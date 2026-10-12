const fs = require("fs");
const path = require("path");

const { buildEvidencePlan } = require("./evidence-planner");
const { mapWithConcurrency } = require("./batch-utils");
const { getKbRoot, loadManifest, readJson } = require("./kb-config");
const { buildKbChunkIndex, invalidateKbChunkIndex, searchChunks } = require("./local-retriever");
const { recordQualityEvent } = require("./quality-monitor");
const { routeIssue } = require("./issue-router");
const { fetchReferenceSnapshot } = require("./secure-fetch");
const { readIndex, searchUploadIndex } = require("./upload-index");

const FETCHABLE_INGEST_TYPES = new Set(["html", "json", "text"]);
const AGENTIC_STATE_PATH = path.join(getKbRoot(), "agentic_refresh_state.json");
const MAX_ANALYSIS_HISTORY = 100;

function isFetchableSource(source = {}) {
  return Boolean(source.url) && FETCHABLE_INGEST_TYPES.has(String(source.ingestAs || "").trim());
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function scoreIssueForAgenticCoverage(issue = {}) {
  const id = String(issue.id || "");
  const title = String(issue.title || "").toLowerCase();
  let score = issue.status === "fail" ? 100 : 25;

  if (id.startsWith("L_") || title.includes("css") || title.includes("layout")) {
    score += 80;
  } else if (id.startsWith("JS_") || title.includes("javascript") || title.includes("script")) {
    score += 75;
  } else if (id.startsWith("S_") || id.startsWith("NCX_") || id.startsWith("NAV_")) {
    score += 60;
  } else if (id.startsWith("T_")) {
    score += 50;
  } else if (id.startsWith("A_") || id.startsWith("IMG_")) {
    score += 40;
  } else if (id.startsWith("M_")) {
    score += 30;
  }

  return score;
}

function sampleToText(sample = {}) {
  return Object.entries(sample)
    .flatMap(([key, value]) => {
      if (value === undefined || value === null || value === "") {
        return [];
      }

      if (Array.isArray(value)) {
        return value.map((item) => `${key} ${item}`);
      }

      if (typeof value === "object") {
        return `${key} ${JSON.stringify(value)}`;
      }

      return `${key} ${value}`;
    })
    .join(" ");
}

function buildIssueQuery(issue = {}) {
  const details = issue.details || {};
  const detailSamples = safeArray(details.samples)
    .slice(0, 3)
    .map((sample) => sampleToText(sample));

  return [
    issue.id,
    issue.title,
    safeArray(details.files).slice(0, 3).join(" "),
    detailSamples.join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function computeCoverage({ evidencePlan, kbResults, uploadResults }) {
  const kbTopScore = Number(kbResults?.[0]?.score || 0);
  const uploadTopScore = Number(uploadResults?.[0]?.score || 0);
  const totalSources = safeArray(evidencePlan?.sources).length;
  const locallyAvailableSources = safeArray(evidencePlan?.sources).filter(
    (source) => source.locallyAvailable
  ).length;
  const missingSources = safeArray(evidencePlan?.sources).filter(
    (source) => !source.locallyAvailable
  );

  const hasEvidence = kbResults.length > 0 || uploadResults.length > 0;
  const status = !hasEvidence
    ? "insufficient"
    : missingSources.length > 0 && kbResults.length < Math.min(2, Math.max(1, totalSources))
      ? "partial"
      : "grounded";

  return {
    status,
    kbTopScore,
    uploadTopScore,
    kbResultCount: kbResults.length,
    uploadResultCount: uploadResults.length,
    sourceCount: totalSources,
    locallyAvailableSources,
    missingSources: missingSources.map((source) => ({
      id: source.id,
      title: source.title,
      url: source.url,
      ingestAs: source.ingestAs,
    })),
  };
}

function readAgenticState() {
  return readJson(AGENTIC_STATE_PATH, {
    updatedAt: "",
    analyses: [],
  });
}

function writeAgenticState(payload) {
  fs.writeFileSync(AGENTIC_STATE_PATH, JSON.stringify(payload, null, 2), "utf8");
  return AGENTIC_STATE_PATH;
}

function recordAgenticAnalysis(entry) {
  const current = readAgenticState();
  const analyses = safeArray(current.analyses);
  analyses.unshift(entry);

  const payload = {
    updatedAt: new Date().toISOString(),
    analyses: analyses.slice(0, MAX_ANALYSIS_HISTORY),
  };

  writeAgenticState(payload);
  return payload;
}

async function refreshMissingSources(evidencePlan, options = {}) {
  const route = evidencePlan?.route || {};
  const autoRefresh = options.autoRefresh === true;
  const actions = [];

  if (!autoRefresh || route.allowExternalFetch !== true) {
    return actions;
  }

  for (const source of safeArray(evidencePlan.sources)) {
    if (source.locallyAvailable || !isFetchableSource(source)) {
      continue;
    }

    try {
      const snapshot = await fetchReferenceSnapshot(source.url, {
        forceRefresh: options.forceRefresh === true,
        timeoutMs: options.timeoutMs,
        sourceId: source.id,
        sourceTitle: source.title,
        category: source.category,
        useFor: source.useFor,
      });

      actions.push({
        sourceId: source.id,
        title: source.title,
        status: "fetched",
        cached: snapshot.cached === true,
        url: source.url,
      });
    } catch (error) {
      actions.push({
        sourceId: source.id,
        title: source.title,
        status: "failed",
        url: source.url,
        error: error.message,
      });
    }
  }

  return actions;
}

async function runAgenticQuery({
  query,
  issue = null,
  documentType = "epub",
  uploadIndexId = "",
  uploadIndexPayload = null,
  kbLimit = 6,
  uploadLimit = 6,
  sourceLimit = 8,
  autoRefresh = false,
  forceRefresh = false,
  timeoutMs,
  sourceFile = "",
} = {}) {
  const trimmedQuery = String(query || "").trim();
  if (!trimmedQuery) {
    throw new Error("query is required");
  }

  const effectiveUploadIndex =
    uploadIndexPayload || (uploadIndexId ? readIndex(uploadIndexId) : null);
  let evidencePlan = issue?.id
    ? buildEvidencePlan({
        issue,
        documentType,
        limit: sourceLimit,
      })
    : null;

  const searchOptions = {
    limit: kbLimit,
    sourceIds: safeArray(evidencePlan?.sources).map((source) => source.id),
  };

  let kbResults = searchChunks(buildKbChunkIndex(), trimmedQuery, searchOptions);
  const uploadResults = effectiveUploadIndex
    ? searchUploadIndex(effectiveUploadIndex, trimmedQuery, {
        limit: uploadLimit,
      })
    : [];

  const refreshActions = await refreshMissingSources(evidencePlan, {
    autoRefresh,
    forceRefresh,
    timeoutMs,
  });

  if (refreshActions.some((action) => action.status === "fetched")) {
    invalidateKbChunkIndex();
    evidencePlan = issue?.id
      ? buildEvidencePlan({
          issue,
          documentType,
          limit: sourceLimit,
        })
      : null;
    kbResults = searchChunks(buildKbChunkIndex(), trimmedQuery, {
      limit: kbLimit,
      sourceIds: safeArray(evidencePlan?.sources).map((source) => source.id),
    });
  }

  const coverage = computeCoverage({
    evidencePlan,
    kbResults,
    uploadResults,
  });

  recordQualityEvent("augmentation", {
    queryChars: trimmedQuery.length,
    issueId: issue?.id || "",
    coverageStatus: coverage.status,
    sourceCount: coverage.sourceCount,
    kbResultCount: coverage.kbResultCount,
    uploadResultCount: coverage.uploadResultCount,
    missingSourceCount: coverage.missingSources.length,
  });

  const entry = {
    analyzedAt: new Date().toISOString(),
    query: trimmedQuery,
    documentType,
    issueId: issue?.id || "",
    sourceFile: sourceFile || effectiveUploadIndex?.sourceFile || "",
    uploadIndexId: effectiveUploadIndex?.indexId || uploadIndexId || "",
    route: issue?.id ? routeIssue({ issue, documentType }) : null,
    coverage,
    refreshedSources: refreshActions
      .filter((action) => action.status === "fetched")
      .map((action) => action.sourceId),
  };

  recordAgenticAnalysis(entry);

  return {
    query: trimmedQuery,
    evidencePlan,
    kbResults,
    uploadResults,
    coverage,
    upload: effectiveUploadIndex
      ? {
          indexId: effectiveUploadIndex.indexId,
          documentType: effectiveUploadIndex.documentType,
          sourceFile: effectiveUploadIndex.sourceFile,
          summary: effectiveUploadIndex.summary || null,
        }
      : null,
    refresh: {
      attempted: autoRefresh === true,
      actions: refreshActions,
      statePath: AGENTIC_STATE_PATH,
    },
  };
}

async function summarizeValidationAgenticCoverage({
  report,
  documentType = "epub",
  uploadIndexPayload = null,
  uploadIndexId = "",
  autoRefresh = false,
  sourceFile = "",
  parallelIssueLimit = Number(process.env.AGENTIC_QUERY_CONCURRENCY || 4),
} = {}) {
  const issues = safeArray(report?.results)
    .filter((result) => result.status === "fail" || result.status === "warn")
    .reduce((accumulator, result) => {
      if (!accumulator.some((entry) => entry.id === result.id)) {
        accumulator.push(result);
      }
      return accumulator;
    }, [])
    .sort((left, right) => scoreIssueForAgenticCoverage(right) - scoreIssueForAgenticCoverage(left))
    .slice(0, 12);

  const analyses = (
    await mapWithConcurrency(
      issues,
      async (issue) => {
        const query = buildIssueQuery(issue);
        if (!query) {
          return null;
        }

        return runAgenticQuery({
          query,
          issue,
          documentType,
          uploadIndexPayload,
          uploadIndexId,
          autoRefresh,
          sourceFile,
        });
      },
      {
        concurrency: Math.max(1, Number(parallelIssueLimit || 4)),
      }
    )
  ).filter(Boolean);

  const statusCounts = analyses.reduce((summary, analysis) => {
    const key = analysis.coverage?.status || "unknown";
    summary[key] = (summary[key] || 0) + 1;
    return summary;
  }, {});

  const refreshedSources = analyses.flatMap((analysis) =>
    safeArray(analysis.refresh?.actions)
      .filter((action) => action.status === "fetched")
      .map((action) => action.sourceId)
  );

  return {
    uploadIndexId: uploadIndexPayload?.indexId || uploadIndexId || "",
    uploadSummary: uploadIndexPayload?.summary || null,
    parallelIssueLimit: Math.max(1, Number(parallelIssueLimit || 4)),
    issueCount: analyses.length,
    statusCounts,
    refreshedSources: Array.from(new Set(refreshedSources)),
    analyses: analyses.map((analysis) => ({
      issueId: analysis.evidencePlan?.issueId || "",
      query: analysis.query,
      route: analysis.evidencePlan?.route || null,
      sources: safeArray(analysis.evidencePlan?.sources).slice(0, 6),
      topKbResults: safeArray(analysis.kbResults).slice(0, 3),
      topUploadResults: safeArray(analysis.uploadResults).slice(0, 3),
      coverage: analysis.coverage,
      refresh: analysis.refresh,
    })),
    statePath: AGENTIC_STATE_PATH,
  };
}

function getAgenticState() {
  return readAgenticState();
}

function getRelevantManifestSources(useCases = []) {
  const requestedUseCases = new Set(safeArray(useCases));
  if (!requestedUseCases.size) {
    return [];
  }

  return safeArray(loadManifest().sources).filter((source) =>
    safeArray(source.use_for).some((value) => requestedUseCases.has(value))
  );
}

module.exports = {
  buildIssueQuery,
  getAgenticState,
  getRelevantManifestSources,
  runAgenticQuery,
  scoreIssueForAgenticCoverage,
  summarizeValidationAgenticCoverage,
};

const fs = require("fs");
const path = require("path");

function resolveQualityStatePath() {
  const baseDir = process.env.EPUB_ANALYSIS_DB_DIR
    ? path.resolve(process.env.EPUB_ANALYSIS_DB_DIR)
    : path.join(__dirname, "../../storage_data");
  return path.join(baseDir, "rag_quality_state.json");
}

function buildTempPath(filePath) {
  const suffix = `${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  return `${filePath}.${suffix}.tmp`;
}

const QUALITY_STATE_PATH = resolveQualityStatePath();
const MAX_RECENT_EVENTS = 120;

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function round(value, digits = 4) {
  return Number((Number(value) || 0).toFixed(digits));
}

function updateAverage(currentAverage, currentCount, nextValue) {
  const count = Number(currentCount) || 0;
  const next = Number(nextValue) || 0;
  if (count <= 0) {
    return round(next);
  }

  return round((currentAverage * count + next) / (count + 1));
}

function incrementCounter(map, key, amount = 1) {
  const normalizedKey = String(key || "unknown").trim() || "unknown";
  map[normalizedKey] = (map[normalizedKey] || 0) + amount;
}

function defaultState() {
  return {
    updatedAt: "",
    phases: {
      embedding: {
        eventCount: 0,
        avgChunkCount: 0,
        avgTokenCount: 0,
        avgChunkChars: 0,
        modelUsage: {},
        strategyUsage: {},
      },
      retrieval: {
        searchCount: 0,
        zeroHitCount: 0,
        lowScoreCount: 0,
        avgResultCount: 0,
        avgTopScore: 0,
        avgTop3Score: 0,
      },
      augmentation: {
        contextCount: 0,
        groundedCount: 0,
        partialCount: 0,
        insufficientCount: 0,
        avgSourceCount: 0,
        avgKbResults: 0,
        avgUploadResults: 0,
        avgMissingSources: 0,
      },
      generation: {
        callCount: 0,
        successCount: 0,
        failureCount: 0,
        fallbackCount: 0,
        avgLatencyMs: 0,
        avgTextChars: 0,
        providerUsage: {},
        modelUsage: {},
        taskTypeUsage: {},
      },
      evaluation: {
        reportCount: 0,
        passCount: 0,
        warnCount: 0,
        failCount: 0,
        avgHumanReviewRate: 0,
        avgLowConfidenceRate: 0,
        avgAutomationReadiness: 0,
      },
    },
    recentEvents: [],
  };
}

function ensureStateDir() {
  fs.mkdirSync(path.dirname(QUALITY_STATE_PATH), { recursive: true });
}

function readState() {
  ensureStateDir();
  if (!fs.existsSync(QUALITY_STATE_PATH)) {
    return defaultState();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(QUALITY_STATE_PATH, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return defaultState();
    }

    return {
      ...defaultState(),
      ...parsed,
      phases: {
        ...defaultState().phases,
        ...(parsed.phases || {}),
      },
      recentEvents: Array.isArray(parsed.recentEvents) ? parsed.recentEvents : [],
    };
  } catch (error) {
    return defaultState();
  }
}

function writeState(payload) {
  ensureStateDir();
  const tempPath = buildTempPath(QUALITY_STATE_PATH);
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf8");

  try {
    fs.renameSync(tempPath, QUALITY_STATE_PATH);
    return;
  } catch (error) {
    if (!error || !["EPERM", "EACCES"].includes(error.code)) {
      throw error;
    }
  }

  fs.copyFileSync(tempPath, QUALITY_STATE_PATH);
  fs.unlinkSync(tempPath);
}

function recordRecentEvent(state, phase, payload = {}) {
  state.recentEvents.unshift({
    phase,
    timestamp: new Date().toISOString(),
    payload,
  });
  state.recentEvents = state.recentEvents.slice(0, MAX_RECENT_EVENTS);
}

function recordEmbeddingEvent(state, payload = {}) {
  const embedding = state.phases.embedding;
  const nextCount = embedding.eventCount;
  embedding.avgChunkCount = updateAverage(
    embedding.avgChunkCount,
    nextCount,
    payload.chunkCount || 0
  );
  embedding.avgTokenCount = updateAverage(
    embedding.avgTokenCount,
    nextCount,
    payload.tokenCount || 0
  );
  embedding.avgChunkChars = updateAverage(
    embedding.avgChunkChars,
    nextCount,
    payload.averageChunkChars || 0
  );
  embedding.eventCount += 1;
  incrementCounter(embedding.modelUsage, payload.model || "structured-chunking");
  incrementCounter(
    embedding.strategyUsage,
    payload.strategy || payload.documentType || "default"
  );
}

function recordRetrievalEvent(state, payload = {}) {
  const retrieval = state.phases.retrieval;
  const nextCount = retrieval.searchCount;
  const topScore = Number(payload.topScore || 0);
  const top3Score = Number(payload.top3Score || topScore || 0);
  const resultCount = Number(payload.resultCount || 0);

  retrieval.avgResultCount = updateAverage(retrieval.avgResultCount, nextCount, resultCount);
  retrieval.avgTopScore = updateAverage(retrieval.avgTopScore, nextCount, topScore);
  retrieval.avgTop3Score = updateAverage(retrieval.avgTop3Score, nextCount, top3Score);
  retrieval.searchCount += 1;
  if (resultCount === 0) {
    retrieval.zeroHitCount += 1;
  }
  if (topScore > 0 && topScore < 0.3) {
    retrieval.lowScoreCount += 1;
  }
}

function recordAugmentationEvent(state, payload = {}) {
  const augmentation = state.phases.augmentation;
  const nextCount = augmentation.contextCount;
  augmentation.avgSourceCount = updateAverage(
    augmentation.avgSourceCount,
    nextCount,
    payload.sourceCount || 0
  );
  augmentation.avgKbResults = updateAverage(
    augmentation.avgKbResults,
    nextCount,
    payload.kbResultCount || 0
  );
  augmentation.avgUploadResults = updateAverage(
    augmentation.avgUploadResults,
    nextCount,
    payload.uploadResultCount || 0
  );
  augmentation.avgMissingSources = updateAverage(
    augmentation.avgMissingSources,
    nextCount,
    payload.missingSourceCount || 0
  );
  augmentation.contextCount += 1;

  switch (String(payload.coverageStatus || "").trim().toLowerCase()) {
    case "grounded":
      augmentation.groundedCount += 1;
      break;
    case "partial":
      augmentation.partialCount += 1;
      break;
    default:
      augmentation.insufficientCount += 1;
      break;
  }
}

function recordGenerationEvent(state, payload = {}) {
  const generation = state.phases.generation;
  const nextCount = generation.callCount;
  const latencyMs = Number(payload.latencyMs || 0);
  const textChars = Number(payload.textChars || 0);

  generation.avgLatencyMs = updateAverage(generation.avgLatencyMs, nextCount, latencyMs);
  generation.avgTextChars = updateAverage(generation.avgTextChars, nextCount, textChars);
  generation.callCount += 1;
  if (payload.success === true) {
    generation.successCount += 1;
  } else {
    generation.failureCount += 1;
  }
  if (payload.fallbackUsed === true) {
    generation.fallbackCount += 1;
  }
  incrementCounter(generation.providerUsage, payload.provider || "unknown");
  incrementCounter(generation.modelUsage, payload.model || "unknown");
  incrementCounter(generation.taskTypeUsage, payload.taskType || "default");
}

function recordEvaluationEvent(state, payload = {}) {
  const evaluation = state.phases.evaluation;
  const nextCount = evaluation.reportCount;
  const actionableCount = Math.max(1, Number(payload.actionableCount || 0));
  const humanReviewRate = clamp(Number(payload.humanReviewCount || 0) / actionableCount);
  const lowConfidenceRate = clamp(Number(payload.lowConfidenceCount || 0) / actionableCount);
  const automationReadiness =
    String(payload.status || "").toLowerCase() === "pass"
      ? 1
      : String(payload.status || "").toLowerCase() === "warn"
        ? 0.65
        : 0.25;

  evaluation.avgHumanReviewRate = updateAverage(
    evaluation.avgHumanReviewRate,
    nextCount,
    humanReviewRate
  );
  evaluation.avgLowConfidenceRate = updateAverage(
    evaluation.avgLowConfidenceRate,
    nextCount,
    lowConfidenceRate
  );
  evaluation.avgAutomationReadiness = updateAverage(
    evaluation.avgAutomationReadiness,
    nextCount,
    automationReadiness
  );
  evaluation.reportCount += 1;
  incrementCounter(evaluation, `${String(payload.status || "unknown").toLowerCase()}Count`);
}

function recordQualityEvent(phase, payload = {}) {
  const state = readState();
  const normalizedPhase = String(phase || "").trim().toLowerCase();

  if (normalizedPhase === "embedding") {
    recordEmbeddingEvent(state, payload);
  } else if (normalizedPhase === "retrieval") {
    recordRetrievalEvent(state, payload);
  } else if (normalizedPhase === "augmentation") {
    recordAugmentationEvent(state, payload);
  } else if (normalizedPhase === "generation") {
    recordGenerationEvent(state, payload);
  } else if (normalizedPhase === "evaluation") {
    recordEvaluationEvent(state, payload);
  }

  state.updatedAt = new Date().toISOString();
  recordRecentEvent(state, normalizedPhase || "unknown", payload);
  writeState(state);
  return state;
}

function buildRecommendations(state) {
  const retrieval = state.phases.retrieval;
  const augmentation = state.phases.augmentation;
  const generation = state.phases.generation;
  const evaluation = state.phases.evaluation;
  const recommendations = [];

  const zeroHitRate =
    retrieval.searchCount > 0 ? retrieval.zeroHitCount / retrieval.searchCount : 0;
  const lowScoreRate =
    retrieval.searchCount > 0 ? retrieval.lowScoreCount / retrieval.searchCount : 0;
  const partialRate =
    augmentation.contextCount > 0 ? augmentation.partialCount / augmentation.contextCount : 0;
  const insufficientRate =
    augmentation.contextCount > 0
      ? augmentation.insufficientCount / augmentation.contextCount
      : 0;
  const failureRate =
    generation.callCount > 0 ? generation.failureCount / generation.callCount : 0;
  const fallbackRate =
    generation.callCount > 0 ? generation.fallbackCount / generation.callCount : 0;

  if (zeroHitRate > 0.25) {
    recommendations.push(
      "Retrieval zero-hit rate is high. Expand the KB, add rule-aware query synonyms, and review chunk overlap."
    );
  }
  if (retrieval.avgTopScore > 0 && retrieval.avgTopScore < 0.35) {
    recommendations.push(
      "Average retrieval top score is weak. Tighten chunk granularity and prioritize CSS/JS-specific query expansion."
    );
  }
  if (lowScoreRate > 0.3) {
    recommendations.push(
      "Many retrievals are low-confidence. Add more gold fixes, false-positive examples, and reading-system compatibility snippets."
    );
  }
  if (partialRate > 0.25 || insufficientRate > 0.1) {
    recommendations.push(
      "Grounding coverage is incomplete. Refresh missing reference sources and enrich upload indexing before auto-fix."
    );
  }
  if (failureRate > 0.1) {
    recommendations.push(
      "Generation failure rate is elevated. Check LLM endpoint stability, timeout policy, and structured-output prompts."
    );
  }
  if (fallbackRate > 0.25) {
    recommendations.push(
      "Fallback usage is high. The primary model path is unstable and should be investigated before trusting unattended fixes."
    );
  }
  if (evaluation.avgHumanReviewRate > 0.65) {
    recommendations.push(
      "Human review volume is heavy. Expand deterministic fixers and promote only high-approval fix patterns into auto-fix."
    );
  }
  if (evaluation.avgLowConfidenceRate > 0.35) {
    recommendations.push(
      "Low-confidence issue rate is high. Improve chunk evidence quality and tighten severity/confidence calibration."
    );
  }

  if (!recommendations.length) {
    recommendations.push(
      "RAG quality signals are stable. Continue growing the gold correction set and re-validate thresholds on a regression corpus."
    );
  }

  return recommendations;
}

function buildAccuracySignals(state) {
  const retrieval = state.phases.retrieval;
  const augmentation = state.phases.augmentation;
  const generation = state.phases.generation;
  const evaluation = state.phases.evaluation;

  const retrievalHitRate =
    retrieval.searchCount > 0 ? 1 - retrieval.zeroHitCount / retrieval.searchCount : 0;
  const retrievalQualityScore =
    retrieval.searchCount > 0
      ? clamp(retrievalHitRate * 0.45 + retrieval.avgTopScore * 0.55)
      : 0;
  const groundingScore =
    augmentation.contextCount > 0
      ? clamp(
          (augmentation.groundedCount + augmentation.partialCount * 0.5) /
            augmentation.contextCount
        )
      : 0;
  const generationReliabilityScore =
    generation.callCount > 0
      ? clamp(
          generation.successCount / generation.callCount -
            generation.fallbackCount / Math.max(generation.callCount, 1) * 0.2
        )
      : 0;
  const automationReadinessScore = clamp(evaluation.avgAutomationReadiness || 0);
  const overallScore = clamp(
    (retrievalQualityScore + groundingScore + generationReliabilityScore + automationReadinessScore) /
      4
  );

  return {
    retrievalHitRate: round(retrievalHitRate),
    retrievalQualityScore: round(retrievalQualityScore),
    groundingScore: round(groundingScore),
    generationReliabilityScore: round(generationReliabilityScore),
    automationReadinessScore: round(automationReadinessScore),
    overallScore: round(overallScore),
  };
}

function getQualityMonitorStatus() {
  const state = readState();
  return {
    path: QUALITY_STATE_PATH,
    updatedAt: state.updatedAt,
    phases: state.phases,
    accuracySignals: buildAccuracySignals(state),
    recommendations: buildRecommendations(state),
    recentEvents: state.recentEvents.slice(0, 20),
  };
}

module.exports = {
  getQualityMonitorStatus,
  recordQualityEvent,
};

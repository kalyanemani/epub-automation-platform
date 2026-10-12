const path = require("path");

const validateEpub = require("../validateEpub");
const validatePdf = require("../validatePdf");
const { statusRank, unique } = require("./issue-router");
const { evaluateValidationReport } = require("../utils/validator-agent");

function toResultMap(report = {}) {
  const map = new Map();
  const results = Array.isArray(report?.results) ? report.results : [];
  results.forEach((result) => {
    if (result?.id) {
      map.set(result.id, result);
    }
  });
  return map;
}

function summarizeTargetedIssues(beforeMap, afterMap, targetedIssueIds) {
  return targetedIssueIds.map((issueId) => {
    const before = beforeMap.get(issueId) || null;
    const after = afterMap.get(issueId) || null;
    const beforeStatus = before?.status || "missing";
    const afterStatus = after?.status || "missing";
    const beforeRank = statusRank(beforeStatus);
    const afterRank = statusRank(afterStatus);

    let outcome = "unchanged";
    if (afterRank < beforeRank) {
      outcome = "improved";
    } else if (afterRank > beforeRank) {
      outcome = "worsened";
    } else if (beforeStatus !== afterStatus) {
      outcome = "changed";
    }

    if (beforeRank > 0 && afterRank === 0) {
      outcome = "resolved";
    }

    return {
      issueId,
      beforeStatus,
      afterStatus,
      outcome,
    };
  });
}

function findNewFailures(beforeMap, afterMap) {
  return Array.from(afterMap.values())
    .filter((result) => result.status === "fail")
    .filter((result) => {
      const before = beforeMap.get(result.id);
      return !before || statusRank(before.status) < statusRank(result.status);
    })
    .map((result) => ({
      issueId: result.id,
      title: result.title,
      status: result.status,
    }));
}

async function verifyAutofixResult({
  documentType = "epub",
  filePath,
  originalReport,
  targetedIssueIds = [],
} = {}) {
  if (!filePath) {
    return {
      verified: false,
      documentType,
      error: "filePath is required for post-fix verification.",
    };
  }

  try {
    const verificationReport =
      documentType === "pdf"
        ? await validatePdf(filePath, { enrichAiSuggestions: false })
        : await validateEpub(filePath, {
            enrichAiSuggestions: false,
            skipVisualChecks: true,
        });

    const beforeMap = toResultMap(originalReport);
    const afterMap = toResultMap(verificationReport);
    const targeted = unique(
      targetedIssueIds.length
        ? targetedIssueIds
        : Array.from(beforeMap.values())
            .filter((result) => result.status === "fail" || result.status === "warn")
            .map((result) => result.id)
    );

    const targetedSummary = summarizeTargetedIssues(beforeMap, afterMap, targeted);
    const resolved = targetedSummary.filter((entry) => entry.outcome === "resolved").length;
    const improved = targetedSummary.filter(
      (entry) => entry.outcome === "resolved" || entry.outcome === "improved"
    ).length;
    const worsened = targetedSummary.filter((entry) => entry.outcome === "worsened").length;
    const newFailures = findNewFailures(beforeMap, afterMap);

    return {
      verified: true,
      documentType,
      sourceFile: path.basename(filePath),
      summary: {
        targetedIssueCount: targetedSummary.length,
        improved,
        resolved,
        worsened,
        newFailures: newFailures.length,
      },
      targetedIssues: targetedSummary,
      newFailures,
      results: verificationReport.results || [],
      report: verificationReport,
      reportSummary: verificationReport.summary || null,
      validatorAgent: evaluateValidationReport({
        results: verificationReport.results || [],
        documentType,
        sourceFile: path.basename(filePath),
      }),
    };
  } catch (error) {
    return {
      verified: false,
      documentType,
      sourceFile: path.basename(filePath),
      error: error.message,
    };
  }
}

module.exports = {
  verifyAutofixResult,
};

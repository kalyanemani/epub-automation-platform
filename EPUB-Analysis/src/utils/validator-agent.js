const { REPORT_THRESHOLDS } = require("./report-annotator");
const { recordQualityEvent } = require("../rag/quality-monitor");

function countBy(values = []) {
  return values.reduce((summary, value) => {
    const key = String(value || "Unknown");
    summary[key] = (summary[key] || 0) + 1;
    return summary;
  }, {});
}

function buildReleaseReadiness({
  kind = "validation_report",
  status = "warn",
  actionableCount = 0,
  completeBreakageCount = 0,
  humanReviewCount = 0,
  afterActionableCount = 0,
  newFailures = 0,
  worsened = 0,
} = {}) {
  if (kind === "autofix_report") {
    if (status === "pass") {
      return {
        label: "Ready for final QA review",
        summary:
          "The follow-up check shows improvement without new failures, so this file can move to final review.",
      };
    }

    if (status === "fail") {
      return {
        label: "Not ready for release",
        summary:
          "The autofix introduced new problems or made some issues worse, so a human rollback review is required.",
      };
    }

    return {
      label: "Needs manual validation",
      summary: `${afterActionableCount} issue(s) still remain after autofix, so a human should review the remaining problems before release.`,
    };
  }

  if (status === "pass") {
    return {
      label: "Ready for release review",
      summary:
        actionableCount === 0
          ? "No fail or warning items remain in this report."
          : "The report is traceable and the remaining issues are ready for release review.",
    };
  }

  if (status === "fail") {
    return {
      label: "Not ready for release",
      summary:
        completeBreakageCount > 0
          ? `${completeBreakageCount} issue(s) could break the book package, navigation, or reading behavior and should be fixed first.`
          : "The report is missing critical traceability details and should not be used as a release decision artifact yet.",
    };
  }

  return {
    label: "Needs production review",
    summary: `${humanReviewCount} issue(s) still need human judgment before the book can move forward confidently.`,
  };
}

function buildNextActions(recommendations = [], fallback = "") {
  const actions = recommendations
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .slice(0, 4);

  if (!actions.length && fallback) {
    actions.push(fallback);
  }

  return actions;
}

function evaluateValidationReport({ results = [], documentType = "epub", sourceFile = "" } = {}) {
  const actionable = results.filter((result) => {
    const status = String(result?.status || "").toLowerCase();
    return status === "fail" || status === "warn";
  });
  const missingLocationCount = actionable.filter(
    (result) => !String(result?.locationText || result?.report_meta?.locationText || "").trim()
  ).length;
  const missingHumanReadableCount = actionable.filter(
    (result) =>
      !String(
        result?.humanReadableError ||
          result?.humanReadableDetails ||
          result?.report_meta?.humanReadableDetails ||
          ""
      ).trim()
  ).length;
  const lowConfidenceCount = actionable.filter(
    (result) => Number(result?.confidenceScore || 0) < REPORT_THRESHOLDS.mediumConfidenceMin
  ).length;
  const humanReviewCount = actionable.filter((result) => result?.humanReviewRequired === true).length;
  const completeBreakageCount = actionable.filter(
    (result) => result?.breakageRisk === "Complete EPUB breakage"
  ).length;
  const issueSizes = countBy(actionable.map((result) => result?.issueSize || "Unknown"));

  let status = "pass";
  if (missingLocationCount > 0 || missingHumanReadableCount > 0) {
    status = "fail";
  } else if (lowConfidenceCount > 0 || humanReviewCount > 0) {
    status = "warn";
  }

  const recommendations = [];
  if (completeBreakageCount > 0) {
    recommendations.push(
      `${completeBreakageCount} issue(s) can break the EPUB package or navigation and should stay at the top of the queue.`
    );
  }
  if (lowConfidenceCount > 0) {
    recommendations.push(
      `${lowConfidenceCount} issue(s) are below the medium-confidence threshold and should remain in human review.`
    );
  }
  if (missingLocationCount > 0 || missingHumanReadableCount > 0) {
    recommendations.push(
      "The report still has missing traceability fields and should not be treated as release-ready."
    );
  }
  if (!recommendations.length) {
    recommendations.push("The report is traceable and can be used for review and release triage.");
  }

  const releaseReadiness = buildReleaseReadiness({
    kind: "validation_report",
    status,
    actionableCount: actionable.length,
    completeBreakageCount,
    humanReviewCount,
  });
  const nextActions = buildNextActions(
    recommendations,
    "Review the remaining issues in order of breakage risk and confidence."
  );

  recordQualityEvent("evaluation", {
    kind: "validation_report",
    status,
    actionableCount: actionable.length,
    lowConfidenceCount,
    humanReviewCount,
  });

  return {
    kind: "validation_report",
    status,
    documentType,
    sourceFile,
    thresholds: REPORT_THRESHOLDS,
    summary: {
      actionableCount: actionable.length,
      missingLocationCount,
      missingHumanReadableCount,
      lowConfidenceCount,
      humanReviewCount,
      completeBreakageCount,
      issueSizes,
    },
    narrative:
      actionable.length === 0
        ? "No fail or warning items were left in the validation report."
        : `Reviewed ${actionable.length} actionable item(s). ${humanReviewCount} item(s) remain in the human-review queue.`,
    releaseReadiness,
    nextActions,
    recommendations,
  };
}

function evaluateAutofixReport({
  preResults = [],
  postResults = [],
  verification = {},
  documentType = "epub",
  sourceFile = "",
} = {}) {
  const beforeActionable = preResults.filter((result) => {
    const status = String(result?.status || "").toLowerCase();
    return status === "fail" || status === "warn";
  });
  const afterActionable = postResults.filter((result) => {
    const status = String(result?.status || "").toLowerCase();
    return status === "fail" || status === "warn";
  });

  const summary = verification?.summary || {};
  const worsened = Number(summary?.worsened || 0);
  const newFailures = Number(summary?.newFailures || 0);
  const resolved = Number(summary?.resolved || 0);
  const improved = Number(summary?.improved || 0);

  let status = "pass";
  if (worsened > 0 || newFailures > 0) {
    status = "fail";
  } else if (!postResults.length || afterActionable.length > 0) {
    status = "warn";
  }

  const recommendations = [];
  if (!postResults.length) {
    recommendations.push("Post-fix validation results are missing, so the autofix report is incomplete.");
  }
  if (worsened > 0 || newFailures > 0) {
    recommendations.push("The autofix introduced regressions or new failures and needs manual rollback review.");
  }
  if (afterActionable.length > 0) {
    recommendations.push(
      `${afterActionable.length} issue(s) remain after autofix and should be kept in the manual validation queue.`
    );
  }
  if (!recommendations.length) {
    recommendations.push("The autofix report shows improvement without new failures.");
  }

  const releaseReadiness = buildReleaseReadiness({
    kind: "autofix_report",
    status,
    afterActionableCount: afterActionable.length,
    newFailures,
    worsened,
  });
  const nextActions = buildNextActions(
    recommendations,
    "Review the remaining items and rerun the follow-up validation before release."
  );

  recordQualityEvent("evaluation", {
    kind: "autofix_report",
    status,
    actionableCount: Math.max(beforeActionable.length, afterActionable.length),
    lowConfidenceCount: 0,
    humanReviewCount: afterActionable.length,
  });

  return {
    kind: "autofix_report",
    status,
    documentType,
    sourceFile,
    thresholds: REPORT_THRESHOLDS,
    summary: {
      beforeActionableCount: beforeActionable.length,
      afterActionableCount: afterActionable.length,
      targetedIssueCount: Number(summary?.targetedIssueCount || 0),
      improved,
      resolved,
      worsened,
      newFailures,
      remainingIssueSizes: countBy(afterActionable.map((result) => result?.issueSize || "Unknown")),
    },
    narrative:
      beforeActionable.length === 0
        ? "No actionable issues were present before autofix."
        : `Autofix was checked against ${beforeActionable.length} actionable issue(s). ${resolved} item(s) were resolved and ${afterActionable.length} item(s) still remain.`,
    releaseReadiness,
    nextActions,
    recommendations,
  };
}

module.exports = {
  evaluateAutofixReport,
  evaluateValidationReport,
};

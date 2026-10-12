const fs = require("fs");
const path = require("path");

const {
  buildDeterministicIssueNarrative,
  cleanText,
  formatLocationText,
  resolveLocation,
  summarizeDetails,
} = require("./issue-language");

const RULE_REGISTRY_PATH = path.join(
  __dirname,
  "..",
  "..",
  "kb",
  "internal",
  "rules",
  "rule-registry.json"
);

const REPORT_THRESHOLDS = Object.freeze({
  failSeverityMin: 0.85,
  warningSeverityMin: 0.55,
  highConfidenceMin: 0.9,
  mediumConfidenceMin: 0.75,
  autoFixConfidenceMin: 0.92,
});

const CONFIDENCE_VALUE_MAP = Object.freeze({
  high: 0.97,
  medium: 0.84,
  low: 0.62,
});

let cachedRuleRegistry = null;

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function roundToTwo(value) {
  return Number(clamp(value).toFixed(2));
}

function mean(values = []) {
  if (!values.length) {
    return 0;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function readRuleRegistry() {
  if (cachedRuleRegistry) {
    return cachedRuleRegistry;
  }

  try {
    const payload = JSON.parse(fs.readFileSync(RULE_REGISTRY_PATH, "utf8"));
    cachedRuleRegistry = Array.isArray(payload?.rules) ? payload.rules : [];
  } catch (error) {
    cachedRuleRegistry = [];
  }

  return cachedRuleRegistry;
}

function matchesRulePattern(pattern, issueId) {
  const normalizedPattern = String(pattern || "").trim();
  const normalizedIssueId = String(issueId || "").trim();
  if (!normalizedPattern || !normalizedIssueId) {
    return false;
  }

  if (normalizedPattern.endsWith("*")) {
    return normalizedIssueId.startsWith(normalizedPattern.slice(0, -1));
  }

  return normalizedPattern === normalizedIssueId;
}

function getRuleProfile(issueId) {
  return (
    readRuleRegistry().find((rule) => matchesRulePattern(rule.id, issueId)) || null
  );
}

function deriveDomain(issueId, profile = null) {
  if (profile?.category) {
    return String(profile.category)
      .replace(/(^\w|-\w)/g, (match) => match.replace("-", "").toUpperCase());
  }

  const id = String(issueId || "");
  if (id.startsWith("S_")) return "Structure";
  if (id.startsWith("NAV_") || id.startsWith("NCX_")) return "Navigation";
  if (id.startsWith("M_")) return "Metadata";
  if (id.startsWith("A_") || id.startsWith("IMG_")) return "Accessibility";
  if (id.startsWith("JS_")) return "Scripting";
  if (id.startsWith("L_") || id.startsWith("AGENT_CSS") || id.startsWith("AGENT_VISUAL")) {
    return "Layout";
  }
  if (id.startsWith("T_")) return "Text";
  if (id.startsWith("Media_") || id.startsWith("SMIL_")) return "Media";
  return "General";
}

function getSampleArray(issue = {}) {
  return Array.isArray(issue?.details?.samples) ? issue.details.samples : [];
}

function sampleConfidenceToScore(value) {
  if (typeof value === "number") {
    return clamp(value);
  }

  const normalized = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(CONFIDENCE_VALUE_MAP, normalized)
    ? CONFIDENCE_VALUE_MAP[normalized]
    : 0;
}

function extractConfidenceScores(issue = {}) {
  return getSampleArray(issue)
    .map((sample) => sampleConfidenceToScore(sample?.confidence))
    .filter((value) => value > 0);
}

function deriveFallbackLocation(issue = {}, domain = "General", documentType = "epub") {
  const details = issue?.details;

  if (details && typeof details === "object") {
    if (details.chapter) {
      return { file: String(details.chapter) };
    }
    if (details.file) {
      return { file: String(details.file) };
    }
    if (Array.isArray(details.files) && details.files.length) {
      return { file: String(details.files[0]) };
    }
    if (Array.isArray(details.pages) && details.pages.length) {
      return { page: String(details.pages[0]) };
    }
    if (details.opfPath) {
      return { file: String(details.opfPath) };
    }
  }

  const id = String(issue?.id || "");
  if (id.startsWith("NAV_")) {
    return { file: "nav.xhtml" };
  }
  if (id.startsWith("NCX_")) {
    return { file: "toc.ncx" };
  }
  if (id.startsWith("S_") || id.startsWith("M_")) {
    return { file: "content.opf" };
  }
  if (id.startsWith("L_")) {
    return { file: "linked stylesheet or content document" };
  }
  if (id.startsWith("JS_")) {
    return { file: "script asset or content document" };
  }
  if (id.startsWith("T_")) {
    return { file: documentType === "pdf" ? "page text content" : "content document" };
  }
  if (id.startsWith("Media_") || id.startsWith("SMIL_")) {
    return { file: "media asset" };
  }
  if (domain === "Accessibility") {
    return { file: "content document or metadata" };
  }
  return { file: documentType === "pdf" ? "uploaded PDF" : "publication package" };
}

function deriveLocation(issue = {}, domain = "General", documentType = "epub") {
  const resolved = resolveLocation(issue);
  if (resolved) {
    return resolved;
  }

  return deriveFallbackLocation(issue, domain, documentType);
}

function toLocationText(location = null) {
  const text = cleanText(formatLocationText(location));
  if (text) {
    return text;
  }

  if (location?.file) {
    return cleanText(String(location.file));
  }

  if (location?.page) {
    return `Page ${location.page}`;
  }

  return "Publication package";
}

function deriveBreakageRisk(issue = {}, domain = "General") {
  if (String(issue?.status || "").toLowerCase() === "pass") {
    return "No active risk";
  }

  const id = String(issue?.id || "");
  if (
    id.startsWith("S_") ||
    id.startsWith("NAV_") ||
    id.startsWith("NCX_") ||
    [
      "T_SPECIAL_CHAR_ENTITY",
      "Media_missing_file",
      "Media_IMAGE_MISSING_FILE",
      "Media_IMAGE_CORRUPT",
      "Media_video_unreadable",
      "Media_audio_corrupt",
      "L_CSS_REFERENCE_BROKEN",
      "L_CSS_SYNTAX",
      "JS_SCRIPT_REFERENCE_BROKEN",
      "JS_SCRIPT_MANIFEST_MISSING_FILE",
      "JS_SCRIPT_SYNTAX",
    ].includes(id)
  ) {
    return "Complete EPUB breakage";
  }

  if (domain === "Layout" || domain === "Media" || domain === "Text" || domain === "Scripting") {
    return "Chapter or feature breakage";
  }

  if (domain === "Accessibility" || domain === "Metadata") {
    return "Release quality risk";
  }

  return "Reader-facing quality risk";
}

function deriveSeverityScore(issue = {}, domain = "General", breakageRisk = "") {
  const status = String(issue?.status || "").toLowerCase();
  if (status === "pass") {
    return 0;
  }

  let score = 0.6;
  if (breakageRisk === "Complete EPUB breakage") {
    score = 0.96;
  } else if (breakageRisk === "Chapter or feature breakage") {
    score = 0.84;
  } else if (breakageRisk === "Release quality risk") {
    score = 0.72;
  }

  if (status === "warn") {
    score -= 0.14;
  }

  if (getSampleArray(issue).length >= 3) {
    score += 0.03;
  }

  if (domain === "Navigation" || domain === "Structure") {
    score += 0.02;
  }

  return roundToTwo(score);
}

function deriveIssueSize(issue = {}, severityScore = 0, breakageRisk = "", domain = "General") {
  if (String(issue?.status || "").toLowerCase() === "pass") {
    return "Small";
  }

  if (
    breakageRisk === "Complete EPUB breakage" ||
    domain === "Structure" ||
    domain === "Navigation" ||
    severityScore >= REPORT_THRESHOLDS.failSeverityMin
  ) {
    return "Complex";
  }

  if (severityScore >= 0.68) {
    return "Medium";
  }

  return "Small";
}

function baseConfidenceForDomain(domain = "General", issueId = "") {
  if (String(issueId).startsWith("AGENT_")) {
    return 0.78;
  }

  switch (domain) {
    case "Structure":
    case "Navigation":
      return 0.98;
    case "Metadata":
      return 0.93;
    case "Accessibility":
      return 0.9;
    case "Layout":
      return 0.91;
    case "Scripting":
      return 0.9;
    case "Text":
      return 0.88;
    case "Media":
      return 0.9;
    default:
      return 0.85;
  }
}

function deriveConfidence(issue = {}, domain = "General") {
  const status = String(issue?.status || "").toLowerCase();
  if (status === "pass") {
    return 0.99;
  }

  const base = baseConfidenceForDomain(domain, issue?.id);
  const sampleScores = extractConfidenceScores(issue);
  let score = sampleScores.length ? mean(sampleScores) * 0.75 + base * 0.25 : base;

  if (status === "warn") {
    score -= 0.04;
  }

  if (issue?.agentic?.coverage?.status === "partial") {
    score -= 0.03;
  }

  return roundToTwo(score);
}

function confidenceLabel(score = 0) {
  if (score >= REPORT_THRESHOLDS.highConfidenceMin) {
    return "High";
  }
  if (score >= REPORT_THRESHOLDS.mediumConfidenceMin) {
    return "Medium";
  }
  return "Low";
}

function deriveHitlDecision(issue = {}, profile = null, issueSize = "Medium", confidenceScore = 0) {
  const status = String(issue?.status || "").toLowerCase();
  if (status === "pass") {
    return {
      action: "No action needed",
      queue: "none",
      reason: "The check passed.",
      requiresHuman: false,
    };
  }

  const safeToAutofix = Boolean(profile?.safe_to_autofix);
  const requiresManualReview = Boolean(profile?.requires_manual_review);
  if (
    safeToAutofix &&
    !requiresManualReview &&
    issueSize === "Small" &&
    confidenceScore >= REPORT_THRESHOLDS.autoFixConfidenceMin
  ) {
    return {
      action: "Auto-fix candidate",
      queue: "auto_fix",
      reason: "Small issue with high confidence and deterministic safety.",
      requiresHuman: false,
    };
  }

  if (requiresManualReview) {
    return {
      action: "Human review required",
      queue: "human_review",
      reason: "Rule policy requires human review.",
      requiresHuman: true,
    };
  }

  if (issueSize === "Complex" || confidenceScore < REPORT_THRESHOLDS.highConfidenceMin) {
    return {
      action: "LLM-assisted candidate",
      queue: "manual_fix",
      reason: issueSize === "Complex"
        ? "Complex issue will be handled by the LLM-assisted pipeline with extra care."
        : "Lower confidence issue will still go through LLM-assisted remediation.",
      requiresHuman: false,
    };
  }

  return {
    action: "Manual fix queue",
    queue: "manual_fix",
    reason: "The issue is actionable but not safe for direct auto-fix.",
    requiresHuman: false,
  };
}

function buildHumanReadableError(issue = {}, narrative = {}, issueSize = "Medium", confidenceScore = 0) {
  const headline = cleanText(narrative?.headline || issue?.title || "Issue detected");
  const summary = cleanText(
    narrative?.summary || issue?.humanReadableDetails || summarizeDetails(issue)
  );
  const confidence = confidenceLabel(confidenceScore);
  return cleanText(`${headline}. ${summary} Issue size: ${issueSize}. Confidence: ${confidence}.`);
}

function annotateResult(issue = {}, options = {}) {
  const profile = getRuleProfile(issue?.id);
  const domain = deriveDomain(issue?.id, profile);
  const location = deriveLocation(issue, domain, options.documentType || "epub");
  const locationText = toLocationText(location);
  const deterministicNarrative = buildDeterministicIssueNarrative({
    ...issue,
    location,
  });
  const narrative =
    issue?.user_friendly && typeof issue.user_friendly === "object"
      ? {
          ...deterministicNarrative,
          ...issue.user_friendly,
          location: locationText,
        }
      : {
          ...deterministicNarrative,
          location: locationText,
        };
  const breakageRisk = deriveBreakageRisk(issue, domain);
  const severityScore = deriveSeverityScore(issue, domain, breakageRisk);
  const issueSize = deriveIssueSize(issue, severityScore, breakageRisk, domain);
  const confidenceScore = deriveConfidence(issue, domain);
  const hitl = deriveHitlDecision(issue, profile, issueSize, confidenceScore);
  const humanReadableDetails = cleanText(
    narrative.summary || summarizeDetails({ ...issue, location })
  );
  const humanReadableError = buildHumanReadableError(
    {
      ...issue,
      humanReadableDetails,
    },
    narrative,
    issueSize,
    confidenceScore
  );

  return {
    ...issue,
    location,
    locationText,
    issueSize,
    breakageRisk,
    confidenceScore,
    confidenceLabel: confidenceLabel(confidenceScore),
    humanReadableDetails,
    humanReadableError,
    hitlAction: hitl.action,
    humanReviewRequired: hitl.requiresHuman,
    report_meta: {
      domain,
      breakageRisk,
      severityScore,
      issueSize,
      confidenceScore,
      confidenceLabel: confidenceLabel(confidenceScore),
      locationText,
      humanReadableDetails,
      thresholds: REPORT_THRESHOLDS,
      hitl,
      rulePolicy: {
        fixMode: profile?.fix_mode || "manual_review",
        safeToAutofix: Boolean(profile?.safe_to_autofix),
        requiresManualReview: Boolean(profile?.requires_manual_review),
      },
    },
    user_friendly: {
      ...narrative,
      location: locationText,
    },
  };
}

function annotateResults(results = [], options = {}) {
  return results.map((issue) => annotateResult(issue, options));
}

module.exports = {
  REPORT_THRESHOLDS,
  annotateResult,
  annotateResults,
  confidenceLabel,
  getRuleProfile,
};

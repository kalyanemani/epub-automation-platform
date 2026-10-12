const PRIORITY_WEIGHT = {
  P0: 0,
  P1: 1,
  P2: 2,
};

function statusRank(status) {
  switch (String(status || "").toLowerCase()) {
    case "pass":
      return 0;
    case "warn":
      return 1;
    case "fail":
      return 2;
    default:
      return 3;
  }
}

function unique(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function buildRoute(overrides = {}) {
  return {
    fixMode: "rag_assisted",
    rationale: "Use KB-guided, LLM-assisted remediation instead of manual review.",
    kbUseCases: [],
    sourceHints: [],
    allowExternalFetch: false,
    ...overrides,
  };
}

function issueSearchText(issue = {}) {
  const title = String(issue?.title || "");
  const details =
    typeof issue?.details === "string"
      ? issue.details
      : JSON.stringify(issue?.details || {});
  return `${issue?.id || ""} ${title} ${details}`.toLowerCase();
}

function isJavaScriptIssue(issue = {}) {
  const issueId = String(issue?.id || "");
  if (issueId.startsWith("JS_")) {
    return true;
  }

  const text = issueSearchText(issue);
  return [
    "javascript",
    "script",
    "ecmascript",
    "container-constrained",
    "spine-level scripting",
    "dom-manipulation",
    "unsupported api",
  ].some((token) => text.includes(token));
}

function isCssOrLayoutIssue(issue = {}) {
  const issueId = String(issue?.id || "");
  if (issueId.startsWith("L_") || issueId.startsWith("AGENT_CSS") || issueId.startsWith("AGENT_VISUAL")) {
    return true;
  }

  const text = issueSearchText(issue);
  return ["css", "stylesheet", "style sheet", "layout", "rendering", "font-face", "media query"].some((token) =>
    text.includes(token)
  );
}

function routeIssue({ issue = {}, documentType = "epub" } = {}) {
  const issueId = String(issue?.id || "");

  if (!issueId) {
    return buildRoute();
  }

  if (
    issueId.startsWith("S_") ||
    issueId.startsWith("M_") ||
    issueId.startsWith("NCX_") ||
    issueId.startsWith("NAV_")
  ) {
    return buildRoute({
      fixMode: "deterministic",
      rationale: "Structural package and navigation issues should be handled by deterministic logic.",
      kbUseCases: [
        "conformance",
        "opf",
        "manifest",
        "spine",
        "nav",
        "content-docs",
        "pagination-validation",
        "ncx-page-list",
        "nav-validation",
        "toc-fixes",
      ],
      sourceHints: [
        "w3c-epub-33",
        "epubcheck-repo",
        "daisy-toc",
        "daisy-pagelist",
        "daisy-landmarks",
        "daisy-pagenav",
      ],
      allowExternalFetch: true,
    });
  }

  if (issueId === "T_SPECIAL_CHAR_ENTITY") {
    return buildRoute({
      fixMode: "lookup_only",
      rationale: "Entity decoding and Unicode cleanup should use exact lookup tables and normalization rules.",
      kbUseCases: [
        "entity-decoding",
        "special-character-fixes",
        "unicode-cleanup-policy",
        "nfc-normalization",
      ],
      sourceHints: [
        "lookup-html-entities-json",
        "lookup-unicode-tr15",
        "lookup-unicode-data",
        "lookup-unicode-normalization-test",
      ],
      allowExternalFetch: true,
    });
  }

  if (issueId === "T_HYPHENATION_WORD_MERGE") {
    return buildRoute({
      fixMode: "rag_assisted",
      rationale: "Word splits and merges need document context, dictionaries, and protected-word lists.",
      kbUseCases: [
        "line-break-hyphenation",
        "language-specific-splits",
        "spelling-validation",
        "compound-word-handling",
        "candidate-ranking",
        "few-shot-retrieval",
      ],
      sourceHints: [
        "lookup-scowl",
        "lookup-libreoffice-dictionaries",
        "lookup-wordfreq",
        "lookup-hunspell-hyphen",
        "internal-gold-corrections",
      ],
      allowExternalFetch: false,
    });
  }

  if (issueId === "T_MISSING_INCORRECT_TEXT") {
    return buildRoute({
      fixMode: "rag_assisted",
      rationale: "Ambiguous text corrections should be grounded in upload evidence plus curated examples and lexicons.",
      kbUseCases: [
        "few-shot-retrieval",
        "correction-templates",
        "quality-regression-checks",
        "spelling-validation",
        "candidate-ranking",
        "false-positive-reduction",
      ],
      sourceHints: [
        "internal-gold-corrections",
        "internal-manual-review",
        "internal-false-positives",
        "lookup-scowl",
        "lookup-libreoffice-dictionaries",
        "lookup-wordfreq",
      ],
      allowExternalFetch: false,
    });
  }

  if (isJavaScriptIssue(issue)) {
    return buildRoute({
      fixMode: "rag_assisted",
      rationale: "JavaScript issues need reading-system scripting guidance, security rules, and upload-grounded script context before proposing a fix.",
      kbUseCases: [
        "scripting-support",
        "container-constrained-scripting",
        "spine-level-scripting",
        "dom-manipulation",
        "layout-changes",
        "security-and-privacy",
        "script-elements",
      ],
      sourceHints: [
        "w3c-epub-rs-33",
        "w3c-epub-33",
        "whatwg-html-syntax",
        "epubcheck-repo",
        "sprint2-layout-rules",
        "sprint2-script-rules",
      ],
      allowExternalFetch: true,
    });
  }

  if (isCssOrLayoutIssue(issue)) {
    return buildRoute({
      fixMode: "rag_assisted",
      rationale: "CSS and rendering issues benefit from EPUB reading-system guidance, CSS references, and upload-grounded chapter context.",
      kbUseCases: [
        "css-validation",
        "layout-validation",
        "css-reference",
        "visual-rendering",
        "table-layout",
        "font-validation",
        "rendering-support-guidance",
        "reading-system-assumptions",
      ],
      sourceHints: [
        "sprint2-layout-rules",
        "w3c-css-snapshot-2025",
        "w3c-epub-rs-33",
        "w3c-epub-33",
        "epubcheck-repo",
      ],
      allowExternalFetch: true,
    });
  }

  if (issueId.startsWith("A_") || issueId.startsWith("IMG_")) {
    return buildRoute({
      fixMode: "rag_assisted",
      rationale: "Accessibility and image alt issues are handled by LLM-assisted remediation with KB guidance.",
      kbUseCases: [
        "accessibility-conformance",
        "discoverability-metadata",
        "accessibility-baseline",
        "accessibility-fix-guidance",
        "manual-review-checklists",
        "accessibility-check-interpretation",
      ],
      sourceHints: [
        "w3c-epub-a11y-11",
        "w3c-epub-a11y-tech-11",
        "w3c-wcag-22",
        "ace-guide",
        "ace-home",
        "daisy-schema-accessmode",
        "daisy-schema-accessmodesufficient",
      ],
      allowExternalFetch: true,
    });
  }

  if (documentType === "pdf") {
    return buildRoute({
      fixMode: issueId === "T_SPECIAL_CHAR_ENTITY" ? "lookup_only" : "rag_assisted",
      rationale: "PDF text fixes need source-page context, lexicons, and review thresholds.",
      kbUseCases: [
        "entity-decoding",
        "special-character-fixes",
        "nfc-normalization",
        "spelling-validation",
        "candidate-ranking",
        "few-shot-retrieval",
      ],
      sourceHints: [
        "lookup-html-entities-json",
        "lookup-unicode-tr15",
        "lookup-scowl",
        "lookup-libreoffice-dictionaries",
        "lookup-wordfreq",
        "internal-gold-corrections",
      ],
      allowExternalFetch: false,
    });
  }

  return buildRoute();
}

function buildFixPlan({ report = {}, documentType = "epub" } = {}) {
  const results = Array.isArray(report?.results) ? report.results : [];
  const candidates = results.filter((result) => result.status === "fail" || result.status === "warn");
  const items = candidates.map((issue) => ({
    issueId: issue.id,
    status: issue.status,
    route: routeIssue({ issue, documentType }),
  }));

  const summary = items.reduce((accumulator, item) => {
    accumulator[item.route.fixMode] = (accumulator[item.route.fixMode] || 0) + 1;
    return accumulator;
  }, {});

  return {
    documentType,
    issueCount: items.length,
    summary,
    items,
  };
}

function priorityValue(priority) {
  return Object.prototype.hasOwnProperty.call(PRIORITY_WEIGHT, priority)
    ? PRIORITY_WEIGHT[priority]
    : 9;
}

function sortSources(sources = []) {
  return sources
    .slice()
    .sort((left, right) => {
      const priorityDiff = priorityValue(left.priority) - priorityValue(right.priority);
      if (priorityDiff !== 0) return priorityDiff;
      return String(left.title || "").localeCompare(String(right.title || ""));
    });
}

module.exports = {
  buildFixPlan,
  isCssOrLayoutIssue,
  isJavaScriptIssue,
  routeIssue,
  sortSources,
  statusRank,
  unique,
};

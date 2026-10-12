const assert = require("assert");

const {
  buildEvidencePlan,
  buildFixPlan,
  createFixProposal,
  routeIssue,
  scoreIssueForAgenticCoverage,
} = require("./src/rag");
const { assertAllowedUrl } = require("./src/rag/secure-fetch");

const route = routeIssue({
  issue: { id: "T_MISSING_INCORRECT_TEXT", status: "fail" },
  documentType: "epub",
});

assert.strictEqual(route.fixMode, "rag_assisted");
assert(route.sourceHints.includes("internal-gold-corrections"));

const layoutRoute = routeIssue({
  issue: { id: "L_CSS_INVALID_DECLARATION", status: "fail" },
  documentType: "epub",
});

assert.strictEqual(layoutRoute.fixMode, "rag_assisted");
assert(layoutRoute.sourceHints.includes("sprint2-layout-rules"));
assert(
  scoreIssueForAgenticCoverage({ id: "L_CSS_INVALID_DECLARATION", status: "fail" }) >
    scoreIssueForAgenticCoverage({ id: "M_PUBLISHER", status: "warn" })
);

const evidencePlan = buildEvidencePlan({
  issue: { id: "NCX_SPINE_MISMATCH", status: "fail" },
  documentType: "epub",
});

assert(evidencePlan.sources.some((source) => source.id === "w3c-epub-33"));
assert(evidencePlan.sources.some((source) => source.id === "epubcheck-repo"));

const fixPlan = buildFixPlan({
  report: {
    results: [
      { id: "NCX_SPINE_MISMATCH", status: "fail" },
      { id: "T_SPECIAL_CHAR_ENTITY", status: "fail" },
      { id: "A_IMAGE_ALT_MISSING", status: "warn" },
    ],
  },
  documentType: "epub",
});

assert.strictEqual(fixPlan.issueCount, 3);
assert.strictEqual(fixPlan.summary.deterministic, 1);
assert.strictEqual(fixPlan.summary.lookup_only, 1);
assert.strictEqual(fixPlan.summary.manual_review, 1);

const proposal = createFixProposal({
  issue_id: "T_MISSING_INCORRECT_TEXT",
  action: "replace_text",
  target_file: "OEBPS/text/chapter01.xhtml",
  original: "b1ade",
  replacement: "blade",
  confidence: "high",
  evidence: [{ source_type: "upload_context", location: "chapter01 line 13" }],
});

assert.strictEqual(proposal.confidence, 0.98);

assert.throws(() => {
  assertAllowedUrl("https://example.com/some-page");
}, /allowlist/i);

const allowed = assertAllowedUrl("https://www.w3.org/TR/epub-33/");
assert.strictEqual(allowed.rule.domain, "www.w3.org");

console.log("rag runtime tests passed");

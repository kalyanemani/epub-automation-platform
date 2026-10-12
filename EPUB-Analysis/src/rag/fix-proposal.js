function toNumericConfidence(value) {
  if (typeof value === "number") {
    return Math.max(0, Math.min(1, value));
  }

  switch (String(value || "").toLowerCase()) {
    case "high":
      return 0.98;
    case "medium":
      return 0.9;
    case "low":
      return 0.65;
    default:
      return 0.5;
  }
}

function mapCategoryToIssueId(category) {
  switch (category) {
    case "special-character":
      return "T_SPECIAL_CHAR_ENTITY";
    case "hyphenation":
      return "T_HYPHENATION_WORD_MERGE";
    case "missing-incorrect":
      return "T_MISSING_INCORRECT_TEXT";
    default:
      return "T_MISSING_INCORRECT_TEXT";
  }
}

function validateFixProposal(proposal) {
  if (!proposal || typeof proposal !== "object") {
    throw new Error("Fix proposal must be an object.");
  }

  const requiredFields = ["issue_id", "action", "target_file", "confidence", "evidence"];
  requiredFields.forEach((field) => {
    if (
      typeof proposal[field] === "undefined" ||
      proposal[field] === null ||
      proposal[field] === ""
    ) {
      throw new Error(`Fix proposal is missing required field: ${field}`);
    }
  });

  if (!Array.isArray(proposal.evidence) || !proposal.evidence.length) {
    throw new Error("Fix proposal must contain at least one evidence item.");
  }

  if (typeof proposal.confidence !== "number" || proposal.confidence < 0 || proposal.confidence > 1) {
    throw new Error("Fix proposal confidence must be a number between 0 and 1.");
  }

  return proposal;
}

function createFixProposal(payload = {}) {
  const proposal = {
    issue_id: String(payload.issue_id || ""),
    action: String(payload.action || "replace_text"),
    target_file: String(payload.target_file || ""),
    original: payload.original == null ? "" : String(payload.original),
    replacement: payload.replacement == null ? "" : String(payload.replacement),
    confidence: toNumericConfidence(payload.confidence),
    fix_mode: String(payload.fix_mode || "deterministic"),
    evidence: Array.isArray(payload.evidence) ? payload.evidence : [],
    notes: payload.notes ? String(payload.notes) : "",
  };

  return validateFixProposal(proposal);
}

function createProposalFromTextChange({ docRelPath, change } = {}) {
  if (!change || !docRelPath) {
    return null;
  }

  const original = String(change.original || "").trim();
  const replacement = String(change.replacement || "").trim();

  if (!original || !replacement || original === replacement) {
    return null;
  }

  return createFixProposal({
    issue_id: mapCategoryToIssueId(change.category),
    action: "replace_text",
    target_file: docRelPath,
    original,
    replacement,
    confidence: change.confidence,
    fix_mode: change.category === "special-character" ? "lookup_only" : "rag_assisted",
    evidence: change.evidence?.length
      ? change.evidence
      : [
        {
          source_type: "upload_context",
          location: docRelPath,
          excerpt: change.excerpt || "",
        },
      ],
    notes: [change.type || "", change.decisionReason || ""].filter(Boolean).join(" | "),
  });
}

module.exports = {
  createFixProposal,
  createProposalFromTextChange,
  mapCategoryToIssueId,
  toNumericConfidence,
  validateFixProposal,
};

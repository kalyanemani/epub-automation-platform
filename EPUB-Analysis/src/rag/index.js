const {
  buildIssueQuery,
  getAgenticState,
  runAgenticQuery,
  scoreIssueForAgenticCoverage,
  summarizeValidationAgenticCoverage,
} = require("./agentic-orchestrator");
const { buildEvidencePlan } = require("./evidence-planner");
const { createFixProposal, createProposalFromTextChange, validateFixProposal } = require("./fix-proposal");
const { loadAllowlist, loadManifest } = require("./kb-config");
const { buildFixPlan, routeIssue } = require("./issue-router");
const { buildKbChunkIndex, invalidateKbChunkIndex, searchChunks } = require("./local-retriever");
const { getAutomationStrategy, summarizeKnowledgeBases } = require("./automation-strategy");
const { verifyAutofixResult } = require("./post-fix-verifier");
const { getQualityMonitorStatus } = require("./quality-monitor");
const { fetchReferenceSnapshot } = require("./secure-fetch");
const { buildTextFixDecider } = require("./text-fix-policy");
const {
  buildEpubUploadIndex,
  buildPdfUploadIndex,
  cleanupCorruptedIndices,
  readIndex,
  searchUploadIndex,
  validateSavedIndex,
} = require("./upload-index");

function getRagStatus() {
  const allowlist = loadAllowlist();
  const manifest = loadManifest();

  return {
    allowlistDefaultPolicy: allowlist.default_policy || "deny",
    allowedDomains: (allowlist.domains || []).map((entry) => ({
      domain: entry.domain,
      trustLevel: entry.trust_level,
    })),
    sourceCount: (manifest.sources || []).length,
    folderCount: (manifest.folders || []).length,
    futureSpecCount: (manifest.future_specs || []).length,
    localKbChunks: buildKbChunkIndex().length,
    knowledgeBases: summarizeKnowledgeBases(manifest),
    qualityMonitor: getQualityMonitorStatus(),
    automationStrategy: getAutomationStrategy(),
  };
}

module.exports = {
  buildIssueQuery,
  buildEvidencePlan,
  buildEpubUploadIndex,
  buildFixPlan,
  buildKbChunkIndex,
  buildPdfUploadIndex,
  buildTextFixDecider,
  cleanupCorruptedIndices,
  createFixProposal,
  createProposalFromTextChange,
  fetchReferenceSnapshot,
  getAgenticState,
  getRagStatus,
  invalidateKbChunkIndex,
  readUploadIndex: readIndex,
  routeIssue,
  runAgenticQuery,
  scoreIssueForAgenticCoverage,
  searchKbChunks: searchChunks,
  searchUploadIndex,
  summarizeValidationAgenticCoverage,
  validateSavedIndex,
  validateFixProposal,
  verifyAutofixResult,
};

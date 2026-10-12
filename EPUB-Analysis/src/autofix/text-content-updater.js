const fs = require("fs");

const {
  buildTextNormalizationContext,
  normalizeHtmlDocument,
  resolveContentDocuments,
} = require("../utils/text-normalizer");
const { buildTextFixDecider, createProposalFromTextChange } = require("../rag");
const { suggestMissingIncorrectText } = require("../utils/text-suggest");
const { debugLog } = require("../utils/pipeline-logger");

const MAX_LLM_REVIEW_SAMPLES = 8;
const UNSAFE_REPLACEMENT_PHRASES = new Set([
  "manual source check",
  "manual review",
  "needs review",
  "uncertain",
]);

function extractExplicitReplacements(suggestion) {
  const replacements = new Map();
  const regex = /["\u201C\u201D]([^"\u201C\u201D]+)["\u201C\u201D]\s*->\s*["\u201C\u201D]([^"\u201C\u201D]+)["\u201C\u201D]/g;
  let match;

  while ((match = regex.exec(String(suggestion || ""))) !== null) {
    const from = String(match[1] || "").trim();
    const to = String(match[2] || "").trim();
    if (!isSafeReplacementPair(from, to)) {
      continue;
    }
    replacements.set(from, to);
  }

  return replacements;
}

function collectExplicitReplacements(issues = []) {
  const replacements = new Map();
  const fromReportSuggestions =
    String(process.env.ENABLE_REPORT_SUGGESTION_REPLACEMENTS || "")
      .trim()
      .toLowerCase() === "true";

  if (!fromReportSuggestions) {
    return replacements;
  }

  issues.forEach((issue) => {
    extractExplicitReplacements(issue?.suggestion).forEach((to, from) => {
      replacements.set(from, to);
    });
  });

  return replacements;
}

function isSafeReplacementPair(from, to) {
  const left = String(from || "").trim();
  const right = String(to || "").trim();

  if (!left || !right || left === right) {
    return false;
  }

  if (
    left.length > 40 ||
    right.length > 40 ||
    /[\r\n\t]/.test(left) ||
    /[\r\n\t]/.test(right)
  ) {
    return false;
  }

  const leftWords = left.split(/\s+/).filter(Boolean);
  const rightWords = right.split(/\s+/).filter(Boolean);
  if (
    leftWords.length === 0 ||
    rightWords.length === 0 ||
    leftWords.length > 3 ||
    rightWords.length > 3
  ) {
    return false;
  }

  if (leftWords.length === 1 && rightWords.length !== 1) {
    return false;
  }

  if (leftWords.length !== rightWords.length) {
    return false;
  }

  const normalizedRight = right.toLowerCase();
  if (UNSAFE_REPLACEMENT_PHRASES.has(normalizedRight)) {
    return false;
  }

  if (/[^a-zA-Z0-9'’ -]/.test(left) || /[^a-zA-Z0-9'’ -]/.test(right)) {
    return false;
  }

  return true;
}

function mergeExplicitReplacements(target = new Map(), source = new Map()) {
  let added = 0;

  source.forEach((to, from) => {
    if (!from || !to || from === to || target.has(from)) {
      return;
    }
    target.set(from, to);
    added += 1;
  });

  return added;
}

function summarizeChanges(changes) {
  return changes.reduce((summary, change) => {
    summary[change.type] = (summary[change.type] || 0) + 1;
    return summary;
  }, {});
}

function textLlmAutofixEnabled(explicitValue) {
  if (typeof explicitValue === "boolean") {
    return explicitValue;
  }

  return String(process.env.ENABLE_TEXT_LLM_AUTOFIX || "")
    .trim()
    .toLowerCase() === "true";
}

function readSourceContents(docs = []) {
  const sourceContents = new Map();

  docs.forEach((doc) => {
    sourceContents.set(doc.relPath, fs.readFileSync(doc.absolutePath, "utf8"));
  });

  return sourceContents;
}

function collectReviewSamples(reviewSamples = []) {
  const seen = new Set();
  const candidates = [];

  for (const sample of reviewSamples) {
    if (!sample?.snippet) {
      continue;
    }

    const snippet = String(sample.snippet).trim();
    if (!snippet || snippet.length > 80) {
      continue;
    }

    const key = `${sample.file || ""}|${sample.type || ""}|${snippet}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    candidates.push({
      file: sample.file,
      type: sample.type,
      snippet,
      excerpt: sample.excerpt,
    });

    if (candidates.length >= MAX_LLM_REVIEW_SAMPLES) {
      break;
    }
  }

  return candidates;
}

function runNormalizationPass({
  docs,
  sourceContents,
  context,
  changeDecider,
  explicitReplacements,
}) {
  let replacementsApplied = 0;
  let manualReviewCount = 0;
  let filesTouched = 0;
  const allChanges = [];
  const proposals = [];
  const normalizedDocs = [];
  const reviewSamples = [];

  docs.forEach((doc) => {
    const originalContent = sourceContents.get(doc.relPath) || "";
    const result = normalizeHtmlDocument(originalContent, context, {
      explicitReplacements,
      applyPlaceholderFixes: true,
      changeDecider,
    });

    replacementsApplied += result.changes.length;
    manualReviewCount += result.reviews.length;
    if (result.content !== originalContent) {
      filesTouched += 1;
    }

    allChanges.push(...result.changes);
    result.changes.forEach((change) => {
      const proposal = createProposalFromTextChange({
        docRelPath: doc.relPath,
        change,
      });
      if (proposal) {
        proposals.push(proposal);
      }
    });

    result.reviews.forEach((review) => {
      reviewSamples.push({
        file: doc.relPath,
        type: review.type,
        snippet: review.snippet,
        excerpt: review.excerpt,
        confidence: review.confidence,
      });
    });

    normalizedDocs.push({
      relPath: doc.relPath,
      absolutePath: doc.absolutePath,
      originalContent,
      content: result.content,
      changed: result.content !== originalContent,
    });
  });

  return {
    filesTouched,
    replacementsApplied,
    manualReviewCount,
    changesByType: summarizeChanges(allChanges),
    proposals,
    normalizedDocs,
    reviewSamples,
  };
}

function persistNormalizedDocs(normalizedDocs = []) {
  normalizedDocs.forEach((doc) => {
    if (!doc.changed) {
      return;
    }

    fs.writeFileSync(doc.absolutePath, doc.content, "utf8");
    console.log(`   Saved text-content fixes in ${doc.relPath}`);
  });
}

async function applyTextContentFixes(tempDir, issues = [], opfAbsolute, opfXml, options = {}) {
  const llmAutofixEnabled = textLlmAutofixEnabled(options.enableLlmAutofix);
  const docs = resolveContentDocuments({ tempDir, opfAbsolute, opfXml });
  if (!docs.length) {
    return {
      success: false,
      filesTouched: 0,
      replacementsApplied: 0,
      manualReviewCount: 0,
      changesByType: {},
      proposals: [],
      llmAutofix: {
        enabled: llmAutofixEnabled,
        invoked: false,
        learnedReplacements: 0,
        appliedReplacements: 0,
      },
    };
  }

  const context = buildTextNormalizationContext({
    tempDir,
    opfAbsolute,
    opfXml,
    docs,
  });
  const changeDecider = buildTextFixDecider({ docs, languageContext: context });
  let explicitReplacements = collectExplicitReplacements(issues);
  const sourceContents = readSourceContents(docs);

  const firstPass = runNormalizationPass({
    docs,
    sourceContents,
    context,
    changeDecider,
    explicitReplacements,
  });

  debugLog("pipeline", "text-fix.pass.completed", {
    pass: "rules+rag",
    filesTouched: firstPass.filesTouched,
    replacementsApplied: firstPass.replacementsApplied,
    manualReviewCount: firstPass.manualReviewCount,
  });

  const llmAutofix = {
    enabled: llmAutofixEnabled,
    invoked: false,
    learnedReplacements: 0,
    appliedReplacements: 0,
    manualReviewBefore: firstPass.manualReviewCount,
    manualReviewAfter: firstPass.manualReviewCount,
  };

  let finalPass = firstPass;

  if (llmAutofix.enabled && firstPass.manualReviewCount > 0) {
    const samples = collectReviewSamples(firstPass.reviewSamples);
    debugLog("pipeline", "text-fix.llm-pass.candidates", {
      candidateCount: samples.length,
    });

    if (samples.length) {
      llmAutofix.invoked = true;
      const suggestion = await suggestMissingIncorrectText(samples, {
        forceLlm: true,
        logLabel: "Text autofix manual-review resolution",
      });
      const llmReplacements = extractExplicitReplacements(suggestion);

      llmAutofix.learnedReplacements = llmReplacements.size;

      const mergedReplacements = new Map(explicitReplacements);
      const appliedReplacementCount = mergeExplicitReplacements(
        mergedReplacements,
        llmReplacements
      );
      llmAutofix.appliedReplacements = appliedReplacementCount;

      debugLog("llm", "text-fix.llm-pass.suggestion", {
        suggestion,
        learnedReplacements: llmReplacements.size,
        appliedReplacements: appliedReplacementCount,
      });

      if (appliedReplacementCount > 0) {
        explicitReplacements = mergedReplacements;
        finalPass = runNormalizationPass({
          docs,
          sourceContents,
          context,
          changeDecider,
          explicitReplacements,
        });
        llmAutofix.manualReviewAfter = finalPass.manualReviewCount;

        console.log(
          `   LLM text autofix generated ${appliedReplacementCount} explicit replacement(s) from manual-review snippets`
        );

        debugLog("pipeline", "text-fix.llm-pass.completed", {
          filesTouched: finalPass.filesTouched,
          replacementsApplied: finalPass.replacementsApplied,
          manualReviewBefore: firstPass.manualReviewCount,
          manualReviewAfter: finalPass.manualReviewCount,
          appliedReplacements: appliedReplacementCount,
        });
      }
    }
  }

  persistNormalizedDocs(finalPass.normalizedDocs);

  return {
    success: finalPass.filesTouched > 0,
    filesTouched: finalPass.filesTouched,
    replacementsApplied: finalPass.replacementsApplied,
    manualReviewCount: finalPass.manualReviewCount,
    changesByType: finalPass.changesByType,
    proposals: finalPass.proposals,
    llmAutofix,
  };
}

module.exports = { applyTextContentFixes };

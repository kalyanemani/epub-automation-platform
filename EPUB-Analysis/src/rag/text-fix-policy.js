const fs = require("fs");
const path = require("path");

const { buildStructuredHtmlChunks, stripHtml } = require("./chunking");
const { getKbRoot, readJson } = require("./kb-config");
const { buildKbChunkIndex, searchChunks } = require("./local-retriever");
const { debugLog } = require("../utils/pipeline-logger");
const { isKnownWord } = require("../utils/text-normalizer");

const OCR_DIGIT_MAP = {
  "0": new Set(["o"]),
  "1": new Set(["i", "l"]),
  "5": new Set(["s"]),
  "8": new Set(["b"]),
};

function normalizeValue(value) {
  return String(value || "").trim();
}

function normalizeKey(value) {
  return normalizeValue(value).toLowerCase();
}

function normalizeProtectionKey(value) {
  return normalizeValue(value)
    .toLowerCase()
    .replace(/[^a-z]+/g, "");
}

function loadRuleList(filename) {
  const filePath = path.join(getKbRoot(), "internal", "rules", filename);
  const payload = readJson(filePath, []);

  if (Array.isArray(payload)) {
    return payload.map((item) => normalizeKey(item)).filter(Boolean);
  }

  if (Array.isArray(payload?.words)) {
    return payload.words.map((item) => normalizeKey(item)).filter(Boolean);
  }

  return [];
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildCorpus(docs = []) {
  return docs.flatMap((doc) => {
    const rawHtml = fs.readFileSync(doc.absolutePath, "utf8");

    return buildStructuredHtmlChunks(rawHtml).map((chunk, chunkIndex) => ({
      relPath: doc.relPath,
      location: `${doc.relPath}#chunk-${chunkIndex + 1}`,
      text: stripHtml(chunk.text),
      searchText: chunk.metadata?.searchText || chunk.text,
      headingTrail: Array.isArray(chunk.metadata?.headingTrail)
        ? chunk.metadata.headingTrail.filter(Boolean).slice(0, 6)
        : [],
      sectionTitle: Array.isArray(chunk.metadata?.headingTrail)
        ? chunk.metadata.headingTrail.filter(Boolean).slice(-1)[0] || ""
        : "",
    }));
  });
}

function findPhraseHits(corpus, phrase, limit = 3) {
  const normalizedPhrase = normalizeValue(phrase);
  if (!normalizedPhrase) {
    return [];
  }

  const regex = new RegExp(`\\b${escapeRegex(normalizedPhrase)}\\b`, "ig");
  const hits = [];

  corpus.forEach((doc) => {
    let match;
    const searchableText = String(doc.searchText || doc.text || "");

    while ((match = regex.exec(searchableText)) !== null) {
      const start = Math.max(0, match.index - 40);
      const end = Math.min(
        searchableText.length,
        match.index + normalizedPhrase.length + 40
      );
      hits.push({
        source_type: "upload_context",
        location: doc.location,
        section: doc.sectionTitle,
        excerpt: searchableText.slice(start, end).replace(/\s+/g, " ").trim(),
      });
      if (hits.length >= limit) {
        return;
      }
    }
  });

  return hits;
}

function normalizeExampleSearchValue(value) {
  return normalizeValue(value).toLowerCase();
}

function buildExampleQueries(original, replacement) {
  const queries = [];
  const left = normalizeValue(original);
  const right = normalizeValue(replacement);

  if (left && right) {
    queries.push(`${left} ${right}`);
    queries.push(`${left} -> ${right}`);
  }

  if (left) {
    queries.push(left);
  }

  if (right && normalizeExampleSearchValue(right) !== normalizeExampleSearchValue(left)) {
    queries.push(right);
  }

  return Array.from(new Set(queries.map((query) => query.trim()).filter(Boolean)));
}

function toExampleHit(result) {
  const metadata = result.metadata || {};
  const searchText = normalizeExampleSearchValue(
    [
      metadata.original,
      metadata.replacement,
      metadata.snippet,
      metadata.candidate,
      metadata.decision,
      metadata.changeType,
      metadata.notes,
      result.text,
    ]
      .filter(Boolean)
      .join(" ")
  );

  return {
    source_type: "kb_example",
    location: result.sourceId || result.filePath,
    sourceId: result.sourceId || "",
    excerpt: result.text,
    score: result.score,
    searchText,
    metadata,
  };
}

function exampleMatchesChange(hit, original, replacement) {
  const left = normalizeExampleSearchValue(original);
  const right = normalizeExampleSearchValue(replacement);
  const metadata = hit.metadata || {};
  const searchText = hit.searchText || "";
  const originalValue = normalizeExampleSearchValue(metadata.original);
  const replacementValue = normalizeExampleSearchValue(metadata.replacement);
  const snippetValue = normalizeExampleSearchValue(metadata.snippet);
  const candidateValue = normalizeExampleSearchValue(metadata.candidate);

  if (left && right) {
    const exactPair =
      originalValue === left && replacementValue === right;
    const snippetPair =
      snippetValue.includes(left) &&
      (candidateValue === right || searchText.includes(right));
    const loosePair = searchText.includes(left) && searchText.includes(right);
    return exactPair || snippetPair || loosePair;
  }

  if (left) {
    return (
      originalValue === left ||
      snippetValue.includes(left) ||
      searchText.includes(left)
    );
  }

  if (right) {
    return (
      replacementValue === right ||
      candidateValue === right ||
      searchText.includes(right)
    );
  }

  return false;
}

function findExampleEvidence(kbChunks, original, replacement, limit = 6) {
  const queries = buildExampleQueries(original, replacement);
  if (!queries.length) {
    return { supportive: [], blocking: [] };
  }

  const hitsById = new Map();
  queries.forEach((query) => {
    searchChunks(kbChunks, query, {
      limit,
      minimumTokenHits: 1,
      sourceIds: [
        "internal-gold-corrections",
        "internal-manual-review",
        "internal-false-positives",
      ],
    }).forEach((result) => {
      const key = result.id || `${result.sourceId}|${result.filePath}|${result.chunkIndex}`;
      const existing = hitsById.get(key);
      if (!existing || result.score > existing.score) {
        hitsById.set(key, result);
      }
    });
  });

  const hits = Array.from(hitsById.values())
    .map((result) => toExampleHit(result))
    .filter((hit) => exampleMatchesChange(hit, original, replacement))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);

  return {
    supportive: hits.filter((hit) => hit.sourceId === "internal-gold-corrections"),
    blocking: hits.filter((hit) =>
      hit.sourceId === "internal-manual-review" ||
      hit.sourceId === "internal-false-positives"
    ),
  };
}

function levenshteinDistance(left, right) {
  const source = normalizeValue(left).toLowerCase();
  const target = normalizeValue(right).toLowerCase();

  if (!source || !target) {
    return Number.MAX_SAFE_INTEGER;
  }

  const previous = Array.from({ length: target.length + 1 }, (_, index) => index);

  for (let i = 1; i <= source.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;

    for (let j = 1; j <= target.length; j += 1) {
      const upper = previous[j];
      const cost = source[i - 1] === target[j - 1] ? 0 : 1;
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + cost
      );
      diagonal = upper;
    }
  }

  return previous[target.length];
}

function isMinorEdit(original, replacement, maxDistance = 2) {
  const left = normalizeValue(original);
  const right = normalizeValue(replacement);
  if (!left || !right) {
    return false;
  }

  const leftWords = left.split(/\s+/).filter(Boolean);
  const rightWords = right.split(/\s+/).filter(Boolean);
  if (leftWords.length !== rightWords.length || leftWords.length > 2) {
    return false;
  }

  return levenshteinDistance(left, right) <= maxDistance;
}

function hasStrongReplacementEvidence(
  originalHits = [],
  replacementHits = [],
  supportiveExampleHits = []
) {
  return (
    replacementHits.length > originalHits.length ||
    replacementHits.length >= 2 ||
    supportiveExampleHits.length > 0
  );
}

function isOcrConfusionOnly(original, replacement) {
  const left = normalizeValue(original).toLowerCase();
  const right = normalizeValue(replacement).toLowerCase();

  if (!left || !right || left.length !== right.length) {
    return false;
  }

  let hasMappedDifference = false;

  for (let index = 0; index < left.length; index += 1) {
    const leftChar = left[index];
    const rightChar = right[index];

    if (leftChar === rightChar) {
      continue;
    }

    const allowed = OCR_DIGIT_MAP[leftChar];
    if (!allowed || !allowed.has(rightChar)) {
      return false;
    }

    hasMappedDifference = true;
  }

  return hasMappedDifference;
}

function buildRejectDecision(reason, evidence = [], options = {}) {
  return {
    apply: false,
    reason,
    evidence,
    ...(options.suppress === true ? { suppress: true } : {}),
  };
}

function buildApplyDecision(reason, evidence = [], confidence) {
  return {
    apply: true,
    reason,
    evidence,
    ...(confidence ? { confidence } : {}),
  };
}

function isDictionaryAnchoredMinorCorrection(original, replacement, languageContext) {
  const originalKey = normalizeKey(original);
  const replacementKey = normalizeKey(replacement);
  if (!languageContext || !originalKey || !replacementKey) {
    return false;
  }

  if (!isMinorEdit(originalKey, replacementKey, 2)) {
    return false;
  }

  return (
    !isKnownWord(originalKey, languageContext) &&
    isKnownWord(replacementKey, languageContext)
  );
}

// Module-level cache — persists across buildTextFixDecider() calls within the same process.
// Key: "original|replacement" — avoids re-running 4 RAG queries for the same pair during
// autofix after they were already computed during validation.
const _exampleEvidenceCache = new Map();

function buildTextFixDecider({ docs = [], languageContext = null } = {}) {
  const corpus = buildCorpus(docs);
  const kbChunks = buildKbChunkIndex();
  const doNotSplit = new Set(loadRuleList("do-not-split-words.json"));
  const doNotMerge = new Set(loadRuleList("do-not-merge-words.json"));
  const exampleEvidenceCache = _exampleEvidenceCache;

  debugLog("rag", "text-fix-decider.initialized", {
    docCount: docs.length,
    corpusDocumentCount: corpus.length,
    kbChunkCount: kbChunks.length,
    doNotSplitCount: doNotSplit.size,
    doNotMergeCount: doNotMerge.size,
  });

  return function decideChange(change = {}) {
    const original = normalizeValue(change.original);
    const replacement = normalizeValue(change.replacement);
    const originalKey = normalizeKey(original);
    const replacementKey = normalizeKey(replacement);
    const originalProtectionKey = normalizeProtectionKey(original);
    const replacementProtectionKey = normalizeProtectionKey(replacement);
    const category = normalizeKey(change.category);
    const originalHits = findPhraseHits(corpus, original);
    const replacementHits = findPhraseHits(corpus, replacement);
    const cacheKey = `${originalKey}|${replacementKey}`;
    const exampleEvidence = exampleEvidenceCache.has(cacheKey)
      ? exampleEvidenceCache.get(cacheKey)
      : (() => {
          const result = findExampleEvidence(kbChunks, original, replacement);
          exampleEvidenceCache.set(cacheKey, result);
          return result;
        })();
    const supportiveExampleHits = exampleEvidence.supportive;
    const blockingExampleHits = exampleEvidence.blocking;
    const evidence = [
      ...replacementHits,
      ...supportiveExampleHits,
      ...blockingExampleHits,
      ...originalHits,
    ];

    let decision;

    switch (change.type) {
      case "merged-word-split":
      case "camelcase-spacing":
      case "inline-hyphenation":
      case "split-word-merge": {
        const replacementParts = replacement.split(/\s+/).filter(Boolean);

        if (
          doNotSplit.has(originalKey) ||
          doNotSplit.has(replacementKey) ||
          doNotSplit.has(originalProtectionKey) ||
          doNotSplit.has(replacementProtectionKey) ||
          doNotMerge.has(originalKey) ||
          doNotMerge.has(replacementKey)
        ) {
          decision = buildRejectDecision(
            "Protected term list blocked the word split/merge.",
            evidence,
            { suppress: true }
          );
          break;
        }

        if (blockingExampleHits.length > 0) {
          decision = buildRejectDecision(
            "Curated manual-review or false-positive examples blocked the split/merge correction.",
            evidence,
            { suppress: true }
          );
          break;
        }

        if (replacementParts.length > 2 && !supportiveExampleHits.length) {
          decision = buildRejectDecision(
            "Multi-part word split lacked supporting upload or KB evidence.",
            evidence
          );
          break;
        }

        if (
          hasStrongReplacementEvidence(
            originalHits,
            replacementHits,
            supportiveExampleHits
          )
        ) {
          decision = buildApplyDecision(
            "Replacement phrase was supported by upload or KB evidence.",
            evidence
          );
          break;
        }

        decision = buildRejectDecision(
          "Closed-compound split lacked supporting evidence and was suppressed to avoid blind suggestions.",
          evidence,
          { suppress: true }
        );
        break;
      }

      case "ocr-like-token": {
        if (String(change.confidence || "").toLowerCase() === "low") {
          decision = buildRejectDecision(
            "Low-confidence OCR correction was downgraded to manual review.",
            evidence
          );
          break;
        }

        if (isOcrConfusionOnly(original, replacement)) {
          decision = buildApplyDecision(
            "OCR substitution matched the allowed confusion map.",
            evidence,
            "high"
          );
          break;
        }

        if (replacementHits.length || supportiveExampleHits.length) {
          decision = buildApplyDecision(
            "OCR correction was supported by upload or KB evidence.",
            evidence
          );
          break;
        }

        if (blockingExampleHits.length > 0) {
          decision = buildRejectDecision(
            "OCR correction matched a curated manual-review or false-positive example.",
            evidence,
            { suppress: true }
          );
          break;
        }

        decision = buildRejectDecision(
          "OCR correction lacked sufficient evidence.",
          evidence
        );
        break;
      }

      case "placeholder-cleanup":
      case "placeholder-or-uncertain-copy": {
        if (replacementHits.length > 0) {
          decision = buildApplyDecision(
            "Placeholder cleanup was allowed because the replacement text was already attested in the upload.",
            evidence
          );
          break;
        }

        decision = buildRejectDecision(
          "Placeholder cleanup lacked upload-grounded replacement evidence and was downgraded to manual review.",
          evidence
        );
        break;
      }

      case "explicit-replacement":
      case "spelling-correction":
      case "grammar-correction": {
        if (blockingExampleHits.length > 0) {
          decision = buildRejectDecision(
            "Curated manual-review or false-positive examples blocked the language correction.",
            evidence,
            { suppress: true }
          );
          break;
        }

        if (replacementHits.length > originalHits.length) {
          decision = buildApplyDecision(
            "Correction was supported by stronger replacement evidence in the upload.",
            evidence
          );
          break;
        }

        if (supportiveExampleHits.length && isMinorEdit(original, replacement)) {
          decision = buildApplyDecision(
            "Correction was a minor edit supported by curated KB examples.",
            evidence
          );
          break;
        }

        if (
          change.type === "spelling-correction" &&
          isDictionaryAnchoredMinorCorrection(original, replacement, languageContext)
        ) {
          decision = buildApplyDecision(
            "Correction was a minor dictionary-backed edit and the original token was not recognized.",
            evidence,
            "high"
          );
          break;
        }

        if (
          languageContext &&
          (isKnownWord(originalKey, languageContext) ||
            isKnownWord(originalProtectionKey, languageContext))
        ) {
          decision = buildRejectDecision(
            "The original token is already recognized by the dictionary or protected-term model.",
            evidence,
            { suppress: true }
          );
          break;
        }

        decision = buildRejectDecision(
          "Language correction lacked supporting evidence and was downgraded to review.",
          evidence
        );
        break;
      }

      default:
        if (
          category === "missing-incorrect" &&
          !hasStrongReplacementEvidence(
            originalHits,
            replacementHits,
            supportiveExampleHits
          )
        ) {
          decision = buildRejectDecision(
            "Ambiguous text correction lacked sufficient upload or KB evidence.",
            evidence
          );
          break;
        }

        decision = buildApplyDecision(
          "No additional evidence gate was required for this change type.",
          evidence
        );
        break;
    }

    debugLog("rag", "text-fix-decider.decision", {
      type: change.type,
      original,
      replacement,
      apply: decision.apply === true,
      reason: decision.reason,
      evidenceCounts: {
        originalHits: originalHits.length,
        replacementHits: replacementHits.length,
        supportiveExampleHits: supportiveExampleHits.length,
        blockingExampleHits: blockingExampleHits.length,
      },
      confidence: decision.confidence || change.confidence || "",
      suppress: decision.suppress === true,
    });

    return decision;
  };
}

module.exports = {
  buildTextFixDecider,
};

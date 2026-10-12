const fs = require("fs");

const { runInBatches, envInt } = require("../utils/batch-runner");
const { suggestMissingIncorrectText } = require("../utils/text-suggest");
const { buildTextFixDecider } = require("../rag/text-fix-policy");
const {
  buildTextNormalizationContext,
  normalizeHtmlDocument,
  resolveContentDocuments,
} = require("../utils/text-normalizer");

const MAX_SAMPLES_PER_RULE = 8;

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function lineFromIndex(text, index) {
  return String(text || "")
    .slice(0, Math.max(0, index))
    .split(/\r\n|\n/).length;
}

function findTextLine(rawText, snippet) {
  if (!rawText || !snippet) return null;
  const index = rawText.indexOf(snippet);
  if (index === -1) return null;
  return lineFromIndex(rawText, index);
}

function buildDetails(samples) {
  const files = new Set(samples.map((sample) => sample.file));
  return {
    count: samples.length,
    files: Array.from(files),
    samples,
  };
}

function pushSample(store, sample) {
  const key = `${sample.file}|${sample.type}|${sample.snippet}`;
  if (store.keys.has(key) || store.samples.length >= MAX_SAMPLES_PER_RULE) {
    return;
  }

  store.keys.add(key);
  store.samples.push(sample);
}

function isLowConfidenceOnly(samples = []) {
  return (
    samples.length > 0 &&
    samples.every((sample) => String(sample?.confidence || "").toLowerCase() === "low")
  );
}

function toSample(changeOrReview, rawHtml, file) {
  const snippet = normalizeWhitespace(
    changeOrReview.original || changeOrReview.snippet || ""
  );
  if (!snippet) {
    return null;
  }

  const line = findTextLine(rawHtml, changeOrReview.original || changeOrReview.snippet || "");
  return {
    file,
    type: changeOrReview.type,
    snippet,
    excerpt: normalizeWhitespace(
      changeOrReview.excerpt ||
        (changeOrReview.replacement
          ? `${changeOrReview.original} -> ${changeOrReview.replacement}`
          : changeOrReview.snippet)
    ),
    ...(changeOrReview.replacement ? { suggested: changeOrReview.replacement } : {}),
    ...(changeOrReview.confidence ? { confidence: changeOrReview.confidence } : {}),
    ...(line ? { line } : {}),
  };
}

async function runTextContentChecks({ tempDir, opfAbsolute, opfXml }) {
  const MAX_TEXT_DOCS = envInt("MAX_TEXT_DOCS", 80);
  const allDocs = resolveContentDocuments({ tempDir, opfAbsolute, opfXml });
  const docs = allDocs.length > MAX_TEXT_DOCS ? allDocs.slice(0, MAX_TEXT_DOCS) : allDocs;

  if (!docs.length) {
    return [
      {
        id: "T_CONTENT_DOCS",
        title: "No text content documents found",
        status: "warn",
        details: "No XHTML/HTML content documents were available for text analysis.",
        suggestion: "Ensure the manifest contains readable XHTML/HTML spine documents before running text-content validation.",
      },
    ];
  }

  const context = buildTextNormalizationContext({
    tempDir,
    opfAbsolute,
    opfXml,
    docs,
  });
  const changeDecider = buildTextFixDecider({
    docs,
    languageContext: context,
  });
  const hyphenationStore = { samples: [], keys: new Set() };
  const specialCharacterStore = { samples: [], keys: new Set() };
  const missingIncorrectStore = { samples: [], keys: new Set() };

  const TEXT_BATCH = envInt("TEXT_BATCH_SIZE", 6);
  await runInBatches(docs, TEXT_BATCH, async (doc) => {
    const rawHtml = fs.readFileSync(doc.absolutePath, "utf8");
    const preview = normalizeHtmlDocument(rawHtml, context, { changeDecider });

    preview.changes.forEach((change) => {
      const sample = toSample(change, rawHtml, doc.relPath);
      if (!sample) return;

      if (change.category === "special-character") {
        pushSample(specialCharacterStore, sample);
        return;
      }

      if (change.category === "missing-incorrect") {
        pushSample(missingIncorrectStore, sample);
        return;
      }

      pushSample(hyphenationStore, sample);
    });

    preview.reviews.forEach((review) => {
      const sample = toSample(review, rawHtml, doc.relPath);
      if (sample) {
        pushSample(missingIncorrectStore, sample);
      }
    });
  });

  const results = [];

  if (hyphenationStore.samples.length) {
    results.push({
      id: "T_HYPHENATION_WORD_MERGE",
      title: "Hyphenation or word-merge issues detected",
      status: "warn",
      details: buildDetails(hyphenationStore.samples),
      suggestion:
        "Normalize broken line-wrap hyphenation, restore missing spaces after punctuation, and split or join words only when the correction is high confidence.",
    });
  } else {
    results.push({
      id: "T_HYPHENATION_WORD_MERGE",
      title: "Hyphenation and word-merge checks passed",
      status: "pass",
      details: `Scanned ${docs.length} content documents for broken hyphenation and merged-word spacing issues.`,
      suggestion: "",
    });
  }

  if (specialCharacterStore.samples.length) {
    results.push({
      id: "T_SPECIAL_CHAR_ENTITY",
      title: "Special character or entity issues detected",
      status: "fail",
      details: buildDetails(specialCharacterStore.samples),
      suggestion:
        "Decode corrupted entities, remove invalid control characters, normalize Unicode to standard UTF-8 text, and preserve valid XHTML escaping.",
    });
  } else {
    results.push({
      id: "T_SPECIAL_CHAR_ENTITY",
      title: "Special character and entity checks passed",
      status: "pass",
      details: `Scanned ${docs.length} content documents for encoding artifacts, invalid entities, and control characters.`,
      suggestion: "",
    });
  }

  if (missingIncorrectStore.samples.length) {
    const lowConfidenceOnly = isLowConfidenceOnly(missingIncorrectStore.samples);
    results.push({
      id: "T_MISSING_INCORRECT_TEXT",
      title: lowConfidenceOnly
        ? "Possible missing or incorrect text requires review"
        : "Possible missing or incorrect text detected",
      status: lowConfidenceOnly ? "warn" : "fail",
      details: buildDetails(missingIncorrectStore.samples),
      suggestion: lowConfidenceOnly
        ? "Low-confidence text anomalies were flagged for manual source review."
        : await suggestMissingIncorrectText(missingIncorrectStore.samples),
    });
  } else {
    results.push({
      id: "T_MISSING_INCORRECT_TEXT",
      title: "Missing and incorrect text checks passed",
      status: "pass",
      details: `Scanned ${docs.length} content documents for placeholder copy, OCR-like tokens, spelling errors, and simple grammar issues.`,
      suggestion: "",
    });
  }

  return results;
}

module.exports = { runTextContentChecks };

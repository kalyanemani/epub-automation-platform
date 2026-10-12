const path = require("path");
const fs = require("fs");
const { PDFDocument } = require("pdf-lib");

const { enrichWithAISuggestions } = require("./utils/ai-enricher");
const { suggestMissingIncorrectText } = require("./utils/text-suggest");
const {
  buildTextNormalizationContextFromTexts,
  normalizeTextSegment,
} = require("./utils/text-normalizer");
const { extractPdfTextPages } = require("./utils/pdf-text");
const {
  decodePdfEntitiesInText,
  isAllowedPdfChange,
  isAllowedPdfReview,
  toRenderablePdfText,
} = require("./utils/pdf-text-rules");
const { annotateResults } = require("./utils/report-annotator");

const MAX_SAMPLES_PER_RULE = 8;

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSummary(results = []) {
  return {
    totalRules: results.length,
    passing: results.filter((result) => result.status === "pass").length,
    failing: results.filter((result) => result.status === "fail").length,
    warnings: results.filter((result) => result.status === "warn").length,
  };
}

function relaxPdfContext(context) {
  const strongAttestedWords = new Set(
    Array.from(context.attestedWords || []).filter((word) => {
      const count = context.wordCounts?.get(word) || 0;
      return count > 1 || context.lexicon?.has(word);
    })
  );

  return {
    ...context,
    attestedWords: strongAttestedWords,
  };
}

function buildDetails(samples) {
  const pages = new Set(samples.map((sample) => sample.page));
  return {
    count: samples.length,
    pages: Array.from(pages).sort((left, right) => left - right),
    samples,
  };
}

function pushSample(store, sample) {
  const key = `${sample.page}|${sample.type}|${sample.snippet}`;
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

function toSample(changeOrReview, page, lineNumber) {
  const snippet = normalizeWhitespace(
    changeOrReview.original || changeOrReview.snippet || ""
  );
  if (!snippet) {
    return null;
  }

  return {
    file: `page-${page}`,
    page,
    line: lineNumber,
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
  };
}

async function detectPdfAutofixOutput(pdfPath) {
  try {
    const bytes = fs.readFileSync(pdfPath);
    const pdf = await PDFDocument.load(bytes);
    const subject = String(pdf.getSubject() || "").trim().toLowerCase();
    return subject.includes("autofixed pdf text normalization output");
  } catch (error) {
    return false;
  }
}

function analyzePdfLine(line, context, options = {}) {
  const entityPrelude = decodePdfEntitiesInText(line.text);
  const normalized = normalizeTextSegment(entityPrelude.text, context, {
    applyPlaceholderFixes: Boolean(options.applyPlaceholderFixes),
  });
  const preview = {
    text: normalized.text,
    changes: [...entityPrelude.changes, ...normalized.changes],
    reviews: normalized.reviews,
  };

  return {
    line,
    preview,
    renderableText: toRenderablePdfText(preview.text),
  };
}

function isSupersededByOverlay(analysis, analyses) {
  return analyses.some((candidate) => {
    if (candidate === analysis) {
      return false;
    }

    const sameColumn = Math.abs(candidate.line.x - analysis.line.x) <= 2;
    const closeY =
      Math.abs(candidate.line.y - analysis.line.y) <=
      Math.max(6, analysis.line.height * 0.75);
    const candidateIsClean =
      candidate.preview.changes.length === 0 && candidate.preview.reviews.length === 0;
    const matchesNormalizedText =
      candidate.line.text === analysis.preview.text ||
      candidate.line.text === analysis.renderableText;

    return sameColumn && closeY && candidateIsClean && matchesNormalizedText;
  });
}

async function validatePdf(pdfPath, options = {}) {
  const enrichAiSuggestions =
    typeof options.enrichAiSuggestions === "boolean"
      ? options.enrichAiSuggestions
      : String(process.env.ENABLE_AI_SUGGESTIONS || "").trim().toLowerCase() === "true";

  if (!pdfPath || !fs.existsSync(pdfPath)) {
    throw new Error(`PDF file not found: ${pdfPath}`);
  }

  const isAutofixedPdf = await detectPdfAutofixOutput(pdfPath);
  const pdf = await extractPdfTextPages(pdfPath);
  const pages = pdf.pages || [];

  if (!pages.length) {
    const results = [
      {
        id: "T_CONTENT_DOCS",
        title: "No extractable PDF text found",
        status: "warn",
        details: "No extractable text was available in the uploaded PDF.",
        suggestion: "Upload a searchable PDF with a text layer before running PDF validation.",
      },
    ];

    return {
      documentType: "pdf",
      sourceFile: path.basename(pdfPath),
      summary: buildSummary(results),
      ocr: pdf.ocr || null,
      results: annotateResults(
        await enrichWithAISuggestions(results, {
          enabled: enrichAiSuggestions,
        }),
        {
          documentType: "pdf",
        }
      ),
    };
  }

  const context = relaxPdfContext(buildTextNormalizationContextFromTexts(
    pages.map((page) => page.text)
  ));
  const hyphenationStore = { samples: [], keys: new Set() };
  const specialCharacterStore = { samples: [], keys: new Set() };
  const missingIncorrectStore = { samples: [], keys: new Set() };

  pages.forEach((page) => {
    const analyses = page.lines.map((line) =>
      analyzePdfLine(line, context, { applyPlaceholderFixes: isAutofixedPdf })
    );

    analyses.forEach((analysis) => {
      if (isSupersededByOverlay(analysis, analyses)) {
        return;
      }

      analysis.preview.changes.forEach((change) => {
        if (!isAllowedPdfChange(change, analysis.line.text)) {
          return;
        }
        if (isAutofixedPdf && change.type === "placeholder-cleanup") {
          return;
        }

        const sample = toSample(change, page.pageNumber, analysis.line.lineNumber);
        if (!sample) {
          return;
        }

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

      analysis.preview.reviews.forEach((review) => {
        if (!isAllowedPdfReview(review, analysis.line.text)) {
          return;
        }
        if (isAutofixedPdf && review.type === "placeholder-or-uncertain-copy") {
          return;
        }

        const sample = toSample(review, page.pageNumber, analysis.line.lineNumber);
        if (sample) {
          pushSample(missingIncorrectStore, sample);
        }
      });
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
      details: `Scanned ${pages.length} PDF pages for broken hyphenation and merged-word spacing issues.`,
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
        "Decode corrupted entities, remove invalid control characters, normalize Unicode to standard UTF-8 text, and preserve valid text symbols.",
    });
  } else {
    results.push({
      id: "T_SPECIAL_CHAR_ENTITY",
      title: "Special character and entity checks passed",
      status: "pass",
      details: `Scanned ${pages.length} PDF pages for encoding artifacts, invalid entities, and control characters.`,
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
      details: `Scanned ${pages.length} PDF pages for placeholder copy, OCR-like tokens, spelling errors, and simple grammar issues.`,
      suggestion: "",
    });
  }

  const enrichedResults = annotateResults(await enrichWithAISuggestions(results, {
    enabled: enrichAiSuggestions,
  }), {
    documentType: "pdf",
  });

  return {
    documentType: "pdf",
    sourceFile: path.basename(pdfPath),
    summary: buildSummary(results),
    ocr: pdf.ocr || null,
    results: enrichedResults,
  };
}

module.exports = validatePdf;

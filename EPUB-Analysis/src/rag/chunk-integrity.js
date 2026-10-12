const fs = require("fs");

const DEFAULT_TEXT_MIN_LENGTH = 2;
const DEFAULT_MAX_TEXT_LENGTH = 50000;
const DEFAULT_MAX_TOKEN_COUNT = 12000;

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isFiniteVector(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isFiniteNumber);
}

function normalizeChunk(chunk = {}, defaults = {}) {
  const text = cleanText(chunk.text);
  const searchText = cleanText(chunk.searchText || text);
  const tokens = Array.isArray(chunk.tokens)
    ? chunk.tokens.map((token) => cleanText(token).toLowerCase()).filter(Boolean)
    : [];
  const metadata =
    chunk.metadata && typeof chunk.metadata === "object" && !Array.isArray(chunk.metadata)
      ? { ...chunk.metadata }
      : {};

  return {
    ...chunk,
    id: cleanText(chunk.id || ""),
    location: cleanText(chunk.location || defaults.location || ""),
    documentType: cleanText(chunk.documentType || defaults.documentType || ""),
    text,
    searchText,
    tokens,
    metadata,
  };
}

function validateChunkRecord(chunk = {}, options = {}) {
  const minTextLength = Number(options.minTextLength || DEFAULT_TEXT_MIN_LENGTH);
  const maxTextLength = Number(options.maxTextLength || DEFAULT_MAX_TEXT_LENGTH);
  const maxTokenCount = Number(options.maxTokenCount || DEFAULT_MAX_TOKEN_COUNT);
  const normalized = normalizeChunk(chunk, options.defaults || {});
  const reasons = [];

  if (!normalized.id) {
    reasons.push("missing_id");
  }
  if (!normalized.location) {
    reasons.push("missing_location");
  }
  if (!normalized.documentType) {
    reasons.push("missing_document_type");
  }
  if (!normalized.text || normalized.text.length < minTextLength) {
    reasons.push("text_too_short");
  }
  if (normalized.text.length > maxTextLength) {
    reasons.push("text_too_long");
  }
  if (!normalized.searchText) {
    reasons.push("missing_search_text");
  }
  if (!Array.isArray(normalized.tokens) || normalized.tokens.length === 0) {
    reasons.push("missing_tokens");
  }
  if (normalized.tokens.length > maxTokenCount) {
    reasons.push("too_many_tokens");
  }
  if (
    Object.prototype.hasOwnProperty.call(normalized, "vector") &&
    normalized.vector != null &&
    !isFiniteVector(normalized.vector)
  ) {
    reasons.push("invalid_vector");
  }

  return {
    valid: reasons.length === 0,
    reasons,
    chunk: normalized,
  };
}

function sanitizeChunkCollection(chunks = [], options = {}) {
  const cleaned = [];
  const rejected = [];
  const seenIds = new Set();
  const seenFingerprints = new Set();

  (Array.isArray(chunks) ? chunks : []).forEach((rawChunk, index) => {
    const validation = validateChunkRecord(rawChunk, options);
    const chunk = validation.chunk;
    const fingerprint = `${chunk.location}|${chunk.text}`;

    if (!validation.valid) {
      rejected.push({
        index,
        id: chunk.id || "",
        location: chunk.location || "",
        reasons: validation.reasons,
      });
      return;
    }

    if (seenIds.has(chunk.id)) {
      rejected.push({
        index,
        id: chunk.id,
        location: chunk.location || "",
        reasons: ["duplicate_id"],
      });
      return;
    }

    if (seenFingerprints.has(fingerprint)) {
      rejected.push({
        index,
        id: chunk.id,
        location: chunk.location || "",
        reasons: ["duplicate_text_location"],
      });
      return;
    }

    seenIds.add(chunk.id);
    seenFingerprints.add(fingerprint);
    cleaned.push(chunk);
  });

  return {
    cleaned,
    rejected,
    summary: {
      inputCount: Array.isArray(chunks) ? chunks.length : 0,
      validCount: cleaned.length,
      rejectedCount: rejected.length,
      rejectedByReason: rejected.reduce((accumulator, entry) => {
        entry.reasons.forEach((reason) => {
          accumulator[reason] = (accumulator[reason] || 0) + 1;
        });
        return accumulator;
      }, {}),
    },
  };
}

function readAndSanitizeIndex(filePath, options = {}) {
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return sanitizeChunkCollection(payload.chunks || [], {
    defaults: {
      documentType: payload.documentType || "",
    },
    ...options,
  });
}

module.exports = {
  isFiniteVector,
  normalizeChunk,
  readAndSanitizeIndex,
  sanitizeChunkCollection,
  validateChunkRecord,
};

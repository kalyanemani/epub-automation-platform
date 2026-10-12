function countWords(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function excerptForText(text, index, length) {
  const safeText = String(text || "");
  const start = Math.max(0, index - 40);
  const end = Math.min(safeText.length, index + length + 40);
  return safeText
    .slice(start, end)
    .replace(/\s+/g, " ")
    .trim();
}

function toRenderablePdfText(text) {
  return String(text || "")
    .replace(/\u20B9/g, "Rs ")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ");
}

const PDF_NAMED_ENTITY_MAP = {
  amp: "&",
  apos: "'",
  copy: "\u00A9",
  euro: "\u20AC",
  gt: ">",
  hellip: "\u2026",
  ldquo: "\u201C",
  lsquo: "\u2018",
  lt: "<",
  mdash: "\u2014",
  nbsp: " ",
  ndash: "\u2013",
  pound: "\u00A3",
  quot: "\"",
  rdquo: "\u201D",
  reg: "\u00AE",
  rsquo: "\u2019",
  trade: "\u2122",
  yen: "\u00A5",
};

function decodeEntity(match, entity) {
  if (!entity) {
    return match;
  }

  if (entity[0] === "#") {
    const isHex = entity[1] && entity[1].toLowerCase() === "x";
    const value = parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
    if (!Number.isFinite(value)) {
      return match;
    }

    return String.fromCodePoint(value);
  }

  return Object.prototype.hasOwnProperty.call(PDF_NAMED_ENTITY_MAP, entity)
    ? PDF_NAMED_ENTITY_MAP[entity]
    : match;
}

function decodePdfEntitiesInText(text) {
  const changes = [];
  const pattern = /&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/g;
  const original = String(text || "");
  const content = original.replace(pattern, (match, entity, offset) => {
    const decoded = decodeEntity(match, entity);
    if (decoded === match) {
      return match;
    }

    changes.push({
      category: "special-character",
      type: "html-entity",
      original: match,
      replacement: decoded,
      confidence: "high",
      excerpt: excerptForText(original, offset, match.length),
    });
    return decoded;
  });

  return { text: content, changes };
}

function isAllowedPdfChange(change, lineText) {
  if (!change?.type) {
    return false;
  }

  switch (change.type) {
    case "html-entity":
    case "encoding-artifact":
    case "invalid-entity":
    case "replacement-character":
    case "unicode-normalization":
    case "currency-order":
    case "explicit-replacement":
    case "placeholder-cleanup":
      return true;
    case "collapsed-whitespace":
      return countWords(lineText) <= 8;
    case "merged-word-split":
    case "split-word-merge":
      return countWords(lineText) <= 4 || String(lineText || "").length <= 32;
    case "line-break-hyphenation":
      return (
        (change.confidence === "high" || change.confidence === "medium") &&
        (countWords(lineText) <= 4 || String(lineText || "").length <= 32)
      );
    case "ocr-like-token":
      return change.confidence === "high";
    case "grammar-correction":
    case "spelling-correction":
      return (
        !String(lineText || "").includes("-") &&
        countWords(lineText) <= 6 &&
        String(lineText || "").length <= 40
      );
    default:
      return false;
  }
}

function isAllowedPdfReview(review, lineText) {
  if (!review?.type) {
    return false;
  }

  switch (review.type) {
    case "placeholder-or-uncertain-copy":
      return (
        /[a-z]/i.test(String(review.snippet || "")) ||
        /\?{3,}/.test(String(review.snippet || ""))
      );
    case "ocr-like-token":
      return countWords(lineText) <= 8;
    default:
      return false;
  }
}

module.exports = {
  decodePdfEntitiesInText,
  isAllowedPdfChange,
  isAllowedPdfReview,
  toRenderablePdfText,
};

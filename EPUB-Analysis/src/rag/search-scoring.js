const { normalizeWhitespace, tokenize } = require("./chunking");

function uniqueTokens(tokens = []) {
  return Array.from(
    new Set(tokens.map((token) => String(token || "").trim()).filter(Boolean))
  );
}

function buildSearchText(chunk = {}) {
  return normalizeWhitespace(
    chunk.searchText ||
      chunk.metadata?.searchText ||
      chunk.text ||
      ""
  );
}

function containsOrderedTokens(text, tokens = []) {
  let cursor = 0;
  const haystack = String(text || "").toLowerCase();

  for (const token of tokens) {
    const nextIndex = haystack.indexOf(String(token || "").toLowerCase(), cursor);
    if (nextIndex === -1) {
      return false;
    }
    cursor = nextIndex + String(token || "").length;
  }

  return true;
}

function scoreSearchChunk(queryTokens = [], chunk = {}) {
  const normalizedQueryTokens = uniqueTokens(queryTokens);
  const searchText = buildSearchText(chunk).toLowerCase();
  const chunkTokens = uniqueTokens(
    chunk.searchTokens ||
      chunk.tokens ||
      tokenize(searchText)
  );
  const tokenSet = new Set(chunkTokens);
  let tokenHits = 0;

  normalizedQueryTokens.forEach((token) => {
    if (tokenSet.has(token)) {
      tokenHits += 1;
    }
  });

  if (!tokenHits) {
    return {
      score: 0,
      tokenHits: 0,
      coverage: 0,
      searchText,
    };
  }

  const queryText = normalizedQueryTokens.join(" ");
  const coverage = tokenHits / Math.max(1, normalizedQueryTokens.length);
  const headingText = normalizeWhitespace(
    (chunk.metadata?.headingTrail || []).join(" ")
  ).toLowerCase();
  const exactPhrase = Boolean(queryText) && searchText.includes(queryText);
  const orderedTerms = !exactPhrase && containsOrderedTokens(searchText, normalizedQueryTokens);
  const type = String(chunk.metadata?.type || "").toLowerCase();
  const sourceKind = String(chunk.metadata?.sourceKind || "").toLowerCase();
  const densityBonus = tokenHits / Math.max(8, chunkTokens.length);
  const phraseBonus = exactPhrase ? 4 : 0;
  const orderedBonus = orderedTerms ? 1.5 : 0;
  const headingBonus = exactPhrase && headingText.includes(queryText)
    ? 2
    : normalizedQueryTokens.some((token) => headingText.includes(token))
      ? 0.75
      : 0;
  const structureBonus =
    type === "heading"
      ? 1
      : type === "table" || type === "image"
        ? 0.6
        : 0;
  const sourceBonus =
    sourceKind === "content"
      ? 0.6
      : sourceKind === "page"
        ? 0.5
        : sourceKind === "package" || sourceKind === "navigation"
          ? 0.3
          : 0;

  return {
    score:
      tokenHits +
      coverage * 3 +
      densityBonus +
      phraseBonus +
      orderedBonus +
      headingBonus +
      structureBonus +
      sourceBonus,
    tokenHits,
    coverage,
    searchText,
  };
}

function defaultDedupeKey(chunk = {}) {
  return [
    chunk.location || chunk.filePath || "",
    chunk.metadata?.anchor || "",
    chunk.chunkIndex,
  ].join("|");
}

function rankSearchResults(chunks = [], query, options = {}) {
  const limit = options.limit || 8;
  const queryTokens = uniqueTokens(tokenize(query));
  const minimumTokenHits =
    options.minimumTokenHits || (queryTokens.length >= 4 ? 2 : 1);
  const minimumCoverage =
    options.minimumCoverage || (queryTokens.length >= 5 ? 0.34 : 0);
  const allowedSourceIds = options.sourceIds?.length
    ? new Set(options.sourceIds)
    : null;

  if (!queryTokens.length) {
    return [];
  }

  const ranked = chunks
    .filter((chunk) => !allowedSourceIds || allowedSourceIds.has(chunk.sourceId))
    .map((chunk) => {
      const metrics = scoreSearchChunk(queryTokens, chunk);
      return {
        ...chunk,
        ...metrics,
      };
    })
    .filter(
      (chunk) =>
        chunk.score > 0 &&
        chunk.tokenHits >= minimumTokenHits &&
        chunk.coverage >= minimumCoverage
    )
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (right.coverage !== left.coverage) {
        return right.coverage - left.coverage;
      }

      return String(left.id || "").localeCompare(String(right.id || ""));
    });

  const deduped = [];
  const seen = new Set();

  ranked.forEach((chunk) => {
    if (deduped.length >= limit) {
      return;
    }

    const key = defaultDedupeKey(chunk);
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    deduped.push(chunk);
  });

  return deduped;
}

module.exports = {
  buildSearchText,
  rankSearchResults,
  scoreSearchChunk,
};

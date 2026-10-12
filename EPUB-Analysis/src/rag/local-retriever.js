const fs = require("fs");
const path = require("path");
const AgentLogger = require("../utils/agent-logger");

const {
  buildStructuredCssChunks,
  buildStructuredHtmlChunks,
  buildStructuredJsChunks,
  buildStructuredTextChunks,
  normalizeWhitespace,
  tokenize,
} = require("./chunking");
const { sanitizeChunkCollection } = require("./chunk-integrity");
const { getKbRoot, loadManifest, readJson } = require("./kb-config");
const { recordQualityEvent } = require("./quality-monitor");
const { buildSearchText, rankSearchResults } = require("./search-scoring");

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".html",
  ".xhtml",
  ".json",
  ".jsonl",
  ".xml",
  ".csv",
  ".properties",
]);

function safeParseJson(value) {
  try {
    return JSON.parse(String(value || ""));
  } catch (error) {
    return null;
  }
}

function compactFields(values = []) {
  return values
    .map((value) => normalizeWhitespace(value))
    .filter(Boolean);
}

function buildJsonlExampleChunk(entry = {}, index = 0, sourceMeta = {}) {
  const issueId = String(entry.issue_id || "").trim();
  const file = String(entry.file || "").trim();
  const original = String(entry.original || "").trim();
  const replacement = String(entry.replacement || "").trim();
  const snippet = String(entry.snippet || "").trim();
  const candidate = String(entry.candidate || "").trim();
  const decision = String(entry.decision || "").trim();
  const changeType = String(entry.change_type || "").trim();
  const notes = String(entry.notes || entry.reason || "").trim();
  const source = String(entry.source || "").trim();
  const pairText =
    original && replacement
      ? `${original} -> ${replacement}`
      : snippet && candidate
        ? `${snippet} -> ${candidate}`
        : "";

  const text = normalizeWhitespace(
    compactFields([
      issueId,
      changeType,
      decision,
      pairText,
      snippet,
      notes,
    ]).join(". ")
  );

  if (!text) {
    return null;
  }

  const searchText = normalizeWhitespace(
    compactFields([
      issueId,
      sourceMeta.id,
      entry.document_type,
      file,
      original,
      replacement,
      snippet,
      candidate,
      decision,
      changeType,
      source,
      notes,
      pairText,
    ]).join("\n")
  );

  return {
    id: `${sourceMeta.id || "jsonl"}:${index + 1}`,
    text,
    searchText,
    tokens: tokenize(searchText),
    sourceType: sourceMeta.sourceType || "kb_file",
    sourceId: sourceMeta.id || "",
    title: sourceMeta.title || path.basename(file || "example"),
    category: sourceMeta.category || "",
    filePath: file,
    chunkIndex: index,
    trustLevel: sourceMeta.trustLevel || "local",
    metadata: {
      type: "jsonl-example",
      sourceKind: "internal-example",
      issueId,
      documentType: String(entry.document_type || "").trim(),
      file,
      original,
      replacement,
      snippet,
      candidate,
      decision,
      changeType,
      source,
      notes,
      anchor: file,
      headingTrail: [issueId, decision || changeType].filter(Boolean),
      elementPath: `jsonl:${index + 1}`,
    },
  };
}

function createJsonlChunks(filePath, sourceMeta = {}) {
  const rawText = safeReadText(filePath);
  if (!rawText) {
    return [];
  }

  return rawText
    .split(/\r\n|\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const entry = safeParseJson(line);
      if (!entry || typeof entry !== "object") {
        return null;
      }

      return buildJsonlExampleChunk(entry, index, sourceMeta);
    })
    .filter(Boolean);
}

function repoRoot() {
  return path.join(getKbRoot(), "..");
}

function isTextLikeFile(filePath) {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function safeReadText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    return "";
  }
}

function gatherFiles(targetPath, output = [], seen = new Set()) {
  if (!targetPath) return output;
  const resolved = path.resolve(targetPath);
  if (seen.has(resolved) || !fs.existsSync(resolved)) {
    return output;
  }
  seen.add(resolved);

  const stat = fs.statSync(resolved);
  if (stat.isFile()) {
    if (isTextLikeFile(resolved)) {
      output.push(resolved);
    }
    return output;
  }

  if (!stat.isDirectory()) {
    return output;
  }

  const children = fs.readdirSync(resolved);
  children.forEach((child) => {
    gatherFiles(path.join(resolved, child), output, seen);
  });
  return output;
}

function createChunksForFile(filePath, sourceMeta = {}) {
  const rawText = safeReadText(filePath);
  if (!rawText) {
    return [];
  }

  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jsonl") {
    return createJsonlChunks(filePath, sourceMeta);
  }

  const structuredChunks =
    extension === ".css"
      ? buildStructuredCssChunks(rawText)
      : extension === ".js" || extension === ".mjs"
        ? buildStructuredJsChunks(rawText)
        : extension === ".html" || extension === ".xhtml" || extension === ".xml"
      ? buildStructuredHtmlChunks(rawText)
      : buildStructuredTextChunks(rawText);

  const chunks = structuredChunks.map((chunk, index) => {
    const searchText = buildSearchText({
      text: chunk.text,
      metadata: chunk.metadata || {},
    });

    return {
      id: `${sourceMeta.id || "file"}:${path.basename(filePath)}:${index + 1}`,
      text: normalizeWhitespace(chunk.text),
      searchText,
      tokens: tokenize(searchText),
      sourceType: sourceMeta.sourceType || "kb_file",
      sourceId: sourceMeta.id || "",
      title: sourceMeta.title || path.basename(filePath),
      category: sourceMeta.category || "",
      filePath,
      chunkIndex: index,
      trustLevel: sourceMeta.trustLevel || "local",
      metadata: chunk.metadata || {},
    };
  });

  const integrity = sanitizeChunkCollection(chunks, {
    defaults: {
      documentType: "kb",
      location: path.basename(filePath),
    },
  });
  
  AgentLogger.log("RAG_CHUNK", "LocalRetriever", { 
    file: path.basename(filePath), 
    chunkCount: integrity.cleaned.length, 
    rejectedChunkCount: integrity.summary.rejectedCount,
    totalTokens: integrity.cleaned.reduce((acc, c) => acc + (c.tokens ? c.tokens.length : 0), 0)
  });

  const totalTokens = integrity.cleaned.reduce((acc, chunk) => acc + (chunk.tokens ? chunk.tokens.length : 0), 0);
  const averageChunkChars = integrity.cleaned.length
    ? integrity.cleaned.reduce((acc, chunk) => acc + String(chunk.text || "").length, 0) / integrity.cleaned.length
    : 0;
  recordQualityEvent("embedding", {
    model: "structured-local-index",
    strategy:
      extension === ".css"
        ? "structured_css"
        : extension === ".js" || extension === ".mjs"
          ? "structured_js"
          : extension === ".html" || extension === ".xhtml" || extension === ".xml"
        ? "structured_html"
        : "structured_text",
    sourceType: sourceMeta.sourceType || "kb_file",
    chunkCount: integrity.cleaned.length,
    tokenCount: totalTokens,
    averageChunkChars,
  });
  
  return integrity.cleaned;
}

function resolveManifestFiles() {
  const manifest = loadManifest();
  const root = repoRoot();
  const files = [];

  (manifest.sources || []).forEach((source) => {
    if (source.vector_index !== true) {
      return;
    }

    const targetPath = source.target_path
      ? path.join(root, source.target_path)
      : "";
    const resolvedFiles = gatherFiles(targetPath);
    resolvedFiles.forEach((filePath) => {
      files.push({
        filePath,
        sourceMeta: {
          id: source.id,
          title: source.title,
          category: source.category,
          sourceType: source.lookup_only ? "lookup_file" : "kb_file",
          trustLevel: source.source_type || "local",
        },
      });
    });
  });

  return files;
}

function resolveSnapshotFiles() {
  const snapshotRoot = path.join(getKbRoot(), "snapshots");
  if (!fs.existsSync(snapshotRoot)) {
    return [];
  }

  const manifest = loadManifest();
  const sourceById = new Map(
    (manifest.sources || []).map((source) => [String(source.id || ""), source])
  );

  return gatherFiles(snapshotRoot)
    .filter((filePath) => !filePath.endsWith(".meta.json"))
    .map((filePath) => {
      const metaPath = filePath.replace(/\.[^.]+$/, ".meta.json");
      const meta = readJson(metaPath, {});
      const source = meta.sourceId ? sourceById.get(String(meta.sourceId || "")) : null;
      if (source && source.vector_index !== true) {
        return null;
      }
      return {
        filePath,
        sourceMeta: {
          id: meta.sourceId || meta.url || path.basename(filePath),
          title: meta.sourceTitle || meta.url || path.basename(filePath),
          category: meta.category || "snapshot",
          sourceType: meta.sourceId ? "external_source_snapshot" : "external_snapshot",
          trustLevel: meta.trustLevel || "snapshot",
        },
      };
    })
    .filter(Boolean);
}

function resolveKbControlFiles() {
  const kbRoot = getKbRoot();
  const candidates = [
    path.join(kbRoot, "README.md"),
    path.join(kbRoot, "manifest.json"),
    path.join(kbRoot, "agentic-rag-design.md"),
    path.join(kbRoot, "source-allowlist.json"),
  ];

  return candidates
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => ({
      filePath,
      sourceMeta: {
        id: `kb-control:${path.basename(filePath)}`,
        title: path.basename(filePath),
        category: "kb-control",
        sourceType: "kb_control",
        trustLevel: "local",
      },
    }));
}

let KB_CACHE = {
  builtAt: 0,
  chunks: null,
};

function buildKbChunkIndex() {
  if (KB_CACHE.chunks) {
    return KB_CACHE.chunks;
  }

  const files = [...resolveKbControlFiles(), ...resolveManifestFiles(), ...resolveSnapshotFiles()];
  const chunks = files.flatMap(({ filePath, sourceMeta }) => createChunksForFile(filePath, sourceMeta));
  KB_CACHE = {
    builtAt: Date.now(),
    chunks,
  };
  return chunks;
}

function invalidateKbChunkIndex() {
  KB_CACHE = {
    builtAt: 0,
    chunks: null,
  };
}

function searchChunks(chunks, query, options = {}) {
  const limit = options.limit || 8;
  const filteredChunks = options.sourceIds?.length
    ? chunks.filter((chunk) => new Set(options.sourceIds).has(chunk.sourceId))
    : chunks;
  if (!tokenize(query).length) {
    return [];
  }

  AgentLogger.log("RAG_SEARCH", "LocalRetriever", { query, limit, options });

  const rankedResults = rankSearchResults(filteredChunks, query, options);

  const results = rankedResults.map((chunk) => ({
      id: chunk.id,
      title: chunk.title,
      category: chunk.category,
      sourceType: chunk.sourceType,
      sourceId: chunk.sourceId,
      filePath: chunk.filePath,
      chunkIndex: chunk.chunkIndex,
      score: Number(chunk.score.toFixed(4)),
      text: normalizeWhitespace(chunk.text),
      trustLevel: chunk.trustLevel,
      searchText: chunk.searchText || "",
      metadata: chunk.metadata || {},
    }));

  AgentLogger.log("RAG_RESULTS", "LocalRetriever", { 
    query, 
    resultCount: results.length,
    results: results.map(r => ({ title: r.title, score: r.score, snippet: r.text.slice(0, 200) }))
  });

  const top3 = results.slice(0, 3);
  const top3Score =
    top3.length > 0
      ? top3.reduce((acc, entry) => acc + Number(entry.score || 0), 0) / top3.length
      : 0;
  recordQualityEvent("retrieval", {
    queryChars: String(query || "").length,
    corpusSize: filteredChunks.length,
    resultCount: results.length,
    topScore: Number(results[0]?.score || 0),
    top3Score,
    filteredSourceCount: Array.isArray(options.sourceIds) ? options.sourceIds.length : 0,
  });

  return results;
}

module.exports = {
  buildKbChunkIndex,
  createChunksForFile,
  invalidateKbChunkIndex,
  searchChunks,
};

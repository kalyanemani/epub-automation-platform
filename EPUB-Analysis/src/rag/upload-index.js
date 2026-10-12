const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { parseXml } = require("../utils/xml");
const { resolveContentDocuments } = require("../utils/text-normalizer");
const { unzipToTemp } = require("../utils/unzip");
const { extractPdfTextPages } = require("../utils/pdf-text");
const {
  buildStructuredCssChunks,
  buildStructuredHtmlChunks,
  buildStructuredJsChunks,
  buildStructuredTextChunks,
  normalizeWhitespace,
  tokenize,
} = require("./chunking");
const { sanitizeChunkCollection } = require("./chunk-integrity");
const { mapWithConcurrency } = require("./batch-utils");
const { ensureDir, getKbRoot } = require("./kb-config");
const { recordQualityEvent } = require("./quality-monitor");
const { buildSearchText, rankSearchResults } = require("./search-scoring");

const INDEX_ROOT = path.join(getKbRoot(), "uploads_index");

function indexPathFor(id) {
  return path.join(ensureDir(INDEX_ROOT), `${id}.json`);
}

function readIndex(id) {
  const filePath = indexPathFor(id);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const integrity = sanitizeChunkCollection(payload.chunks || [], {
    defaults: {
      documentType: payload.documentType || "",
    },
  });

  return {
    ...payload,
    chunks: integrity.cleaned,
    chunkCount: integrity.cleaned.length,
    integrity: {
      ...(payload.integrity || {}),
      ...integrity.summary,
    },
  };
}

function writeIndex(id, payload) {
  const integrity = sanitizeChunkCollection(payload.chunks || [], {
    defaults: {
      documentType: payload.documentType || "",
    },
  });
  const filePath = indexPathFor(id);
  const normalizedPayload = {
    ...payload,
    chunks: integrity.cleaned,
    chunkCount: integrity.cleaned.length,
    integrity: integrity.summary,
  };
  fs.writeFileSync(filePath, JSON.stringify(normalizedPayload, null, 2), "utf8");
  return filePath;
}

function buildChunkRecord({
  indexId,
  documentType,
  location,
  text,
  metadata = {},
  chunkIndex = 0,
}) {
  const normalizedText = normalizeWhitespace(text);
  const searchText = buildSearchText({
    text: normalizedText,
    metadata,
  });
  const headingTrail = Array.isArray(metadata.headingTrail)
    ? metadata.headingTrail.filter(Boolean).slice(0, 6)
    : [];
  const sectionTitle = headingTrail.length ? headingTrail[headingTrail.length - 1] : "";

  return {
    id: `${indexId}:${location}:${chunkIndex + 1}`,
    documentType,
    location,
    chunkIndex,
    text: normalizedText,
    searchText,
    tokens: tokenize(searchText),
    metadata: {
      ...metadata,
      headingTrail,
      sectionTitle,
      searchText,
    },
  };
}

function detectOpfPath(tempDir) {
  const stack = [tempDir];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.name.toLowerCase().endsWith(".opf")) {
        return fullPath;
      }
    }
  }

  return null;
}

function detectFirstFileByExtension(tempDir, extension) {
  const expected = String(extension || "").toLowerCase();
  const stack = [tempDir];

  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.name.toLowerCase().endsWith(expected)) {
        return fullPath;
      }
    }
  }

  return null;
}

function listFilesByExtension(tempDir, extensions = []) {
  const expected = new Set(
    (Array.isArray(extensions) ? extensions : [extensions])
      .map((entry) => String(entry || "").trim().toLowerCase())
      .filter(Boolean)
  );
  const matches = [];
  const stack = [tempDir];

  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (expected.has(path.extname(entry.name).toLowerCase())) {
        matches.push(fullPath);
      }
    }
  }

  return matches;
}

function findManifestItemByPredicate(opfXml, predicate) {
  const items = opfXml?.package?.manifest?.item;
  const manifestItems = Array.isArray(items) ? items : items ? [items] : [];
  return manifestItems.find((item) => predicate(item)) || null;
}

function resolveManifestHref(tempDir, opfAbsolute, href) {
  if (!opfAbsolute || !href) {
    return null;
  }

  return path.join(path.dirname(opfAbsolute), href);
}

function readOpfMetadata(opfXml) {
  const packageNode = opfXml?.package || {};
  const metadataNode = packageNode.metadata || {};
  const manifestNode = packageNode.manifest || {};
  const spineNode = packageNode.spine || {};

  const items = Array.isArray(manifestNode.item)
    ? manifestNode.item
    : manifestNode.item
      ? [manifestNode.item]
      : [];
  const itemrefs = Array.isArray(spineNode.itemref)
    ? spineNode.itemref
    : spineNode.itemref
      ? [spineNode.itemref]
      : [];

  const manifestSummary = items
    .slice(0, 40)
    .map((item) =>
      [item["@_id"], item["@_media-type"], item["@_href"]].filter(Boolean).join(" | ")
    )
    .filter(Boolean)
    .join("\n");
  const spineSummary = itemrefs
    .slice(0, 40)
    .map((itemref) => [itemref["@_idref"], itemref["@_linear"]].filter(Boolean).join(" | "))
    .filter(Boolean)
    .join("\n");

  return {
    title: normalizeWhitespace(
      metadataNode["dc:title"]?.["#text"] ||
        metadataNode["dc:title"] ||
        metadataNode.title ||
        ""
    ),
    language: normalizeWhitespace(
      metadataNode["dc:language"]?.["#text"] ||
        metadataNode["dc:language"] ||
        metadataNode.language ||
        ""
    ),
    identifier: normalizeWhitespace(
      metadataNode["dc:identifier"]?.["#text"] ||
        metadataNode["dc:identifier"] ||
        metadataNode.identifier ||
        ""
    ),
    manifestSummary,
    spineSummary,
    manifestCount: items.length,
    spineCount: itemrefs.length,
  };
}

function addStructuredChunks(chunks, indexId, documentType, location, structuredChunks, baseMetadata = {}) {
  structuredChunks.forEach((chunk, chunkIndex) => {
    chunks.push(
      buildChunkRecord({
        indexId,
        documentType,
        location,
        text: chunk.text,
        metadata: {
          ...baseMetadata,
          ...(chunk.metadata || {}),
        },
        chunkIndex,
      })
    );
  });
}

function getUploadIndexConcurrency() {
  const configured = Number(process.env.UPLOAD_INDEX_CONCURRENCY || 4);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 4;
}

async function addFilesInParallel({
  files = [],
  chunks = [],
  indexId,
  documentType,
  tempDir,
  buildChunksForFile,
  buildMetadata,
  concurrency = getUploadIndexConcurrency(),
}) {
  const perFileChunks = await mapWithConcurrency(
    files,
    async (absolutePath) => {
      const relativePath = path.relative(tempDir, absolutePath).replace(/\\/g, "/");
      const rawText = fs.readFileSync(absolutePath, "utf8");
      const structuredChunks = buildChunksForFile(rawText, absolutePath, relativePath);
      const localChunks = [];

      addStructuredChunks(
        localChunks,
        indexId,
        documentType,
        relativePath,
        structuredChunks,
        buildMetadata(absolutePath, relativePath)
      );

      return localChunks;
    },
    {
      concurrency,
    }
  );

  perFileChunks.forEach((fileChunks) => {
    if (Array.isArray(fileChunks) && fileChunks.length) {
      chunks.push(...fileChunks);
    }
  });
}

function summarizeUploadIndex(chunks = []) {
  const typeCounts = {};
  const locationCounts = {};
  const sectionTitles = new Set();

  chunks.forEach((chunk) => {
    const type = chunk.metadata?.type || "text";
    typeCounts[type] = (typeCounts[type] || 0) + 1;
    locationCounts[chunk.location] = (locationCounts[chunk.location] || 0) + 1;
    if (chunk.metadata?.sectionTitle) {
      sectionTitles.add(chunk.metadata.sectionTitle);
    }
  });

  return {
    chunkTypes: typeCounts,
    documentCount: Object.keys(locationCounts).length,
    sectionTitles: Array.from(sectionTitles).slice(0, 50),
  };
}

function recordUploadEmbeddingEvent(documentType, chunks = []) {
  const totalTokens = chunks.reduce((sum, chunk) => sum + (chunk.tokens?.length || 0), 0);
  const averageChunkChars = chunks.length
    ? chunks.reduce((sum, chunk) => sum + String(chunk.text || "").length, 0) / chunks.length
    : 0;
  recordQualityEvent("embedding", {
    model: "structured-upload-index",
    strategy: `upload_${documentType}`,
    documentType,
    chunkCount: chunks.length,
    tokenCount: totalTokens,
    averageChunkChars,
  });
}

async function buildEpubUploadIndex(filePath, options = {}) {
  const indexId = options.indexId || crypto.randomUUID();
  const sourceFile = path.basename(filePath);
  const { tempDir } = await unzipToTemp(filePath);
  const concurrency = getUploadIndexConcurrency();

  try {
    const opfAbsolute = detectOpfPath(tempDir);
    let opfXml = null;
    if (opfAbsolute && fs.existsSync(opfAbsolute)) {
      opfXml = parseXml(fs.readFileSync(opfAbsolute, "utf8"));
    }

    const docs = resolveContentDocuments({
      tempDir,
      opfAbsolute,
      opfXml,
    });

    const chunks = [];
    const cssFiles = listFilesByExtension(tempDir, [".css"]);
    const jsFiles = listFilesByExtension(tempDir, [".js", ".mjs"]);
    const opfRelative = opfAbsolute
      ? path.relative(tempDir, opfAbsolute).replace(/\\/g, "/")
      : "";
    const navAbsolute = resolveManifestHref(
      tempDir,
      opfAbsolute,
      findManifestItemByPredicate(
        opfXml,
        (item) => String(item["@_properties"] || "").split(/\s+/).includes("nav")
      )?.["@_href"]
    ) || detectFirstFileByExtension(tempDir, ".xhtml");
    const ncxAbsolute = resolveManifestHref(
      tempDir,
      opfAbsolute,
      findManifestItemByPredicate(
        opfXml,
        (item) => item["@_media-type"] === "application/x-dtbncx+xml"
      )?.["@_href"]
    ) || detectFirstFileByExtension(tempDir, ".ncx");

    if (opfXml) {
      const metadataSummary = readOpfMetadata(opfXml);
      const headerText = [
        metadataSummary.title ? `Title: ${metadataSummary.title}` : "",
        metadataSummary.language ? `Language: ${metadataSummary.language}` : "",
        metadataSummary.identifier ? `Identifier: ${metadataSummary.identifier}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      addStructuredChunks(
        chunks,
        indexId,
        "epub",
        opfRelative || "package.opf",
        buildStructuredTextChunks([headerText, metadataSummary.manifestSummary, metadataSummary.spineSummary].filter(Boolean).join("\n\n")),
        {
          sourceKind: "package",
          relPath: opfRelative,
          manifestCount: metadataSummary.manifestCount,
          spineCount: metadataSummary.spineCount,
        }
      );
    }

    if (ncxAbsolute && fs.existsSync(ncxAbsolute)) {
      const ncxText = fs.readFileSync(ncxAbsolute, "utf8");
      addStructuredChunks(
        chunks,
        indexId,
        "epub",
        path.relative(tempDir, ncxAbsolute).replace(/\\/g, "/"),
        buildStructuredHtmlChunks(ncxText),
        {
          sourceKind: "navigation",
          relPath: path.relative(tempDir, ncxAbsolute).replace(/\\/g, "/"),
        }
      );
    }

    await addFilesInParallel({
      files: docs.map((doc) => doc.absolutePath),
      chunks,
      indexId,
      documentType: "epub",
      tempDir,
      concurrency,
      buildChunksForFile: (rawHtml) => buildStructuredHtmlChunks(rawHtml),
      buildMetadata: (absolutePath, relativePath) => ({
        relPath: relativePath,
        opfPath: opfRelative,
        navPath:
          navAbsolute && fs.existsSync(navAbsolute)
            ? path.relative(tempDir, navAbsolute).replace(/\\/g, "/")
            : "",
        sourceKind: "content",
      }),
    });

    await addFilesInParallel({
      files: cssFiles,
      chunks,
      indexId,
      documentType: "epub",
      tempDir,
      concurrency,
      buildChunksForFile: (rawCss) => buildStructuredCssChunks(rawCss),
      buildMetadata: (absolutePath, relativePath) => ({
        relPath: relativePath,
        sourceKind: "style",
        assetType: "css",
      }),
    });

    await addFilesInParallel({
      files: jsFiles,
      chunks,
      indexId,
      documentType: "epub",
      tempDir,
      concurrency,
      buildChunksForFile: (rawJs) => buildStructuredJsChunks(rawJs),
      buildMetadata: (absolutePath, relativePath) => ({
        relPath: relativePath,
        sourceKind: "script",
        assetType: "javascript",
      }),
    });

    const integrity = sanitizeChunkCollection(chunks, {
      defaults: {
        documentType: "epub",
      },
    });

    const payload = {
      indexId,
      documentType: "epub",
      sourceFile,
      createdAt: new Date().toISOString(),
      chunkCount: integrity.cleaned.length,
      summary: summarizeUploadIndex(integrity.cleaned),
      integrity: integrity.summary,
      batchStats: {
        concurrency,
        contentDocumentCount: docs.length,
        cssFileCount: cssFiles.length,
        jsFileCount: jsFiles.length,
      },
      chunks: integrity.cleaned,
    };

    recordUploadEmbeddingEvent("epub", integrity.cleaned);

    const savedTo = writeIndex(indexId, payload);
    return {
      ...payload,
      savedTo,
    };
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn("Failed to cleanup temp dir:", tempDir);
    }
  }
}

async function buildPdfUploadIndex(filePath, options = {}) {
  const indexId = options.indexId || crypto.randomUUID();
  const sourceFile = path.basename(filePath);
  const parsed = await extractPdfTextPages(filePath);
  const chunks = [];

  parsed.pages.forEach((page) => {
    const pageLocation = `page-${page.pageNumber}`;
    addStructuredChunks(
      chunks,
      indexId,
      "pdf",
      pageLocation,
      buildStructuredTextChunks(page.text),
      {
        pageNumber: page.pageNumber,
        sourceKind: "page",
        extractionMethod: page.extractionMethod || "text-layer",
        ocrApplied: page.ocrApplied === true,
      }
    );
  });

  const integrity = sanitizeChunkCollection(chunks, {
    defaults: {
      documentType: "pdf",
    },
  });

  const payload = {
    indexId,
    documentType: "pdf",
    sourceFile,
    createdAt: new Date().toISOString(),
    chunkCount: integrity.cleaned.length,
    summary: summarizeUploadIndex(integrity.cleaned),
    integrity: integrity.summary,
    chunks: integrity.cleaned,
  };

  recordUploadEmbeddingEvent("pdf", integrity.cleaned);

  const savedTo = writeIndex(indexId, payload);
  return {
    ...payload,
    savedTo,
  };
}

function validateSavedIndex(indexId, options = {}) {
  const filePath = indexPathFor(indexId);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const rawPayload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const integrity = sanitizeChunkCollection(rawPayload.chunks || [], {
    defaults: {
      documentType: rawPayload.documentType || "",
    },
  });
  const repaired = integrity.summary.rejectedCount > 0;

  if (repaired && options.rewrite === true) {
    writeIndex(indexId, {
      ...rawPayload,
      chunks: integrity.cleaned,
      integrity: integrity.summary,
      chunkCount: integrity.cleaned.length,
    });
  }

  return {
    indexId,
    repaired,
    filePath,
    documentType: rawPayload.documentType || "",
    sourceFile: rawPayload.sourceFile || "",
    summary: integrity.summary,
  };
}

function cleanupCorruptedIndices(options = {}) {
  const root = ensureDir(INDEX_ROOT);
  return fs.readdirSync(root)
    .filter((entry) => entry.toLowerCase().endsWith(".json"))
    .map((entry) => path.basename(entry, ".json"))
    .map((indexId) => validateSavedIndex(indexId, options))
    .filter(Boolean);
}

function searchUploadIndex(indexPayload, query, options = {}) {
  if (!tokenize(query).length) {
    return [];
  }

  return rankSearchResults(indexPayload?.chunks || [], query, options)
    .map((chunk) => ({
      id: chunk.id,
      location: chunk.location,
      score: Number(chunk.score.toFixed(4)),
      text: chunk.text,
      searchText: chunk.searchText || "",
      metadata: chunk.metadata || {},
    }));
}

module.exports = {
  buildEpubUploadIndex,
  buildPdfUploadIndex,
  cleanupCorruptedIndices,
  readIndex,
  searchUploadIndex,
  validateSavedIndex,
};

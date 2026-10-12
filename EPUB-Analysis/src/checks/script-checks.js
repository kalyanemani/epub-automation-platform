const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { listAllFiles, readTextFile } = require("../utils/unzip");

const SCRIPT_MEDIA_TYPES = new Set([
  "text/javascript",
  "application/javascript",
  "application/ecmascript",
  "text/ecmascript",
  "application/x-javascript",
]);

const UNSUPPORTED_API_PATTERNS = [
  { api: "eval()", pattern: /\beval\s*\(/g },
  { api: "new Function()", pattern: /\bnew\s+Function\s*\(/g },
  { api: "fetch()", pattern: /\bfetch\s*\(/g },
  { api: "XMLHttpRequest", pattern: /\bXMLHttpRequest\b/g },
  { api: "WebSocket", pattern: /\bWebSocket\b/g },
  { api: "localStorage", pattern: /\blocalStorage\b/g },
  { api: "sessionStorage", pattern: /\bsessionStorage\b/g },
  { api: "indexedDB", pattern: /\bindexedDB\b/g },
  { api: "ServiceWorker", pattern: /\bserviceWorker\b/g },
  { api: "Worker", pattern: /\b(?:SharedWorker|Worker)\s*\(/g },
  { api: "import()", pattern: /\bimport\s*\(/g },
  { api: "document.write()", pattern: /\bdocument\.write\s*\(/g },
  { api: "window.open()", pattern: /\bwindow\.open\s*\(/g },
];

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function toRelative(tempDir, filePath) {
  return path.relative(tempDir, filePath).replace(/\\/g, "/");
}

function lineFromIndex(text, index) {
  return String(text || "")
    .slice(0, Math.max(0, index))
    .split(/\r\n|\n/).length;
}

function createBucketStore() {
  return new Map();
}

function deriveLocation(sample) {
  if (!sample?.file) {
    return undefined;
  }

  const location = { file: sample.file };
  if (Number.isFinite(Number(sample.line))) {
    location.line = Number(sample.line);
  }
  return location;
}

function recordBucket(store, id, title, status, sample, suggestion = "") {
  if (!store.has(id)) {
    store.set(id, {
      id,
      title,
      status,
      suggestion,
      totalCount: 0,
      samples: [],
      keys: new Set(),
    });
  }

  const bucket = store.get(id);
  bucket.totalCount += Math.max(1, Number(sample?.occurrenceCount) || 1);
  if (status === "fail" || (status === "warn" && bucket.status !== "fail")) {
    bucket.status = status;
  }
  if (suggestion && !bucket.suggestion) {
    bucket.suggestion = suggestion;
  }

  const key = JSON.stringify(sample || {});
  if (!bucket.keys.has(key) && bucket.samples.length < 16) {
    bucket.keys.add(key);
    bucket.samples.push(sample);
  }
}

function toResults(store) {
  return Array.from(store.values()).map((bucket) => ({
    id: bucket.id,
    title: bucket.title,
    status: bucket.status,
    location: deriveLocation(bucket.samples[0]),
    details: {
      count: bucket.totalCount || bucket.samples.length,
      samples: bucket.samples,
    },
    suggestion: bucket.suggestion,
  }));
}

function getManifestItems(opfXml) {
  const items = opfXml?.package?.manifest?.item;
  return Array.isArray(items) ? items : items ? [items] : [];
}

function normalizeRelativePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .trim();
}

function buildManifestScriptMap(tempDir, opfAbsolute, opfXml) {
  const manifestScripts = new Map();

  getManifestItems(opfXml).forEach((item) => {
    const href = String(item?.["@_href"] || "").trim();
    const mediaType = String(item?.["@_media-type"] || "").trim().toLowerCase();
    const looksLikeScript =
      SCRIPT_MEDIA_TYPES.has(mediaType) || /\.(?:m?js|cjs)$/i.test(href);

    if (!looksLikeScript || !href || !opfAbsolute) {
      return;
    }

    const absolutePath = path.normalize(path.join(path.dirname(opfAbsolute), href));
    const relativePath = normalizeRelativePath(toRelative(tempDir, absolutePath));

    manifestScripts.set(relativePath.toLowerCase(), {
      id: String(item?.["@_id"] || "").trim(),
      href: relativePath,
      absolutePath,
      mediaType,
    });
  });

  return manifestScripts;
}

function extractAttributeValue(attributes, name) {
  const match = new RegExp(`${name}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(
    String(attributes || "")
  );
  return match ? String(match[2] || "").trim() : "";
}

function resolveAssetReference(baseFile, href) {
  const normalized = String(href || "").trim();
  if (!normalized) {
    return null;
  }

  const cleanHref = normalized.split("#")[0].split("?")[0];
  if (!cleanHref || /^(?:https?:|data:|javascript:)/i.test(cleanHref)) {
    return null;
  }

  return path.normalize(path.join(path.dirname(baseFile), cleanHref));
}

function parseSyntaxLocation(error, sourceText) {
  const stack = String(error?.stack || error?.message || "");
  const match = stack.match(/:(\d+):(\d+)/);
  const line = match ? Number(match[1]) : undefined;
  const column = match ? Number(match[2]) : undefined;

  if (Number.isFinite(line)) {
    return { line, column };
  }

  const positionMatch = stack.match(/position\s+(\d+)/i);
  if (positionMatch) {
    const index = Number(positionMatch[1]);
    return {
      line: lineFromIndex(sourceText, index),
    };
  }

  return {};
}

function inspectScriptSyntax(bucketStore, file, sourceText, contextKind) {
  const code = String(sourceText || "").trim();
  if (!code) {
    return;
  }

  try {
    new vm.Script(code, { filename: file });
  } catch (error) {
    const location = parseSyntaxLocation(error, code);
    recordBucket(
      bucketStore,
      "JS_SCRIPT_SYNTAX",
      "JavaScript syntax issues detected",
      "fail",
      {
        file,
        line: location.line,
        column: location.column,
        contextKind,
        issue: normalizeWhitespace(error.message || "JavaScript syntax error"),
      },
      "Fix malformed JavaScript before relying on scripting features in EPUB readers."
    );
  }
}

function inspectUnsupportedApis(bucketStore, file, sourceText, contextKind, lineOffset = 0) {
  const code = String(sourceText || "");

  UNSUPPORTED_API_PATTERNS.forEach(({ api, pattern }) => {
    const seenLines = new Set();
    let match;

    while ((match = pattern.exec(code)) !== null) {
      const line = lineFromIndex(code, match.index) + Math.max(0, lineOffset);
      if (seenLines.has(line)) {
        continue;
      }
      seenLines.add(line);
      recordBucket(
        bucketStore,
        "JS_UNSUPPORTED_API",
        "JavaScript uses reading-system-sensitive APIs",
        "warn",
        {
          file,
          line,
          api,
          contextKind,
        },
        "Replace browser-specific APIs with EPUB-safe scripting patterns or route the script to manual review."
      );
    }

    pattern.lastIndex = 0;
  });
}

function inspectHtmlScriptUsage({
  htmlFile,
  htmlRelPath,
  tempDir,
  manifestScripts,
  bucketStore,
  inspectedAssets,
}) {
  const rawHtml = readTextFile(htmlFile);
  const scriptTagRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  const inlineEventRegex = /\s(on[a-z0-9:_-]+)\s*=\s*(["'])([\s\S]*?)\2/gi;
  let match;

  while ((match = scriptTagRegex.exec(rawHtml)) !== null) {
    const attributes = String(match[1] || "");
    const inlineCode = String(match[2] || "");
    const src = extractAttributeValue(attributes, "src");
    const type = extractAttributeValue(attributes, "type").toLowerCase();
    const tagLine = lineFromIndex(rawHtml, match.index);

    if (type === "module") {
      recordBucket(
        bucketStore,
        "JS_MODULE_SCRIPT",
        "Module scripts may not be portable across EPUB reading systems",
        "warn",
        {
          file: htmlRelPath,
          line: tagLine,
          type,
        },
        "Prefer classic packaged scripts unless module support is explicitly validated for the target reading systems."
      );
    }

    if (src) {
      if (/^https?:/i.test(src)) {
        recordBucket(
          bucketStore,
          "JS_REMOTE_SCRIPT_REFERENCE",
          "Remote JavaScript references are not packaged with the EPUB",
          "fail",
          {
            file: htmlRelPath,
            line: tagLine,
            src,
          },
          "Package script assets inside the EPUB instead of loading them from a remote URL."
        );
        continue;
      }

      const resolvedPath = resolveAssetReference(htmlFile, src);
      if (!resolvedPath || !fs.existsSync(resolvedPath)) {
        recordBucket(
          bucketStore,
          "JS_SCRIPT_REFERENCE_BROKEN",
          "Script reference is broken",
          "fail",
          {
            file: htmlRelPath,
            line: tagLine,
            src,
          },
          "Fix the script src so the content document references a packaged asset."
        );
        continue;
      }

      const relativeScriptPath = normalizeRelativePath(toRelative(tempDir, resolvedPath));
      if (!manifestScripts.has(relativeScriptPath.toLowerCase())) {
        recordBucket(
          bucketStore,
          "JS_SCRIPT_REFERENCE_MISSING_MANIFEST",
          "Referenced scripts are not declared in the OPF manifest",
          "warn",
          {
            file: htmlRelPath,
            line: tagLine,
            script: relativeScriptPath,
          },
          "Declare packaged JavaScript assets in the OPF manifest so reading systems can discover them consistently."
        );
      }

      const inspectionKey = relativeScriptPath.toLowerCase();
      if (!inspectedAssets.has(inspectionKey)) {
        inspectedAssets.add(inspectionKey);
        const scriptSource = readTextFile(resolvedPath);
        inspectScriptSyntax(
          bucketStore,
          relativeScriptPath,
          scriptSource,
          "packaged-script"
        );
        inspectUnsupportedApis(
          bucketStore,
          relativeScriptPath,
          scriptSource,
          "packaged-script"
        );
      }

      continue;
    }

    if (normalizeWhitespace(inlineCode)) {
      recordBucket(
        bucketStore,
        "JS_INLINE_SCRIPT",
        "Inline JavaScript requires manual portability review",
        "warn",
        {
          file: htmlRelPath,
          line: tagLine,
        },
        "Move inline scripts into packaged assets when possible and validate them against target reading systems."
      );
      inspectScriptSyntax(bucketStore, htmlRelPath, inlineCode, "inline-script");
      inspectUnsupportedApis(bucketStore, htmlRelPath, inlineCode, "inline-script", tagLine - 1);
    }
  }

  while ((match = inlineEventRegex.exec(rawHtml)) !== null) {
    const attribute = String(match[1] || "").toLowerCase();
    const line = lineFromIndex(rawHtml, match.index);
    recordBucket(
      bucketStore,
      "JS_EVENT_HANDLER_ATTRIBUTE",
      "Inline event handler attributes require manual review",
      "warn",
      {
        file: htmlRelPath,
        line,
        attribute,
      },
      "Replace inline event handlers with packaged script listeners where possible and validate them against EPUB reader support."
    );
    inspectUnsupportedApis(bucketStore, htmlRelPath, match[3] || "", "inline-event-handler", line - 1);
  }
}

async function runScriptChecks(context) {
  const { tempDir, opfAbsolute, opfXml } = context;
  const bucketStore = createBucketStore();
  const manifestScripts = buildManifestScriptMap(tempDir, opfAbsolute, opfXml);
  const inspectedAssets = new Set();

  manifestScripts.forEach((entry) => {
    if (!fs.existsSync(entry.absolutePath)) {
      recordBucket(
        bucketStore,
        "JS_SCRIPT_MANIFEST_MISSING_FILE",
        "Manifest-declared JavaScript assets are missing from the package",
        "fail",
        {
          file: entry.href,
          manifestId: entry.id,
        },
        "Restore the missing script asset or remove the stale manifest entry."
      );
      return;
    }

  });

  const htmlFiles = listAllFiles(tempDir).filter((filePath) => {
    const lower = filePath.toLowerCase();
    return lower.endsWith(".html") || lower.endsWith(".xhtml");
  });

  htmlFiles.forEach((htmlFile) => {
    inspectHtmlScriptUsage({
      htmlFile,
      htmlRelPath: toRelative(tempDir, htmlFile),
      tempDir,
      manifestScripts,
      bucketStore,
      inspectedAssets,
    });
  });

  const results = toResults(bucketStore);
  if (!results.length) {
    results.push({
      id: "JS_VALIDATION_PASSED",
      title: "JavaScript validation passed",
      status: "pass",
      details:
        "No broken script references, high-risk inline handlers, unsupported APIs, or JavaScript syntax errors were detected.",
      suggestion: "",
    });
  }

  return results;
}

module.exports = {
  runScriptChecks,
};

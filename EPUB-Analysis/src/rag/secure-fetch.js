const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { ensureDir, getSnapshotRoot, loadAllowlist } = require("./kb-config");

function normalizeContentType(value) {
  return String(value || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function isAllowedContentType(contentType, allowedContentTypes = []) {
  return allowedContentTypes.some((allowedType) => contentType === normalizeContentType(allowedType));
}

function findDomainRule(urlObject, allowlist) {
  const hostname = String(urlObject.hostname || "").toLowerCase();
  const pathname = urlObject.pathname || "/";

  return (allowlist.domains || []).find((entry) => {
    if (hostname !== String(entry.domain || "").toLowerCase()) {
      return false;
    }

    return (entry.allowed_paths || []).some((prefix) => pathname.startsWith(prefix));
  });
}

function assertAllowedUrl(urlString) {
  const allowlist = loadAllowlist();
  const urlObject = new URL(urlString);

  if (urlObject.protocol !== "https:") {
    throw new Error("Only https URLs are allowed for external reference fetching.");
  }

  const rule = findDomainRule(urlObject, allowlist);
  if (!rule) {
    throw new Error(`URL is not permitted by the source allowlist: ${urlObject.hostname}${urlObject.pathname}`);
  }

  return { allowlist, rule, urlObject };
}

function stripActiveHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ")
    .replace(/\son[a-z]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, "")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

function toNormalizedText(content, contentType) {
  if (contentType === "text/html" || contentType === "application/xhtml+xml") {
    return stripActiveHtml(content)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return String(content || "").replace(/\s+/g, " ").trim();
}

function safeSnapshotName(urlObject) {
  const pathname = urlObject.pathname.replace(/[\/\\?%*:|"<>]/g, "_");
  const suffix = crypto.createHash("sha256").update(urlObject.toString()).digest("hex").slice(0, 12);
  const baseName = pathname.split("_").filter(Boolean).slice(-3).join("_") || "index";
  return `${baseName}-${suffix}`;
}

function contentExtension(contentType) {
  switch (contentType) {
    case "application/json":
      return ".json";
    case "text/html":
    case "application/xhtml+xml":
      return ".html";
    default:
      return ".txt";
  }
}

async function fetchReferenceSnapshot(urlString, options = {}) {
  const { allowlist, rule, urlObject } = assertAllowedUrl(urlString);
  const normalizedTimeoutMs = Math.max(1000, parseInt(options.timeoutMs || "15000", 10));
  const snapshotRoot = ensureDir(path.join(getSnapshotRoot(), urlObject.hostname));
  const snapshotName = safeSnapshotName(urlObject);
  const metaPath = path.join(snapshotRoot, `${snapshotName}.meta.json`);

  if (!options.forceRefresh && fs.existsSync(metaPath)) {
    return JSON.parse(fs.readFileSync(metaPath, "utf8"));
  }

  const response = await fetch(urlString, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(normalizedTimeoutMs),
    headers: {
      "User-Agent": "EPUB-Analysis-KB-Fetcher/1.0",
      Accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.1",
    },
  });

  if (response.status >= 300 && response.status < 400) {
    throw new Error(`Redirected responses are blocked for external fetches: ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(`External fetch failed with status ${response.status}`);
  }

  const contentType = normalizeContentType(response.headers.get("content-type"));
  if (!isAllowedContentType(contentType, rule.allowed_content_types || [])) {
    throw new Error(`Content type ${contentType || "<unknown>"} is not allowed for this source.`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const maxBytes = allowlist?.sanitization?.max_response_bytes || 10 * 1024 * 1024;
  if (bytes.length > maxBytes) {
    throw new Error(`Fetched content exceeds max_response_bytes (${maxBytes}).`);
  }

  const rawText = bytes.toString("utf8");
  const sanitized =
    contentType === "text/html" || contentType === "application/xhtml+xml"
      ? stripActiveHtml(rawText)
      : rawText;
  const normalizedText = toNormalizedText(rawText, contentType);
  const contentHash = crypto.createHash("sha256").update(bytes).digest("hex");

  const rawPath = path.join(snapshotRoot, `${snapshotName}${contentExtension(contentType)}`);
  const normalizedPath = path.join(snapshotRoot, `${snapshotName}.txt`);

  fs.writeFileSync(rawPath, sanitized, "utf8");
  fs.writeFileSync(normalizedPath, normalizedText, "utf8");

  const snapshot = {
    url: urlObject.toString(),
    hostname: urlObject.hostname,
    sourceId: options.sourceId ? String(options.sourceId) : "",
    sourceTitle: options.sourceTitle ? String(options.sourceTitle) : "",
    category: options.category ? String(options.category) : "",
    useFor: Array.isArray(options.useFor) ? options.useFor : [],
    trustLevel: rule.trust_level,
    contentType,
    contentHash,
    fetchedAt: new Date().toISOString(),
    rawPath,
    normalizedPath,
    sanitized: true,
    cached: false,
  };

  fs.writeFileSync(metaPath, JSON.stringify(snapshot, null, 2), "utf8");
  return snapshot;
}

module.exports = {
  assertAllowedUrl,
  fetchReferenceSnapshot,
  normalizeContentType,
};

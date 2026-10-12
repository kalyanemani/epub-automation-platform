const fs = require("fs");
const path = require("path");

const KB_ROOT = path.join(__dirname, "..", "..", "kb");
const MANIFEST_PATH = path.join(KB_ROOT, "manifest.json");
const ALLOWLIST_PATH = path.join(KB_ROOT, "source-allowlist.json");
const SNAPSHOT_ROOT = path.join(KB_ROOT, "snapshots");

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function loadManifest() {
  return readJson(MANIFEST_PATH, { folders: [], sources: [], future_specs: [] });
}

function loadAllowlist() {
  return readJson(ALLOWLIST_PATH, { default_policy: "deny", domains: [] });
}

function getKbRoot() {
  return KB_ROOT;
}

function getSnapshotRoot() {
  return ensureDir(SNAPSHOT_ROOT);
}

function walkFiles(targetPath, output = []) {
  if (!targetPath || !fs.existsSync(targetPath)) {
    return output;
  }

  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    output.push(targetPath);
    return output;
  }

  if (!stat.isDirectory()) {
    return output;
  }

  fs.readdirSync(targetPath).forEach((entry) => {
    walkFiles(path.join(targetPath, entry), output);
  });
  return output;
}

function listSnapshotMetadata() {
  return walkFiles(getSnapshotRoot())
    .filter((filePath) => filePath.endsWith(".meta.json"))
    .map((filePath) => readJson(filePath, null))
    .filter(Boolean);
}

function findSnapshotBySourceId(sourceId) {
  const normalized = String(sourceId || "").trim();
  if (!normalized) {
    return null;
  }

  return listSnapshotMetadata().find(
    (meta) => String(meta.sourceId || "").trim() === normalized
  ) || null;
}

module.exports = {
  ALLOWLIST_PATH,
  KB_ROOT,
  MANIFEST_PATH,
  SNAPSHOT_ROOT,
  ensureDir,
  findSnapshotBySourceId,
  getKbRoot,
  getSnapshotRoot,
  listSnapshotMetadata,
  loadAllowlist,
  loadManifest,
  readJson,
};

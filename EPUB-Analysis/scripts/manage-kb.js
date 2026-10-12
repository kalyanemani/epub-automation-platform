#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const { ensureDir, getKbRoot, loadAllowlist, loadManifest } = require("../src/rag/kb-config");
const { fetchReferenceSnapshot } = require("../src/rag/secure-fetch");

const PROJECT_ROOT = path.join(__dirname, "..");
const KB_ROOT = getKbRoot();
const REPORT_JSON_PATH = path.join(KB_ROOT, "KB_POPULATION_STATUS.json");
const REPORT_MD_PATH = path.join(KB_ROOT, "KB_POPULATION_STATUS.md");

const FETCHABLE_INGEST_TYPES = new Set(["html", "json", "text"]);
const DIRECTORY_INGEST_TYPES = new Set([
  "git-repo",
  "git-repo-or-exported-sqlite",
  "git-repo-or-pip-package-export",
]);
const TEXT_LIKE_EXTENSIONS = new Set([".html", ".json", ".jsonl", ".md", ".txt", ".xml", ".xhtml"]);

function usage() {
  console.log(`Usage:
  node scripts/manage-kb.js status
  node scripts/manage-kb.js plan
  node scripts/manage-kb.js fetch --all-fetchable [--force]
  node scripts/manage-kb.js fetch <sourceId> [<sourceId> ...] [--force]
  node scripts/manage-kb.js import-local <sourceId> <fromPath> [--force]

Commands:
  status         Generate KB population reports in kb/KB_POPULATION_STATUS.json and .md
  plan           Alias of status
  fetch          Fetch allowlisted file-based sources (html/json/text) into manifest target paths
  import-local   Copy a local file or directory into the manifest target path for a source
`);
}

function parseArgs(argv) {
  const args = [];
  const flags = new Set();

  argv.forEach((value) => {
    if (value.startsWith("--")) {
      flags.add(value);
    } else {
      args.push(value);
    }
  });

  return {
    command: args[0] || "status",
    positional: args.slice(1),
    force: flags.has("--force"),
    allFetchable: flags.has("--all-fetchable"),
  };
}

function resolveProjectPath(relativePath) {
  return path.join(PROJECT_ROOT, String(relativePath || ""));
}

function safeStat(targetPath) {
  try {
    return fs.statSync(targetPath);
  } catch (error) {
    return null;
  }
}

function isEffectivelyEmptyFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (!TEXT_LIKE_EXTENSIONS.has(extension)) {
    return false;
  }

  try {
    const content = fs.readFileSync(filePath, "utf8");
    return content.trim().length === 0;
  } catch (error) {
    return false;
  }
}

function countDirectoryContents(dirPath) {
  let fileCount = 0;
  let totalBytes = 0;
  let latestMtimeMs = 0;

  function walk(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    entries.forEach((entry) => {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        return;
      }

      if (!entry.isFile()) {
        return;
      }

      const stat = fs.statSync(absolutePath);
      fileCount += 1;
      totalBytes += stat.size;
      latestMtimeMs = Math.max(latestMtimeMs, stat.mtimeMs || 0);
    });
  }

  walk(dirPath);
  return {
    fileCount,
    totalBytes,
    latestMtimeMs,
  };
}

function inspectTarget(source) {
  const relativePath = source.target_path || "";
  const absolutePath = resolveProjectPath(relativePath);
  const stat = safeStat(absolutePath);

  if (!stat) {
    return {
      exists: false,
      status: "missing",
      targetKind: DIRECTORY_INGEST_TYPES.has(source.ingest_as) ? "directory" : "file",
      absolutePath,
      fileCount: 0,
      totalBytes: 0,
      lastModified: "",
    };
  }

  if (stat.isDirectory()) {
    const dirStats = countDirectoryContents(absolutePath);
    return {
      exists: true,
      status: dirStats.fileCount > 0 ? "populated_directory" : "empty_directory",
      targetKind: "directory",
      absolutePath,
      fileCount: dirStats.fileCount,
      totalBytes: dirStats.totalBytes,
      lastModified: dirStats.latestMtimeMs ? new Date(dirStats.latestMtimeMs).toISOString() : "",
    };
  }

  return {
    exists: true,
    status:
      stat.size > 0 && !isEffectivelyEmptyFile(absolutePath)
        ? "populated_file"
        : "empty_file",
    targetKind: "file",
    absolutePath,
    fileCount: 1,
    totalBytes: stat.size,
    lastModified: stat.mtime ? stat.mtime.toISOString() : "",
  };
}

function computeAcquisitionMode(source) {
  if (FETCHABLE_INGEST_TYPES.has(source.ingest_as) && source.url) {
    return "fetchable";
  }

  if (DIRECTORY_INGEST_TYPES.has(source.ingest_as)) {
    return "local_import_required";
  }

  if (source.category === "internal") {
    return "maintain_internally";
  }

  return "local_import_required";
}

function buildNextAction(source, inspection) {
  if (inspection.status === "populated_file" || inspection.status === "populated_directory") {
    return "No action required.";
  }

  const acquisitionMode = computeAcquisitionMode(source);
  switch (acquisitionMode) {
    case "fetchable":
      return `Run: node scripts/manage-kb.js fetch ${source.id}`;
    case "maintain_internally":
      return `Populate: ${source.target_path}`;
    default:
      return `Run: node scripts/manage-kb.js import-local ${source.id} <local-path>`;
  }
}

function buildStatusReport() {
  const manifest = loadManifest();
  const allowlist = loadAllowlist();
  const generatedAt = new Date().toISOString();

  const sources = (manifest.sources || []).map((source) => {
    const inspection = inspectTarget(source);
    const acquisitionMode = computeAcquisitionMode(source);
    const nextAction = buildNextAction(source, inspection);

    return {
      id: source.id,
      title: source.title,
      category: source.category,
      priority: source.priority,
      ingestAs: source.ingest_as,
      vectorIndex: Boolean(source.vector_index),
      lookupOnly: Boolean(source.lookup_only),
      acquisitionMode,
      status: inspection.status,
      exists: inspection.exists,
      targetKind: inspection.targetKind,
      targetPath: source.target_path,
      absolutePath: inspection.absolutePath,
      fileCount: inspection.fileCount,
      totalBytes: inspection.totalBytes,
      lastModified: inspection.lastModified,
      url: source.url || "",
      useFor: Array.isArray(source.use_for) ? source.use_for : [],
      nextAction,
    };
  });

  const summary = {
    totalSources: sources.length,
    populated: sources.filter((source) =>
      source.status === "populated_file" || source.status === "populated_directory"
    ).length,
    missing: sources.filter((source) => source.status === "missing").length,
    empty: sources.filter((source) =>
      source.status === "empty_file" || source.status === "empty_directory"
    ).length,
    fetchableMissing: sources.filter((source) =>
      source.acquisitionMode === "fetchable" &&
      (source.status === "missing" || source.status === "empty_file" || source.status === "empty_directory")
    ).length,
    localImportMissing: sources.filter((source) =>
      source.acquisitionMode === "local_import_required" &&
      (source.status === "missing" || source.status === "empty_file" || source.status === "empty_directory")
    ).length,
    internalPending: sources.filter((source) =>
      source.acquisitionMode === "maintain_internally" &&
      (source.status === "missing" || source.status === "empty_file" || source.status === "empty_directory")
    ).length,
  };

  const byCategory = (manifest.sources || []).reduce((accumulator, source) => {
    const entry = sources.find((item) => item.id === source.id);
    const key = source.category || "uncategorized";
    if (!accumulator[key]) {
      accumulator[key] = {
        total: 0,
        populated: 0,
        missingOrEmpty: 0,
      };
    }

    accumulator[key].total += 1;
    if (entry.status === "populated_file" || entry.status === "populated_directory") {
      accumulator[key].populated += 1;
    } else {
      accumulator[key].missingOrEmpty += 1;
    }

    return accumulator;
  }, {});

  return {
    generatedAt,
    project: manifest.project || "EPUB-Analysis",
    manifestVersion: manifest.version || "",
    allowlistDefaultPolicy: allowlist.default_policy || "deny",
    summary,
    byCategory,
    sources,
  };
}

function renderStatusMarkdown(report) {
  const lines = [];
  lines.push("# KB Population Status");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Total sources: ${report.summary.totalSources}`);
  lines.push(`- Populated: ${report.summary.populated}`);
  lines.push(`- Missing: ${report.summary.missing}`);
  lines.push(`- Empty: ${report.summary.empty}`);
  lines.push(`- Fetchable missing or empty: ${report.summary.fetchableMissing}`);
  lines.push(`- Local import required: ${report.summary.localImportMissing}`);
  lines.push(`- Internal sources pending content: ${report.summary.internalPending}`);
  lines.push("");
  lines.push("## By Category");
  lines.push("");
  Object.keys(report.byCategory)
    .sort()
    .forEach((category) => {
      const item = report.byCategory[category];
      lines.push(`- ${category}: ${item.populated}/${item.total} populated`);
    });
  lines.push("");
  lines.push("## Sources");
  lines.push("");
  lines.push("| ID | Category | Ingest | Status | Files | Target | Next Action |");
  lines.push("| --- | --- | --- | --- | ---: | --- | --- |");

  report.sources
    .slice()
    .sort((left, right) => {
      const leftPriority = String(left.priority || "");
      const rightPriority = String(right.priority || "");
      if (leftPriority !== rightPriority) {
        return leftPriority.localeCompare(rightPriority);
      }
      return String(left.id).localeCompare(String(right.id));
    })
    .forEach((source) => {
      lines.push(
        `| ${source.id} | ${source.category} | ${source.ingestAs} | ${source.status} | ${source.fileCount} | ${source.targetPath} | ${source.nextAction} |`
      );
    });

  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- `fetchable` sources can be ingested directly by `scripts/manage-kb.js fetch`.");
  lines.push("- `local_import_required` sources are directories or exported assets that should be copied in from a local checkout or archive.");
  lines.push("- Empty internal example corpora are intentional until real reviewed examples are added.");

  return lines.join("\n");
}

function writeReport(report) {
  fs.writeFileSync(REPORT_JSON_PATH, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(REPORT_MD_PATH, renderStatusMarkdown(report), "utf8");
}

function ensureWritableTarget(source, force = false) {
  const targetPath = resolveProjectPath(source.target_path);
  const targetDir = DIRECTORY_INGEST_TYPES.has(source.ingest_as)
    ? targetPath
    : path.dirname(targetPath);

  ensureDir(targetDir);

  if (safeStat(targetPath) && !force) {
    throw new Error(`Target already exists for ${source.id}. Re-run with --force to overwrite.`);
  }

  return targetPath;
}

function removeTarget(targetPath) {
  const stat = safeStat(targetPath);
  if (!stat) {
    return;
  }

  if (stat.isDirectory()) {
    fs.rmSync(targetPath, { recursive: true, force: true });
    return;
  }

  fs.rmSync(targetPath, { force: true });
}

function copyRecursive(sourcePath, targetPath) {
  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    ensureDir(targetPath);
    const entries = fs.readdirSync(sourcePath, { withFileTypes: true });
    entries.forEach((entry) => {
      copyRecursive(path.join(sourcePath, entry.name), path.join(targetPath, entry.name));
    });
    return;
  }

  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function requireSourceById(sourceId) {
  const manifest = loadManifest();
  const source = (manifest.sources || []).find((item) => item.id === sourceId);
  if (!source) {
    throw new Error(`Unknown source id: ${sourceId}`);
  }
  return source;
}

async function fetchSources(sourceIds = [], options = {}) {
  const manifest = loadManifest();
  const selected = options.allFetchable
    ? (manifest.sources || []).filter((source) => FETCHABLE_INGEST_TYPES.has(source.ingest_as) && source.url)
    : sourceIds.map((sourceId) => requireSourceById(sourceId));

  if (!selected.length) {
    throw new Error("No fetchable sources selected.");
  }

  for (const source of selected) {
    if (!FETCHABLE_INGEST_TYPES.has(source.ingest_as) || !source.url) {
      console.log(`Skipping ${source.id}: ingest type ${source.ingest_as} requires local import.`);
      continue;
    }

    const targetPath = ensureWritableTarget(source, options.force);
    const snapshot = await fetchReferenceSnapshot(source.url, {
      forceRefresh: Boolean(options.force),
    });

    copyRecursive(snapshot.rawPath, targetPath);
    console.log(`Fetched ${source.id} -> ${source.target_path}`);
  }
}

function importLocal(sourceId, fromPath, options = {}) {
  if (!fromPath) {
    throw new Error("import-local requires a source id and a local path.");
  }

  const source = requireSourceById(sourceId);
  const sourcePath = path.resolve(fromPath);
  const sourceStat = safeStat(sourcePath);
  if (!sourceStat) {
    throw new Error(`Local import path not found: ${sourcePath}`);
  }

  const targetPath = ensureWritableTarget(source, options.force);
  if (options.force) {
    removeTarget(targetPath);
  }

  copyRecursive(sourcePath, targetPath);
  console.log(`Imported ${source.id} from ${sourcePath} -> ${source.target_path}`);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));

  switch (parsed.command) {
    case "status":
    case "plan": {
      const report = buildStatusReport();
      writeReport(report);
      console.log(`KB status written to ${REPORT_MD_PATH}`);
      console.log(`Populated ${report.summary.populated}/${report.summary.totalSources} sources.`);
      break;
    }

    case "fetch": {
      await fetchSources(parsed.positional, {
        allFetchable: parsed.allFetchable,
        force: parsed.force,
      });
      const report = buildStatusReport();
      writeReport(report);
      console.log(`Updated KB status written to ${REPORT_MD_PATH}`);
      break;
    }

    case "import-local": {
      const [sourceId, fromPath] = parsed.positional;
      importLocal(sourceId, fromPath, { force: parsed.force });
      const report = buildStatusReport();
      writeReport(report);
      console.log(`Updated KB status written to ${REPORT_MD_PATH}`);
      break;
    }

    case "help":
    case "--help":
    case "-h":
      usage();
      break;

    default:
      usage();
      process.exitCode = 1;
      break;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

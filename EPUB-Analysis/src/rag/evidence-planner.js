const path = require("path");

const { findSnapshotBySourceId, getKbRoot, loadManifest } = require("./kb-config");
const { routeIssue, sortSources, unique } = require("./issue-router");

function intersect(left = [], right = []) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function fileExistsInKb(targetPath) {
  if (!targetPath) return false;
  try {
    return require("fs").existsSync(path.join(getKbRoot(), "..", targetPath));
  } catch (error) {
    return false;
  }
}

function isSourceLocallyAvailable(source = {}) {
  if (fileExistsInKb(source.target_path)) {
    return true;
  }

  return Boolean(findSnapshotBySourceId(source.id));
}

function buildEvidencePlan({ issue = {}, documentType = "epub", limit = 8 } = {}) {
  const manifest = loadManifest();
  const route = routeIssue({ issue, documentType });
  const sourceHintSet = new Set(route.sourceHints || []);

  const matched = (manifest.sources || []).filter((source) => {
    if (sourceHintSet.has(source.id)) {
      return true;
    }

    if (!route.kbUseCases?.length || !source.use_for?.length) {
      return false;
    }

    return intersect(route.kbUseCases, source.use_for).length > 0;
  });

  const ordered = sortSources(matched).slice(0, limit);

  return {
    issueId: issue.id || "",
    documentType,
    route,
    sources: ordered.map((source) => ({
      id: source.id,
      title: source.title,
      category: source.category,
      priority: source.priority,
      url: source.url,
      targetPath: source.target_path,
      ingestAs: source.ingest_as,
      vectorIndex: Boolean(source.vector_index),
      lookupOnly: Boolean(source.lookup_only),
      useFor: unique(source.use_for || []),
      locallyAvailable: isSourceLocallyAvailable(source),
    })),
  };
}

module.exports = {
  buildEvidencePlan,
};

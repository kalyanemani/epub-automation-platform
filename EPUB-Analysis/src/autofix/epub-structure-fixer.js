/**
 * Structure-level fixers: mimetype, manifest dedup, NCX IDs, phantom entries, unreferenced media.
 */
const fs = require("fs");
const path = require("path");

/**
 * Fix S_MIMETYPE_MISSING / S_MIMETYPE_CONTENT: write correct mimetype file.
 */
function fixMimetype(tempDir) {
  const mimetypePath = path.join(tempDir, "mimetype");
  const correct = "application/epub+zip";
  let changed = false;
  if (!fs.existsSync(mimetypePath)) {
    fs.writeFileSync(mimetypePath, correct, "utf8");
    changed = true;
  } else {
    const current = fs.readFileSync(mimetypePath, "utf8").trim();
    if (current !== correct) {
      fs.writeFileSync(mimetypePath, correct, "utf8");
      changed = true;
    }
  }
  return changed;
}

/**
 * Fix S_MANIFEST_DUP_IDS: deduplicate <item> id attributes in manifest by appending _N suffix.
 */
function fixManifestDupIds(opfPath) {
  let xml = fs.readFileSync(opfPath, "utf8");
  const seen = new Map();
  let changed = false;

  xml = xml.replace(/(<item\b[^>]*\bid="([^"]*)"[^>]*\/?>)/gi, (match, _tag, id) => {
    const lc = id.toLowerCase();
    if (!seen.has(lc)) {
      seen.set(lc, 0);
      return match;
    }
    changed = true;
    const n = seen.get(lc) + 1;
    seen.set(lc, n);
    const newId = `${id}_dup${n}`;
    return match.replace(`id="${id}"`, `id="${newId}"`);
  });

  if (changed) fs.writeFileSync(opfPath, xml, "utf8");
  return changed;
}

/**
 * Fix NCX_IDS_UNIQUE: deduplicate id attributes in NCX file.
 */
function fixNcxDupIds(ncxPath) {
  if (!ncxPath || !fs.existsSync(ncxPath)) return false;
  let xml = fs.readFileSync(ncxPath, "utf8");
  const seen = new Map();
  let changed = false;

  xml = xml.replace(/\bid="([^"]*)"/g, (match, id) => {
    const lc = id.toLowerCase();
    if (!seen.has(lc)) { seen.set(lc, 0); return match; }
    changed = true;
    const n = seen.get(lc) + 1;
    seen.set(lc, n);
    return `id="${id}_u${n}"`;
  });

  if (changed) fs.writeFileSync(ncxPath, xml, "utf8");
  return changed;
}

/**
 * Fix NCX_PHANTOM_ENTRIES: remove navPoint entries in NCX whose content src doesn't exist.
 */
function fixNcxPhantomEntries(ncxPath, tempDir) {
  if (!ncxPath || !fs.existsSync(ncxPath)) return 0;
  let xml = fs.readFileSync(ncxPath, "utf8");
  let removed = 0;
  const ncxDir = path.dirname(ncxPath);

  xml = xml.replace(/<navPoint\b[\s\S]*?<\/navPoint>/gi, (block) => {
    const srcMatch = block.match(/\bsrc="([^"#]*)([^"]*)"/i);
    if (!srcMatch) return block;
    const srcFile = path.resolve(ncxDir, srcMatch[1]);
    if (!fs.existsSync(srcFile)) { removed++; return ""; }
    return block;
  });

  if (removed > 0) fs.writeFileSync(ncxPath, xml, "utf8");
  return removed;
}

/**
 * Fix NAV_TOC_PHANTOM_ENTRIES: remove <li> entries in nav.xhtml TOC whose href target doesn't exist.
 */
function fixNavPhantomEntries(navPath, tempDir) {
  if (!navPath || !fs.existsSync(navPath)) return 0;
  let html = fs.readFileSync(navPath, "utf8");
  let removed = 0;
  const navDir = path.dirname(navPath);

  html = html.replace(/<li\b[^>]*>[\s\S]*?<\/li>/gi, (block) => {
    const hrefMatch = block.match(/\bhref="([^"#]*)([^"]*)"/i);
    if (!hrefMatch) return block;
    const target = hrefMatch[1];
    if (!target) return block;
    const targetPath = path.resolve(navDir, target);
    if (!fs.existsSync(targetPath)) { removed++; return ""; }
    return block;
  });

  if (removed > 0) fs.writeFileSync(navPath, html, "utf8");
  return removed;
}

/**
 * Fix UNREFERENCED_MEDIA: remove manifest <item> entries for files that are not
 * referenced from spine, nav, or content documents.
 * Only removes entries — does NOT delete physical files (safe).
 */
function fixUnreferencedMedia(opfPath) {
  let xml = fs.readFileSync(opfPath, "utf8");
  const opfDir = path.dirname(opfPath);

  // Collect all hrefs in spine itemrefs
  const spineRefs = new Set();
  (xml.match(/<itemref\b[^>]*\bidref="([^"]+)"/gi) || []).forEach((m) => {
    const id = m.match(/idref="([^"]+)"/i)?.[1];
    if (id) spineRefs.add(id);
  });

  // Only remove manifest items that are media files (image/audio/video/font)
  // and whose id is not in the spine refs
  const REMOVABLE_TYPES = /^(image\/|audio\/|video\/|font\/|application\/x-font|application\/vnd\.ms-fontobject)/i;
  let removed = 0;

  xml = xml.replace(/[ \t]*<item\b[^>]*\/>\r?\n?/gi, (match) => {
    const idMatch = match.match(/\bid="([^"]+)"/i);
    const typeMatch = match.match(/\bmedia-type="([^"]+)"/i);
    const hrefMatch = match.match(/\bhref="([^"]+)"/i);
    if (!idMatch || !typeMatch || !hrefMatch) return match;
    const id = idMatch[1];
    const mediaType = typeMatch[1];
    const href = hrefMatch[1];
    if (!REMOVABLE_TYPES.test(mediaType)) return match;
    if (spineRefs.has(id)) return match;
    // Check if file exists — only remove from manifest if file is missing
    const filePath = path.resolve(opfDir, href);
    if (fs.existsSync(filePath)) return match; // file exists, may be referenced from content docs
    removed++;
    return "";
  });

  if (removed > 0) fs.writeFileSync(opfPath, xml, "utf8");
  return removed;
}

/**
 * Fix MULTIPLE_COVERS: keep only the first item with properties="cover-image".
 */
function fixMultipleCovers(opfPath) {
  let xml = fs.readFileSync(opfPath, "utf8");
  let found = false;
  let changed = false;

  xml = xml.replace(/(<item\b[^>]*\bproperties="[^"]*cover-image[^"]*"[^>]*\/?>)/gi, (match) => {
    if (!found) { found = true; return match; }
    changed = true;
    // Remove the cover-image property but keep the item
    return match.replace(/\s*cover-image\s*/g, "").replace(/\bproperties="\s*"/g, "");
  });

  if (changed) fs.writeFileSync(opfPath, xml, "utf8");
  return changed;
}

module.exports = {
  fixMimetype,
  fixManifestDupIds,
  fixNcxDupIds,
  fixNcxPhantomEntries,
  fixNavPhantomEntries,
  fixUnreferencedMedia,
  fixMultipleCovers,
};

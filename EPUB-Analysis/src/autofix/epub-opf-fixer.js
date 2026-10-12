const fs = require("fs");
const path = require("path");

/**
 * Correct EPUB media-type for every recognised file extension.
 */
const CORRECT_MEDIA_TYPES = {
  ".xhtml": "application/xhtml+xml",
  ".html":  "application/xhtml+xml",
  ".htm":   "application/xhtml+xml",
  ".css":   "text/css",
  ".jpg":   "image/jpeg",
  ".jpeg":  "image/jpeg",
  ".png":   "image/png",
  ".gif":   "image/gif",
  ".svg":   "image/svg+xml",
  ".mp3":   "audio/mpeg",
  ".mp4":   "video/mp4",
  ".ncx":   "application/x-dtbncx+xml",
  ".ttf":   "font/ttf",
  ".otf":   "font/otf",
  ".woff":  "font/woff",
  ".woff2": "font/woff2",
  ".eot":   "application/vnd.ms-fontobject",
  ".js":    "application/javascript",
  ".smil":  "application/smil+xml",
};

/**
 * Font extension → correct EPUB3 media-type
 */
const FONT_MEDIA_TYPES = {
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".eot": "application/vnd.ms-fontobject",
};

/**
 * Wrong MIME values commonly used for fonts that we want to replace.
 */
const WRONG_FONT_MIMES = new Set([
  "application/x-font-ttf",
  "application/x-font-otf",
  "application/vnd.ms-opentype",
  "application/font-woff",
  "application/font-woff2",
  "application/x-font-woff",
]);

/**
 * Default accessibility metadata to inject when missing.
 * Values follow schema.org / EPUB accessibility spec defaults.
 */
const A11Y_DEFAULTS = {
  "schema:accessMode": ["textual", "visual"],
  "schema:accessibilityFeature": ["structuralNavigation", "tableOfContents"],
  "schema:accessibilityHazard": ["none"],
};

/**
 * Fix S_MANIFEST_ITEMS_INVALID: correct font media-type mismatches.
 *
 * Uses raw text regex surgery to avoid losing XML namespace prefixes or
 * attribute order that a full parse-and-reserialize would mangle.
 *
 * Returns true if any changes were written.
 */
function fixManifestMediaTypes(opfPath) {
  let xml = fs.readFileSync(opfPath, "utf8");
  let changed = false;

  // Match every <item …/> or <item …></item> in the manifest.
  // Capture the whole tag so we can do a targeted replacement.
  xml = xml.replace(
    /(<item\b[^>]*\bhref="([^"]*)"[^>]*\bmedia-type="([^"]*)"[^>]*\/?>)/gi,
    (match, _tag, href, mediaType) => {
      const ext = (href.match(/\.[^./?]+(?:[?#]|$)/) || [""])[0]
        .toLowerCase()
        .replace(/[?#].*/, "");
      const correct = FONT_MEDIA_TYPES[ext];
      if (correct && WRONG_FONT_MIMES.has(mediaType) && mediaType !== correct) {
        changed = true;
        return match.replace(
          `media-type="${mediaType}"`,
          `media-type="${correct}"`
        );
      }
      return match;
    }
  );

  if (changed) {
    fs.writeFileSync(opfPath, xml, "utf8");
  }
  return changed;
}

/**
 * Comprehensive S_MANIFEST_ITEMS_INVALID fixer.
 *
 * Handles three classes of issue detected by validateManifestItems:
 *   1. Wrong media-type for any file type (images, CSS, XHTML, fonts, …)
 *   2. Manifest entries whose file does not exist on disk (removed + spine cleaned)
 *   3. Duplicate href entries (second+ occurrence removed + spine cleaned)
 *
 * Uses raw-text regex surgery to avoid namespace/attribute-order mangling.
 * Returns true if any change was written.
 */
function fixManifestItems(opfPath) {
  const opfDir = path.dirname(opfPath);
  let xml = fs.readFileSync(opfPath, "utf8");
  let changed = false;
  const removedIds = new Set();
  const seenHrefs  = new Set();

  // Process every self-closing or open <item ...> tag in the manifest.
  // Attribute order is arbitrary, so we extract each piece individually.
  xml = xml.replace(/<item\b([^>]*?)(\s*\/?>)/gi, (match, attrs, closing) => {
    const hrefM = attrs.match(/\bhref="([^"]*)"/i);
    if (!hrefM) return match;
    const href   = hrefM[1].replace(/[?#].*/, "");  // strip query/fragment
    const idM    = attrs.match(/\bid="([^"]*)"/i);
    const mtM    = attrs.match(/\bmedia-type="([^"]*)"/i);
    const itemId = idM ? idM[1] : null;

    // ── 1. Remove duplicate hrefs (keep the first occurrence) ──────────────
    if (seenHrefs.has(href)) {
      changed = true;
      if (itemId) removedIds.add(itemId);
      return "";
    }
    seenHrefs.add(href);

    // ── 2. Remove entries whose file doesn't exist on disk ─────────────────
    const fullPath = path.join(opfDir, href);
    if (!fs.existsSync(fullPath)) {
      changed = true;
      if (itemId) removedIds.add(itemId);
      return "";
    }

    // ── 3. Fix wrong media-type ─────────────────────────────────────────────
    if (mtM) {
      const ext     = path.extname(href).toLowerCase();
      const correct = CORRECT_MEDIA_TYPES[ext];
      if (correct && mtM[1] !== correct) {
        changed = true;
        return match.replace(`media-type="${mtM[1]}"`, `media-type="${correct}"`);
      }
    }

    return match;
  });

  // Remove spine <itemref> tags that pointed to now-deleted manifest items.
  for (const id of removedIds) {
    const re     = new RegExp(`\\s*<itemref\\b[^>]*\\bidref="${id}"[^>]*/?>`, "gi");
    const before = xml;
    xml = xml.replace(re, "");
    if (xml !== before) changed = true;
  }

  if (changed) fs.writeFileSync(opfPath, xml, "utf8");
  return changed;
}

/**
 * Fix M_DUPLICATES: remove duplicate <dc:*> metadata elements.
 *
 * Keeps the first occurrence of each tag name; removes subsequent ones.
 * Returns true if any changes were written.
 */
function fixDuplicateMetadata(opfPath) {
  let xml = fs.readFileSync(opfPath, "utf8");

  // Isolate the <metadata>…</metadata> block
  const metaMatch = xml.match(/<metadata\b[^>]*>([\s\S]*?)<\/metadata>/i);
  if (!metaMatch) return false;

  const originalBlock = metaMatch[0];
  const seen = new Set();
  let changed = false;

  const fixedBlock = originalBlock.replace(
    /<(dc:[a-z:]+)(\b[^>]*)>([\s\S]*?)<\/\1>/gi,
    (match, tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) {
        changed = true;
        return ""; // drop duplicate
      }
      seen.add(key);
      return match;
    }
  );

  if (changed) {
    xml = xml.replace(originalBlock, fixedBlock);
    fs.writeFileSync(opfPath, xml, "utf8");
  }
  return changed;
}

/**
 * Fix M_EPUB2_GUIDE: remove the deprecated <guide>…</guide> element.
 * Returns true if any changes were written.
 */
function fixEpub2Guide(opfPath) {
  let xml = fs.readFileSync(opfPath, "utf8");
  const before = xml;
  // Strip <guide>…</guide> including any surrounding whitespace line
  xml = xml.replace(/[ \t]*<guide\b[^>]*>[\s\S]*?<\/guide>[ \t]*(\r?\n)?/gi, "");
  if (xml !== before) {
    fs.writeFileSync(opfPath, xml, "utf8");
    return true;
  }
  return false;
}

/**
 * Fix A_SCHEMA_* issues: inject missing schema.org accessibility metadata.
 *
 * Only adds a property if no element with that property name already exists.
 * Returns an array of property names that were added (empty = nothing changed).
 */
function fixAccessibilityMetadata(opfPath, issuesToFix = []) {
  let xml = fs.readFileSync(opfPath, "utf8");
  const added = [];

  const propertiesToAdd = issuesToFix
    .map((id) => {
      if (id === "A_SCHEMA_ACCESSMODE_MISSING") return "schema:accessMode";
      if (id === "A_SCHEMA_ACCESSIBILITYFEATURE_MISSING") return "schema:accessibilityFeature";
      if (id === "A_SCHEMA_ACCESSIBILITYHAZARD_MISSING") return "schema:accessibilityHazard";
      return null;
    })
    .filter(Boolean);

  if (!propertiesToAdd.length) return added;

  // Find the closing </metadata> tag to inject before it
  const metaCloseMatch = xml.match(/<\/metadata>/i);
  if (!metaCloseMatch) return added;

  let injection = "";
  for (const prop of propertiesToAdd) {
    // Skip if already present
    const alreadyPresent = new RegExp(
      `<meta\\b[^>]*\\bproperty="${prop.replace(":", "\\:")}"`,
      "i"
    ).test(xml);
    if (alreadyPresent) continue;

    const values = A11Y_DEFAULTS[prop] || [];
    for (const value of values) {
      injection += `    <meta property="${prop}">${value}</meta>\n`;
    }
    added.push(prop);
  }

  if (injection) {
    xml = xml.replace(/<\/metadata>/i, `${injection}</metadata>`);
    fs.writeFileSync(opfPath, xml, "utf8");
  }
  return added;
}

/**
 * Fix M_RENDITION_* issues: inject missing rendition meta elements.
 * Returns array of issue IDs that were resolved.
 */
function fixRenditionMetadata(opfPath, issuesToFix) {
  let xml = fs.readFileSync(opfPath, "utf8");
  const added = [];

  const renditionMap = {
    M_RENDITION_LAYOUT:      { property: "rendition:layout",      value: "reflowable" },
    M_RENDITION_ORIENTATION: { property: "rendition:orientation",  value: "auto" },
    M_RENDITION_SPREAD:      { property: "rendition:spread",       value: "auto" },
  };

  const metaCloseMatch = xml.match(/<\/metadata>/i);
  if (!metaCloseMatch) return added;

  let injection = "";
  for (const id of issuesToFix) {
    const entry = renditionMap[id];
    if (!entry) continue;
    const already = new RegExp(`property="${entry.property.replace(":", "\\:")}"`, "i").test(xml);
    if (already) continue;
    injection += `    <meta property="${entry.property}">${entry.value}</meta>\n`;
    added.push(id);
  }

  if (injection) {
    xml = xml.replace(/<\/metadata>/i, `${injection}</metadata>`);
    fs.writeFileSync(opfPath, xml, "utf8");
  }
  return added;
}

/**
 * Fix missing dc:* metadata elements (M_LANGUAGE, M_PUBLISHER, M_DATE, M_IDENTIFIER).
 * Only injects elements that are genuinely absent.
 * Returns array of issue IDs that were resolved.
 */
function fixMissingDcMetadata(opfPath, issuesToFix) {
  const crypto = require("crypto");
  let xml = fs.readFileSync(opfPath, "utf8");
  const added = [];

  const fixMap = {
    M_LANGUAGE:   { tag: "dc:language",  value: "en" },
    M_PUBLISHER:  { tag: "dc:publisher", value: "Unknown Publisher" },
    M_DATE:       { tag: "dc:date",      value: new Date().toISOString().slice(0, 10) },
    M_IDENTIFIER: { tag: "dc:identifier",value: `urn:uuid:${crypto.randomUUID()}` },
  };

  const metaCloseMatch = xml.match(/<\/metadata>/i);
  if (!metaCloseMatch) return added;

  let injection = "";
  for (const id of issuesToFix) {
    const entry = fixMap[id];
    if (!entry) continue;
    const tagLocal = entry.tag.split(":")[1];
    const alreadyPresent = new RegExp(`<(?:[^:\\s>]+:)?${tagLocal}[\\s>]`, "i").test(xml);
    if (alreadyPresent) continue;
    injection += `    <${entry.tag}>${entry.value}</${entry.tag}>\n`;
    added.push(id);
  }

  if (injection) {
    xml = xml.replace(/<\/metadata>/i, `${injection}</metadata>`);
    fs.writeFileSync(opfPath, xml, "utf8");
  }
  return added;
}

module.exports = {
  fixManifestMediaTypes,
  fixManifestItems,
  fixDuplicateMetadata,
  fixEpub2Guide,
  fixAccessibilityMetadata,
  fixMissingDcMetadata,
  fixRenditionMetadata,
};

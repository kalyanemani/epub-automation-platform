const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const { XMLParser } = require("fast-xml-parser");

const { unzipToTemp } = require("../utils/unzip");
const { requestFix } = require("./llm-fixer");
const { applyAltFix } = require("./epub-alt-updater");
const { applyTextContentFixes } = require("./text-content-updater");
const { detectFileForIssue, normalize } = require("./fix-helpers");
const { buildFixPlan } = require("../rag");
const { debugLog } = require("../utils/pipeline-logger");
const {
  fixManifestMediaTypes,
  fixManifestItems,
  fixDuplicateMetadata,
  fixEpub2Guide,
  fixAccessibilityMetadata,
  fixMissingDcMetadata,
  fixRenditionMetadata,
} = require("./epub-opf-fixer");

const {
  applyResponsiveHtmlPatch,
  fixBrokenScriptLinks,
  fixBrokenStylesheetLinks,
  fixHtmlLang,
  fixEmptyLinks,
  fixMediaControls,
  fixHeadingHierarchy,
  fixImagesNoSrc,
  fixMissingAlt,
  fixMissingStylesheetLinks,
  fixResponsiveImages,
  fixResponsiveTables,
} = require("./epub-html-fixer");

const {
  fixMimetype,
  fixManifestDupIds,
  fixNcxDupIds,
  fixNcxPhantomEntries,
  fixNavPhantomEntries,
  fixUnreferencedMedia,
  fixMultipleCovers,
} = require("./epub-structure-fixer");

const {
  fixCssSyntaxIssues,
  fixFontFallback,
  fixInvalidCssDeclarations,
  fixCssPropertyAliases,
  fixOverlappingElements,
} = require("./epub-css-fixer");

const { fixSpine } = require("../fixes/fix-spine");
const { fixNav } = require("../fixes/fix-nav");
const { fixNcx } = require("../fixes/fix-ncx");
const { fixNavigationTargets } = require("../fixes/fix-navigation-targets");
const { getSpineHrefs } = require("../utils/spine-utils");
const { generateNavXhtml } = require("../generators/navXhtml");
const { generateTocNcx } = require("../generators/tocNcx");

const LLM_ALLOWED_RULES = new Set([
  "Media_IMAGE_NO_ALT",
  "A_IMAGE_ALT_MISSING",
  "IMG_ALT_MISSING",
]);

const NODE_FIX_RULES = new Set([
  // â”€â”€ Structure â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  "S_MIMETYPE_MISSING",
  "S_MIMETYPE_CONTENT",
  "S_SPINE_DUP_IDREFS",
  "S_SPINE_OUT_OF_ORDER",
  "S_MANIFEST_ITEMS_INVALID",
  "S_MANIFEST_DUP_IDS",
  "MULTIPLE_COVERS",
  "UNREFERENCED_MEDIA",
  // â”€â”€ NCX / Nav â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  "NCX_SPINE_MISMATCH",
  "NCX_PLAYORDER_INVALID",
  "NCX_PAGELIST_PLAYORDER",
  "NCX_DUPLICATE_IDS",
  "NCX_IDS_UNIQUE",
  "NCX_PAGELIST_VALUE_TEXT_MISMATCH",
  "NCX_NAV_PAGELIST_MISMATCH",
  "NCX_PHANTOM_ENTRIES",
  "NAV_SPINE_MISMATCH",
  "NAV_TOC_PHANTOM_ENTRIES",
  // â”€â”€ Metadata â€” OPF-level â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  "M_DUPLICATES",
  "M_EPUB2_GUIDE",
  "M_LANGUAGE",
  "M_PUBLISHER",
  "M_DATE",
  "M_IDENTIFIER",
  "M_RENDITION_LAYOUT",
  "M_RENDITION_ORIENTATION",
  "M_RENDITION_SPREAD",
  // â”€â”€ Accessibility schema metadata â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  "A_SCHEMA_ACCESSMODE_MISSING",
  "A_SCHEMA_ACCESSIBILITYFEATURE_MISSING",
  "A_SCHEMA_ACCESSIBILITYHAZARD_MISSING",
  // â”€â”€ HTML-level accessibility â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  "A_HTML_LANG_MISSING",
  "A_LINK_TEXT_MISSING",
  // â”€â”€ Media â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  "Media_IMAGE_NO_ALT",
  "Media_IMAGE_NO_SRC",
  "Media_audio_controls",
  "Media_missing_control",
  // â”€â”€ Layout / CSS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  "L_CSS_SYNTAX",
  "L_CSS_REFERENCE_MISSING",
  "L_CSS_REFERENCE_BROKEN",
  "L_FONT_FALLBACK",
  "L_CSS_INVALID_DECLARATION",
  "L_HEADING_HIERARCHY",
  "L_TABLE_RESPONSIVE",
  "L_IMAGE_RENDERING",
  "L_RESPONSIVE_HORIZONTAL_SCROLL",
  "L_RESPONSIVE_TEXT_CLIPPING",
  "L_LAYOUT_OVERLAP",
  "JS_SCRIPT_REFERENCE_BROKEN",
  // â”€â”€ Text content â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  "T_HYPHENATION_WORD_MERGE",
  "T_SPECIAL_CHAR_ENTITY",
  "T_MISSING_INCORRECT_TEXT",
]);

const TEXT_FIX_RULES = new Set([
  "T_HYPHENATION_WORD_MERGE",
  "T_SPECIAL_CHAR_ENTITY",
  "T_MISSING_INCORRECT_TEXT",
]);

function llmAutofixEnabled(value) {
  if (typeof value === "boolean") {
    return value;
  }

  return String(process.env.ENABLE_LLM_AUTOFIX || "")
    .trim()
    .toLowerCase() === "true";
}

function findNavFromOpf(opfXml, tempDir, opfRel) {
  const items = Array.isArray(opfXml.package.manifest.item)
    ? opfXml.package.manifest.item
    : [opfXml.package.manifest.item];

  const navItem = items.find((item) => (item["@_properties"] || "").includes("nav"));
  if (!navItem) {
    return null;
  }

  return path.join(path.dirname(path.join(tempDir, opfRel)), navItem["@_href"]);
}

function findNcxFromOpf(opfXml, tempDir, opfRel) {
  const items = Array.isArray(opfXml.package.manifest.item)
    ? opfXml.package.manifest.item
    : [opfXml.package.manifest.item];

  const ncxItem = items.find(
    (item) => item["@_media-type"] === "application/x-dtbncx+xml"
  );
  if (!ncxItem) {
    return null;
  }

  return path.join(path.dirname(path.join(tempDir, opfRel)), ncxItem["@_href"]);
}

function addFixedRules(failingIssues, fixedNodeRules, ruleIds) {
  ruleIds.forEach((ruleId) => {
    if (failingIssues.some((issue) => issue.id === ruleId)) {
      fixedNodeRules.add(ruleId);
    }
  });
}

function getAllFilesByExt(tempDir, extRegex) {
  const results = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch (_) { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      let stat;
      try { stat = fs.statSync(full); } catch (_) { continue; }
      if (stat.isDirectory()) {
        walk(full);
      } else if (extRegex.test(entry)) {
        results.push(path.relative(tempDir, full).replace(/\\/g, "/"));
      }
    }
  }
  walk(tempDir);
  return results;
}

function getAllHtmlFiles(tempDir) { return getAllFilesByExt(tempDir, /\.(x?html?)$/i); }
function getAllCssFiles(tempDir)  { return getAllFilesByExt(tempDir, /\.css$/i); }
function getAllJsFiles(tempDir)   { return getAllFilesByExt(tempDir, /\.(m?js)$/i); }

async function runAutoFix({ epubPath, report, enableLlmFixes, collectDetails = false }) {
  if (!epubPath || !report) {
    throw new Error("epubPath or report missing");
  }

  const llmFixesEnabled = llmAutofixEnabled(enableLlmFixes);
  const fixPlan = buildFixPlan({
    report,
    documentType: "epub",
  });

  const failing = report.results.filter((result) => result.status === "fail");
  const textIssues = report.results.filter((result) => {
    return TEXT_FIX_RULES.has(result.id) && (result.status === "fail" || result.status === "warn");
  });
  const fixableIssueCount = report.results.filter(
    (r) =>
      (r.status === "fail" || r.status === "warn") &&
      (NODE_FIX_RULES.has(r.id) || TEXT_FIX_RULES.has(r.id))
  ).length;

  if (!fixableIssueCount) {
    console.log("No fixable issues to apply");
    if (collectDetails) {
      return {
        fixedEpubPath: epubPath,
        fixPlan,
        fixedNodeRules: [],
        textFixResult: null,
        altFixCount: 0,
      };
    }
    return epubPath;
  }

  console.log(`Starting autofix for ${fixableIssueCount} fixable issues`);
  debugLog("pipeline", "autofix.started", {
    epubPath,
    llmImageFixesEnabled: llmFixesEnabled,
    fixableIssueCount,
    failingIssueCount: failing.length,
    textIssueCount: textIssues.length,
    fixPlanSummary: fixPlan.summary,
  });

  const { tempDir } = await unzipToTemp(epubPath);
  console.log("EPUB extracted at:", tempDir);

  // â”€â”€ Structure pre-fixes (mimetype, manifest dup IDs) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const allResults = report.results || [];
  const hasIssue = (id) => allResults.some((r) => r.id === id && (r.status === "fail" || r.status === "warn"));

  if (hasIssue("S_MIMETYPE_MISSING") || hasIssue("S_MIMETYPE_CONTENT")) {
    const changed = fixMimetype(tempDir);
    console.log(`   Mimetype fix: ${changed ? "applied" : "already correct"}`);
  }

  const opfRel = detectFileForIssue({ id: "S_" }, tempDir);
  if (!opfRel) {
    throw new Error("OPF not found");
  }

  console.log("OPF found:", opfRel);

  const opfPath = path.join(tempDir, opfRel);
  const parser = new XMLParser({ ignoreAttributes: false });
  const opfXml = parser.parse(fs.readFileSync(opfPath, "utf8"));
  const navPath = findNavFromOpf(opfXml, tempDir, opfRel);
  const ncxPath = findNcxFromOpf(opfXml, tempDir, opfRel);
  const fixedNodeRules = new Set();

  // Handle missing spine@toc attribute (legacy EPUB2) deterministically
  if (hasIssue("S_SPINE_NO_TOC")) {
    try {
      let opfTxt = fs.readFileSync(opfPath, 'utf8');
      if (!/\bspine\b[^>]*\btoc=/.test(opfTxt)) {
        opfTxt = opfTxt.replace(/<spine(\b[^>]*)>/i, `<spine$1 toc="ncx">`);
        fs.writeFileSync(opfPath, opfTxt, 'utf8');
        console.log('   âœ… Added spine@toc="ncx" attribute to OPF');
        fixedNodeRules.add('S_SPINE_NO_TOC');
      }
    } catch (err) {
      console.warn('   Failed to add spine@toc attribute:', err.message || err);
    }
  }

  if (hasIssue("S_MANIFEST_DUP_IDS")) {
    const changed = fixManifestDupIds(opfPath);
    console.log(`   Manifest duplicate ID fix: ${changed ? "applied" : "none found"}`);
    if (changed) fixedNodeRules.add("S_MANIFEST_DUP_IDS");
  }

  if (hasIssue("S_MIMETYPE_MISSING")) fixedNodeRules.add("S_MIMETYPE_MISSING");
  if (hasIssue("S_MIMETYPE_CONTENT")) fixedNodeRules.add("S_MIMETYPE_CONTENT");

  if (hasIssue("MULTIPLE_COVERS")) {
    const changed = fixMultipleCovers(opfPath);
    console.log(`   Multiple covers fix: ${changed ? "applied" : "not needed"}`);
    if (changed) fixedNodeRules.add("MULTIPLE_COVERS");
  }

  // Run fixManifestItems BEFORE fixUnreferencedMedia so it can catch
  // items with missing files or wrong media-types before they are
  // silently dropped by the unreferenced-media pass.
  const needsManifestFix = failing.some((i) => i.id === "S_MANIFEST_ITEMS_INVALID");
  if (needsManifestFix) {
    const changed = fixManifestItems(opfPath);
    console.log(`   Manifest items fix: ${changed ? "applied" : "no changes needed"}`);
    if (changed) addFixedRules(failing, fixedNodeRules, ["S_MANIFEST_ITEMS_INVALID"]);
  }

  if (hasIssue("UNREFERENCED_MEDIA")) {
    const removed = fixUnreferencedMedia(opfPath);
    console.log(`   Unreferenced media manifest entries removed: ${removed}`);
    if (removed > 0) fixedNodeRules.add("UNREFERENCED_MEDIA");
  }

  if (hasIssue("NCX_IDS_UNIQUE")) {
    const changed = fixNcxDupIds(ncxPath);
    console.log(`   NCX duplicate ID fix: ${changed ? "applied" : "not needed"}`);
    if (changed) fixedNodeRules.add("NCX_IDS_UNIQUE");
  }

  if (hasIssue("NCX_PHANTOM_ENTRIES")) {
    const removed = fixNcxPhantomEntries(ncxPath, tempDir);
    console.log(`   NCX phantom entries removed: ${removed}`);
    if (removed > 0) fixedNodeRules.add("NCX_PHANTOM_ENTRIES");
  }


  const needsSpineFix = failing.some(
    (issue) => issue.id === "S_SPINE_DUP_IDREFS" || issue.id === "S_SPINE_OUT_OF_ORDER"
  );
  const needsNavFix = failing.some((issue) => ["NAV_SPINE_MISMATCH", "NAV_TOC_PHANTOM_ENTRIES"].includes(issue.id));
  const needsNcxFix = failing.some((issue) =>
    [
      "NCX_SPINE_MISMATCH",
      "NCX_PLAYORDER_INVALID",
      "NCX_PAGELIST_PLAYORDER",
      "NCX_DUPLICATE_IDS",
      "NCX_PAGELIST_VALUE_TEXT_MISMATCH",
      "NCX_NAV_PAGELIST_MISMATCH",
      "NCX_SPINE_CONTENT_MISMATCH",
    ].includes(issue.id)
  );

  if (needsSpineFix) {
    console.log("\nFixing SPINE issues...");
    fixSpine(opfPath);
    addFixedRules(failing, fixedNodeRules, [
      "S_SPINE_DUP_IDREFS",
      "S_SPINE_OUT_OF_ORDER",
    ]);
  }

  const spineHrefs = getSpineHrefs(opfPath);
  console.log("\n[SPINE] Reading order established:");
  spineHrefs.forEach((href, index) => {
    console.log(`   ${index + 1}. ${href}`);
  });

  // â”€â”€ Create missing navigation if validator recommended adding it
  const needsNavigationTargetRepair = failing.some((issue) =>
    [
      "NAV_TOC_PHANTOM_ENTRIES",
      "NAV_SPINE_MISMATCH",
      "NCX_SPINE_CONTENT_MISMATCH",
      "S_BROKEN_INTERNAL_LINKS",
    ].includes(issue.id)
  );
  if (needsNavigationTargetRepair) {
    const navigationRepair = fixNavigationTargets({
      packageDir: path.dirname(opfPath),
      navPath,
      ncxPath,
      spineHrefs,
    });
    console.log(
      `   Navigation targets repaired: ${navigationRepair.total} (HTML: ${navigationRepair.htmlRepairs}, NCX: ${navigationRepair.ncxRepairs})`
    );
    if (navigationRepair.htmlRepairs > 0) {
      addFixedRules(failing, fixedNodeRules, ["NAV_TOC_PHANTOM_ENTRIES", "NAV_SPINE_MISMATCH"]);
    }
    if (navigationRepair.ncxRepairs > 0) {
      addFixedRules(failing, fixedNodeRules, ["NCX_SPINE_CONTENT_MISMATCH"]);
    }
  }
  if (hasIssue("S_NO_NAVIGATION")) {
    console.log("\nS_NO_NAVIGATION detected â€” creating navigation files...");
    try {
      const opfTxt = fs.readFileSync(opfPath, "utf8");
      const isEpub3 = /<package[^>]*version="?3/.test(opfTxt);
      const opfDir = path.dirname(opfPath);

      // Build a minimal contentFiles list from spine hrefs
      const contentFiles = spineHrefs.map((h) => ({ href: h, title: path.basename(h) }));

      if (isEpub3) {
        const navXhtml = generateNavXhtml({ title: (opfXml.package?.metadata?.['dc:title'] || 'Table of Contents') }, contentFiles);
        const navFilename = 'nav.xhtml';
        const navFull = path.join(opfDir, navFilename);
        fs.writeFileSync(navFull, navXhtml, 'utf8');
        console.log(`   âœ… nav.xhtml created at ${navFull}`);

        // Insert manifest <item> for nav.xhtml if missing
        if (!/properties\s*=\s*"[^"]*nav[^"]*"/i.test(opfTxt)) {
          const manifestInsert = `    <item id="nav" href="${navFilename}" media-type="application/xhtml+xml" properties="nav"/>\n`;
          const newOpf = opfTxt.replace(/(<manifest\b[^>]*>)/i, `$1\n${manifestInsert}`);
          fs.writeFileSync(opfPath, newOpf, 'utf8');
          console.log('   âœ… manifest updated with nav.xhtml entry');
          fixedNodeRules.add('S_NO_NAVIGATION');
        }
      } else {
        // EPUB2: generate toc.ncx and add manifest + spine toc attr
        const ncxXml = generateTocNcx({ title: (opfXml.package?.metadata?.['dc:title'] || 'Table of Contents'), author: '' }, contentFiles);
        const ncxFilename = 'toc.ncx';
        const ncxFull = path.join(opfDir, ncxFilename);
        fs.writeFileSync(ncxFull, ncxXml, 'utf8');
        console.log(`   âœ… toc.ncx created at ${ncxFull}`);

        // Add manifest entry for NCX if missing
        if (!/application\/x-dtbncx\+xml/i.test(opfTxt)) {
          const manifestInsert = `    <item id="ncx" href="${ncxFilename}" media-type="application/x-dtbncx+xml"/>\n`;
          let newOpf = opfTxt.replace(/(<manifest\b[^>]*>)/i, `$1\n${manifestInsert}`);
          // Add spine toc attribute if missing
          if (!/\bspine\b[^>]*\btoc=/.test(newOpf)) {
            newOpf = newOpf.replace(/<spine(\b[^>]*)>/i, `<spine$1 toc="ncx">`);
          }
          fs.writeFileSync(opfPath, newOpf, 'utf8');
          console.log('   âœ… manifest and spine updated for NCX');
          fixedNodeRules.add('S_NO_NAVIGATION');
          fixedNodeRules.add('S_SPINE_NO_TOC');
        }
      }
    } catch (err) {
      console.warn('   Failed to create navigation:', err.message || err);
    }
  }

  if (needsNavFix) {
    console.log("\nFixing nav.xhtml TOC order...");
    if (navPath && fs.existsSync(navPath)) {
      fixNav(navPath, spineHrefs);
      fixedNodeRules.add("NAV_SPINE_MISMATCH");
    } else {
      console.log("   nav.xhtml not found");
    }
  }

  if (needsNcxFix) {
    console.log("\nFixing NCX file...");
    if (ncxPath && fs.existsSync(ncxPath)) {
      fixNcx(
        ncxPath,
        spineHrefs,
        navPath && fs.existsSync(navPath) ? navPath : null
      );
      addFixedRules(failing, fixedNodeRules, [
        "NCX_SPINE_MISMATCH",
        "NCX_PLAYORDER_INVALID",
        "NCX_PAGELIST_PLAYORDER",
        "NCX_DUPLICATE_IDS",
        "NCX_PAGELIST_VALUE_TEXT_MISMATCH",
        "NCX_NAV_PAGELIST_MISMATCH",
        "NCX_SPINE_CONTENT_MISMATCH",
      ]);
    } else {
      console.log("   NCX file not found");
    }
  }

  // â”€â”€ OPF-level fixes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  console.log("\nApplying OPF-level fixes...");

  const needsDedup = failing.some((i) => i.id === "M_DUPLICATES") ||
    report.results.some((i) => i.id === "M_DUPLICATES" && i.status === "warn");
  if (needsDedup) {
    const changed = fixDuplicateMetadata(opfPath);
    console.log(`   Duplicate metadata fix: ${changed ? "applied" : "no changes needed"}`);
    if (changed) {
      const allResults = report.results.filter((i) => i.id === "M_DUPLICATES");
      allResults.forEach((i) => fixedNodeRules.add(i.id));
    }
  }

  const needsGuideFix = failing.some((i) => i.id === "M_EPUB2_GUIDE") ||
    report.results.some((i) => i.id === "M_EPUB2_GUIDE" && i.status === "warn");
  if (needsGuideFix) {
    const changed = fixEpub2Guide(opfPath);
    console.log(`   EPUB2 guide fix: ${changed ? "removed <guide> element" : "not present"}`);
    if (changed) fixedNodeRules.add("M_EPUB2_GUIDE");
  }

  const a11yIssueIds = [
    "A_SCHEMA_ACCESSMODE_MISSING",
    "A_SCHEMA_ACCESSIBILITYFEATURE_MISSING",
    "A_SCHEMA_ACCESSIBILITYHAZARD_MISSING",
  ].filter((id) =>
    failing.some((i) => i.id === id) ||
    report.results.some((i) => i.id === id && i.status === "warn")
  );
  if (a11yIssueIds.length) {
    const added = fixAccessibilityMetadata(opfPath, a11yIssueIds);
    console.log(`   Accessibility metadata injected: ${added.length ? added.join(", ") : "none needed"}`);
    added.forEach((prop) => {
      // Map property name back to issue ID
      const idMap = {
        "schema:accessMode": "A_SCHEMA_ACCESSMODE_MISSING",
        "schema:accessibilityFeature": "A_SCHEMA_ACCESSIBILITYFEATURE_MISSING",
        "schema:accessibilityHazard": "A_SCHEMA_ACCESSIBILITYHAZARD_MISSING",
      };
      if (idMap[prop]) fixedNodeRules.add(idMap[prop]);
    });
  }

  // â”€â”€ Missing dc:* metadata fixes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const dcMetaIssues = ["M_LANGUAGE", "M_PUBLISHER", "M_DATE", "M_IDENTIFIER"].filter((id) =>
    failing.some((i) => i.id === id) ||
    report.results.some((i) => i.id === id && i.status === "warn")
  );
  if (dcMetaIssues.length) {
    const added = fixMissingDcMetadata(opfPath, dcMetaIssues);
    console.log(`   Missing dc metadata injected: ${added.length ? added.join(", ") : "none needed"}`);
    added.forEach((id) => fixedNodeRules.add(id));
  }

  const renditionIssues = ["M_RENDITION_LAYOUT", "M_RENDITION_ORIENTATION", "M_RENDITION_SPREAD"].filter(
    (id) => hasIssue(id)
  );
  if (renditionIssues.length) {
    const added = fixRenditionMetadata(opfPath, renditionIssues);
    console.log(`   Rendition metadata injected: ${added.length ? added.join(", ") : "none needed"}`);
    added.forEach((id) => fixedNodeRules.add(id));
  }

  debugLog("pipeline", "autofix.opf-fixes.completed", {
    manifestFix: needsManifestFix,
    dedupFix: needsDedup,
    guideFix: needsGuideFix,
    a11yIssues: a11yIssueIds,
    dcMetaFixes: dcMetaIssues,
  });

  // â”€â”€ HTML-level fixes (lang, alt, empty links) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const htmlFiles = getAllHtmlFiles(tempDir);
  const cssFiles = getAllCssFiles(tempDir);
  const jsFiles = getAllJsFiles(tempDir);
  console.log(`\nProcessing HTML-level fixes across ${htmlFiles.length} file(s)â€¦`);

  const needsLangFix = failing.some((i) => i.id === "A_HTML_LANG_MISSING") ||
    report.results.some((i) => i.id === "A_HTML_LANG_MISSING" && i.status === "warn");
  if (needsLangFix) {
    const count = fixHtmlLang(tempDir, htmlFiles);
    console.log(`   HTML lang fix applied to ${count} file(s).`);
    if (count > 0) fixedNodeRules.add("A_HTML_LANG_MISSING");
  }

  const needsLinkFix = failing.some((i) => i.id === "A_LINK_TEXT_MISSING") ||
    report.results.some((i) => i.id === "A_LINK_TEXT_MISSING" && i.status === "warn");
  if (needsLinkFix) {
    const count = fixEmptyLinks(tempDir, htmlFiles);
    console.log(`   Empty link fix applied to ${count} file(s).`);
    if (count > 0) fixedNodeRules.add("A_LINK_TEXT_MISSING");
  }

  if (hasIssue("L_CSS_REFERENCE_MISSING")) {
    const count = fixMissingStylesheetLinks(tempDir, htmlFiles, cssFiles);
    console.log(`   Missing stylesheet link fix applied to ${count} file(s).`);
    if (count > 0) fixedNodeRules.add("L_CSS_REFERENCE_MISSING");
  }

  if (hasIssue("L_CSS_REFERENCE_BROKEN")) {
    const count = fixBrokenStylesheetLinks(tempDir, htmlFiles, cssFiles);
    console.log(`   Broken stylesheet href fix applied to ${count} file(s).`);
    if (count > 0) fixedNodeRules.add("L_CSS_REFERENCE_BROKEN");
  }

  if (hasIssue("JS_SCRIPT_REFERENCE_BROKEN")) {
    const count = fixBrokenScriptLinks(tempDir, htmlFiles, jsFiles);
    console.log(`   Broken script src fix applied to ${count} file(s).`);
    if (count > 0) fixedNodeRules.add("JS_SCRIPT_REFERENCE_BROKEN");
  }

  // Non-LLM alt fallback: add alt="" when LLM is off
  const needsAltFix = !llmFixesEnabled &&
    (failing.some((i) => i.id === "Media_IMAGE_NO_ALT") ||
     report.results.some((i) => i.id === "Media_IMAGE_NO_ALT" && i.status === "warn"));
  if (needsAltFix) {
    const count = fixMissingAlt(tempDir, htmlFiles);
    console.log(`   Missing alt="" fallback applied to ${count} file(s).`);
    if (count > 0) fixedNodeRules.add("Media_IMAGE_NO_ALT");
  }

  if (hasIssue("Media_IMAGE_NO_SRC")) {
    const count = fixImagesNoSrc(tempDir, htmlFiles);
    console.log(`   Images with no src removed from ${count} file(s).`);
    if (count > 0) fixedNodeRules.add("Media_IMAGE_NO_SRC");
  }

  if (hasIssue("Media_audio_controls") || hasIssue("Media_missing_control")) {
    const count = fixMediaControls(tempDir, htmlFiles);
    console.log(`   Media controls fix applied to ${count} file(s).`);
    if (count > 0) {
      fixedNodeRules.add("Media_audio_controls");
      fixedNodeRules.add("Media_missing_control");
    }
  }

  if (hasIssue("L_HEADING_HIERARCHY")) {
    const count = fixHeadingHierarchy(tempDir, htmlFiles);
    console.log(`   Heading hierarchy fix applied to ${count} file(s).`);
    if (count > 0) fixedNodeRules.add("L_HEADING_HIERARCHY");
  }

  const needsResponsivePatch = [
    "L_TABLE_RESPONSIVE",
    "L_IMAGE_RENDERING",
    "L_RESPONSIVE_HORIZONTAL_SCROLL",
    "L_RESPONSIVE_TEXT_CLIPPING",
    "L_LAYOUT_OVERLAP",
  ].some((issueId) => hasIssue(issueId));

  if (needsResponsivePatch) {
    const patchCount = applyResponsiveHtmlPatch(tempDir, htmlFiles);
    const tableCount = fixResponsiveTables(tempDir, htmlFiles);
    const imageCount = fixResponsiveImages(tempDir, htmlFiles);
    console.log(
      `   Responsive patch applied to ${patchCount} file(s), tables normalized in ${tableCount} file(s), images normalized in ${imageCount} file(s).`
    );
    if (patchCount > 0 || tableCount > 0 || imageCount > 0) {
      [
        "L_TABLE_RESPONSIVE",
        "L_IMAGE_RENDERING",
        "L_RESPONSIVE_HORIZONTAL_SCROLL",
        "L_RESPONSIVE_TEXT_CLIPPING",
        "L_LAYOUT_OVERLAP",
      ].forEach((issueId) => {
        if (hasIssue(issueId)) {
          fixedNodeRules.add(issueId);
        }
      });
    }
  }

  // â”€â”€ CSS-level fixes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  console.log(`\nProcessing CSS-level fixes across ${cssFiles.length} CSS file(s)â€¦`);

  if (hasIssue("L_CSS_SYNTAX")) {
    const count = fixCssSyntaxIssues(tempDir, cssFiles);
    console.log(`   CSS syntax normalization applied to ${count} CSS file(s).`);
    if (count > 0) fixedNodeRules.add("L_CSS_SYNTAX");
  }

  if (hasIssue("L_FONT_FALLBACK")) {
    const count = fixFontFallback(tempDir, cssFiles);
    console.log(`   Font fallback fix applied to ${count} CSS file(s).`);
    if (count > 0) fixedNodeRules.add("L_FONT_FALLBACK");
  }

  if (hasIssue("L_CSS_INVALID_DECLARATION")) {
    // Pass 1: strip vendor-prefixed / unsupported declarations.
    const stripCount = fixInvalidCssDeclarations(tempDir, cssFiles);
    console.log(`   Invalid CSS declaration strip applied to ${stripCount} CSS file(s).`);

    // Pass 2: deterministic property-alias rename (fontsize â†’ font-size, etc.)
    // Runs directly on the unpacked directory so it sees any changes from pass 1.
    const aliasResult = fixCssPropertyAliases(tempDir);
    console.log(
      `   CSS property alias fix: ${aliasResult.fixes} fix(es) in ${aliasResult.files.length} file(s)`
    );

    if (stripCount > 0 || aliasResult.changed) {
      fixedNodeRules.add("L_CSS_INVALID_DECLARATION");
    }
  }

  if (hasIssue("L_LAYOUT_OVERLAP")) {
    const overlapCount = fixOverlappingElements(tempDir, cssFiles);
    console.log(`   CSS overlap fix applied to ${overlapCount} CSS file(s).`);
    if (overlapCount > 0) fixedNodeRules.add("L_LAYOUT_OVERLAP");
  }

  console.log("\nProcessing text-content fixes...");
  let textFixResult = null;
  if (textIssues.length) {
    textFixResult = await applyTextContentFixes(
      tempDir,
      textIssues,
      opfPath,
      opfXml,
      {
        enableLlmAutofix: llmFixesEnabled,
      }
    );

    if (textFixResult.success) {
      textIssues.forEach((issue) => fixedNodeRules.add(issue.id));
    } else {
      console.log("   No text-content changes were applied");
    }

    console.log(`Text content replacements applied: ${textFixResult.replacementsApplied}`);
    console.log(`Text content files touched: ${textFixResult.filesTouched}`);
    if (textFixResult.manualReviewCount) {
      console.log(
        `Text content manual-review flags remaining: ${textFixResult.manualReviewCount}`
      );
    }
    Object.entries(textFixResult.changesByType).forEach(([type, count]) => {
      console.log(`   ${type}: ${count}`);
    });

    if (textFixResult.llmAutofix?.enabled) {
      console.log(
        `Text LLM autofix invoked: ${textFixResult.llmAutofix.invoked ? "yes" : "no"}`
      );
      console.log(
        `Text LLM replacements learned/applied: ${textFixResult.llmAutofix.learnedReplacements || 0}/${textFixResult.llmAutofix.appliedReplacements || 0}`
      );
      if (typeof textFixResult.llmAutofix.manualReviewAfter === "number") {
        console.log(
          `Text manual-review before/after LLM pass: ${textFixResult.llmAutofix.manualReviewBefore || 0}/${textFixResult.llmAutofix.manualReviewAfter}`
        );
      }
    }

    debugLog("pipeline", "autofix.text-fixes.completed", {
      filesTouched: textFixResult.filesTouched,
      replacementsApplied: textFixResult.replacementsApplied,
      manualReviewCount: textFixResult.manualReviewCount,
      changesByType: textFixResult.changesByType,
      llmAutofix: textFixResult.llmAutofix || null,
    });
  } else {
    console.log("Text content replacements applied: 0");
  }

  console.log("\nProcessing image alt fixes...");
  let altFixCount = 0;

  if (!llmFixesEnabled) {
    console.log("Skipping LLM-backed image alt fixes (disabled by default).");
    for (const issue of failing) {
      if (LLM_ALLOWED_RULES.has(issue.id)) {
        console.log(`   Skipped LLM fix: ${issue.id}`);
      }
    }
  } else {
    // Log status for non-LLM issues
    for (const issue of failing) {
      if (LLM_ALLOWED_RULES.has(issue.id)) continue;
      if (fixedNodeRules.has(issue.id)) {
        console.log(`   Already fixed by Node.js: ${issue.id}`);
      } else if (NODE_FIX_RULES.has(issue.id)) {
        console.log(`   Node.js fix not applied: ${issue.id}`);
      } else {
        console.log(`   Skipped (no fix available): ${issue.id}`);
      }
    }

    // Process all LLM alt-text fixes in parallel batches (concurrency 3)
    const ALT_FIX_CONCURRENCY = 3;
    const altFixIssues = failing.filter(issue => LLM_ALLOWED_RULES.has(issue.id));
    for (let _ai = 0; _ai < altFixIssues.length; _ai += ALT_FIX_CONCURRENCY) {
      const batch = altFixIssues.slice(_ai, _ai + ALT_FIX_CONCURRENCY);
      await Promise.all(batch.map(async (issue) => {
        const targetFile =
          issue.details?.chapter ||
          issue.details?.file ||
          detectFileForIssue(issue, tempDir);
        const imageSrc = issue.details?.file || "";

        if (!targetFile || !imageSrc) {
          console.log(`   Missing file or image info for: ${issue.id}`);
          return;
        }

        const filePath = path.join(tempDir, normalize(targetFile));
        if (!fs.existsSync(filePath)) {
          console.log(`   File not found: ${targetFile}`);
          return;
        }

        console.log(`\n   Requesting alt text for: ${imageSrc} in ${path.basename(targetFile)}`);
        const fileContent = fs.readFileSync(filePath, "utf8");

        const altText = await requestFix({
          filepath: targetFile,
          original: fileContent,
          issue,
        });

        if (!altText) {
          console.log("   LLM failed to generate alt text");
          return;
        }

        if (applyAltFix(tempDir, targetFile, imageSrc, altText)) {
          altFixCount += 1;
        }
      }));
    }

    if (altFixIssues.length && altFixCount < altFixIssues.length) {
      const fallbackCount = fixMissingAlt(tempDir, htmlFiles);
      if (fallbackCount > 0) {
        console.log(`   Deterministic alt="" fallback applied to ${fallbackCount} file(s).`);
        altFixCount += fallbackCount;
        fixedNodeRules.add("Media_IMAGE_NO_ALT");
      }
    }
  }

  console.log(`\nImage alt fixes applied: ${altFixCount}`);
  if (altFixCount > 0) {
    fixedNodeRules.add("Media_IMAGE_NO_ALT");
  }
  debugLog("pipeline", "autofix.image-alt.completed", {
    llmImageFixesEnabled: llmFixesEnabled,
    altFixCount,
  });

  console.log("\nRepacking EPUB...");
  const fixedEpubPath = epubPath.replace(/\.epub$/i, "_fixed.epub");
  const zip = new AdmZip();
  const mimetypePath = path.join(tempDir, "mimetype");

  if (fs.existsSync(mimetypePath)) {
    zip.addLocalFile(mimetypePath, "", "mimetype");
  }

  const addDirectory = (directory, zipPath = "") => {
    const items = fs.readdirSync(directory);
    for (const item of items) {
      if (item === "mimetype") {
        continue;
      }

      const fullPath = path.join(directory, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        addDirectory(fullPath, path.join(zipPath, item));
      } else {
        zip.addLocalFile(fullPath, zipPath);
      }
    }
  };

  addDirectory(tempDir);
  zip.writeZip(fixedEpubPath);

  console.log(`Fixed EPUB saved at: ${fixedEpubPath}`);
  debugLog("pipeline", "autofix.completed", {
    fixedEpubPath,
    fixedRuleCount: fixedNodeRules.size,
    altFixCount,
  });

  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (error) {
    console.warn("Failed to cleanup temp dir:", tempDir);
  }

  if (collectDetails) {
    return {
      fixedEpubPath,
      fixPlan,
      fixedNodeRules: Array.from(fixedNodeRules),
      textFixResult,
      altFixCount,
    };
  }

  return fixedEpubPath;
}

module.exports = { runAutoFix };

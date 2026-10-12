const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const { XMLParser } = require("fast-xml-parser");

const { unzipToTemp } = require("../utils/unzip");
const { requestFix } = require("./llm-fixer");
const { applyFix } = require("./epub-updater");
const { applyAltFix } = require("./epub-alt-updater"); // Surgical file updater
const {
  detectFileForIssue,
  isTextFile,
  normalize
} = require("./fix-helpers");

const { fixSpine } = require("../fixes/fix-spine");
const { fixNav } = require("../fixes/fix-nav");
const { fixNcx } = require("../fixes/fix-ncx");
const { fixAccessibility } = require("../fixes/fix-accessibility"); // NEW
const { getSpineHrefs } = require("../utils/spine-utils");

const LLM_ALLOWED_RULES = new Set([
  "Media_IMAGE_NO_ALT",
  "A_IMAGE_ALT_MISSING",
  "IMG_ALT_MISSING"
]);

// Issues that are fixed by Node.js (not LLM)
const NODE_FIX_RULES = new Set([
  // Structure fixes
  "S_SPINE_DUP_IDREFS",
  "S_SPINE_OUT_OF_ORDER",
  "NCX_SPINE_MISMATCH",
  "NCX_PLAYORDER_INVALID",
  "NCX_PAGELIST_PLAYORDER",
  "NCX_DUPLICATE_IDS",
  "NCX_PAGELIST_VALUE_TEXT_MISMATCH",
  "NAV_SPINE_MISMATCH",
  
  // Accessibility fixes (NEW)
  "A_SCHEMA_ACCESSMODE_MISSING",
  "A_SCHEMA_ACCESSIBILITYFEATURE_MISSING",
  "A_SCHEMA_ACCESSIBILITYHAZARD_MISSING",
  "A_SCHEMA_ACCESSMODESUFFICIENT_MISSING",
  "A_SCHEMA_ACCESSIBILITYSUMMARY_MISSING",
  "A_HTML_LANG_MISSING",
  "A_LINK_TEXT_MISSING",
  "A_LANDMARKS_MISSING",
  "A_TABLE_HEADERS_MISSING",
  "A_PAGEBREAK_LABELS",
  "A_HEADING_SEQUENCE",
  "A_LIST_STRUCTURE"
]);

function findNavFromOpf(opfXml, tempDir, opfRel) {
  const items = Array.isArray(opfXml.package.manifest.item)
    ? opfXml.package.manifest.item
    : [opfXml.package.manifest.item];

  const navItem = items.find(i =>
    (i["@_properties"] || "").includes("nav")
  );

  if (!navItem) return null;

  return path.join(path.dirname(path.join(tempDir, opfRel)), navItem["@_href"]);
}

function findNcxFromOpf(opfXml, tempDir, opfRel) {
  const items = Array.isArray(opfXml.package.manifest.item)
    ? opfXml.package.manifest.item
    : [opfXml.package.manifest.item];

  const ncxItem = items.find(
    i => i["@_media-type"] === "application/x-dtbncx+xml"
  );

  if (!ncxItem) return null;

  return path.join(path.dirname(path.join(tempDir, opfRel)), ncxItem["@_href"]);
}

async function runAutoFix({ epubPath, report }) {
  if (!epubPath || !report) {
    throw new Error("epubPath or report missing");
  }

  const failing = report.results.filter(r => r.status === "fail");
  if (failing.length === 0) {
    console.log("✅ No failing issues to fix");
    return epubPath;
  }

  console.log(`🔧 Starting autofix for ${failing.length} failing issues`);

  // 1️⃣ Unzip EPUB
  const { tempDir } = await unzipToTemp(epubPath);
  console.log("📂 EPUB extracted at:", tempDir);

  // 2️⃣ Find & parse OPF
  const opfRel = detectFileForIssue({ id: "S_" }, tempDir);
  if (!opfRel) throw new Error("OPF not found");
  console.log("📄 OPF found:", opfRel);
  
  const opfPath = path.join(tempDir, opfRel);
  const parser = new XMLParser({ ignoreAttributes: false });
  const opfXml = parser.parse(fs.readFileSync(opfPath, "utf8"));

  // 3️⃣ Identify which fixes are needed
  const needsSpineFix = failing.some(f => 
    f.id === "S_SPINE_DUP_IDREFS" || f.id === "S_SPINE_OUT_OF_ORDER"
  );
  const needsNavFix = failing.some(f => f.id === "NAV_SPINE_MISMATCH");
  const needsNcxFix = failing.some(f => 
    f.id === "NCX_SPINE_MISMATCH" || 
    f.id === "NCX_PLAYORDER_INVALID" || 
    f.id === "NCX_PAGELIST_PLAYORDER" ||
    f.id === "NCX_DUPLICATE_IDS" ||
    f.id === "NCX_PAGELIST_VALUE_TEXT_MISMATCH"
  );
  
  // NEW: Check for accessibility fixes needed
  const needsAccessibilityFix = failing.some(f => 
    f.id.startsWith("A_") && NODE_FIX_RULES.has(f.id)
  );

  // 4️⃣ FIX SPINE (must be first - establishes reading order)
  if (needsSpineFix) {
    console.log("\n🔧 Fixing SPINE issues...");
    fixSpine(opfPath);
  }

  // 5️⃣ Get spine reading order (after spine fix)
  const spineHrefs = getSpineHrefs(opfPath);
  console.log("\n📚 [SPINE] Reading order established:");
  spineHrefs.forEach((h, i) => {
    console.log(`   ${i + 1}. ${h}`);
  });

  // 6️⃣ FIX NAV.XHTML (reorder TOC to match spine)
  if (needsNavFix) {
    console.log("\n🔧 Fixing NAV.XHTML TOC order...");
    const navPath = findNavFromOpf(opfXml, tempDir, opfRel);
    if (navPath && fs.existsSync(navPath)) {
      fixNav(navPath, spineHrefs);
    } else {
      console.log("   ⚠️ nav.xhtml not found");
    }
  }

  // 7️⃣ FIX NCX (reorder navMap + fix playOrder + fix duplicate IDs)
  if (needsNcxFix) {
    console.log("\n🔧 Fixing NCX file...");
    const ncxPath = findNcxFromOpf(opfXml, tempDir, opfRel);
    if (ncxPath && fs.existsSync(ncxPath)) {
      // fixNcx handles ALL NCX issues including:
      // - Duplicate IDs (calls fixNcxDuplicateIds internally)
      // - Missing navPoints from spine
      // - Reordering navPoints to match spine
      // - Sequential playOrder in navMap and pageList
      // - Value/text mismatches in pageList
      fixNcx(ncxPath, spineHrefs);
    } else {
      console.log("   ⚠️ NCX file not found");
    }
  }

  // 8️⃣ FIX ACCESSIBILITY ISSUES (NEW)
  if (needsAccessibilityFix) {
    console.log("\n♿ Fixing accessibility issues...");
    const accessibilityIssues = failing.filter(f => 
      f.id.startsWith("A_") && NODE_FIX_RULES.has(f.id)
    );
    fixAccessibility(tempDir, opfPath, accessibilityIssues);
  }

  // 9️⃣ IMAGE ALT FIXES (LLM generates alt text, Node.js updates file)
  console.log("\n🖼️ Processing image alt fixes...");
  let altFixCount = 0;
  
  for (const issue of failing) {
    // Skip if not image alt issue
    if (!LLM_ALLOWED_RULES.has(issue.id)) {
      if (NODE_FIX_RULES.has(issue.id)) {
        console.log(`   ✅ Already fixed by Node.js: ${issue.id}`);
      } else {
        console.log(`   ⏭️ Skipped (no fix available): ${issue.id}`);
      }
      continue;
    }

    // Get the file and image details
    const targetFile = issue.details?.chapter || issue.details?.file || detectFileForIssue(issue, tempDir);
    const imageSrc = issue.details?.file || "";

    if (!targetFile || !imageSrc) {
      console.log(`   ⚠️ Missing file or image info for: ${issue.id}`);
      continue;
    }

    const filePath = path.join(tempDir, normalize(targetFile));
    if (!fs.existsSync(filePath)) {
      console.log(`   ⚠️ File not found: ${targetFile}`);
      continue;
    }

    console.log(`\n   🤖 Requesting alt text for: ${imageSrc} in ${path.basename(targetFile)}`);
    const fileContent = fs.readFileSync(filePath, "utf8");

    // Request JUST the alt text from LLM
    const altText = await requestFix({
      filepath: targetFile,
      original: fileContent,
      issue
    });

    if (!altText) {
      console.log(`   ❌ LLM failed to generate alt text`);
      continue;
    }

    // Use Node.js to surgically update the file
    const success = applyAltFix(tempDir, targetFile, imageSrc, altText);
    if (success) {
      altFixCount++;
    }
  }

  console.log(`\n📊 Image alt fixes applied: ${altFixCount}`);

  // 🔟 Repack EPUB
  console.log("\n📦 Repacking EPUB...");
  const fixedEpubPath = epubPath.replace(/\.epub$/i, "_fixed.epub");
  const zip = new AdmZip();
  
  // Add mimetype first (uncompressed)
  const mimetypePath = path.join(tempDir, "mimetype");
  if (fs.existsSync(mimetypePath)) {
    zip.addLocalFile(mimetypePath, "", "mimetype");
  }
  
  // Add rest of files
  const addDirectory = (dir, zipPath = "") => {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      if (item === "mimetype") continue; // Already added
      
      const fullPath = path.join(dir, item);
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

  console.log(`✅ Fixed EPUB saved at: ${fixedEpubPath}`);

  // Cleanup temp directory
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (e) {
    console.warn("⚠️ Failed to cleanup temp dir:", tempDir);
  }

  return fixedEpubPath;
}

module.exports = { runAutoFix };
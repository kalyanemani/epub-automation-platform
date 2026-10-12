const fs = require("fs");
const path = require("path");

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function extractFilename(href) {
  return path.basename(String(href || "").split("#")[0]).toLowerCase();
}

function extractChapterNumber(value) {
  const match = String(value || "")
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .match(/\bchapter\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
  if (!match) return null;
  return /^\d+$/.test(match[1]) ? Number(match[1]) : NUMBER_WORDS[match[1].toLowerCase()];
}

function getChapterAnchor(targetPath, chapterNumber) {
  if (!chapterNumber || !fs.existsSync(targetPath)) return "";
  const content = fs.readFileSync(targetPath, "utf8");
  const match = content.match(new RegExp(`\\bid=["'](ch0*${chapterNumber})["']`, "i"));
  return match ? match[1] : "";
}

function chooseTarget(label, href, spineHrefs) {
  const labelChapter = extractChapterNumber(label);
  if (labelChapter !== null) {
    const chapterTarget = spineHrefs.find((candidate) => extractChapterNumber(candidate) === labelChapter);
    if (chapterTarget) return chapterTarget;
  }

  const filename = extractFilename(href);
  const exactTarget = spineHrefs.find((candidate) => extractFilename(candidate) === filename);
  if (exactTarget) return exactTarget;

  const stem = filename.replace(/\.[^.]+$/, "");
  return spineHrefs.find((candidate) => extractFilename(candidate).replace(/\.[^.]+$/, "") === stem) || "";
}

function buildHref(label, currentHref, sourcePath, packageDir, spineHrefs) {
  const targetHref = chooseTarget(label, currentHref, spineHrefs);
  if (!targetHref) return currentHref;

  const targetPath = path.resolve(packageDir, targetHref);
  const chapterNumber = extractChapterNumber(label) ?? extractChapterNumber(targetHref);
  const expectedAnchor = getChapterAnchor(targetPath, chapterNumber);
  const currentAnchor = String(currentHref || "").split("#")[1] || "";
  const relativePath = path.relative(path.dirname(sourcePath), targetPath).replace(/\\/g, "/");
  return `${relativePath}${expectedAnchor ? `#${expectedAnchor}` : currentAnchor ? `#${currentAnchor}` : ""}`;
}

function repairHtmlLinks(filePath, packageDir, spineHrefs) {
  if (!filePath || !fs.existsSync(filePath)) return 0;
  let html = fs.readFileSync(filePath, "utf8");
  let repaired = 0;
  html = html.replace(
    /(<a\b[^>]*\bhref=")([^"]*)("[^>]*>)([\s\S]*?)(<\/a>)/gi,
    (fullMatch, prefix, href, middle, labelMarkup, suffix) => {
      const label = labelMarkup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (extractChapterNumber(label) === null) return fullMatch;
      const correctedHref = buildHref(label, href, filePath, packageDir, spineHrefs);
      if (correctedHref === href) return fullMatch;
      repaired++;
      return `${prefix}${correctedHref}${middle}${labelMarkup}${suffix}`;
    }
  );
  if (repaired > 0) fs.writeFileSync(filePath, html, "utf8");
  return repaired;
}

function repairNcxLinks(ncxPath, packageDir, spineHrefs) {
  if (!ncxPath || !fs.existsSync(ncxPath)) return 0;
  let xml = fs.readFileSync(ncxPath, "utf8");
  let repaired = 0;
  xml = xml.replace(
    /(<navPoint\b[\s\S]*?<navLabel>\s*<text>)([^<]*)(<\/text>\s*<\/navLabel>[\s\S]*?<content\s+src=")([^"]*)/gi,
    (fullMatch, prefix, label, middle, src) => {
      if (extractChapterNumber(label) === null) return fullMatch;
      const correctedSrc = buildHref(label, src, ncxPath, packageDir, spineHrefs);
      if (correctedSrc === src) return fullMatch;
      repaired++;
      return `${prefix}${label}${middle}${correctedSrc}`;
    }
  );
  if (repaired > 0) fs.writeFileSync(ncxPath, xml, "utf8");
  return repaired;
}

function fixNavigationTargets({ packageDir, navPath, ncxPath, spineHrefs }) {
  const contentTocPaths = spineHrefs
    .filter((href) => /contents?|toc/i.test(path.basename(href)))
    .map((href) => path.resolve(packageDir, href));
  const htmlPaths = [navPath, ...contentTocPaths].filter(Boolean);
  const htmlRepairs = htmlPaths.reduce(
    (total, filePath) => total + repairHtmlLinks(filePath, packageDir, spineHrefs),
    0
  );
  const ncxRepairs = repairNcxLinks(ncxPath, packageDir, spineHrefs);
  return { htmlRepairs, ncxRepairs, total: htmlRepairs + ncxRepairs };
}

module.exports = { fixNavigationTargets };
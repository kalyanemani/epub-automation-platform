// src/epub-updater.js
const fs = require("fs");
const path = require("path");

function applyFix(epubRoot, targetFile, newContent) {
  const fullPath = path.join(epubRoot, targetFile);
  fs.writeFileSync(fullPath, newContent, "utf8");
  console.log("✔ Updated:", targetFile);
}

module.exports = { applyFix };

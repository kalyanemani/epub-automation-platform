const fs = require("fs");
const path = require("path");

// function detectFileForIssue(issue, EPUB_DIR) {
//   const candidates = [];

//   if (issue.id === "S_MIMETYPE") {
//     candidates.push("mimetype");
//   }

//   if (issue.id.startsWith("S_") || issue.id.startsWith("M_")) {
//     const findOpf = (dir, base = "") => {
//       for (const it of fs.readdirSync(dir)) {
//         const full = path.join(dir, it);
//         const rel = path.join(base, it).replace(/\\/g, "/");
//         if (fs.statSync(full).isDirectory()) {
//           const found = findOpf(full, rel);
//           if (found) return found;
//         } else if (it.toLowerCase().endsWith(".opf")) {
//           return rel;
//         }
//       }
//       return null;
//     };
//     const opfPath = findOpf(EPUB_DIR);
//     if (opfPath) candidates.push(opfPath);
//   }

//   if (typeof issue.details === "string") {
//     const m = issue.details.match(/([A-Za-z0-9_.-]+\.(xhtml|html|xml))/i);
//     if (m) candidates.push(m[1]);
//   }

//   for (const c of candidates) {
//     const n = normalize(c);
//     if (fs.existsSync(path.join(EPUB_DIR, n))) return n;
//   }

//   return null;
// }

function detectFileForIssue(issue, EPUB_DIR) {
  const candidates = [];

  // 1️⃣ mimetype
  if (issue.id === "S_MIMETYPE") {
    candidates.push("mimetype");
  }

  // 2️⃣ OPF-based rules
  if (issue.id.startsWith("S_") || issue.id.startsWith("M_")) {
    const findOpf = (dir, base = "") => {
      for (const it of fs.readdirSync(dir)) {
        const full = path.join(dir, it);
        const rel = path.join(base, it).replace(/\\/g, "/");
        if (fs.statSync(full).isDirectory()) {
          const found = findOpf(full, rel);
          if (found) return found;
        } else if (it.toLowerCase().endsWith(".opf")) {
          return rel;
        }
      }
      return null;
    };

    const opfPath = findOpf(EPUB_DIR);
    if (opfPath) candidates.push(opfPath);
  }

  // 3️⃣ details.file / details.chapter (🔥 MOST IMPORTANT)
  if (issue.details && typeof issue.details === "object") {
    if (issue.details.file) candidates.push(issue.details.file);
    if (issue.details.chapter) candidates.push(issue.details.chapter);
  }

  // 4️⃣ details as string (fallback)
  if (typeof issue.details === "string") {
    const m = issue.details.match(/([A-Za-z0-9_.-]+\.(xhtml|html|xml|opf|js|mjs))/i);
    if (m) candidates.push(m[1]);
  }

  // 5️⃣ resolve candidates
  for (const c of candidates) {
    const n = normalize(c);
    if (fs.existsSync(path.join(EPUB_DIR, n))) {
      return n;
    }
  }

  return null;
}


function normalize(fp) {
  return fp.replace(/\\/g, "/").replace(/^\//, "");
}

function isTextFile(fp) {
  return (
    fp.endsWith(".xhtml") ||
    fp.endsWith(".html") ||
    fp.endsWith(".opf") ||
    fp.endsWith(".xml") ||
    fp.endsWith(".css") ||
    fp.endsWith(".js") ||
    fp.endsWith(".mjs") ||
    fp === "mimetype"
  );
}

module.exports = {
  detectFileForIssue,
  isTextFile,
  normalize
};

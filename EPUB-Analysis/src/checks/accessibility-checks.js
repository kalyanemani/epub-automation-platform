// Basic accessibility heuristics (no heavy Axe integration by default).
// For deep checks, integrate Playwright + axe-core and run headless HTML checks.

const fs = require('fs');
const path = require('path');
const glob = require('glob');
const { detectEpubContext } = require("../utils/epub-context");
const { runInBatches, envInt } = require("../utils/batch-runner");

function hasHtmlLang(html) {
  return /<html[^>]+lang=["'][^"']+["']/i.test(html);
}

function findImagesWithoutAlt(html) {
  const regex = /<img([^>]+)>/gi;
  let m, count = 0;
  while ((m = regex.exec(html))) {
    if (!/alt\s*=\s*["']/.test(m[1])) count++;
  }
  return count;
}

function findLinksWithoutText(html) {
  const regex = /<a([^>]+)>(.*?)<\/a>/gis;
  let m, count = 0;
  while ((m = regex.exec(html))) {
    const attrs = m[1];
    const text = m[2].trim();
    const hasAria = /aria-label|aria-labelledby|title=/.test(attrs);
    if (!text && !hasAria) count++;
  }
  return count;
}

async function runAccessibilityChecks({ tempDir, opfAbsolute, opfXml }) {
    const results = [];
    // heuristic: check for landmarks, aria roles, and reading order
    const files = glob.sync('**/*.{xhtml,html}', { cwd: tempDir, nodir: true });
    const A11Y_BATCH = envInt("A11Y_BATCH_SIZE", 8);
    const fileStats = await runInBatches(files, A11Y_BATCH, async (f) => {
      const html = await fs.promises.readFile(path.join(tempDir, f), "utf8");
      return {
        missingLandmark: !/role\s*=\s*["']main["']/.test(html) && !/<main[\s>]/i.test(html) && !/<nav[\s>]/i.test(html),
        missingLang: !hasHtmlLang(html),
        badLinks: findLinksWithoutText(html),
      };
    });
    const missingLandmarks = fileStats.filter(s => s.missingLandmark).length;
    const htmlLangMissing  = fileStats.filter(s => s.missingLang).length;
    const badLinks         = fileStats.reduce((sum, s) => sum + s.badLinks, 0);
    if (missingLandmarks > 0) 
    //     {
    //     const obj = {
    //         id: 'A_LANDMARKS',
    //         title: 'Missing landmarks/ARIA',
    //         status: 'warn',
    //         details: `${missingLandmarks} files missing main/nav landmarks`,
    //     };
    //     obj.suggestion = await aiSuggestion(obj);

    //     results.push(obj);
    // }
    //  results.push({ id: 'A_LANDMARKS',
    //      title: 'Missing landmarks/ARIA',
    //       status: 'warn',
    //        details: `${missingLandmarks} files missing main/nav landmarks`,
    //         suggestion: 'Add <nav>, <main> or ARIA roles for better screen reader navigation'
    //      });
    // else results.push({
    //     id: 'A_LANDMARKS',
    //     title: 'Landmarks present',
    //     status: 'pass',
    //     details: 'Landmarks found in files'
    // });

    // color contrast and other checks are difficult without rendering — we flag needs-manual-review
    // const obj = {
    //     id: 'A_MANUAL',
    //     title: 'Manual accessibility review required',
    //     status: 'warn',
    //     details: 'Color contrast and screen reader experience require rendering-based tests',
    // };
    // obj.suggestion = await aiSuggestion(obj);

    // results.push(obj);

      results.push({ 
        id: 'A_MANUAL',
         title: 'Manual accessibility review required',
          status: 'warn',
           details: 'Color contrast and screen reader experience require rendering-based tests',
            suggestion: 'Integrate Playwright + axe-core for deep automated checks' });
// EPUB ARIA semantic validation
// const epubAriaResults = await runEpubAriaValidation({ tempDir });
// results.push(...epubAriaResults);

const { isEpub3, isAccessibilityEPUB } = detectEpubContext(opfXml);
function hasSchemaMeta(metas, prop) {
  return metas.some(m =>
    m['@_property'] === prop ||
    m['@_property'] === prop.replace('schema:', '') ||
    m['@_name'] === prop ||
    m['@_name'] === prop.replace('schema:', '')
  );
}

/* ======================================================
   OPF ACCESSIBILITY METADATA (ACE-aligned)
====================================================== */
const meta = opfXml?.package?.metadata?.meta || [];
const metas = Array.isArray(meta) ? meta : [meta];

const requiredSchemaMeta = [
  "schema:accessMode",
  "schema:accessibilityFeature",
  "schema:accessibilityHazard"
];

requiredSchemaMeta.forEach(prop => {
  if (!hasSchemaMeta(metas, prop)) {
    results.push({
      id: `A_${prop.toUpperCase().replace(/[:]/g, "_")}_MISSING`,
      title: `Missing ${prop}`,
      status: "fail", // or "warn" based on your policy
      details: `OPF metadata does not declare ${prop}`,
      suggestion: `Add <meta property="${prop}">…</meta> in OPF metadata`
    });
  } else {
    results.push({
      id: `A_${prop.toUpperCase().replace(/[:]/g, "_")}_PRESENT`,
      title: `${prop} present`,
      status: "pass",
      details: `${prop} declared in OPF`
    });
  }
});


// requiredSchemaMeta.forEach(prop => {
//   if (!metas.some(m => m['@_property'] === prop)) {
//     results.push({
//       id: "A_SCHEMA_META_MISSING",
//       title: `Missing ${prop}`,
//       status: "warn",
//       details: "Accessibility metadata not declared in OPF",
//       suggestion: ``
//     });
//   }
// });

/* ======================================================
   HTML lang ATTRIBUTE CHECK
====================================================== */
if (htmlLangMissing > 0) {
  results.push({
    id: "A_HTML_LANG_MISSING",
    title: "<html> missing lang attribute",
    status: "warn",
    details: `${htmlLangMissing} XHTML files missing lang attribute`,
    suggestion: ""
  });
}
/* ======================================================
   LINK ACCESSIBLE TEXT CHECK
====================================================== */
if (badLinks > 0) {
  results.push({
    id: "A_LINK_TEXT_MISSING",
    title: "Links without accessible text",
    status: "fail",
    details: `${badLinks} links lack discernible text`,
    suggestion:
      ""
  });
}
/* ======================================================
   READING ORDER HEURISTIC
====================================================== */
// results.push({
//   id: "A_READING_ORDER",
//   title: "Reading order requires verification",
//   status: "warn",
//   details:
//     "Logical reading order cannot be fully validated without rendering",
//   suggestion:
//     ""
// });


console.log("➡ Accessibility context:", { isEpub3, isAccessibilityEPUB });

    return results;
}

module.exports = { runAccessibilityChecks };

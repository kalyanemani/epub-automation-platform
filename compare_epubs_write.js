const fs = require('fs');
const validateEpub = require('./EPUB-Analysis/src/validateEpub');
const [origPath, fixedPath, outPath] = process.argv.slice(2);
if (!origPath || !fixedPath || !outPath) {
  console.error('Usage: node compare_epubs_write.js <original.epub> <fixed.epub> <output.json>');
  process.exit(1);
}
(async () => {
  try {
    const original = await validateEpub(origPath, { enrichAiSuggestions: false, skipVisualChecks: true });
    const fixed = await validateEpub(fixedPath, { enrichAiSuggestions: false, skipVisualChecks: true });
    const summarize = (report) => report.results.map(r => ({ id: r.id, status: r.status, title: r.title }));
    const result = { original: summarize(original), fixed: summarize(fixed) };
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
    console.log('Written', outPath);
  } catch (error) {
    console.error('ERROR', error && error.message ? error.message : error);
    process.exit(1);
  }
})();

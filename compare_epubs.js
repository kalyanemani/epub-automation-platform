const validateEpub = require('./EPUB-Analysis/src/validateEpub');
const [origPath, fixedPath] = process.argv.slice(2);
if (!origPath || !fixedPath) {
  console.error('Usage: node compare_epubs.js <original.epub> <fixed.epub>');
  process.exit(1);
}
(async () => {
  try {
    const original = await validateEpub(origPath, { enrichAiSuggestions: false, skipVisualChecks: true });
    const fixed = await validateEpub(fixedPath, { enrichAiSuggestions: false, skipVisualChecks: true });
    const summarize = (report) => report.results.map(r => ({ id: r.id, status: r.status, title: r.title }));
    console.log(JSON.stringify({ original: summarize(original), fixed: summarize(fixed) }, null, 2));
  } catch (error) {
    console.error('ERROR', error && error.message ? error.message : error);
    process.exit(1);
  }
})();

const validateEpub = require('./EPUB-Analysis/src/validateEpub');
const [origPath, fixedPath] = process.argv.slice(2);
if (!origPath || !fixedPath) {
  console.error('Usage: node compare_epubs_clean.js <original.epub> <fixed.epub>');
  process.exit(1);
}
const silence = () => {};
console.log = silence;
console.info = silence;
console.debug = silence;
console.warn = silence;
(async () => {
  try {
    const original = await validateEpub(origPath, { enrichAiSuggestions: false, skipVisualChecks: true });
    const fixed = await validateEpub(fixedPath, { enrichAiSuggestions: false, skipVisualChecks: true });
    const summarize = (report) => report.results.map(r => ({ id: r.id, status: r.status, title: r.title }));
    process.stdout.write(JSON.stringify({ original: summarize(original), fixed: summarize(fixed) }, null, 2));
  } catch (error) {
    console.error('ERROR', error && error.message ? error.message : error);
    process.exit(1);
  }
})();

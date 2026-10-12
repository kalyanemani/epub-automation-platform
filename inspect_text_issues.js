const validateEpub = require('./EPUB-Analysis/src/validateEpub');
const [epubPath] = process.argv.slice(2);
if (!epubPath) {
  console.error('Usage: node inspect_text_issues.js <epub-path>');
  process.exit(1);
}
(async () => {
  try {
    const report = await validateEpub(epubPath, { enrichAiSuggestions: false, skipVisualChecks: true });
    const textIssues = report.results
      .filter((r) => typeof r.id === 'string' && r.id.startsWith('T_'))
      .map((r) => ({ id: r.id, status: r.status, title: r.title, details: r.details || null }));
    console.log(JSON.stringify(textIssues, null, 2));
  } catch (error) {
    console.error('ERROR', error && error.message ? error.message : error);
    process.exit(1);
  }
})();

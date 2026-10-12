const fs = require('fs');
const path = require('path');
const { runAutoFix } = require('./src/autofix/autofix-runner');

async function testAutofix() {
  const epubPath = path.join(__dirname, 'Testing_with_missing_incorrect_text.epub');
  if (!fs.existsSync(epubPath)) {
    console.error('Test EPUB not found');
    return;
  }

  // First get the report
  const validateEpub = require('./src/validateEpub');
  const report = await validateEpub(epubPath, { enrichAiSuggestions: false });
  console.log('Report generated');

  // Now run autofix
  const fixedPath = await runAutoFix({
    epubPath,
    report
  });

  console.log('Fixed EPUB created at:', fixedPath);

  // Validate the fixed one
  const fixedReport = await validateEpub(fixedPath, { enrichAiSuggestions: false });
  console.log(
    'Fixed report:',
    JSON.stringify(fixedReport.results.filter(r => r.id.startsWith('T_')), null, 2)
  );
}

testAutofix();

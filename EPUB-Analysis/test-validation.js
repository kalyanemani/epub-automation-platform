const fs = require('fs');
const path = require('path');
const validateEpub = require('./src/validateEpub');

async function testValidation() {
  const epubPath = path.join(__dirname, 'Testing_with_missing_incorrect_text.epub');
  if (!fs.existsSync(epubPath)) {
    console.error('Test EPUB not found');
    return;
  }

  try {
    const result = await validateEpub(epubPath, { enrichAiSuggestions: false });
    console.log('Validation result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Validation error:', error);
  }
}

testValidation();

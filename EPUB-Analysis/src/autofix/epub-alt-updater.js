const fs = require("fs");
const path = require("path");

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Surgically updates alt attribute in an XHTML file.
 * Only modifies the specific <img> tag and preserves everything else.
 */
function applyAltFix(tempDir, relativeFilePath, imageSrc, altText) {
  const filePath = path.join(tempDir, relativeFilePath.replace(/\\/g, "/"));

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return false;
  }

  console.log(`Updating alt in: ${relativeFilePath}`);
  console.log(`   Image: ${imageSrc}`);
  console.log(`   Alt text: "${altText}"`);

  let content = fs.readFileSync(filePath, "utf8");
  const originalContent = content;
  const escapedSrc = escapeRegex(imageSrc);
  const finalAlt = altText === "DECORATIVE" ? "" : altText;
  const imageTagPattern = new RegExp(
    `<img[^>]*src=["']${escapedSrc}["'][^>]*>`,
    "i"
  );

  const pattern1 = new RegExp(
    `(<img[^>]*src=["']${escapedSrc}["'][^>]*?)alt\\s*=\\s*(["'])(.*?)\\2`,
    "gi"
  );

  if (pattern1.test(content)) {
    pattern1.lastIndex = 0;
    const updatedContent = content.replace(pattern1, `$1alt="${finalAlt}"`);

    if (updatedContent === content) {
      console.log(`   Image already has the desired alt attribute`);
      return true;
    }

    content = updatedContent;
    console.log(`   Replaced existing alt attribute`);
  } else {
    const pattern2 = new RegExp(
      `(<img[^>]*src=["']${escapedSrc}["'][^>]*?)(\\/?>)`,
      "gi"
    );

    const updatedContent = content.replace(pattern2, `$1 alt="${finalAlt}"$2`);

    if (updatedContent === content) {
      if (imageTagPattern.test(content)) {
        console.log(`   Image already has the desired alt attribute`);
        return true;
      }

      console.error(`   No changes made - image tag not found or pattern didn't match`);
      return false;
    }

    content = updatedContent;
    console.log(`   Added new alt attribute`);
  }

  if (content === originalContent) {
    console.log(`   Image already has the desired alt attribute`);
    return true;
  }

  fs.writeFileSync(filePath, content, "utf8");
  console.log(`   File saved`);
  return true;
}

module.exports = { applyAltFix };

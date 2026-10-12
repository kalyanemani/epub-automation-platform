const fs = require("fs");
const path = require("path");
const { XMLParser, XMLBuilder } = require("fast-xml-parser");

/**
 * Adds missing accessibility metadata to OPF file
 */
function addAccessibilityMeta(opfPath, property, value = null) {
  console.log(`🔧 [A11Y] Adding ${property} to OPF`);

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text"
  });

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    format: true,
    indentBy: "  ",
    suppressEmptyNode: true
  });

  let opfContent = fs.readFileSync(opfPath, "utf8");
  const opfXml = parser.parse(opfContent);

  if (!opfXml.package || !opfXml.package.metadata) {
    console.log("   ⚠️ Invalid OPF structure");
    return;
  }

  // Ensure meta array exists
  if (!opfXml.package.metadata.meta) {
    opfXml.package.metadata.meta = [];
  } else if (!Array.isArray(opfXml.package.metadata.meta)) {
    opfXml.package.metadata.meta = [opfXml.package.metadata.meta];
  }

  // Default values for different properties
  const defaultValues = {
    "schema:accessMode": "textual,visual",
    "schema:accessibilityFeature": "structuralNavigation,alternativeText",
    "schema:accessibilityHazard": "none",
    "schema:accessModeSufficient": "textual",
    "schema:accessibilitySummary": "This publication has been evaluated for accessibility."
  };

  const metaValue = value || defaultValues[property] || "";

  // Check if property already exists
  const exists = opfXml.package.metadata.meta.some(
    m => m["@_property"] === property
  );

  if (!exists) {
    opfXml.package.metadata.meta.push({
      "@_property": property,
      "#text": metaValue
    });
    console.log(`   ✅ Added ${property}: "${metaValue}"`);
  } else {
    console.log(`   ℹ️ ${property} already exists`);
  }

  // Write back to OPF
  const newOpfContent = builder.build(opfXml);
  fs.writeFileSync(opfPath, `<?xml version="1.0" encoding="UTF-8"?>\n${newOpfContent}`, "utf8");
  console.log("   💾 OPF saved");
}

/**
 * Adds lang attribute to HTML files
 */
function addHtmlLang(filePath, lang = "en") {
  console.log(`🔧 [A11Y] Adding lang attribute to ${path.basename(filePath)}`);

  let content = fs.readFileSync(filePath, "utf8");
  const originalContent = content;

  // Check if lang already exists
  if (/<html[^>]+lang=["'][^"']+["']/i.test(content)) {
    console.log("   ℹ️ lang attribute already exists");
    return;
  }

  // Add lang to <html> tag
  content = content.replace(
    /<html([^>]*)>/i,
    (match, attrs) => {
      // If there are existing attributes, add lang with a space
      if (attrs.trim()) {
        return `<html${attrs} lang="${lang}">`;
      }
      return `<html lang="${lang}">`;
    }
  );

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, "utf8");
    console.log(`   ✅ Added lang="${lang}"`);
  }
}

/**
 * Adds alt text to images (requires LLM for descriptive text)
 */
function addImageAlt(filePath, imageSrc, altText) {
  console.log(`🔧 [A11Y] Adding alt text for ${imageSrc} in ${path.basename(filePath)}`);

  let content = fs.readFileSync(filePath, "utf8");
  const originalContent = content;

  // Escape special regex characters in imageSrc
  const escapedSrc = imageSrc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Find <img> tag with this src and add alt
  const imgRegex = new RegExp(
    `<img([^>]*src\\s*=\\s*["']${escapedSrc}["'][^>]*)>`,
    'gi'
  );

  content = content.replace(imgRegex, (match, attrs) => {
    // Check if alt already exists
    if (/alt\s*=/.test(attrs)) {
      console.log("   ℹ️ alt attribute already exists");
      return match;
    }

    // Add alt attribute
    return `<img${attrs} alt="${altText}">`;
  });

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, "utf8");
    console.log(`   ✅ Added alt="${altText}"`);
    return true;
  }

  return false;
}

/**
 * Adds text to empty links
 */
function addLinkText(filePath) {
  console.log(`🔧 [A11Y] Adding accessible text to links in ${path.basename(filePath)}`);

  let content = fs.readFileSync(filePath, "utf8");
  const originalContent = content;
  let fixCount = 0;

  // Find links without text content
  const linkRegex = /<a([^>]+)>([\s]*)<\/a>/gi;

  content = content.replace(linkRegex, (match, attrs, text) => {
    // Check if already has aria-label or title
    if (/aria-label|title=/.test(attrs)) {
      return match;
    }

    // Try to extract href to create meaningful text
    const hrefMatch = attrs.match(/href\s*=\s*["']([^"']+)["']/i);
    const href = hrefMatch ? hrefMatch[1] : "";
    
    // Create aria-label from href
    const filename = path.basename(href).replace(/\.(x?html?|pdf)$/i, '');
    const label = filename || "Link";

    fixCount++;
    return `<a${attrs} aria-label="${label}"></a>`;
  });

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, "utf8");
    console.log(`   ✅ Added aria-label to ${fixCount} links`);
  }
}

/**
 * Adds main landmark to content files
 */
function addLandmarks(filePath) {
  console.log(`🔧 [A11Y] Adding landmarks to ${path.basename(filePath)}`);

  let content = fs.readFileSync(filePath, "utf8");
  const originalContent = content;

  // Check if main or nav already exists
  if (/<main[\s>]/i.test(content) || /role\s*=\s*["']main["']/i.test(content)) {
    console.log("   ℹ️ Landmarks already exist");
    return;
  }

  // Wrap body content in <main> element
  content = content.replace(
    /(<body[^>]*>)([\s\S]*?)(<\/body>)/i,
    (match, openBody, bodyContent, closeBody) => {
      // Don't wrap if there's already semantic structure
      if (/<section[\s>]/i.test(bodyContent) || /<article[\s>]/i.test(bodyContent)) {
        // Add role="main" to first section/article instead
        bodyContent = bodyContent.replace(
          /(<(?:section|article)[\s>])/i,
          '$1 role="main"'
        );
        return openBody + bodyContent + closeBody;
      }

      // Wrap entire body content in main
      return openBody + '\n<main>\n' + bodyContent + '\n</main>\n' + closeBody;
    }
  );

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, "utf8");
    console.log("   ✅ Added <main> landmark");
  }
}

/**
 * Adds headers to tables
 */
function addTableHeaders(filePath) {
  console.log(`🔧 [A11Y] Adding table headers to ${path.basename(filePath)}`);

  let content = fs.readFileSync(filePath, "utf8");
  const originalContent = content;
  let fixCount = 0;

  // Find tables and add scope to first row cells
  content = content.replace(
    /<table([^>]*)>([\s\S]*?)<\/table>/gi,
    (match, tableAttrs, tableContent) => {
      // Check if already has th elements
      if (/<th[\s>]/i.test(tableContent)) {
        return match;
      }

      // Convert first row td to th with scope="col"
      let firstRowProcessed = false;
      tableContent = tableContent.replace(
        /<tr([^>]*)>([\s\S]*?)<\/tr>/i,
        (trMatch, trAttrs, rowContent) => {
          if (firstRowProcessed) return trMatch;
          firstRowProcessed = true;

          // Replace td with th and add scope
          const newRowContent = rowContent.replace(
            /<td([^>]*)>/gi,
            '<th$1 scope="col">'
          ).replace(/<\/td>/gi, '</th>');

          fixCount++;
          return `<tr${trAttrs}>${newRowContent}</tr>`;
        }
      );

      return `<table${tableAttrs}>${tableContent}</table>`;
    }
  );

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, "utf8");
    console.log(`   ✅ Added headers to ${fixCount} tables`);
  }
}

/**
 * Adds aria-label to page breaks
 */
function addPageBreakLabels(filePath) {
  console.log(`🔧 [A11Y] Adding labels to page breaks in ${path.basename(filePath)}`);

  let content = fs.readFileSync(filePath, "utf8");
  const originalContent = content;
  let fixCount = 0;

  // Find page break elements without aria-label
  content = content.replace(
    /<([a-z]+)([^>]*epub:type\s*=\s*["'][^"']*pagebreak[^"']*["'][^>]*)>/gi,
    (match, tag, attrs) => {
      // Check if already has aria-label or title
      if (/aria-label|title=/.test(attrs)) {
        return match;
      }

      // Try to extract page number from id or create sequential number
      const idMatch = attrs.match(/id\s*=\s*["']([^"']+)["']/i);
      const pageNum = idMatch ? idMatch[1].replace(/[^\d]/g, '') : fixCount + 1;

      fixCount++;
      return `<${tag}${attrs} aria-label="Page ${pageNum}">`;
    }
  );

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, "utf8");
    console.log(`   ✅ Added labels to ${fixCount} page breaks`);
  }
}

/**
 * Main accessibility fix function
 */
function fixAccessibility(tempDir, opfPath, issues) {
  console.log("🔧 [A11Y] Starting accessibility fixes...");

  issues.forEach(issue => {
    try {
      switch (issue.autofix?.action) {
        case 'addAccessibilityMeta':
          addAccessibilityMeta(
            opfPath,
            issue.autofix.property,
            issue.autofix.value
          );
          break;

        case 'addHtmlLang':
          issue.autofix.files?.forEach(file => {
            const filePath = path.join(tempDir, file);
            if (fs.existsSync(filePath)) {
              addHtmlLang(filePath);
            }
          });
          break;

        case 'addImageAlt':
          // This requires LLM - handled separately in main autofix flow
          console.log("   ℹ️ Image alt text requires LLM - handled separately");
          break;

        case 'addLinkText':
          issue.autofix.files?.forEach(file => {
            const filePath = path.join(tempDir, file);
            if (fs.existsSync(filePath)) {
              addLinkText(filePath);
            }
          });
          break;

        case 'addLandmarks':
          issue.autofix.files?.forEach(file => {
            const filePath = path.join(tempDir, file);
            if (fs.existsSync(filePath)) {
              addLandmarks(filePath);
            }
          });
          break;

        case 'addTableHeaders':
          issue.autofix.files?.forEach(file => {
            const filePath = path.join(tempDir, file);
            if (fs.existsSync(filePath)) {
              addTableHeaders(filePath);
            }
          });
          break;

        case 'addPageBreakLabels':
          issue.autofix.files?.forEach(file => {
            const filePath = path.join(tempDir, file);
            if (fs.existsSync(filePath)) {
              addPageBreakLabels(filePath);
            }
          });
          break;

        default:
          console.log(`   ⏭️ No autofix available for: ${issue.id}`);
      }
    } catch (error) {
      console.error(`   ❌ Error fixing ${issue.id}:`, error.message);
    }
  });

  console.log("✅ [A11Y] Accessibility fixes complete");
}

module.exports = {
  fixAccessibility,
  addAccessibilityMeta,
  addHtmlLang,
  addImageAlt,
  addLinkText,
  addLandmarks,
  addTableHeaders,
  addPageBreakLabels
};
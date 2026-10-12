const fs = require("fs");
const { XMLParser } = require("fast-xml-parser");

/**
 * Fixes spine issues with surgical edits:
 * - Removes duplicate IDREFs (keeps first occurrence)
 * - Preserves all original formatting
 */
function fixSpine(opfPath) {
  console.log("🔧 [SPINE] Fixing spine in:", opfPath);
  
  let opfContent = fs.readFileSync(opfPath, "utf8");
  const originalContent = opfContent;

  const parser = new XMLParser({
    ignoreAttributes: false,
    preserveOrder: false,
    parseAttributeValue: false,
    trimValues: true
  });

  const opfXml = parser.parse(opfContent);

  if (!opfXml?.package) {
    console.error("❌ Invalid OPF structure");
    return;
  }

  const pkg = opfXml.package;
  const spine = pkg.spine;
  
  if (!spine) {
    console.error("❌ No spine found");
    return;
  }

  let itemrefs = Array.isArray(spine.itemref) 
    ? spine.itemref 
    : spine.itemref ? [spine.itemref] : [];

  // Find duplicates
  const seenIdrefs = new Set();
  const duplicates = [];
  
  itemrefs.forEach(ref => {
    const idref = ref["@_idref"];
    if (seenIdrefs.has(idref)) {
      duplicates.push(idref);
    } else {
      seenIdrefs.add(idref);
    }
  });

  if (duplicates.length === 0) {
    console.log("   ✅ No duplicate spine items found");
    return;
  }

  // Remove duplicate itemrefs surgically
  duplicates.forEach(idref => {
    // Find all occurrences of this itemref
    const itemrefRegex = new RegExp(`<itemref[^>]*idref="${idref}"[^>]*/>`, 'g');
    const matches = [...opfContent.matchAll(itemrefRegex)];
    
    if (matches.length > 1) {
      // Remove all but the first occurrence
      for (let i = 1; i < matches.length; i++) {
        const matchToRemove = matches[i][0];
        // Remove the line including any whitespace before it
        opfContent = opfContent.replace(new RegExp(`\\s*${matchToRemove.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), '');
        console.log(`   ✅ Removed duplicate spine itemref: ${idref}`);
      }
    }
  });

  // Only write if changes were made
  if (opfContent !== originalContent) {
    fs.writeFileSync(opfPath, opfContent, "utf8");
    console.log("   💾 OPF file saved with fixes");
  } else {
    console.log("   ✅ Spine already correct, no changes needed");
  }
}

module.exports = { fixSpine };
const fs = require("fs");
const path = require("path");

function extractFilename(href) {
  return path.basename(href || "").split("#")[0].toLowerCase();
}

function capitalize(str) {
  return str.replace(/\b\w/g, l => l.toUpperCase());
}

function generateNavLabel(filename) {
  // Remove extension and common prefixes
  let label = filename.replace(/\.(x?html?)$/i, '');
  label = label.replace(/^\d+_/, ''); // Remove ISBN prefix
  label = label.replace(/_/g, ' ');
  
  // Capitalize
  return capitalize(label);
}

/**
 * Converts absolute path to relative path from nav.xhtml location
 * Example: "text/chapter01.xhtml" → "chapter01.xhtml" (if nav is in text/)
 */
function makeRelativeToNav(navPath, targetHref) {
  const navDir = path.dirname(navPath);
  const tempDir = navDir.split(path.sep).slice(0, -1).join(path.sep); // Go up to EPUB root
  
  // Resolve both paths from EPUB root
  const navAbsolute = path.resolve(tempDir, path.relative(tempDir, navPath));
  const targetAbsolute = path.resolve(tempDir, targetHref);
  
  // Calculate relative path
  let relativePath = path.relative(path.dirname(navAbsolute), targetAbsolute);
  
  // Normalize path separators for EPUB (always forward slash)
  relativePath = relativePath.replace(/\\/g, '/');
  
  return relativePath;
}

/**
 * Fixes nav.xhtml TOC order to match spine reading order
 * Uses surgical string manipulation to preserve formatting
 */
function fixNav(navPath, spineHrefs) {
  console.log("🔧 [NAV] Fixing nav.xhtml at:", navPath);

  let navContent = fs.readFileSync(navPath, "utf8");
  const originalContent = navContent;

  // Find the TOC nav section
  const tocNavMatch = navContent.match(/<nav[^>]*epub:type="toc"[^>]*>[\s\S]*?<\/nav>|<nav[^>]*role="doc-toc"[^>]*>[\s\S]*?<\/nav>/i);
  
  if (!tocNavMatch) {
    console.log("   ⚠️ No TOC nav found");
    return;
  }

  const tocSection = tocNavMatch[0];
  
  // Extract all <li> elements with their <a> hrefs
  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/g;
  const listItems = [];
  const listItemsByFile = new Map();
  let liMatch;
  
  while ((liMatch = liRegex.exec(tocSection)) !== null) {
    const liContent = liMatch[1];
    const liFullMatch = liMatch[0];
    
    // Find href in this <li>
    const hrefMatch = liContent.match(/<a[^>]+href="([^"]+)"/);
    if (hrefMatch) {
      const href = hrefMatch[1];
      const filename = extractFilename(href);
      
      const item = {
        fullLi: liFullMatch,
        filename,
        href
      };
      
      listItems.push(item);
      listItemsByFile.set(filename, item);
    }
  }

  if (listItems.length === 0) {
    console.log("   ⚠️ No TOC links found");
    return;
  }

  console.log(`   📋 Found ${listItems.length} existing TOC entries`);

  // Extract spine filenames for ordering
  const spineFilenames = spineHrefs.map(h => extractFilename(h));
  
  // FIX 1: Find missing entries
  const missingFiles = spineFilenames.filter(sf => !listItemsByFile.has(sf));
  
  if (missingFiles.length > 0) {
    console.log(`   ⚠️ Missing ${missingFiles.length} TOC entries: ${missingFiles.join(', ')}`);
    
    // Create new <li> entries for missing files
    missingFiles.forEach((filename) => {
      const spineHref = spineHrefs.find(h => extractFilename(h) === filename);
      
      // Convert to relative path from nav.xhtml location
      const relativeHref = makeRelativeToNav(navPath, spineHref);
      const label = generateNavLabel(filename);
      
      const newLi = `<li><a href="${relativeHref}">${label}</a></li>`;
      
      const newItem = {
        fullLi: newLi,
        filename,
        href: relativeHref,
        isNew: true
      };
      
      listItems.push(newItem);
      listItemsByFile.set(filename, newItem);
      console.log(`   ✅ Created new TOC entry: ${filename} → "${relativeHref}"`);
    });
  }

  // FIX 2: Create ordering map
  const spineOrderMap = {};
  spineFilenames.forEach((filename, idx) => {
    spineOrderMap[filename] = idx;
  });

  // FIX 3: Sort list items by spine order
  // Before sorting, remap existing TOC hrefs to the best matching spine href.
  // This addresses misnavigation where nav links point to wrong chapters.
  const spineQueue = {};
  spineHrefs.forEach(h => {
    const fn = extractFilename(h);
    if (!spineQueue[fn]) spineQueue[fn] = [];
    spineQueue[fn].push(h);
  });

  let remappedCount = 0;
  listItems.forEach(item => {
    const candidates = spineQueue[item.filename] || [];
    if (candidates.length > 0) {
      // Use and rotate the first candidate so duplicates map in order
      const targetHref = candidates.shift();
      if (targetHref) {
        const relativeHref = makeRelativeToNav(navPath, targetHref);
        // If href differs, replace href in the <li> markup
        try {
          const oldLi = item.fullLi;
          const newLi = oldLi.replace(/href="([^"]+)"/, `href="${relativeHref}"`);
          if (newLi !== oldLi) {
            item.fullLi = newLi;
            item.href = relativeHref;
            remappedCount++;
          }
        } catch (e) {
          // ignore replace errors
        }
      }
    }
  });

  if (remappedCount > 0) {
    console.log(`   ✅ Remapped ${remappedCount} TOC link(s) to match spine`);
  }

  listItems.sort((a, b) => {
    const orderA = spineOrderMap[a.filename] ?? 9999;
    const orderB = spineOrderMap[b.filename] ?? 9999;
    return orderA - orderB;
  });

  // Find the parent <ol> or <ul> in TOC
  const listMatch = tocSection.match(/(<[ou]l[^>]*>)([\s\S]*?)(<\/[ou]l>)/);
  
  if (!listMatch) {
    console.log("   ⚠️ No <ol> or <ul> found in TOC");
    return;
  }

  const [fullList, openTag, oldContent, closeTag] = listMatch;
  
  // Rebuild the list with sorted items
  const newListContent = listItems.map(item => item.fullLi).join('\n');
  const newList = openTag + '\n' + newListContent + '\n' + closeTag;
  
  // Replace the old list with new sorted list
  navContent = navContent.replace(fullList, newList);

  // Only write if changes were made
  if (navContent !== originalContent) {
    fs.writeFileSync(navPath, navContent, "utf8");
    console.log(`   ✅ Reordered ${listItems.length} TOC entries to match spine`);
    console.log(`   💾 nav.xhtml saved with fixes`);
  } else {
    console.log("   ✅ NAV already correct, no changes needed");
  }
}

module.exports = { fixNav };
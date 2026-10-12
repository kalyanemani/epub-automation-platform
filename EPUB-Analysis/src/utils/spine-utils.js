const fs = require("fs");
const path = require("path");
const { XMLParser } = require("fast-xml-parser");

/**
 * Extracts spine reading order hrefs from OPF file
 * Returns array of hrefs in spine order (relative paths from OPF location)
 */
function getSpineHrefs(opfPath) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    preserveOrder: false
  });

  const opfContent = fs.readFileSync(opfPath, "utf8");
  const opfXml = parser.parse(opfContent);

  if (!opfXml?.package) {
    return [];
  }

  const pkg = opfXml.package;
  
  // Get manifest items
  const manifest = Array.isArray(pkg.manifest?.item) 
    ? pkg.manifest.item 
    : pkg.manifest?.item ? [pkg.manifest.item] : [];
  
  // Get spine itemrefs
  const spine = pkg.spine;
  const itemrefs = Array.isArray(spine?.itemref) 
    ? spine.itemref 
    : spine?.itemref ? [spine.itemref] : [];

  // Build id -> href map
  const idToHref = {};
  manifest.forEach(item => {
    const id = item["@_id"];
    const href = item["@_href"];
    if (id && href) {
      idToHref[id] = href;
    }
  });

  // Extract hrefs in spine order
  const spineHrefs = itemrefs
    .map(ref => {
      const idref = ref["@_idref"];
      return idToHref[idref] || null;
    })
    .filter(Boolean);

  return spineHrefs;
}

module.exports = { getSpineHrefs };
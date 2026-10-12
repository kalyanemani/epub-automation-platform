/**
 * Detect EPUB version and whether the EPUB claims accessibility
 * Source:
 *  - OPF package@version
 *  - accessibility metadata (schema.org / EPUB a11y)
 */
function detectEpubContext(opfXml) {
  let isEpub3 = false;
  let isAccessibilityEPUB = false;
console.log(opfXml,"opfXml")
  if (opfXml?.package) {
    const version =
      opfXml.package["@_version"] ||
      opfXml.package["version"];

    isEpub3 = String(version || "").startsWith("3");

    const metadata = opfXml.package.metadata;
    if (metadata) {
      const metaStr = JSON.stringify(metadata).toLowerCase();
      if (
        metaStr.includes("accessibility") ||
        metaStr.includes("schema:accessibility") ||
        metaStr.includes("accessibilityfeature") ||
        metaStr.includes("accessibilitysummary")
      ) {
        isAccessibilityEPUB = true;
      }
    }
  }

  return { isEpub3, isAccessibilityEPUB };
}

module.exports = { detectEpubContext };

const { XMLParser, XMLBuilder } = require("fast-xml-parser");

/* -------------------------------
   PARSE XML → JS OBJECT
-------------------------------- */
function parseXml(xmlString) {
  if (!xmlString) return null;

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseAttributeValue: false,
    allowBooleanAttributes: true,
  });

  try {
    return parser.parse(xmlString);
  } catch (e) {
    console.error("XML Parse Error:", e);
    return null;
  }
}

/* -------------------------------
   BUILD XML STRING FROM JS OBJECT
-------------------------------- */
function buildXml(jsObj) {
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    suppressEmptyNode: false,
    format: true,          // pretty print
    indentBy: "  ",        // optional
  });

  try {
    return builder.build(jsObj);
  } catch (e) {
    console.error("XML Build Error:", e);
    return null;
  }
}

module.exports = { parseXml, buildXml };


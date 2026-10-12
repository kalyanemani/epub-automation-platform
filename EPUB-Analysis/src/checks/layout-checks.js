const fs = require("fs");
const path = require("path");
const csstree = require("css-tree");
const { JSDOM } = require("jsdom");

const { listAllFiles, readTextFile } = require("../utils/unzip");
const AgentLogger = require("../utils/agent-logger");
const { envInt } = require("../utils/batch-runner");

const CRITICAL_INLINE_PROPERTIES = [
  "font-size",
  "font-family",
  "font-weight",
  "font-style",
  "line-height",
  "text-align",
  "margin-left",
  "margin-right",
  "padding-left",
  "padding-right",
];

const FONT_FACE_PROPERTIES = new Set([
  "font-family",
  "src",
  "font-style",
  "font-weight",
  "font-display",
  "unicode-range",
  "font-stretch",
]);

const PROPERTY_ALIAS_MAP = new Map([
  ["textindent", "text-indent"],
  ["margintop", "margin-top"],
  ["marginbottom", "margin-bottom"],
  ["marginleft", "margin-left"],
  ["marginright", "margin-right"],
  ["paddingtop", "padding-top"],
  ["paddingbottom", "padding-bottom"],
  ["paddingleft", "padding-left"],
  ["paddingright", "padding-right"],
  ["fontsize", "font-size"],
  ["fontstyle", "font-style"],
  ["fontweight", "font-weight"],
  ["fontfamily", "font-family"],
  ["lineheight", "line-height"],
  ["textalign", "text-align"],
  ["backgroundcolor", "background-color"],
  ["bordercollapse", "border-collapse"],
  ["letterspacing", "letter-spacing"],
  ["wordspacing", "word-spacing"],
]);

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function createBucketStore() {
  return new Map();
}

function recordBucket(store, id, title, status, sample, suggestion = "") {
  if (!store.has(id)) {
    store.set(id, {
      id,
      title,
      status,
      suggestion,
      totalCount: 0,
      samples: [],
      keys: new Set(),
    });
  }

  const bucket = store.get(id);
  bucket.totalCount += Math.max(1, Number(sample?.occurrenceCount) || 1);
  if (status === "fail" || (status === "warn" && bucket.status !== "fail")) {
    bucket.status = status;
  }
  if (suggestion && !bucket.suggestion) {
    bucket.suggestion = suggestion;
  }

  const key = JSON.stringify(sample || {});
  if (!bucket.keys.has(key) && bucket.samples.length < 16) {
    bucket.keys.add(key);
    bucket.samples.push(sample);
  }
}

function toResults(store) {
  return Array.from(store.values()).map((bucket) => ({
    id: bucket.id,
    title: bucket.title,
    status: bucket.status,
    location: deriveLocation(bucket.samples[0]),
    details: {
      count: bucket.totalCount || bucket.samples.length,
      samples: bucket.samples,
    },
    suggestion: bucket.suggestion,
  }));
}

function deriveLocation(sample) {
  if (!sample || !sample.file) {
    return undefined;
  }

  const location = {
    file: sample.file,
  };

  if (Number.isFinite(Number(sample.line))) {
    location.line = Number(sample.line);
  }

  return location;
}

function toRelative(tempDir, filePath) {
  return path.relative(tempDir, filePath).replace(/\\/g, "/");
}

function lineFromIndex(text, index) {
  return String(text || "")
    .slice(0, Math.max(0, index))
    .split(/\r\n|\n/).length;
}

function numericFontSize(value) {
  const match = String(value || "").match(/([0-9.]+)/);
  return match ? parseFloat(match[1]) : 0;
}

function numericLineHeight(value, fontSize) {
  if (!value || value === "normal") {
    return fontSize ? fontSize * 1.2 : 0;
  }

  const raw = String(value);
  if (raw.endsWith("px")) {
    return numericFontSize(raw);
  }

  const numeric = parseFloat(raw);
  return Number.isFinite(numeric) ? numeric * (fontSize || 1) : 0;
}

function numericSpacing(value) {
  const match = String(value || "").match(/-?[0-9.]+/);
  return match ? parseFloat(match[0]) : 0;
}

function listCssFiles(tempDir) {
  const map = new Map();

  listAllFiles(tempDir)
    .filter((filePath) => filePath.toLowerCase().endsWith(".css"))
    .forEach((filePath) => {
      map.set(toRelative(tempDir, filePath), filePath);
    });

  return map;
}

function extractFontFacesFromCss(content, relativePath) {
  const faces = [];
  try {
    const ast = csstree.parse(content, { onParseError: () => {} });
    csstree.walk(ast, function (node) {
      if (node.type !== "Atrule" || node.name !== "font-face") return;
      let fontFamily = "";
      let srcValue = "";
      let fontStyle = "";
      let fontWeight = "";
      csstree.walk(node, function (decl) {
        if (decl.type !== "Declaration") return;
        const val = csstree.generate(decl.value);
        if (decl.property === "font-family") fontFamily = val.replace(/^['"]|['"]$/g, "").trim();
        else if (decl.property === "src") srcValue = val;
        else if (decl.property === "font-style") fontStyle = val.toLowerCase();
        else if (decl.property === "font-weight") fontWeight = val.toLowerCase();
      });
      faces.push({
        file: relativePath,
        fontFamily: normalizeWhitespace(fontFamily),
        urls: extractUrlsFromCssValue(srcValue),
        hasItalic: fontStyle.includes("italic"),
        hasBold: fontWeight.includes("bold") || parseInt(fontWeight, 10) >= 600,
      });
    });
  } catch (_) {}
  return faces;
}

function collectRules(ruleList, output = []) {
  Array.from(ruleList || []).forEach((rule) => {
    if (rule.type === 1 || rule.type === 5) {
      output.push(rule);
      return;
    }

    if (rule.cssRules) {
      collectRules(rule.cssRules, output);
    }
  });

  return output;
}

function buildSelectorMatchers(sheet, sourceRel) {
  return collectRules(sheet?.cssRules || [])
    .filter((rule) => rule.type === 1 && rule.selectorText)
    .map((rule) => ({
      sourceRel,
      selectorText: rule.selectorText,
    }));
}

function stripCssComments(value) {
  return String(value || "").replace(/\/\*[\s\S]*?\*\//g, " ");
}

function normalizeCssIssue(error) {
  return String(error?.formattedMessage || error?.message || "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCssBlocks(content) {
  const blocks = [];
  const regex = /([^{}]+)\{([^{}]*)\}/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const headerText = normalizeWhitespace(stripCssComments(match[1]));
    const bodyText = String(match[2] || "");
    const bodyStartIndex = match.index + String(match[0] || "").indexOf("{") + 1;

    blocks.push({
      header: headerText,
      body: bodyText,
      headerLine: lineFromIndex(content, match.index),
      bodyStartLine: lineFromIndex(content, bodyStartIndex),
    });
  }

  return blocks;
}

function isValidSelectorList(selectorText) {
  try {
    csstree.parse(selectorText, { context: "selectorList" });
    return true;
  } catch (error) {
    return false;
  }
}

function buildSelectorMatchersFromContent(content, sourceRel) {
  return extractCssBlocks(content)
    .filter((block) => block.header && !block.header.startsWith("@"))
    .filter((block) => isValidSelectorList(block.header))
    .map((block) => ({
      sourceRel,
      selectorText: block.header,
    }));
}

function collectDefinedClasses(styleMatchers = []) {
  const classes = new Set();

  styleMatchers.forEach((entry) => {
    const selectorText = String(entry?.selectorText || "");
    const matches = selectorText.match(/\.([_a-zA-Z][\w-]*)/g) || [];
    matches.forEach((match) => {
      classes.add(match.slice(1));
    });
  });

  return classes;
}

function resolveCssReference(htmlFile, href) {
  if (!href || /^https?:/i.test(href) || /^data:/i.test(href)) {
    return null;
  }

  return path.normalize(path.join(path.dirname(htmlFile), href.split("#")[0]));
}

function extractUrlsFromCssValue(value) {
  const urls = [];
  const regex = /url\(([^)]+)\)/gi;
  let match;

  while ((match = regex.exec(String(value || ""))) !== null) {
    const raw = String(match[1] || "").trim().replace(/^['"]|['"]$/g, "");
    if (raw) {
      urls.push(raw);
    }
  }

  return urls;
}

function isAcceptedDeclaration(probeStyle, property, value) {
  const normalizedProperty = String(property || "").trim().toLowerCase();
  const normalizedValue = String(value || "").trim();

  if (!normalizedProperty || !normalizedValue) {
    return false;
  }

  if (normalizedProperty.startsWith("--")) {
    return true;
  }

  if (
    normalizedProperty.startsWith("-webkit-") ||
    normalizedProperty.startsWith("-moz-") ||
    normalizedProperty.startsWith("-ms-") ||
    normalizedProperty.startsWith("-epub-")
  ) {
    return true;
  }

  if (FONT_FACE_PROPERTIES.has(normalizedProperty)) {
    return true;
  }

  if (PROPERTY_ALIAS_MAP.has(normalizedProperty)) {
    return false;
  }

  try {
    const parsedValue = csstree.parse(normalizedValue, { context: "value" });
    const match = csstree.lexer.matchProperty(normalizedProperty, parsedValue);
    if (match?.matched) {
      return true;
    }
  } catch (error) {
    return false;
  }

  return false;
}

function validateCssFile(cssFile, relativePath, bucketStore, fontFaces) {
  const content = readTextFile(cssFile);
  const cssBlocks = extractCssBlocks(content);
  const selectors = buildSelectorMatchersFromContent(content, relativePath);

  const openBraces = (content.match(/\{/g) || []).length;
  const closeBraces = (content.match(/\}/g) || []).length;
  if (openBraces !== closeBraces) {
    recordBucket(
      bucketStore,
      "L_CSS_SYNTAX",
      "CSS syntax issues detected",
      "fail",
      {
        file: relativePath,
        issue: "Mismatched opening and closing braces in stylesheet.",
      },
      "Fix malformed CSS blocks before validating layout."
    );
  }

  const parseErrors = [];
  try {
    csstree.parse(content, {
      positions: true,
      onParseError: (error) => {
        parseErrors.push(error);
      },
    });
  } catch (error) {
    parseErrors.push(error);
  }

  parseErrors.forEach((error) => {
    recordBucket(
      bucketStore,
      "L_CSS_SYNTAX",
      "CSS syntax issues detected",
      "fail",
      {
        file: relativePath,
        line: Number.isFinite(error?.line)
          ? error.line
          : lineFromIndex(content, error?.offset || 0),
        column: Number.isFinite(error?.column) ? error.column : undefined,
        issue: normalizeCssIssue(error),
      },
      "Fix malformed CSS blocks before validating layout."
    );
  });

  cssBlocks.forEach((block) => {
    if (!block.header) {
      return;
    }

    if (!block.header.startsWith("@") && !isValidSelectorList(block.header)) {
      recordBucket(
        bucketStore,
        "L_CSS_SYNTAX",
        "CSS syntax issues detected",
        "fail",
        {
          file: relativePath,
          line: block.headerLine,
          issue: `Invalid selector list: ${block.header}`,
        },
        "Fix malformed CSS blocks before validating layout."
      );
    }

    const declarationLines = String(block.body || "")
      .split(/\r\n|\n/)
      .map((line, index) => ({
        text: stripCssComments(line).trim(),
        line: block.bodyStartLine + index,
      }))
      .filter((entry) => entry.text);

    declarationLines.forEach((entry, entryIndex) => {
      if (!entry.text.includes(":")) {
        recordBucket(
          bucketStore,
          "L_CSS_SYNTAX",
          "CSS syntax issues detected",
          "fail",
          {
            file: relativePath,
            line: entry.line,
            issue: `Malformed declaration line: ${entry.text}`,
          },
          "Fix malformed CSS blocks before validating layout."
        );
        return;
      }

      const colonIndex = entry.text.indexOf(":");
      const property = entry.text.slice(0, colonIndex).trim();
      const hasSemicolon = /;\s*$/.test(entry.text);
      const value = entry.text
        .slice(colonIndex + 1)
        .trim()
        .replace(/;\s*$/, "");
      const hasAnotherDeclaration =
        entryIndex < declarationLines.length - 1 &&
        declarationLines[entryIndex + 1].text.includes(":");

      if (!hasSemicolon && hasAnotherDeclaration) {
        recordBucket(
          bucketStore,
          "L_CSS_SYNTAX",
          "CSS syntax issues detected",
          "fail",
          {
            file: relativePath,
            line: entry.line,
            property,
            value,
            issue: "Missing semicolon before the next declaration.",
          },
          "Fix malformed CSS blocks before validating layout."
        );
      }

      if (!isAcceptedDeclaration(null, property, value)) {
        recordBucket(
          bucketStore,
          "L_CSS_INVALID_DECLARATION",
          "Invalid or unsupported CSS declarations found",
          "fail",
          {
            file: relativePath,
            line: entry.line,
            property,
            value,
          },
          "Correct invalid CSS properties and values so EPUB readers can apply the stylesheet consistently."
        );
      }
    });
  });

  // Extract @font-face rules via csstree AST (no JSDOM)
  extractFontFacesFromCss(content, relativePath).forEach((face) => {
    fontFaces.push(face);
    if (!face.urls.length) {
      recordBucket(
        bucketStore,
        "L_FONT_EMBED_REFERENCE",
        "Embedded font declarations are incomplete",
        "fail",
        {
          file: relativePath,
          fontFamily: face.fontFamily,
          issue: "@font-face is missing a resolvable src URL.",
        },
        "Ensure each @font-face rule points to a packaged font asset."
      );
    }
  });

  return { content, selectors };
}

// ─── Fast regex-based HTML checks (no JSDOM) ────────────────────────────────

function getLinkedCssPaths(rawHtml, htmlFile) {
  const hrefs = [];
  const re = /<link([^>]+)>/gi;
  let m;
  while ((m = re.exec(rawHtml)) !== null) {
    const tag = m[1];
    if (!/rel\s*=\s*["'][^"']*stylesheet[^"']*["']/i.test(tag)) continue;
    const hm = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (hm) hrefs.push(hm[1]);
  }
  return hrefs;
}

function checkCssLinks(rawHtml, htmlFile, relPath, cssFilesMap, tempDir, bucketStore) {
  const hrefs = getLinkedCssPaths(rawHtml, htmlFile);
  const hasEmbeddedStyle = /<style[\s>]/i.test(rawHtml);
  if (!hrefs.length && !hasEmbeddedStyle && cssFilesMap.size > 0) {
    recordBucket(bucketStore, "L_CSS_REFERENCE_MISSING",
      "Content documents are missing stylesheet links", "fail",
      { file: relPath, issue: "No linked or embedded stylesheet found." },
      "Add a <link rel=\"stylesheet\"> to the XHTML document."
    );
  }
  hrefs.forEach((href) => {
    const resolved = resolveCssReference(htmlFile, href);
    if (!resolved) return;
    if (!fs.existsSync(resolved)) {
      recordBucket(bucketStore, "L_CSS_REFERENCE_BROKEN",
        "Stylesheet reference is broken", "fail",
        { file: relPath, href, resolvedPath: resolved },
        "Fix the stylesheet href so the XHTML can load its CSS."
      );
    }
  });
}

function checkHeadingStructure(rawHtml, relPath, bucketStore) {
  const headingRe = /<(h[1-6])[\s>]/gi;
  const levels = [];
  let m;
  while ((m = headingRe.exec(rawHtml)) !== null) {
    levels.push(parseInt(m[1][1], 10));
  }
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] > levels[i - 1] + 1) {
      recordBucket(bucketStore, "L_HEADING_HIERARCHY",
        "Heading level skipped — accessibility and structure issue", "warn",
        { file: relPath, from: `h${levels[i - 1]}`, to: `h${levels[i]}` },
        "Use sequential heading levels (e.g. h1 → h2 → h3) without skipping levels."
      );
      break;
    }
  }
}

function checkInlineStyles(rawHtml, relPath, bucketStore) {
  const CRITICAL = ["font-size", "font-family", "font-weight", "text-align", "margin", "padding", "line-height", "color", "background"];
  const inlineRe = /\bstyle\s*=\s*["']([^"']+)["']/gi;
  const seen = new Set();
  let m;
  while ((m = inlineRe.exec(rawHtml)) !== null) {
    const styleVal = m[1].toLowerCase();
    const hit = CRITICAL.find((p) => styleVal.includes(p));
    if (hit && !seen.has(hit)) {
      seen.add(hit);
      recordBucket(bucketStore, "L_INLINE_STYLE_CONFLICT",
        "Inline styles override global CSS", "warn",
        { file: relPath, property: hit, snippet: m[0].slice(0, 120) },
        "Move inline styles into the linked stylesheet for consistent chapter rendering."
      );
    }
  }
}

function checkTableStructure(rawHtml, relPath, bucketStore) {
  const tableRe = /<table([^>]*)>/gi;
  let m, idx = 0;
  while ((m = tableRe.exec(rawHtml)) !== null) {
    idx++;
    const attrs = m[1];
    const hasFixedWidth = /width\s*=\s*["']?\d{3,}["']?/i.test(attrs) ||
      /style\s*=\s*["'][^"']*width\s*:\s*\d{4,}/i.test(attrs);
    if (hasFixedWidth) {
      recordBucket(bucketStore, "L_TABLE_RESPONSIVE",
        "Table has a fixed pixel width that may overflow on narrow screens", "warn",
        { file: relPath, tableIndex: idx },
        "Use percentage widths on tables so they reflow on all screen sizes."
      );
    }
  }
}

function checkCodeBlocks(rawHtml, relPath, bucketStore) {
  if (!/<pre[\s>]|<code[\s>]/i.test(rawHtml)) return;
  const inlineCode = /<(pre|code)[^>]*style\s*=\s*["']([^"']*)["']/gi;
  let m;
  let anyIssue = false;
  while ((m = inlineCode.exec(rawHtml)) !== null) {
    const style = m[2].toLowerCase();
    if (style.includes("font-family") && !/mono|courier|consolas|menlo/i.test(style)) {
      anyIssue = true;
    }
  }
  if (!anyIssue && /<(pre|code)/i.test(rawHtml)) {
    // Only flag if there are code blocks but no monospace font defined anywhere in linked CSS
    // (CSS-level check handles this more accurately — skip per-file flagging to avoid false positives)
  }
}

// ─── Legacy JSDOM stubs — no-ops so callers compile cleanly ─────────────────
function ensureCssLoaded(
  htmlFile,
  tempDir,
  cssFilesMap,
  bucketStore,
  parsedCssByRelPath = new Map()
) {
  const rawHtml = readTextFile(htmlFile);
  const dom = new JSDOM(rawHtml, {
    pretendToBeVisual: true,
  });
  const document = dom.window.document;
  const root = document.documentElement || document.querySelector("html");
  if (root && !document.head) {
    const head = document.createElement("head");
    root.insertBefore(head, document.body || root.firstChild || null);
  }
  const links = Array.from(document.querySelectorAll('link[rel~="stylesheet" i]'));
  const embeddedStyles = Array.from(document.querySelectorAll("style"));
  const stylesheets = [];

  if (!links.length && !embeddedStyles.length && cssFilesMap.size > 0) {
    recordBucket(
      bucketStore,
      "L_CSS_REFERENCE_MISSING",
      "Content documents are missing stylesheet links",
      "fail",
      {
        file: toRelative(tempDir, htmlFile),
        issue: "No linked or embedded stylesheet was found for this document.",
      },
      "Link chapter XHTML files to the packaged CSS files so global styles are applied consistently."
    );
  }

  links.forEach((link) => {
    const href = link.getAttribute("href");
    const resolved = resolveCssReference(htmlFile, href);
    if (!resolved || !fs.existsSync(resolved)) {
      recordBucket(
        bucketStore,
        "L_CSS_REFERENCE_BROKEN",
        "Broken CSS references detected",
        "fail",
        {
          file: toRelative(tempDir, htmlFile),
          href: href || "",
        },
        "Fix broken stylesheet href values inside the XHTML package."
      );
      return;
    }

    const styleElement = document.createElement("style");
    styleElement.textContent = readTextFile(resolved);
    styleElement.setAttribute("data-source", toRelative(tempDir, resolved));
    document.head.appendChild(styleElement);
    stylesheets.push({
      file: resolved,
      relativePath: toRelative(tempDir, resolved),
      sheet: styleElement.sheet,
      selectors:
        parsedCssByRelPath.get(toRelative(tempDir, resolved))?.selectors ||
        buildSelectorMatchers(styleElement.sheet, toRelative(tempDir, resolved)),
    });
  });

  embeddedStyles.forEach((style, index) => {
    stylesheets.push({
      file: `${toRelative(tempDir, htmlFile)}#embedded-${index + 1}`,
      relativePath: `${toRelative(tempDir, htmlFile)}#embedded-${index + 1}`,
      sheet: style.sheet,
      selectors: buildSelectorMatchersFromContent(
        style.textContent || "",
        `${toRelative(tempDir, htmlFile)}#embedded-${index + 1}`
      ),
    });
  });

  return {
    rawHtml,
    dom,
    document,
    stylesheets,
    styleMatchers: stylesheets.flatMap((entry) => entry.selectors),
  };
}

function elementMatchesAnySelector(element, selectors) {
  return selectors.some((entry) => {
    try {
      return element.matches(entry.selectorText);
    } catch (error) {
      return false;
    }
  });
}

function inspectInlineOverrides(document, window, htmlRelPath, styleMatchers, bucketStore) {
  const inlineElements = Array.from(document.querySelectorAll("[style]")).slice(0, 80);

  inlineElements.forEach((element) => {
    if (!elementMatchesAnySelector(element, styleMatchers)) {
      return;
    }

    const originalStyle = element.getAttribute("style");
    const before = window.getComputedStyle(element);
    const beforeValues = {};
    CRITICAL_INLINE_PROPERTIES.forEach((property) => {
      beforeValues[property] = before.getPropertyValue(property);
    });

    element.removeAttribute("style");
    const after = window.getComputedStyle(element);

    const differences = CRITICAL_INLINE_PROPERTIES.filter(
      (property) => beforeValues[property] !== after.getPropertyValue(property)
    );

    element.setAttribute("style", originalStyle);

    if (differences.length) {
      recordBucket(
        bucketStore,
        "L_INLINE_STYLE_CONFLICT",
        "Inline styles override global CSS",
        "warn",
        {
          file: htmlRelPath,
          tag: element.tagName.toLowerCase(),
          id: element.getAttribute("id") || "",
          class: normalizeWhitespace(element.getAttribute("class") || ""),
          properties: differences,
        },
        "Reduce inline styling for headings, paragraphs, and layout-critical elements so chapter rendering stays consistent."
      );
    }
  });
}

function inspectReferencedClasses(document, htmlRelPath, styleMatchers, bucketStore) {
  if (!styleMatchers.length) {
    return;
  }

  const definedClasses = collectDefinedClasses(styleMatchers);

  const classSamples = new Map();

  Array.from(document.querySelectorAll("[class]"))
    .slice(0, 240)
    .forEach((element) => {
      if (element.closest("nav")) {
        return;
      }

      Array.from(element.classList || []).forEach((className) => {
        const normalizedClass = String(className || "").trim();
        if (!normalizedClass || definedClasses.has(normalizedClass)) {
          return;
        }

        if (!classSamples.has(normalizedClass)) {
          classSamples.set(normalizedClass, {
            file: htmlRelPath,
            className: normalizedClass,
            tag: element.tagName.toLowerCase(),
            text: normalizeWhitespace(element.textContent || "").slice(0, 120),
            occurrenceCount: 0,
          });
        }

        classSamples.get(normalizedClass).occurrenceCount += 1;
      });
    });

  classSamples.forEach((sample) => {
    recordBucket(
      bucketStore,
      "L_CSS_CLASS_SELECTOR_MISSING",
      "Referenced CSS classes are not defined in linked stylesheets",
      "fail",
      sample,
      "Define the missing class selector in the stylesheet or correct the class name in the XHTML so chapter-specific styling is applied."
    );
  });
}

function inspectHeadings(document, window, htmlRelPath, bodyStyle, bucketStore, headingProfiles) {
  const bodyFontSize = numericFontSize(bodyStyle.fontSize);
  const headingSizes = {};

  ["h1", "h2", "h3"].forEach((tagName) => {
    const elements = Array.from(document.querySelectorAll(tagName));
    if (!elements.length) {
      return;
    }

    const profiles = elements.map((element) => {
      const computed = window.getComputedStyle(element);
      return {
        fontSize: numericFontSize(computed.fontSize),
        fontWeight: computed.fontWeight,
        fontFamily: computed.fontFamily,
        marginBottom: numericSpacing(computed.marginBottom),
      };
    });

    const averageFontSize =
      profiles.reduce((sum, profile) => sum + profile.fontSize, 0) / profiles.length;
    headingSizes[tagName] = averageFontSize;
    headingProfiles[tagName].push({
      file: htmlRelPath,
      fontSize: averageFontSize,
      fontFamily: profiles[0]?.fontFamily || "",
      fontWeight: profiles[0]?.fontWeight || "",
    });

    if (averageFontSize <= bodyFontSize) {
      recordBucket(
        bucketStore,
        "L_HEADING_HIERARCHY",
        "Heading hierarchy is not visually distinct",
        "fail",
        {
          file: htmlRelPath,
          tag: tagName,
          headingFontSize: averageFontSize,
          bodyFontSize,
        },
        "Style H1/H2/H3 with a clear size and weight hierarchy above body text."
      );
    }
  });

  if (headingSizes.h1 && headingSizes.h2 && headingSizes.h1 <= headingSizes.h2) {
    recordBucket(
      bucketStore,
      "L_HEADING_HIERARCHY",
      "Heading hierarchy is not visually distinct",
      "fail",
      {
        file: htmlRelPath,
        issue: "H1 is not larger than H2.",
        h1: headingSizes.h1,
        h2: headingSizes.h2,
      },
      "Ensure H1, H2, and H3 decrease progressively in visual prominence."
    );
  }

  if (headingSizes.h2 && headingSizes.h3 && headingSizes.h2 <= headingSizes.h3) {
    recordBucket(
      bucketStore,
      "L_HEADING_HIERARCHY",
      "Heading hierarchy is not visually distinct",
      "fail",
      {
        file: htmlRelPath,
        issue: "H2 is not larger than H3.",
        h2: headingSizes.h2,
        h3: headingSizes.h3,
      },
      "Ensure H1, H2, and H3 decrease progressively in visual prominence."
    );
  }
}

function inspectParagraphSpacing(document, window, htmlRelPath, bodyStyle, bucketStore, bodyProfiles) {
  const bodyFontSize = numericFontSize(bodyStyle.fontSize);
  const bodyLineHeight = numericLineHeight(bodyStyle.lineHeight, bodyFontSize);
  const bodyFontFamily = normalizeWhitespace(bodyStyle.fontFamily);
  const bodyTextAlign = normalizeWhitespace(bodyStyle.textAlign);

  bodyProfiles.push({
    file: htmlRelPath,
    fontFamily: bodyFontFamily,
    fontSize: bodyFontSize,
    lineHeight: bodyLineHeight,
    textAlign: bodyTextAlign,
  });

  const paragraphs = Array.from(document.querySelectorAll("p")).slice(0, 40);
  if (!paragraphs.length) {
    return;
  }

  const paragraphProfiles = paragraphs.map((paragraph) => {
    const computed = window.getComputedStyle(paragraph);
    return {
      fontSize: numericFontSize(computed.fontSize),
      lineHeight: numericLineHeight(computed.lineHeight, numericFontSize(computed.fontSize)),
      marginTop: numericSpacing(computed.marginTop),
      marginBottom: numericSpacing(computed.marginBottom),
    };
  });

  const averageLineHeight =
    paragraphProfiles.reduce((sum, profile) => sum + profile.lineHeight, 0) /
    paragraphProfiles.length;

  if (averageLineHeight < bodyFontSize * 1.2) {
    recordBucket(
      bucketStore,
      "L_PARAGRAPH_SPACING",
      "Paragraph line spacing is too tight",
      "warn",
      {
        file: htmlRelPath,
        fontSize: bodyFontSize,
        lineHeight: Number(averageLineHeight.toFixed(2)),
      },
      "Increase line-height to improve readability and prevent cramped rendering."
    );
  }
}

function inspectFonts(document, window, htmlRelPath, fontFaces, bucketStore) {
  const embeddedFamilies = new Set(
    fontFaces.map((fontFace) => normalizeWhitespace(fontFace.fontFamily).toLowerCase()).filter(Boolean)
  );
  const bodyFontFamily = normalizeWhitespace(window.getComputedStyle(document.body || document.documentElement).fontFamily).toLowerCase();

  if (embeddedFamilies.size && !Array.from(embeddedFamilies).some((family) => bodyFontFamily.includes(family))) {
    recordBucket(
      bucketStore,
      "L_FONT_FALLBACK",
      "Unexpected font fallback detected",
      "warn",
      {
        file: htmlRelPath,
        bodyFontFamily,
        embeddedFonts: Array.from(embeddedFamilies),
      },
      "Apply the embedded font-family to body and heading styles so readers do not fall back to unexpected defaults."
    );
  }

  const italicElements = Array.from(document.querySelectorAll("em, i")).slice(0, 20);
  italicElements.forEach((element) => {
    const fontStyle = window.getComputedStyle(element).fontStyle;
    if (!String(fontStyle).toLowerCase().includes("italic")) {
      recordBucket(
        bucketStore,
        "L_FONT_VARIANTS",
        "Expected font variants are not rendering correctly",
        "warn",
        {
          file: htmlRelPath,
          tag: element.tagName.toLowerCase(),
          issue: "Italic text does not compute to an italic font-style.",
        },
        "Ensure bold and italic variants are defined and mapped correctly in CSS."
      );
    }
  });

  const boldElements = Array.from(document.querySelectorAll("strong, b")).slice(0, 20);
  boldElements.forEach((element) => {
    const weight = parseInt(window.getComputedStyle(element).fontWeight || "0", 10);
    if (!Number.isFinite(weight) || weight < 600) {
      recordBucket(
        bucketStore,
        "L_FONT_VARIANTS",
        "Expected font variants are not rendering correctly",
        "warn",
        {
          file: htmlRelPath,
          tag: element.tagName.toLowerCase(),
          issue: "Bold text does not compute to a strong font-weight.",
        },
        "Ensure bold and italic variants are defined and mapped correctly in CSS."
      );
    }
  });
}

function inspectTables(document, window, htmlRelPath, bucketStore) {
  Array.from(document.querySelectorAll("table")).forEach((table, tableIndex) => {
    const rows = Array.from(table.querySelectorAll("tr"));
    if (!rows.length) {
      return;
    }

    const cellCounts = rows.map((row) => row.querySelectorAll("th,td").length).filter(Boolean);
    const uniqueCellCounts = Array.from(new Set(cellCounts));
    if (uniqueCellCounts.length > 2) {
      recordBucket(
        bucketStore,
        "L_TABLE_STRUCTURE",
        "Table rows and columns are inconsistent",
        "fail",
        {
          file: htmlRelPath,
          tableIndex: tableIndex + 1,
          cellCounts: uniqueCellCounts,
        },
        "Normalize table row and column structure so data remains readable across readers."
      );
    }

    const sampleCell = table.querySelector("th,td");
    if (!sampleCell) {
      return;
    }

    const cellStyle = window.getComputedStyle(sampleCell);
    if (numericSpacing(cellStyle.paddingLeft) < 2 && numericSpacing(cellStyle.paddingRight) < 2) {
      recordBucket(
        bucketStore,
        "L_TABLE_STYLING",
        "Table spacing is too tight for readability",
        "warn",
        {
          file: htmlRelPath,
          tableIndex: tableIndex + 1,
        },
        "Add table cell padding and consistent borders so content remains readable."
      );
    }
  });
}

function inspectLists(document, window, htmlRelPath, bucketStore) {
  Array.from(document.querySelectorAll("ul, ol")).forEach((listElement) => {
    if (listElement.closest("nav")) {
      return;
    }

    if (
      /contents|toc/i.test(htmlRelPath) ||
      /toc|contents/i.test(listElement.getAttribute("class") || "")
    ) {
      return;
    }

    const items = Array.from(listElement.querySelectorAll(":scope > li"));
    if (!items.length) {
      return;
    }

    const computed = window.getComputedStyle(listElement);
    const listStyleType = String(computed.listStyleType || "").toLowerCase();
    if (!listStyleType || listStyleType === "none") {
      recordBucket(
        bucketStore,
        "L_LIST_STYLING",
        "List bullets or numbering are not visually preserved",
        "warn",
        {
          file: htmlRelPath,
          tag: listElement.tagName.toLowerCase(),
          listStyleType,
        },
        "Preserve list bullets and numbering for body content lists."
      );
    }
  });
}

function inspectSpecialBlocks(document, window, htmlRelPath, bucketStore) {
  Array.from(document.querySelectorAll("blockquote")).slice(0, 20).forEach((blockquote) => {
    const computed = window.getComputedStyle(blockquote);
    if (
      numericSpacing(computed.marginLeft) <= 8 &&
      numericSpacing(computed.paddingLeft) <= 2 &&
      !String(computed.fontStyle || "").toLowerCase().includes("italic")
    ) {
      recordBucket(
        bucketStore,
        "L_BLOCKQUOTE_STYLING",
        "Blockquotes are not visually differentiated",
        "warn",
        {
          file: htmlRelPath,
          tag: "blockquote",
        },
        "Apply indentation, spacing, or font treatment to distinguish blockquotes from body paragraphs."
      );
    }
  });

  Array.from(document.querySelectorAll("pre, code")).slice(0, 20).forEach((codeElement) => {
    const computed = window.getComputedStyle(codeElement);
    const fontFamily = String(computed.fontFamily || "").toLowerCase();
    const whiteSpace = String(computed.whiteSpace || "").toLowerCase();
    if (
      !/mono|courier|consolas|menlo/.test(fontFamily) ||
      !["pre", "pre-wrap", "break-spaces"].includes(whiteSpace)
    ) {
      recordBucket(
        bucketStore,
        "L_CODE_BLOCK_STYLING",
        "Code blocks are not formatted consistently",
        "warn",
        {
          file: htmlRelPath,
          tag: codeElement.tagName.toLowerCase(),
          fontFamily,
          whiteSpace,
        },
        "Render code blocks with monospace fonts and whitespace-preserving styles."
      );
    }
  });
}

function finalizeFontAssets(fontFaces, tempDir, cssFilesMap, bucketStore) {
  fontFaces.forEach((fontFace) => {
    fontFace.urls.forEach((url) => {
      if (/^data:/i.test(url) || /^https?:/i.test(url)) {
        return;
      }

      const absolutePath = path.normalize(
        path.join(path.dirname(path.join(tempDir, fontFace.file)), url)
      );
      if (!fs.existsSync(absolutePath)) {
        recordBucket(
          bucketStore,
          "L_FONT_EMBED_REFERENCE",
          "Embedded font declarations are incomplete",
          "fail",
          {
            file: fontFace.file,
            fontFamily: fontFace.fontFamily,
            missingAsset: url,
          },
          "Ensure each @font-face URL points to an actual packaged font file."
        );
      }
    });
  });
}

function finalizeConsistencyChecks(bodyProfiles, headingProfiles, bucketStore) {
  const bodyFamilies = Array.from(new Set(bodyProfiles.map((profile) => profile.fontFamily).filter(Boolean)));
  if (bodyFamilies.length > 3) {
    recordBucket(
      bucketStore,
      "L_FONT_CONSISTENCY",
      "Body font styling is inconsistent across chapters",
      "warn",
      {
        fonts: bodyFamilies,
        files: bodyProfiles.slice(0, 10).map((profile) => profile.file),
      },
      "Keep body font-family usage consistent across chapters."
    );
  }

  ["h1", "h2", "h3"].forEach((tagName) => {
    const profiles = headingProfiles[tagName];
    if (profiles.length < 2) {
      return;
    }

    const sizes = profiles.map((profile) => profile.fontSize).filter(Boolean);
    if (!sizes.length) {
      return;
    }

    const min = Math.min(...sizes);
    const max = Math.max(...sizes);
    if (max - min > Math.max(2, min * 0.2)) {
      recordBucket(
        bucketStore,
        "L_HEADING_CONSISTENCY",
        "Heading styling is inconsistent across chapters",
        "warn",
        {
          tag: tagName,
          minFontSize: min,
          maxFontSize: max,
          files: profiles.slice(0, 8).map((profile) => profile.file),
        },
        "Use consistent heading styles for the same heading level across chapters."
      );
    }
  });
}

async function runLayoutChecks(context) {
  const { tempDir } = context;
  const bucketStore = createBucketStore();
  const cssFilesMap = listCssFiles(tempDir);
  const parsedCssByRelPath = new Map();
  const fontFaces = [];
  const bodyProfiles = [];
  const headingProfiles = {
    h1: [],
    h2: [],
    h3: [],
  };

  AgentLogger.log("LAYOUT_CHECK", "LayoutEngine", {
    phase: "start",
    cssFileCount: cssFilesMap.size,
  });

  Array.from(cssFilesMap.entries()).forEach(([relativePath, absolutePath]) => {
    parsedCssByRelPath.set(
      relativePath,
      validateCssFile(absolutePath, relativePath, bucketStore, fontFaces)
    );
  });

  if (!cssFilesMap.size) {
    recordBucket(
      bucketStore,
      "L_NO_CSS",
      "No standalone CSS files were packaged in the EPUB",
      "warn",
      {
        issue: "No .css assets were found in the EPUB package.",
      },
      "Add a packaged stylesheet if the book depends on reusable global styling."
    );
  }

  // Process ALL HTML files with fast regex — no JSDOM, no file caps
  const htmlFiles = listAllFiles(tempDir).filter((filePath) => {
    const lower = filePath.toLowerCase();
    return lower.endsWith(".html") || lower.endsWith(".xhtml");
  });

  htmlFiles.forEach((htmlFile) => {
    const htmlRelPath = toRelative(tempDir, htmlFile);
    const rawHtml = readTextFile(htmlFile);
    checkCssLinks(rawHtml, htmlFile, htmlRelPath, cssFilesMap, tempDir, bucketStore);
    checkHeadingStructure(rawHtml, htmlRelPath, bucketStore);
    checkInlineStyles(rawHtml, htmlRelPath, bucketStore);
    checkTableStructure(rawHtml, htmlRelPath, bucketStore);

    try {
      const { document, dom, styleMatchers } = ensureCssLoaded(
        htmlFile,
        tempDir,
        cssFilesMap,
        bucketStore,
        parsedCssByRelPath
      );
      const window = dom.window;
      const bodyElement = document.body || document.documentElement;
      const bodyStyle = window.getComputedStyle(bodyElement);
      inspectReferencedClasses(document, htmlRelPath, styleMatchers, bucketStore);
      inspectInlineOverrides(document, window, htmlRelPath, styleMatchers, bucketStore);
      inspectHeadings(document, window, htmlRelPath, bodyStyle, bucketStore, headingProfiles);
      inspectParagraphSpacing(document, window, htmlRelPath, bodyStyle, bucketStore, bodyProfiles);
      inspectFonts(document, window, htmlRelPath, fontFaces, bucketStore);
      inspectTables(document, window, htmlRelPath, bucketStore);
      inspectLists(document, window, htmlRelPath, bucketStore);
      inspectSpecialBlocks(document, window, htmlRelPath, bucketStore);
    } catch (error) {
      AgentLogger.log("LAYOUT_CHECK", "LayoutEngine", {
        phase: "html_inspection_failed",
        file: htmlRelPath,
        error: error.message,
      });
    }
  });

  finalizeFontAssets(fontFaces, tempDir, cssFilesMap, bucketStore);
  finalizeConsistencyChecks(bodyProfiles, headingProfiles, bucketStore);

  const results = toResults(bucketStore);
  if (!results.length) {
    results.push({
      id: "L_LAYOUT_PASSED",
      title: "Layout and styling validation passed",
      status: "pass",
      details: "CSS loading, font usage, heading hierarchy, spacing, and special block styling checks passed.",
      suggestion: "",
    });
  }

  AgentLogger.log("LAYOUT_CHECK", "LayoutEngine", {
    phase: "complete",
    issuesFound: results.length,
  });

  return results;
}

module.exports = {
  runLayoutChecks,
};

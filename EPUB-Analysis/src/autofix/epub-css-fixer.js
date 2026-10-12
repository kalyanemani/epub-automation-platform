const fs = require("fs");
const path = require("path");

const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
]);

const INVALID_PATTERNS = [
  /\s*-epub-[^:]+:[^;]+;/gi,
  /\s*-moz-[^:]+:[^;]+;/gi,
  /\s*filter\s*:\s*[^;]+;/gi,
  /\s*behavior\s*:\s*[^;]+;/gi,
  /\s*zoom\s*:\s*[^;]+;/gi,
];

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
  ["textdecoration", "text-decoration"],
  ["bordertop", "border-top"],
  ["borderbottom", "border-bottom"],
  ["borderleft", "border-left"],
  ["borderright", "border-right"],
]);

// Compiled once at module load for performance.
const ALIAS_REGEX = (() => {
  const aliases = Array.from(PROPERTY_ALIAS_MAP.keys())
    // Longest first so e.g. "backgroundcolor" matches before "background".
    .sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&"))
    .join("|");
  // Match only at a property-name position: start-of-line / after { or ; with
  // optional whitespace, capture leading whitespace for re-insertion.
  return new RegExp(`((?:^|[{;,])\\s*)(${aliases})(\\s*:)`, "gim");
})();

function readCss(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, "utf8");
}

function writeIfChanged(filePath, before, after) {
  if (before === null || before === after) {
    return false;
  }
  fs.writeFileSync(filePath, after, "utf8");
  return true;
}

function normalizePropertyAliases(css) {
  ALIAS_REGEX.lastIndex = 0;
  return String(css || "").replace(ALIAS_REGEX, (_, lead, alias, colon) => {
    const canonical = PROPERTY_ALIAS_MAP.get(alias.toLowerCase()) || alias;
    return `${lead}${canonical}${colon}`;
  });
}

/**
 * Count how many alias occurrences exist in a CSS string without modifying it.
 * @param {string} css
 * @returns {number}
 */
function countPropertyAliases(css) {
  ALIAS_REGEX.lastIndex = 0;
  const matches = String(css || "").match(ALIAS_REGEX);
  return matches ? matches.length : 0;
}

function normalizeAdjacentDimensions(css) {
  return String(css || "").replace(
    /(\d(?:\.\d+)?(?:px|em|rem|pt|pc|vh|vw|%))(?=-?\d(?:\.\d+)?(?:px|em|rem|pt|pc|vh|vw|%))/gi,
    "$1 "
  );
}

function addMissingSemicolons(css) {
  return String(css || "")
    .replace(/([^\s;{}])(\r?\n\s*[a-z-]+\s*:)/gi, "$1;$2")
    .replace(/([^\s;{}])(\s+[a-z-]+\s*:)/gi, (match, tail, next) => {
      if (/[{}]/.test(next)) {
        return match;
      }
      return `${tail};${next}`;
    });
}

function fixFontFallback(tempDir, cssFiles) {
  let fixed = 0;
  cssFiles.forEach((file) => {
    const filePath = path.join(tempDir, file);
    const before = readCss(filePath);
    if (before === null) {
      return;
    }

    const after = before.replace(/font-family\s*:\s*([^;{}]+);/gi, (match, value) => {
      const families = String(value)
        .split(",")
        .map((entry) => entry.trim().toLowerCase().replace(/["']/g, ""));
      const hasGeneric = families.some((family) => GENERIC_FAMILIES.has(family));
      if (hasGeneric) {
        return match;
      }

      const first = families[0] || "";
      const generic = /mono|code|courier|consolas/i.test(first) ? "monospace" : "serif";
      return match.replace(value, `${String(value).trimEnd()}, ${generic}`);
    });

    if (writeIfChanged(filePath, before, after)) {
      fixed += 1;
    }
  });
  return fixed;
}

function fixInvalidCssDeclarations(tempDir, cssFiles) {
  let fixed = 0;
  cssFiles.forEach((file) => {
    const filePath = path.join(tempDir, file);
    const before = readCss(filePath);
    if (before === null) {
      return;
    }

    let after = before;
    INVALID_PATTERNS.forEach((pattern) => {
      after = after.replace(pattern, "");
    });

    if (writeIfChanged(filePath, before, after)) {
      fixed += 1;
    }
  });
  return fixed;
}

function fixCssSyntaxIssues(tempDir, cssFiles) {
  let fixed = 0;
  cssFiles.forEach((file) => {
    const filePath = path.join(tempDir, file);
    const before = readCss(filePath);
    if (before === null) {
      return;
    }

    let after = before;
    after = normalizePropertyAliases(after);
    after = normalizeAdjacentDimensions(after);
    after = addMissingSemicolons(after);

    const openBraces = (after.match(/\{/g) || []).length;
    const closeBraces = (after.match(/\}/g) || []).length;
    if (openBraces > closeBraces) {
      after = `${after}\n${"}".repeat(openBraces - closeBraces)}`;
    }

    if (writeIfChanged(filePath, before, after)) {
      fixed += 1;
    }
  });
  return fixed;
}

/**
 * Walk all CSS files under `epubDir` recursively and replace aliased CSS
 * property names (e.g. `fontsize` → `font-size`) with their canonical
 * hyphenated equivalents.  Only property names (before the colon) are
 * rewritten; values are never touched.
 *
 * @param {string} epubDir  Absolute path to the unpacked EPUB directory.
 * @returns {{ changed: boolean, files: string[], fixes: number }}
 */
function fixCssPropertyAliases(epubDir) {
  const changedFiles = [];
  let totalFixes = 0;

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch (_) {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch (_) {
        continue;
      }

      if (stat.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (!entry.toLowerCase().endsWith(".css")) {
        continue;
      }

      const before = readCss(fullPath);
      if (before === null) {
        continue;
      }

      const fileFixCount = countPropertyAliases(before);
      if (fileFixCount === 0) {
        continue;
      }

      const after = normalizePropertyAliases(before);
      if (writeIfChanged(fullPath, before, after)) {
        changedFiles.push(fullPath);
        totalFixes += fileFixCount;
      }
    }
  }

  walk(epubDir);

  return {
    changed: changedFiles.length > 0,
    files: changedFiles,
    fixes: totalFixes,
  };
}

/**
 * Scan CSS files for declarations that commonly cause layout overlap:
 * - position: absolute/fixed on content-level selectors
 * - negative top/left/margin values that pull elements into each other
 *
 * Replaces aggressive overlap-prone values with safe alternatives.
 *
 * @param {string} tempDir  Absolute path to the unpacked EPUB directory.
 * @param {string[]} cssFiles  Relative CSS paths inside tempDir.
 * @returns {number}  Count of files changed.
 */
function fixOverlappingElements(tempDir, cssFiles) {
  let fixed = 0;

  // Content-level selectors that should not have absolute/fixed positioning.
  // Navigation/decorative selectors (nav, header[role=banner], etc.) are excluded.
  const CONTENT_SELECTOR_HINTS = /(?:^|\s|,)(?:h[1-6]|p|img|figure|figcaption|blockquote|section|article|div|table)\b/i;

  cssFiles.forEach((file) => {
    const filePath = path.join(tempDir, file);
    const before = readCss(filePath);
    if (before === null) {
      return;
    }

    let after = before;

    // 1. Replace position: absolute/fixed in content-level rule blocks
    //    Match a block: selector { ... position: absolute; ... }
    after = after.replace(
      /([^{}]+)\{([^}]*)\}/g,
      (match, selector, body) => {
        if (!CONTENT_SELECTOR_HINTS.test(selector)) {
          return match;
        }

        let newBody = body;

        // position: absolute|fixed → position: static
        newBody = newBody.replace(
          /position\s*:\s*(?:absolute|fixed)\s*;?/gi,
          "position: static;"
        );

        // Negative top/left/right/bottom offsets → auto
        newBody = newBody.replace(
          /(top|left|right|bottom)\s*:\s*-\d+[^;]*;?/gi,
          "$1: auto;"
        );

        // Negative margin-top/margin-bottom → 0
        newBody = newBody.replace(
          /(margin-top|margin-bottom)\s*:\s*-\d+[^;]*;?/gi,
          "$1: 0;"
        );

        if (newBody !== body) {
          return `${selector}{${newBody}}`;
        }
        return match;
      }
    );

    if (writeIfChanged(filePath, before, after)) {
      fixed += 1;
    }
  });

  return fixed;
}

module.exports = {
  fixCssSyntaxIssues,
  fixFontFallback,
  fixInvalidCssDeclarations,
  fixCssPropertyAliases,
  fixOverlappingElements,
};

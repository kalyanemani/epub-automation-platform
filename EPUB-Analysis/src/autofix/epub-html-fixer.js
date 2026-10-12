const fs = require("fs");
const path = require("path");

const RESPONSIVE_PATCH_ID = "codex-autofix-responsive-patch";
const RESPONSIVE_PATCH_CSS = [
  "html, body { max-width: 100% !important; overflow-x: hidden !important; }",
  "body, p, li, td, th, blockquote, pre, code { overflow-wrap: anywhere !important; word-break: break-word !important; }",
  "img, svg, video, canvas { max-width: 100% !important; height: auto !important; }",
  "table { display: block !important; width: 100% !important; max-width: 100% !important; overflow-x: auto !important; box-sizing: border-box !important; }",
  "pre, code { white-space: pre-wrap !important; }",
  "h1, h2, h3, h4, h5, h6, label, legend, header, section, article, nav, aside, figure { position: static !important; float: none !important; z-index: auto !important; left: auto !important; top: auto !important; right: auto !important; bottom: auto !important; }",
  "body * { min-width: 0 !important; box-sizing: border-box !important; }",
  // — Spacing rules to prevent title/logo and element overlap —
  "h1, h2, h3, h4, h5, h6 { margin-top: 0.8em !important; margin-bottom: 0.5em !important; clear: both !important; }",
  "figure, header, section { margin-top: 0.5em !important; margin-bottom: 0.5em !important; clear: both !important; }",
  "figure img, header img, section img { display: block !important; margin: 0.5em auto !important; clear: both !important; }",
  "h1 + img, h1 + figure, img + h1, figure + h1, h2 + img, h2 + figure, img + h2, figure + h2 { margin-top: 1em !important; }",
  "h1 + p, h2 + p, h3 + p { margin-top: 0.5em !important; }",
].join("\n");

function readHtml(filePath) {
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

function mergeStyleDeclarations(styleValue, additions = {}) {
  const entries = new Map();
  String(styleValue || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const colonIndex = part.indexOf(":");
      if (colonIndex === -1) {
        return;
      }
      const property = part.slice(0, colonIndex).trim().toLowerCase();
      const value = part.slice(colonIndex + 1).trim();
      if (property && value) {
        entries.set(property, value);
      }
    });

  Object.entries(additions).forEach(([property, value]) => {
    if (!entries.has(property)) {
      entries.set(property, value);
    }
  });

  return Array.from(entries.entries())
    .map(([property, value]) => `${property}: ${value}`)
    .join("; ");
}

function injectIntoHead(html, block) {
  if (html.includes(RESPONSIVE_PATCH_ID)) {
    return html;
  }

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${block}\n</head>`);
  }

  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b([^>]*)>/i, `<head$1>\n${block}`);
  }

  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(/<html\b([^>]*)>/i, `<html$1><head>\n${block}\n</head>`);
  }

  return `${block}\n${html}`;
}

function buildStylesheetHref(htmlFile, cssFile) {
  const htmlDir = path.dirname(htmlFile);
  return path.relative(htmlDir, cssFile).replace(/\\/g, "/");
}

function buildAssetHref(htmlFile, assetFile) {
  const htmlDir = path.dirname(htmlFile);
  return path.relative(htmlDir, assetFile).replace(/\\/g, "/");
}

function chooseStylesheetForHtml(tempDir, htmlFile, cssFiles = []) {
  if (!cssFiles.length) {
    return "";
  }

  const htmlRel = path.relative(tempDir, htmlFile).replace(/\\/g, "/");
  const sameFolder = cssFiles.find((cssFile) => path.dirname(cssFile) === path.dirname(htmlRel));
  return sameFolder || cssFiles[0];
}

function chooseAssetForHtml(tempDir, htmlFile, assetFiles = []) {
  if (!assetFiles.length) {
    return "";
  }

  const htmlRel = path.relative(tempDir, htmlFile).replace(/\\/g, "/");
  const sameFolder = assetFiles.find((assetFile) => path.dirname(assetFile) === path.dirname(htmlRel));
  return sameFolder || assetFiles[0];
}

function fixHtmlLang(tempDir, htmlFiles) {
  let fixed = 0;
  htmlFiles.forEach((file) => {
    const filePath = path.join(tempDir, file);
    const before = readHtml(filePath);
    if (before === null) {
      return;
    }

    const after = before.replace(
      /(<html\b(?![^>]*\blang\s*=)[^>]*)(>)/gi,
      '$1 lang="en"$2'
    );

    if (writeIfChanged(filePath, before, after)) {
      fixed += 1;
    }
  });
  return fixed;
}

function fixMissingAlt(tempDir, htmlFiles) {
  let fixed = 0;
  htmlFiles.forEach((file) => {
    const filePath = path.join(tempDir, file);
    const before = readHtml(filePath);
    if (before === null) {
      return;
    }

    const after = before.replace(
      /(<img\b(?![^>]*\balt\s*=)[^>]*)(\/?>)/gi,
      '$1 alt=""$2'
    );

    if (writeIfChanged(filePath, before, after)) {
      fixed += 1;
    }
  });
  return fixed;
}

function fixEmptyLinks(tempDir, htmlFiles) {
  let fixed = 0;
  htmlFiles.forEach((file) => {
    const filePath = path.join(tempDir, file);
    const before = readHtml(filePath);
    if (before === null) {
      return;
    }

    const after = before.replace(
      /(<a\b(?![^>]*\baria-label\s*=)[^>]*>)([\s\u00A0]*)(<\/a>)/gi,
      (match, open, content, close) => {
        if (String(content || "").trim() === "") {
          return `${open}&nbsp;${close}`;
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

function fixMediaControls(tempDir, htmlFiles) {
  let fixed = 0;
  htmlFiles.forEach((file) => {
    const filePath = path.join(tempDir, file);
    const before = readHtml(filePath);
    if (before === null) {
      return;
    }

    let after = before.replace(
      /(<audio\b(?![^>]*\bcontrols\b)[^>]*)(\/?>)/gi,
      "$1 controls$2"
    );
    after = after.replace(
      /(<video\b(?![^>]*\bcontrols\b)[^>]*)(\/?>)/gi,
      "$1 controls$2"
    );

    if (writeIfChanged(filePath, before, after)) {
      fixed += 1;
    }
  });
  return fixed;
}

function fixHeadingHierarchy(tempDir, htmlFiles) {
  let fixed = 0;
  htmlFiles.forEach((file) => {
    const filePath = path.join(tempDir, file);
    const before = readHtml(filePath);
    if (before === null) {
      return;
    }

    const levels = new Set();
    (before.match(/<h([1-6])\b/gi) || []).forEach((match) => {
      levels.add(parseInt(match.slice(2), 10));
    });

    const sorted = Array.from(levels).sort((left, right) => left - right);
    const hasSkip = sorted.some((level, index) => index > 0 && level !== sorted[index - 1] + 1);
    if (!hasSkip) {
      return;
    }

    const remap = {};
    sorted.forEach((level, index) => {
      remap[level] = index + 1;
    });

    const after = before.replace(/<(\/?)h([1-6])(\b[^>]*)?>/gi, (match, slash, level, attrs) => {
      const mapped = remap[parseInt(level, 10)] || parseInt(level, 10);
      return `<${slash}h${mapped}${attrs || ""}>`;
    });

    if (writeIfChanged(filePath, before, after)) {
      fixed += 1;
    }
  });
  return fixed;
}

function fixImagesNoSrc(tempDir, htmlFiles) {
  let fixed = 0;
  htmlFiles.forEach((file) => {
    const filePath = path.join(tempDir, file);
    const before = readHtml(filePath);
    if (before === null) {
      return;
    }

    let after = before.replace(/<img\b(?![^>]*\bsrc\s*=)[^>]*\/>/gi, "");
    after = after.replace(/<img\b(?![^>]*\bsrc\s*=)[^>]*>/gi, "");

    if (writeIfChanged(filePath, before, after)) {
      fixed += 1;
    }
  });
  return fixed;
}

function fixMissingStylesheetLinks(tempDir, htmlFiles, cssFiles = []) {
  let fixed = 0;
  htmlFiles.forEach((file) => {
    const filePath = path.join(tempDir, file);
    const before = readHtml(filePath);
    if (before === null || /<link\b[^>]*rel\s*=\s*["'][^"']*stylesheet/i.test(before)) {
      return;
    }

    const cssRel = chooseStylesheetForHtml(tempDir, filePath, cssFiles);
    if (!cssRel) {
      return;
    }

    const cssAbs = path.join(tempDir, cssRel);
    const href = buildStylesheetHref(filePath, cssAbs);
    const linkTag = `<link rel="stylesheet" type="text/css" href="${href}" />`;
    const after = injectIntoHead(before, linkTag);

    if (writeIfChanged(filePath, before, after)) {
      fixed += 1;
    }
  });
  return fixed;
}

function fixBrokenStylesheetLinks(tempDir, htmlFiles, cssFiles = []) {
  const basenameMap = new Map();
  cssFiles.forEach((cssRel) => {
    const key = path.basename(cssRel).toLowerCase();
    if (!basenameMap.has(key)) {
      basenameMap.set(key, []);
    }
    basenameMap.get(key).push(cssRel);
  });

  let fixed = 0;
  htmlFiles.forEach((file) => {
    const filePath = path.join(tempDir, file);
    const before = readHtml(filePath);
    if (before === null) {
      return;
    }

    let changed = false;
    const after = before.replace(
      /(<link\b[^>]*rel\s*=\s*["'][^"']*stylesheet[^"']*["'][^>]*href\s*=\s*["'])([^"']+)(["'][^>]*\/?>)/gi,
      (match, prefix, href, suffix) => {
        if (/^(?:https?:|data:)/i.test(href)) {
          return match;
        }

        const resolved = path.normalize(path.join(path.dirname(filePath), href.split("#")[0]));
        if (fs.existsSync(resolved)) {
          return match;
        }

        const basenameCandidates = basenameMap.get(path.basename(href).toLowerCase()) || [];
        const candidates =
          basenameCandidates.length === 1
            ? basenameCandidates
            : cssFiles.length === 1
              ? [cssFiles[0]]
              : [];
        if (candidates.length !== 1) {
          return match;
        }

        changed = true;
        const repairedHref = buildStylesheetHref(filePath, path.join(tempDir, candidates[0]));
        return `${prefix}${repairedHref}${suffix}`;
      }
    );

    if (changed && writeIfChanged(filePath, before, after)) {
      fixed += 1;
    }
  });
  return fixed;
}

function fixBrokenScriptLinks(tempDir, htmlFiles, jsFiles = []) {
  const basenameMap = new Map();
  jsFiles.forEach((jsRel) => {
    const key = path.basename(jsRel).toLowerCase();
    if (!basenameMap.has(key)) {
      basenameMap.set(key, []);
    }
    basenameMap.get(key).push(jsRel);
  });

  let fixed = 0;
  htmlFiles.forEach((file) => {
    const filePath = path.join(tempDir, file);
    const before = readHtml(filePath);
    if (before === null) {
      return;
    }

    let changed = false;
    const after = before.replace(
      /(<script\b[^>]*src\s*=\s*["'])([^"']+)(["'][^>]*>\s*<\/script>)/gi,
      (match, prefix, src, suffix) => {
        if (/^(?:https?:|data:|javascript:)/i.test(src)) {
          return match;
        }

        const resolved = path.normalize(path.join(path.dirname(filePath), src.split("#")[0]));
        if (fs.existsSync(resolved)) {
          return match;
        }

        const basenameCandidates = basenameMap.get(path.basename(src).toLowerCase()) || [];
        const candidates =
          basenameCandidates.length === 1
            ? basenameCandidates
            : jsFiles.length === 1
              ? [jsFiles[0]]
              : [];

        if (candidates.length !== 1) {
          return match;
        }

        changed = true;
        const repairedSrc = buildAssetHref(filePath, path.join(tempDir, candidates[0]));
        return `${prefix}${repairedSrc}${suffix}`;
      }
    );

    if (changed && writeIfChanged(filePath, before, after)) {
      fixed += 1;
    }
  });

  return fixed;
}

function applyResponsiveHtmlPatch(tempDir, htmlFiles) {
  let fixed = 0;
  const block = `<style type="text/css" id="${RESPONSIVE_PATCH_ID}">\n${RESPONSIVE_PATCH_CSS}\n</style>`;

  htmlFiles.forEach((file) => {
    const filePath = path.join(tempDir, file);
    const before = readHtml(filePath);
    if (before === null || before.includes(RESPONSIVE_PATCH_ID)) {
      return;
    }

    const after = injectIntoHead(before, block);
    if (writeIfChanged(filePath, before, after)) {
      fixed += 1;
    }
  });

  return fixed;
}

function fixResponsiveTables(tempDir, htmlFiles) {
  let fixed = 0;
  htmlFiles.forEach((file) => {
    const filePath = path.join(tempDir, file);
    const before = readHtml(filePath);
    if (before === null) {
      return;
    }

    const after = before.replace(/<table\b([^>]*)>/gi, (match, attrs) => {
      const withoutWidthAttr = String(attrs || "").replace(/\swidth\s*=\s*["'][^"']*["']/gi, "");
      const styleMatch = withoutWidthAttr.match(/\sstyle\s*=\s*(["'])(.*?)\1/i);
      const mergedStyle = mergeStyleDeclarations(styleMatch?.[2] || "", {
        "width": "100%",
        "max-width": "100%",
        "display": "block",
        "overflow-x": "auto",
        "box-sizing": "border-box",
      });

      let nextAttrs = withoutWidthAttr;
      if (styleMatch) {
        nextAttrs = nextAttrs.replace(styleMatch[0], ` style="${mergedStyle}"`);
      } else {
        nextAttrs = `${nextAttrs} style="${mergedStyle}"`;
      }

      return `<table${nextAttrs}>`;
    });

    if (writeIfChanged(filePath, before, after)) {
      fixed += 1;
    }
  });
  return fixed;
}

function fixResponsiveImages(tempDir, htmlFiles) {
  let fixed = 0;
  htmlFiles.forEach((file) => {
    const filePath = path.join(tempDir, file);
    const before = readHtml(filePath);
    if (before === null) {
      return;
    }

    const after = before.replace(/<img\b([^>]*?)\/?>/gi, (match, attrs) => {
      const styleMatch = String(attrs || "").match(/\sstyle\s*=\s*(["'])(.*?)\1/i);
      const mergedStyle = mergeStyleDeclarations(styleMatch?.[2] || "", {
        "max-width": "100%",
        "height": "auto",
      });

      let nextAttrs = String(attrs || "");
      if (styleMatch) {
        nextAttrs = nextAttrs.replace(styleMatch[0], ` style="${mergedStyle}"`);
      } else {
        nextAttrs = `${nextAttrs} style="${mergedStyle}"`;
      }

      return match.endsWith("/>") ? `<img${nextAttrs}/>` : `<img${nextAttrs}>`;
    });

    if (writeIfChanged(filePath, before, after)) {
      fixed += 1;
    }
  });
  return fixed;
}

module.exports = {
  applyResponsiveHtmlPatch,
  buildAssetHref,
  fixBrokenStylesheetLinks,
  fixBrokenScriptLinks,
  fixEmptyLinks,
  fixHeadingHierarchy,
  fixHtmlLang,
  fixImagesNoSrc,
  fixMediaControls,
  fixMissingAlt,
  fixMissingStylesheetLinks,
  fixResponsiveImages,
  fixResponsiveTables,
};

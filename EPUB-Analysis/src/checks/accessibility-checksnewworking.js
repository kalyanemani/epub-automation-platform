// EPUB Accessibility validation based on W3C and EPUB Accessibility 1.1 standards
// Checks metadata, semantic structure, ARIA roles, and content accessibility

const fs = require('fs');
const path = require('path');
const glob = require('glob');
const { detectEpubContext } = require("../utils/epub-context");

function hasHtmlLang(html) {
  return /<html[^>]+lang=["'][^"']+["']/i.test(html);
}

function findImagesWithoutAlt(html) {
  const regex = /<img([^>]+)>/gi;
  let m, issues = [];
  while ((m = regex.exec(html))) {
    const attrs = m[1];
    if (!/alt\s*=\s*["']/.test(attrs)) {
      // Extract src for detailed reporting
      const srcMatch = attrs.match(/src\s*=\s*["']([^"']+)["']/i);
      issues.push({
        tag: m[0],
        src: srcMatch ? srcMatch[1] : 'unknown'
      });
    }
  }
  return issues;
}

function findLinksWithoutText(html) {
  const regex = /<a([^>]+)>(.*?)<\/a>/gis;
  let m, count = 0;
  while ((m = regex.exec(html))) {
    const attrs = m[1];
    const text = m[2].trim();
    const hasAria = /aria-label|aria-labelledby|title=/.test(attrs);
    if (!text && !hasAria) count++;
  }
  return count;
}

function findHeadingStructure(html) {
  const headings = [];
  const regex = /<h([1-6])[^>]*>(.*?)<\/h\1>/gi;
  let m;
  while ((m = regex.exec(html))) {
    headings.push({
      level: parseInt(m[1]),
      text: m[2].replace(/<[^>]+>/g, '').trim()
    });
  }
  return headings;
}

function checkHeadingSequence(headings) {
  const issues = [];
  for (let i = 1; i < headings.length; i++) {
    const prev = headings[i - 1].level;
    const curr = headings[i].level;
    // Allow h1 to h2, h2 to h3, etc. or same level
    // Flag if skips levels (h1 to h3, h2 to h4, etc.)
    if (curr > prev + 1) {
      issues.push({
        from: `h${prev}`,
        to: `h${curr}`,
        text: headings[i].text
      });
    }
  }
  return issues;
}

function hasTableHeaders(html) {
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let m, issues = [];
  while ((m = tableRegex.exec(html))) {
    const tableContent = m[1];
    const hasTh = /<th[\s>]/i.test(tableContent);
    const hasScope = /scope\s*=\s*["'](row|col|rowgroup|colgroup)["']/i.test(tableContent);
    const hasHeaders = /headers\s*=\s*["'][^"']+["']/i.test(tableContent);
    
    if (!hasTh && !hasScope && !hasHeaders) {
      issues.push('table without headers/scope attributes');
    }
  }
  return issues;
}

function checkListStructure(html) {
  // Check for proper list nesting (ul/ol > li)
  const issues = [];
  
  // Find lists without li children
  const listRegex = /<(ul|ol)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = listRegex.exec(html))) {
    const listContent = m[2];
    const hasLi = /<li[\s>]/i.test(listContent);
    if (!hasLi) {
      issues.push(`Empty ${m[1]} list`);
    }
  }
  
  return issues;
}

function findLandmarks(html) {
  const landmarks = {
    main: /<main[\s>]/i.test(html) || /role\s*=\s*["']main["']/i.test(html),
    nav: /<nav[\s>]/i.test(html) || /role\s*=\s*["']navigation["']/i.test(html),
    aside: /<aside[\s>]/i.test(html) || /role\s*=\s*["']complementary["']/i.test(html),
    footer: /<footer[\s>]/i.test(html) || /role\s*=\s*["']contentinfo["']/i.test(html),
    header: /<header[\s>]/i.test(html) || /role\s*=\s*["']banner["']/i.test(html)
  };
  return landmarks;
}

function checkAriaRoles(html) {
  const issues = [];
  
  // Find invalid ARIA roles
  const roleRegex = /role\s*=\s*["']([^"']+)["']/gi;
  const validRoles = [
    'alert', 'alertdialog', 'application', 'article', 'banner', 'button',
    'cell', 'checkbox', 'columnheader', 'combobox', 'complementary',
    'contentinfo', 'definition', 'dialog', 'directory', 'document',
    'feed', 'figure', 'form', 'grid', 'gridcell', 'group', 'heading',
    'img', 'link', 'list', 'listbox', 'listitem', 'log', 'main',
    'marquee', 'math', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox',
    'menuitemradio', 'navigation', 'none', 'note', 'option', 'presentation',
    'progressbar', 'radio', 'radiogroup', 'region', 'row', 'rowgroup',
    'rowheader', 'scrollbar', 'search', 'searchbox', 'separator', 'slider',
    'spinbutton', 'status', 'switch', 'tab', 'table', 'tablist', 'tabpanel',
    'term', 'textbox', 'timer', 'toolbar', 'tooltip', 'tree', 'treegrid',
    'treeitem',
    // EPUB-specific
    'doc-abstract', 'doc-acknowledgments', 'doc-afterword', 'doc-appendix',
    'doc-backlink', 'doc-biblioentry', 'doc-bibliography', 'doc-biblioref',
    'doc-chapter', 'doc-colophon', 'doc-conclusion', 'doc-cover',
    'doc-credit', 'doc-credits', 'doc-dedication', 'doc-endnote',
    'doc-endnotes', 'doc-epigraph', 'doc-epilogue', 'doc-errata',
    'doc-example', 'doc-footnote', 'doc-foreword', 'doc-glossary',
    'doc-glossref', 'doc-index', 'doc-introduction', 'doc-noteref',
    'doc-notice', 'doc-pagebreak', 'doc-pagelist', 'doc-part',
    'doc-preface', 'doc-prologue', 'doc-pullquote', 'doc-qna',
    'doc-subtitle', 'doc-tip', 'doc-toc'
  ];
  
  let m;
  while ((m = roleRegex.exec(html))) {
    const role = m[1].toLowerCase();
    if (!validRoles.includes(role)) {
      issues.push(`Invalid ARIA role: "${role}"`);
    }
  }
  
  return issues;
}

function checkEpubType(html) {
  const issues = [];
  
  // Check for deprecated epub:type values
  const epubTypeRegex = /epub:type\s*=\s*["']([^"']+)["']/gi;
  const validEpubTypes = [
    'abstract', 'acknowledgments', 'afterword', 'appendix', 'assessment',
    'assessments', 'backmatter', 'bibliography', 'biblioref', 'bodymatter',
    'chapter', 'colophon', 'conclusion', 'contributors', 'copyright-page',
    'cover', 'credits', 'dedication', 'division', 'endnote', 'endnotes',
    'epigraph', 'epilogue', 'errata', 'footnote', 'footnotes', 'foreword',
    'frontmatter', 'glossary', 'glossref', 'glossterm', 'halftitlepage',
    'imprint', 'imprimatur', 'index', 'index-term', 'index-editor-note',
    'index-headnotes', 'index-legend', 'introduction', 'landmarks',
    'list', 'list-item', 'loa', 'loi', 'lot', 'lov', 'noteref', 'notice',
    'other-credits', 'page-list', 'part', 'preamble', 'preface', 'prologue',
    'pullquote', 'qna', 'referrer', 'revision-history', 'seriespage',
    'subchapter', 'subtitle', 'table', 'table-row', 'table-cell',
    'titlepage', 'toc', 'toc-brief', 'volume'
  ];
  
  let m;
  while ((m = epubTypeRegex.exec(html))) {
    const types = m[1].split(/\s+/);
    types.forEach(type => {
      if (!validEpubTypes.includes(type.toLowerCase())) {
        issues.push(`Unknown epub:type: "${type}"`);
      }
    });
  }
  
  return issues;
}

function checkPageBreaks(html) {
  // Check if page breaks have proper ARIA and epub:type
  const pageBreakRegex = /<[^>]+epub:type\s*=\s*["'][^"']*pagebreak[^"']*["'][^>]*>/gi;
  const issues = [];
  let m;
  
  while ((m = pageBreakRegex.exec(html))) {
    const tag = m[0];
    const hasAriaLabel = /aria-label\s*=\s*["'][^"']+["']/i.test(tag);
    const hasTitle = /title\s*=\s*["'][^"']+["']/i.test(tag);
    
    if (!hasAriaLabel && !hasTitle) {
      issues.push('Page break without aria-label or title');
    }
  }
  
  return issues;
}

async function runAccessibilityChecks({ tempDir, opfAbsolute, opfXml }) {
  const results = [];
  const files = glob.sync('**/*.{xhtml,html}', { cwd: tempDir, nodir: true });
  
  const { isEpub3, isAccessibilityEPUB } = detectEpubContext(opfXml);
  console.log("➡ Accessibility context:", { isEpub3, isAccessibilityEPUB });

  function hasSchemaMeta(metas, prop) {
    return metas.some(m =>
      m['@_property'] === prop ||
      m['@_property'] === prop.replace('schema:', '') ||
      m['@_name'] === prop ||
      m['@_name'] === prop.replace('schema:', '')
    );
  }

  /* ======================================================
     OPF ACCESSIBILITY METADATA (ACE-aligned)
  ====================================================== */
  const meta = opfXml?.package?.metadata?.meta || [];
  const metas = Array.isArray(meta) ? meta : [meta];

  const requiredSchemaMeta = [
    "schema:accessMode",
    "schema:accessibilityFeature",
    "schema:accessibilityHazard"
  ];

  requiredSchemaMeta.forEach(prop => {
    if (!hasSchemaMeta(metas, prop)) {
      results.push({
        id: `A_${prop.toUpperCase().replace(/[:]/g, "_")}_MISSING`,
        title: `Missing ${prop}`,
        status: "fail",
        details: `OPF metadata does not declare ${prop}`,
        suggestion: `Add <meta property="${prop}">…</meta> in OPF metadata`,
        autofix: { action: 'addAccessibilityMeta', property: prop }
      });
    } else {
      results.push({
        id: `A_${prop.toUpperCase().replace(/[:]/g, "_")}_PRESENT`,
        title: `${prop} present`,
        status: "pass",
        details: `${prop} declared in OPF`
      });
    }
  });

  // Check for accessModeSufficient (recommended)
  if (!hasSchemaMeta(metas, 'schema:accessModeSufficient')) {
    results.push({
      id: 'A_SCHEMA_ACCESSMODESUFFICIENT_MISSING',
      title: 'Missing schema:accessModeSufficient',
      status: 'warn',
      details: 'Recommended accessibility metadata not declared',
      suggestion: 'Add <meta property="schema:accessModeSufficient">textual</meta>',
      autofix: { action: 'addAccessibilityMeta', property: 'schema:accessModeSufficient', value: 'textual' }
    });
  }

  // Check for accessibilitySummary (recommended)
  if (!hasSchemaMeta(metas, 'schema:accessibilitySummary')) {
    results.push({
      id: 'A_SCHEMA_ACCESSIBILITYSUMMARY_MISSING',
      title: 'Missing schema:accessibilitySummary',
      status: 'warn',
      details: 'Human-readable accessibility summary not provided',
      suggestion: 'Add <meta property="schema:accessibilitySummary">Description of accessibility features</meta>',
      autofix: { action: 'addAccessibilityMeta', property: 'schema:accessibilitySummary', value: 'This publication has been evaluated for accessibility.' }
    });
  }

  /* ======================================================
     HTML lang ATTRIBUTE CHECK
  ====================================================== */
  let htmlLangMissing = 0;
  const filesWithoutLang = [];

  for (const f of files) {
    const html = fs.readFileSync(path.join(tempDir, f), 'utf8');
    if (!hasHtmlLang(html)) {
      htmlLangMissing++;
      filesWithoutLang.push(f);
    }
  }

  if (htmlLangMissing > 0) {
    results.push({
      id: "A_HTML_LANG_MISSING",
      title: "<html> missing lang attribute",
      status: "fail",
      details: `${htmlLangMissing} XHTML files missing lang attribute: ${filesWithoutLang.slice(0, 5).join(', ')}`,
      suggestion: "Add lang attribute to <html> tag (e.g., <html lang=\"en\">)",
      autofix: { action: 'addHtmlLang', files: filesWithoutLang }
    });
  } else {
    results.push({
      id: "A_HTML_LANG_OK",
      title: "HTML lang attributes present",
      status: "pass",
      details: `All ${files.length} files have lang attribute`
    });
  }

  /* ======================================================
     IMAGE ALT TEXT CHECK
  ====================================================== */
  let totalImagesWithoutAlt = 0;
  const imageIssuesByFile = {};

  for (const f of files) {
    const html = fs.readFileSync(path.join(tempDir, f), 'utf8');
    const issues = findImagesWithoutAlt(html);
    if (issues.length > 0) {
      totalImagesWithoutAlt += issues.length;
      imageIssuesByFile[f] = issues;
    }
  }

  if (totalImagesWithoutAlt > 0) {
    const fileList = Object.keys(imageIssuesByFile).slice(0, 5);
    results.push({
      id: "A_IMAGE_ALT_MISSING",
      title: "Images missing alt text",
      status: "fail",
      details: `${totalImagesWithoutAlt} images without alt attribute in ${Object.keys(imageIssuesByFile).length} files: ${fileList.join(', ')}`,
      suggestion: "Add descriptive alt text to all images",
      imageIssues: imageIssuesByFile,
      autofix: { action: 'addImageAlt', files: imageIssuesByFile }
    });
  } else {
    results.push({
      id: "A_IMAGE_ALT_OK",
      title: "Image alt text present",
      status: "pass",
      details: "All images have alt attributes"
    });
  }

  /* ======================================================
     LINK ACCESSIBLE TEXT CHECK
  ====================================================== */
  let badLinks = 0;
  const linksFileList = [];

  for (const f of files) {
    const html = fs.readFileSync(path.join(tempDir, f), 'utf8');
    const count = findLinksWithoutText(html);
    if (count > 0) {
      badLinks += count;
      linksFileList.push(f);
    }
  }

  if (badLinks > 0) {
    results.push({
      id: "A_LINK_TEXT_MISSING",
      title: "Links without accessible text",
      status: "fail",
      details: `${badLinks} links lack discernible text in ${linksFileList.length} files: ${linksFileList.slice(0, 5).join(', ')}`,
      suggestion: "Add text content or aria-label to all links",
      autofix: { action: 'addLinkText', files: linksFileList }
    });
  } else {
    results.push({
      id: "A_LINK_TEXT_OK",
      title: "Link text present",
      status: "pass",
      details: "All links have accessible text"
    });
  }

  /* ======================================================
     HEADING STRUCTURE CHECK
  ====================================================== */
  let headingSkipIssues = [];
  let filesWithBadHeadings = [];

  for (const f of files) {
    const html = fs.readFileSync(path.join(tempDir, f), 'utf8');
    const headings = findHeadingStructure(html);
    if (headings.length > 0) {
      const issues = checkHeadingSequence(headings);
      if (issues.length > 0) {
        headingSkipIssues.push(...issues);
        filesWithBadHeadings.push(f);
      }
    }
  }

  if (headingSkipIssues.length > 0) {
    results.push({
      id: "A_HEADING_SEQUENCE",
      title: "Heading levels skip ranks",
      status: "fail",
      details: `${headingSkipIssues.length} heading sequence issues in ${filesWithBadHeadings.length} files (e.g., ${headingSkipIssues[0].from} → ${headingSkipIssues[0].to})`,
      suggestion: "Use sequential heading levels (h1→h2→h3, not h1→h3)",
      autofix: { action: 'fixHeadingSequence', issues: headingSkipIssues, files: filesWithBadHeadings }
    });
  } else {
    results.push({
      id: "A_HEADING_SEQUENCE_OK",
      title: "Heading structure correct",
      status: "pass",
      details: "Heading levels follow proper sequence"
    });
  }

  /* ======================================================
     TABLE ACCESSIBILITY CHECK
  ====================================================== */
  let tableIssues = [];
  let filesWithBadTables = [];

  for (const f of files) {
    const html = fs.readFileSync(path.join(tempDir, f), 'utf8');
    const issues = hasTableHeaders(html);
    if (issues.length > 0) {
      tableIssues.push(...issues);
      filesWithBadTables.push(f);
    }
  }

  if (tableIssues.length > 0) {
    results.push({
      id: "A_TABLE_HEADERS_MISSING",
      title: "Tables without proper headers",
      status: "fail",
      details: `${tableIssues.length} tables missing <th>, scope, or headers attributes in ${filesWithBadTables.length} files`,
      suggestion: "Add <th> elements or scope attributes to table headers",
      autofix: { action: 'addTableHeaders', files: filesWithBadTables }
    });
  }

  /* ======================================================
     LIST STRUCTURE CHECK
  ====================================================== */
  let listIssues = [];
  let filesWithBadLists = [];

  for (const f of files) {
    const html = fs.readFileSync(path.join(tempDir, f), 'utf8');
    const issues = checkListStructure(html);
    if (issues.length > 0) {
      listIssues.push(...issues);
      filesWithBadLists.push(f);
    }
  }

  if (listIssues.length > 0) {
    results.push({
      id: "A_LIST_STRUCTURE",
      title: "Improper list structure",
      status: "fail",
      details: `${listIssues.length} list structure issues in ${filesWithBadLists.length} files`,
      suggestion: "Ensure lists contain <li> elements",
      autofix: { action: 'fixListStructure', files: filesWithBadLists }
    });
  }

  /* ======================================================
     LANDMARKS CHECK (ARIA/HTML5)
  ====================================================== */
  let filesWithLandmarks = 0;
  let filesWithoutLandmarks = [];

  for (const f of files) {
    const html = fs.readFileSync(path.join(tempDir, f), 'utf8');
    const landmarks = findLandmarks(html);
    
    // File should have at least main or nav landmark (for content files)
    const hasRelevantLandmark = landmarks.main || landmarks.nav;
    if (hasRelevantLandmark) {
      filesWithLandmarks++;
    } else {
      filesWithoutLandmarks.push(f);
    }
  }

  if (filesWithoutLandmarks.length > 0) {
    results.push({
      id: "A_LANDMARKS_MISSING",
      title: "Missing ARIA landmarks",
      status: "warn",
      details: `${filesWithoutLandmarks.length} files missing landmarks (main/nav): ${filesWithoutLandmarks.slice(0, 5).join(', ')}`,
      suggestion: "Add semantic HTML5 elements (<main>, <nav>) or ARIA roles",
      autofix: { action: 'addLandmarks', files: filesWithoutLandmarks }
    });
  } else {
    results.push({
      id: "A_LANDMARKS_OK",
      title: "Landmarks present",
      status: "pass",
      details: `All ${files.length} content files have appropriate landmarks`
    });
  }

  /* ======================================================
     ARIA ROLES VALIDATION
  ====================================================== */
  let invalidAriaRoles = [];
  let filesWithBadRoles = [];

  for (const f of files) {
    const html = fs.readFileSync(path.join(tempDir, f), 'utf8');
    const issues = checkAriaRoles(html);
    if (issues.length > 0) {
      invalidAriaRoles.push(...issues);
      filesWithBadRoles.push(f);
    }
  }

  if (invalidAriaRoles.length > 0) {
    results.push({
      id: "A_ARIA_ROLES_INVALID",
      title: "Invalid ARIA roles",
      status: "fail",
      details: `${invalidAriaRoles.length} invalid ARIA roles in ${filesWithBadRoles.length} files: ${invalidAriaRoles.slice(0, 3).join(', ')}`,
      suggestion: "Use valid ARIA roles from WAI-ARIA specification",
      autofix: { action: 'fixAriaRoles', issues: invalidAriaRoles, files: filesWithBadRoles }
    });
  } else {
    results.push({
      id: "A_ARIA_ROLES_OK",
      title: "ARIA roles valid",
      status: "pass",
      details: "All ARIA roles are valid"
    });
  }

  /* ======================================================
     EPUB:TYPE VALIDATION
  ====================================================== */
  let invalidEpubTypes = [];
  let filesWithBadEpubTypes = [];

  for (const f of files) {
    const html = fs.readFileSync(path.join(tempDir, f), 'utf8');
    const issues = checkEpubType(html);
    if (issues.length > 0) {
      invalidEpubTypes.push(...issues);
      filesWithBadEpubTypes.push(f);
    }
  }

  if (invalidEpubTypes.length > 0) {
    results.push({
      id: "A_EPUB_TYPE_INVALID",
      title: "Invalid epub:type values",
      status: "warn",
      details: `${invalidEpubTypes.length} invalid epub:type values in ${filesWithBadEpubTypes.length} files: ${invalidEpubTypes.slice(0, 3).join(', ')}`,
      suggestion: "Use valid epub:type values from EPUB 3 Structural Semantics Vocabulary"
    });
  }

  /* ======================================================
     PAGE BREAKS CHECK
  ====================================================== */
  let pageBreakIssues = [];
  let filesWithBadPageBreaks = [];

  for (const f of files) {
    const html = fs.readFileSync(path.join(tempDir, f), 'utf8');
    const issues = checkPageBreaks(html);
    if (issues.length > 0) {
      pageBreakIssues.push(...issues);
      filesWithBadPageBreaks.push(f);
    }
  }

  if (pageBreakIssues.length > 0) {
    results.push({
      id: "A_PAGEBREAK_LABELS",
      title: "Page breaks without labels",
      status: "warn",
      details: `${pageBreakIssues.length} page breaks missing aria-label in ${filesWithBadPageBreaks.length} files`,
      suggestion: "Add aria-label or title to page break elements",
      autofix: { action: 'addPageBreakLabels', files: filesWithBadPageBreaks }
    });
  }

  /* ======================================================
     MANUAL REVIEW REMINDER
  ====================================================== */
  results.push({
    id: 'A_MANUAL',
    title: 'Manual accessibility review required',
    status: 'warn',
    details: 'Color contrast and screen reader experience require rendering-based tests',
    suggestion: 'Integrate Playwright + axe-core for deep automated checks'
  });

  return results;
}

module.exports = { runAccessibilityChecks };
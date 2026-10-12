// checks/accessibility-checks.js
// Comprehensive EPUB accessibility validation
// Covers WCAG 2.1 Level AA and EPUB Accessibility 1.1 specifications

const fs = require('fs');
const path = require('path');
const glob = require('glob');

/* ======================================================
   HELPER FUNCTIONS
====================================================== */

function hasHtmlLang(html) {
  return /<html[^>]+lang=["'][^"']+["']/i.test(html);
}

function getHtmlLang(html) {
  const match = html.match(/<html[^>]+lang=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

function hasXmlLang(html) {
  return /<html[^>]+xml:lang=["'][^"']+["']/i.test(html);
}

function findImagesWithoutAlt(html, filename) {
  const images = [];
  const regex = /<img([^>]+)>/gi;
  let m;
  while ((m = regex.exec(html))) {
    const attrs = m[1];
    const srcMatch = attrs.match(/src=["']([^"']+)["']/);
    const hasAlt = /alt\s*=\s*["']/.test(attrs);
    const hasAriaLabel = /aria-label\s*=\s*["']/.test(attrs);
    const hasAriaLabelledby = /aria-labelledby\s*=\s*["']/.test(attrs);
    const rolePresentation = /role\s*=\s*["']presentation["']/.test(attrs);
    const roleNone = /role\s*=\s*["']none["']/.test(attrs);
    
    if (!hasAlt && !hasAriaLabel && !hasAriaLabelledby && !rolePresentation && !roleNone) {
      images.push({
        file: filename,
        src: srcMatch ? srcMatch[1] : 'unknown',
        issue: 'missing alt attribute'
      });
    }
  }
  return images;
}

function findLinksWithoutText(html, filename) {
  const links = [];
  const regex = /<a([^>]+)>(.*?)<\/a>/gis;
  let m;
  while ((m = regex.exec(html))) {
    const attrs = m[1];
    const innerContent = m[2].trim();
    
    // Remove HTML tags from inner content to get text
    const textOnly = innerContent.replace(/<[^>]+>/g, '').trim();
    
    const hasAriaLabel = /aria-label\s*=\s*["']([^"']+)["']/.test(attrs);
    const hasAriaLabelledby = /aria-labelledby\s*=\s*["']/.test(attrs);
    
    // Check if link has image with alt text
    const hasImgWithAlt = /<img[^>]+alt\s*=\s*["']([^"']+)["']/.test(innerContent);
    
    if (!textOnly && !hasAriaLabel && !hasAriaLabelledby && !hasImgWithAlt) {
      const hrefMatch = attrs.match(/href=["']([^"']+)["']/);
      links.push({
        file: filename,
        href: hrefMatch ? hrefMatch[1] : 'unknown',
        issue: 'link has no accessible text'
      });
    }
  }
  return links;
}

function findHeadingStructureIssues(html, filename) {
  const issues = [];
  const headingRegex = /<h([1-6])[^>]*>/gi;
  const headings = [];
  let m;
  
  while ((m = headingRegex.exec(html))) {
    headings.push(parseInt(m[1]));
  }
  
  if (headings.length === 0) {
    return [];
  }
  
  // Check if starts with h1
  if (headings[0] !== 1) {
    issues.push({
      file: filename,
      issue: `heading structure doesn't start with h1 (starts with h${headings[0]})`
    });
  }
  
  // Check for skipped levels
  for (let i = 1; i < headings.length; i++) {
    const jump = headings[i] - headings[i - 1];
    if (jump > 1) {
      issues.push({
        file: filename,
        issue: `skipped heading level: h${headings[i - 1]} → h${headings[i]}`
      });
    }
  }
  
  return issues;
}

function checkTableAccessibility(html, filename) {
  const issues = [];
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let m, tableIndex = 0;
  
  while ((m = tableRegex.exec(html))) {
    tableIndex++;
    const tableContent = m[1];
    const tableTag = m[0];
    
    // Check for caption or summary
    const hasCaption = /<caption[^>]*>/.test(tableContent);
    const hasSummary = /summary\s*=\s*["']([^"']+)["']/.test(tableTag);
    const hasAriaLabel = /aria-label\s*=\s*["']([^"']+)["']/.test(tableTag);
    const hasAriaLabelledby = /aria-labelledby\s*=\s*["']/.test(tableTag);
    
    if (!hasCaption && !hasSummary && !hasAriaLabel && !hasAriaLabelledby) {
      issues.push({
        file: filename,
        table: tableIndex,
        issue: 'table missing caption or accessible label'
      });
    }
    
    // Check for th elements
    if (!/<th[^>]*>/.test(tableContent)) {
      issues.push({
        file: filename,
        table: tableIndex,
        issue: 'table missing header cells (<th>)'
      });
    }
  }
  
  return issues;
}

function checkFormAccessibility(html, filename) {
  const issues = [];
  
  // Check inputs without labels
  const inputRegex = /<input([^>]+)>/gi;
  let m, inputIndex = 0;
  
  while ((m = inputRegex.exec(html))) {
    inputIndex++;
    const attrs = m[1];
    
    const hasId = /id\s*=\s*["']([^"']+)["']/.test(attrs);
    const idMatch = attrs.match(/id\s*=\s*["']([^"']+)["']/);
    const inputId = idMatch ? idMatch[1] : null;
    
    const hasAriaLabel = /aria-label\s*=\s*["']([^"']+)["']/.test(attrs);
    const hasAriaLabelledby = /aria-labelledby\s*=\s*["']/.test(attrs);
    const hasTitle = /title\s*=\s*["']([^"']+)["']/.test(attrs);
    
    // Check if there's a label pointing to this input
    let hasLabel = false;
    if (inputId) {
      const labelRegex = new RegExp(`<label[^>]+for=["']${inputId}["']`, 'i');
      hasLabel = labelRegex.test(html);
    }
    
    if (!hasLabel && !hasAriaLabel && !hasAriaLabelledby && !hasTitle) {
      const typeMatch = attrs.match(/type\s*=\s*["']([^"']+)["']/);
      const inputType = typeMatch ? typeMatch[1] : 'text';
      
      if (inputType !== 'hidden' && inputType !== 'submit' && inputType !== 'button') {
        issues.push({
          file: filename,
          input: inputIndex,
          type: inputType,
          issue: 'form input missing accessible label'
        });
      }
    }
  }
  
  return issues;
}

function checkLandmarks(html, filename) {
  const landmarks = {
    hasMain: /<main[\s>]/i.test(html) || /role\s*=\s*["']main["']/i.test(html),
    hasNav: /<nav[\s>]/i.test(html) || /role\s*=\s*["']navigation["']/i.test(html),
    hasHeader: /<header[\s>]/i.test(html) || /role\s*=\s*["']banner["']/i.test(html),
    hasFooter: /<footer[\s>]/i.test(html) || /role\s*=\s*["']contentinfo["']/i.test(html)
  };
  
  return landmarks;
}

function checkEpubSemantics(html, filename) {
  const hasEpubTypes = /epub:type\s*=\s*["']/i.test(html);
  return hasEpubTypes;
}

function checkPageBreaks(html, filename) {
  // Check for page break markers
  const epubPageBreak = (html.match(/epub:type\s*=\s*["']pagebreak["']/gi) || []).length;
  const roleDocPagebreak = (html.match(/role\s*=\s*["']doc-pagebreak["']/gi) || []).length;
  
  return {
    file: filename,
    epubPageBreaks: epubPageBreak,
    rolePageBreaks: roleDocPagebreak,
    total: epubPageBreak + roleDocPagebreak
  };
}

function checkAriaRoles(html, filename) {
  const issues = [];
  
  // Find potentially incorrect ARIA usage
  const ariaHiddenOnFocusableRegex = /<(?:a|button|input|select|textarea)[^>]+aria-hidden\s*=\s*["']true["']/gi;
  const matches = html.match(ariaHiddenOnFocusableRegex);
  
  if (matches && matches.length > 0) {
    issues.push({
      file: filename,
      count: matches.length,
      issue: 'focusable element with aria-hidden="true" (keyboard trap)'
    });
  }
  
  return issues;
}

function checkMetadata(opfXml) {
  const issues = [];
  const passes = [];
  const meta = opfXml?.package?.metadata?.meta || [];
  const metas = Array.isArray(meta) ? meta : [meta];
  
  function hasSchemaMeta(prop) {
    return metas.some(m =>
      m['@_property'] === prop ||
      m['@_property'] === prop.replace('schema:', '') ||
      m['@_name'] === prop ||
      m['@_name'] === prop.replace('schema:', '')
    );
  }
  
  // Required EPUB Accessibility 1.1 metadata
  const requiredMeta = [
    "schema:accessMode",
    "schema:accessModeSufficient", 
    "schema:accessibilityFeature",
    "schema:accessibilityHazard",
    "schema:accessibilitySummary"
  ];
  
  requiredMeta.forEach(prop => {
    if (!hasSchemaMeta(prop)) {
      issues.push({
        id: `A11Y_META_${prop.toUpperCase().replace(/[:]/g, "_")}_MISSING`,
        property: prop,
        severity: 'fail',
        issue: `Required accessibility metadata ${prop} missing`
      });
    } else {
      passes.push({
        id: `A11Y_META_${prop.toUpperCase().replace(/[:]/g, "_")}_PRESENT`,
        property: prop,
        severity: 'pass'
      });
    }
  });
  
  // Check accessMode values
  const accessModes = metas
    .filter(m => m['@_property'] === 'schema:accessMode')
    .map(m => m['_'] || m['#text']);
  
  const validAccessModes = ['textual', 'visual', 'auditory', 'tactile'];
  accessModes.forEach(mode => {
    if (mode && !validAccessModes.includes(mode)) {
      issues.push({
        id: 'A11Y_META_INVALID_ACCESSMODE',
        property: 'schema:accessMode',
        value: mode,
        severity: 'fail',
        issue: `Invalid accessMode value: ${mode}`
      });
    }
  });
  
  // Check accessibilityHazard values
  const hazards = metas
    .filter(m => m['@_property'] === 'schema:accessibilityHazard')
    .map(m => m['_'] || m['#text']);
  
  const validHazards = ['none', 'unknown', 'flashing', 'motionSimulation', 'sound', 'noFlashingHazard', 'noMotionSimulationHazard', 'noSoundHazard'];
  hazards.forEach(hazard => {
    if (hazard && !validHazards.includes(hazard)) {
      issues.push({
        id: 'A11Y_META_INVALID_HAZARD',
        property: 'schema:accessibilityHazard',
        value: hazard,
        severity: 'fail',
        issue: `Invalid accessibilityHazard value: ${hazard}`
      });
    }
  });
  
  // Check for WCAG conformance link
  const dcTermsConformsTo = opfXml?.package?.metadata?.link || [];
  const conformsLinks = Array.isArray(dcTermsConformsTo) ? dcTermsConformsTo : [dcTermsConformsTo];
  
  const hasWCAGConformance = conformsLinks.some(link =>
    link && link['@_rel'] === 'dcterms:conformsTo' &&
    (link['@_href'] || '').includes('wcag')
  );
  
  if (!hasWCAGConformance) {
    issues.push({
      id: 'A11Y_META_WCAG_CONFORMANCE_MISSING',
      property: 'dcterms:conformsTo',
      severity: 'warn',
      issue: 'No WCAG conformance declaration found'
    });
  } else {
    passes.push({
      id: 'A11Y_META_WCAG_CONFORMANCE_PRESENT',
      property: 'dcterms:conformsTo',
      severity: 'pass'
    });
  }
  
  return { issues, passes };
}

function checkNavDocument(navPath, opfDir) {
  const issues = [];
  const passes = [];
  
  const fullNavPath = path.join(opfDir, navPath);
  
  if (!fs.existsSync(fullNavPath)) {
    issues.push({
      id: 'A11Y_NAV_MISSING',
      severity: 'fail',
      issue: 'Navigation document (nav.xhtml) not found'
    });
    return { issues, passes };
  }
  
  const navHtml = fs.readFileSync(fullNavPath, 'utf8');
  
  // Check for required nav elements
  const hasTocNav = /<nav[^>]*epub:type=["']toc["']/i.test(navHtml);
  const hasPageList = /<nav[^>]*epub:type=["']page-list["']/i.test(navHtml);
  const hasLandmarks = /<nav[^>]*epub:type=["']landmarks["']/i.test(navHtml);
  
  if (!hasTocNav) {
    issues.push({
      id: 'A11Y_NAV_TOC_MISSING',
      severity: 'fail',
      issue: 'Navigation document missing epub:type="toc"'
    });
  } else {
    passes.push({
      id: 'A11Y_NAV_TOC_PRESENT',
      severity: 'pass'
    });
  }
  
  if (!hasPageList) {
    issues.push({
      id: 'A11Y_NAV_PAGELIST_MISSING',
      severity: 'warn',
      issue: 'Navigation document missing page-list (recommended for accessibility)'
    });
  } else {
    passes.push({
      id: 'A11Y_NAV_PAGELIST_PRESENT',
      severity: 'pass'
    });
  }
  
  if (!hasLandmarks) {
    issues.push({
      id: 'A11Y_NAV_LANDMARKS_MISSING',
      severity: 'warn',
      issue: 'Navigation document missing landmarks (recommended for accessibility)'
    });
  } else {
    passes.push({
      id: 'A11Y_NAV_LANDMARKS_PRESENT',
      severity: 'pass'
    });
  }
  
  // Check if nav has lang attribute
  if (!hasHtmlLang(navHtml)) {
    issues.push({
      id: 'A11Y_NAV_LANG_MISSING',
      severity: 'fail',
      issue: 'Navigation document missing lang attribute on <html>'
    });
  }
  
  return { issues, passes };
}

/* ======================================================
   MAIN ACCESSIBILITY CHECK FUNCTION
====================================================== */

async function runAccessibilityChecks({ tempDir, opfAbsolute, opfXml }) {
  const results = [];
  
  if (!opfXml || !opfAbsolute) {
    results.push({
      id: 'A11Y_NO_OPF',
      title: 'Accessibility check skipped',
      status: 'warn',
      details: 'OPF file not found, cannot run accessibility checks'
    });
    return results;
  }
  
  const opfDir = path.dirname(opfAbsolute);
  
  console.log('🔍 Running EPUB Accessibility Validation...');
  
  /* ======================================================
     1. OPF METADATA CHECKS (EPUB Accessibility 1.1)
  ====================================================== */
  const metadataResult = checkMetadata(opfXml);
  
  metadataResult.issues.forEach(issue => {
    results.push({
      id: issue.id,
      title: `Metadata: ${issue.property || 'general'}`,
      status: issue.severity === 'fail' ? 'fail' : 'warn',
      details: issue.issue,
      suggestion: `Add ${issue.property} to OPF <metadata> section`
    });
  });
  
  if (metadataResult.issues.length === 0 && metadataResult.passes.length > 0) {
    results.push({
      id: 'A11Y_META_COMPLETE',
      title: 'Accessibility metadata complete',
      status: 'pass',
      details: 'All required EPUB Accessibility 1.1 metadata present'
    });
  }
  
  /* ======================================================
     2. NAVIGATION DOCUMENT CHECKS
  ====================================================== */
  const manifest = opfXml?.package?.manifest?.item || [];
  const manifestItems = Array.isArray(manifest) ? manifest : [manifest];
  
  const navItem = manifestItems.find(item => {
    const props = (item['@_properties'] || '').toLowerCase();
    return props.includes('nav');
  });
  
  if (navItem) {
    const navResult = checkNavDocument(navItem['@_href'], opfDir);
    
    navResult.issues.forEach(issue => {
      results.push({
        id: issue.id,
        title: 'Navigation structure',
        status: issue.severity === 'fail' ? 'fail' : 'warn',
        details: issue.issue,
        suggestion: 'Add missing navigation elements to nav.xhtml'
      });
    });
    
    if (navResult.passes.length > 0 && navResult.issues.length === 0) {
      results.push({
        id: 'A11Y_NAV_COMPLETE',
        title: 'Navigation document complete',
        status: 'pass',
        details: 'Navigation has TOC, page-list, and landmarks'
      });
    }
  } else {
    results.push({
      id: 'A11Y_NAV_NOT_FOUND',
      title: 'Navigation document missing',
      status: 'fail',
      details: 'No navigation document with properties="nav" found in manifest',
      suggestion: 'Add nav.xhtml with properties="nav" in manifest'
    });
  }
  
  /* ======================================================
     3. HTML CONTENT CHECKS (WCAG 2.1 AA)
  ====================================================== */
  const files = glob.sync('**/*.{xhtml,html}', { cwd: tempDir, nodir: true });
  
  if (files.length === 0) {
    results.push({
      id: 'A11Y_NO_HTML_FILES',
      title: 'No HTML files found',
      status: 'warn',
      details: 'Cannot perform HTML content accessibility checks'
    });
    return results;
  }
  
  // 3.1 Language attributes (WCAG 3.1.1)
  let htmlLangMissing = 0;
  const langMissingFiles = [];
  
  for (const f of files) {
    const html = fs.readFileSync(path.join(tempDir, f), 'utf8');
    if (!hasHtmlLang(html)) {
      htmlLangMissing++;
      langMissingFiles.push(f);
    }
  }
  
  if (htmlLangMissing > 0) {
    results.push({
      id: 'A11Y_HTML_LANG_MISSING',
      title: 'HTML lang attribute missing',
      status: 'fail',
      details: `${htmlLangMissing} file(s) missing lang attribute on <html>`,
      files: langMissingFiles.slice(0, 5),
      suggestion: 'Add lang="en" (or appropriate language code) to <html> element'
    });
  } else {
    results.push({
      id: 'A11Y_HTML_LANG_OK',
      title: 'HTML lang attributes present',
      status: 'pass',
      details: `All ${files.length} HTML files have lang attribute`
    });
  }
  
  // 3.2 Image alt text (WCAG 1.1.1)
  let imagesWithoutAlt = [];
  
  for (const f of files) {
    const html = fs.readFileSync(path.join(tempDir, f), 'utf8');
    const issues = findImagesWithoutAlt(html, f);
    imagesWithoutAlt = imagesWithoutAlt.concat(issues);
  }
  
  if (imagesWithoutAlt.length > 0) {
    results.push({
      id: 'A11Y_IMG_ALT_MISSING',
      title: 'Images missing alt text',
      status: 'fail',
      details: `${imagesWithoutAlt.length} image(s) missing alt attribute`,
      images: imagesWithoutAlt.slice(0, 5),
      suggestion: 'Add alt="" for decorative images or descriptive alt text for informative images'
    });
  } else {
    results.push({
      id: 'A11Y_IMG_ALT_OK',
      title: 'Image alt text present',
      status: 'pass',
      details: 'All images have alt attributes'
    });
  }
  
  // 3.3 Link text (WCAG 2.4.4)
  let linksWithoutText = [];
  
  for (const f of files) {
    const html = fs.readFileSync(path.join(tempDir, f), 'utf8');
    const issues = findLinksWithoutText(html, f);
    linksWithoutText = linksWithoutText.concat(issues);
  }
  
  if (linksWithoutText.length > 0) {
    results.push({
      id: 'A11Y_LINK_TEXT_MISSING',
      title: 'Links without accessible text',
      status: 'fail',
      details: `${linksWithoutText.length} link(s) lack discernible text`,
      links: linksWithoutText.slice(0, 5),
      suggestion: 'Add descriptive text, aria-label, or alt text on images within links'
    });
  } else {
    results.push({
      id: 'A11Y_LINK_TEXT_OK',
      title: 'Link text present',
      status: 'pass',
      details: 'All links have accessible text'
    });
  }
  
  // 3.4 Heading structure (WCAG 1.3.1, 2.4.6)
  let headingIssues = [];
  
  for (const f of files) {
    const html = fs.readFileSync(path.join(tempDir, f), 'utf8');
    const issues = findHeadingStructureIssues(html, f);
    headingIssues = headingIssues.concat(issues);
  }
  
  if (headingIssues.length > 0) {
    results.push({
      id: 'A11Y_HEADING_STRUCTURE',
      title: 'Heading structure issues',
      status: 'warn',
      details: `${headingIssues.length} heading structure problem(s) found`,
      headings: headingIssues.slice(0, 5),
      suggestion: 'Use proper heading hierarchy (h1 → h2 → h3), don\'t skip levels'
    });
  } else {
    results.push({
      id: 'A11Y_HEADING_STRUCTURE_OK',
      title: 'Heading structure valid',
      status: 'pass',
      details: 'Proper heading hierarchy maintained'
    });
  }
  
  // 3.5 Table accessibility (WCAG 1.3.1)
  let tableIssues = [];
  
  for (const f of files) {
    const html = fs.readFileSync(path.join(tempDir, f), 'utf8');
    const issues = checkTableAccessibility(html, f);
    tableIssues = tableIssues.concat(issues);
  }
  
  if (tableIssues.length > 0) {
    results.push({
      id: 'A11Y_TABLE_ACCESSIBILITY',
      title: 'Table accessibility issues',
      status: 'fail',
      details: `${tableIssues.length} table accessibility problem(s)`,
      tables: tableIssues.slice(0, 5),
      suggestion: 'Add <caption>, <th> elements, or aria-label to tables'
    });
  }
  
  // 3.6 Form accessibility (WCAG 1.3.1, 3.3.2)
  let formIssues = [];
  
  for (const f of files) {
    const html = fs.readFileSync(path.join(tempDir, f), 'utf8');
    const issues = checkFormAccessibility(html, f);
    formIssues = formIssues.concat(issues);
  }
  
  if (formIssues.length > 0) {
    results.push({
      id: 'A11Y_FORM_LABELS',
      title: 'Form inputs missing labels',
      status: 'fail',
      details: `${formIssues.length} form input(s) without accessible labels`,
      forms: formIssues.slice(0, 5),
      suggestion: 'Add <label> elements or aria-label to form inputs'
    });
  }
  
  // 3.7 Landmarks (WCAG 1.3.1, 2.4.1)
  let filesWithLandmarks = 0;
  
  for (const f of files) {
    const html = fs.readFileSync(path.join(tempDir, f), 'utf8');
    const landmarks = checkLandmarks(html, f);
    
    if (landmarks.hasMain || landmarks.hasNav) {
      filesWithLandmarks++;
    }
  }
  
  if (filesWithLandmarks === 0) {
    results.push({
      id: 'A11Y_LANDMARKS_MISSING',
      title: 'ARIA landmarks missing',
      status: 'warn',
      details: 'No files use semantic HTML5 or ARIA landmarks',
      suggestion: 'Add <main>, <nav>, <header>, <footer> or appropriate ARIA roles'
    });
  } else {
    results.push({
      id: 'A11Y_LANDMARKS_PRESENT',
      title: 'ARIA landmarks present',
      status: 'pass',
      details: `${filesWithLandmarks} file(s) use landmarks`
    });
  }
  
  // 3.8 EPUB semantic inflection
  let filesWithSemantics = 0;
  
  for (const f of files) {
    const html = fs.readFileSync(path.join(tempDir, f), 'utf8');
    if (checkEpubSemantics(html, f)) {
      filesWithSemantics++;
    }
  }
  
  if (filesWithSemantics < files.length * 0.5) {
    results.push({
      id: 'A11Y_EPUB_SEMANTICS',
      title: 'EPUB semantic markup limited',
      status: 'warn',
      details: `${files.length - filesWithSemantics} file(s) lack epub:type attributes`,
      suggestion: 'Add epub:type attributes for better semantic structure'
    });
  }
  
  // 3.9 Page break markers
  let totalPageBreaks = 0;
  
  for (const f of files) {
    const html = fs.readFileSync(path.join(tempDir, f), 'utf8');
    const pageBreaks = checkPageBreaks(html, f);
    totalPageBreaks += pageBreaks.total;
  }
  
  if (totalPageBreaks > 0) {
    results.push({
      id: 'A11Y_PAGE_BREAKS_PRESENT',
      title: 'Page break markers present',
      status: 'pass',
      details: `${totalPageBreaks} page break marker(s) found`
    });
  } else {
    results.push({
      id: 'A11Y_PAGE_BREAKS_MISSING',
      title: 'No page break markers',
      status: 'warn',
      details: 'No epub:type="pagebreak" markers found',
      suggestion: 'Add page break markers for print-replica accessibility'
    });
  }
  
  // 3.10 ARIA usage validation
  let ariaIssues = [];
  
  for (const f of files) {
    const html = fs.readFileSync(path.join(tempDir, f), 'utf8');
    const issues = checkAriaRoles(html, f);
    ariaIssues = ariaIssues.concat(issues);
  }
  
  if (ariaIssues.length > 0) {
    results.push({
      id: 'A11Y_ARIA_MISUSE',
      title: 'ARIA usage issues',
      status: 'fail',
      details: `${ariaIssues.length} ARIA misuse detected`,
      aria: ariaIssues,
      suggestion: 'Fix aria-hidden on focusable elements'
    });
  }
  
  /* ======================================================
     4. SUMMARY
  ====================================================== */
  const failures = results.filter(r => r.status === 'fail').length;
  const warnings = results.filter(r => r.status === 'warn').length;
  const passes = results.filter(r => r.status === 'pass').length;
  
  // Add overall summary
  results.unshift({
    id: 'A11Y_OVERALL_SCORE',
    title: 'Accessibility Score',
    status: failures === 0 ? (warnings === 0 ? 'pass' : 'warn') : 'fail',
    details: `${passes} check(s) passed, ${warnings} warning(s), ${failures} failure(s)`,
    score: {
      total: passes + warnings + failures,
      passed: passes,
      warnings: warnings,
      failed: failures,
      percentage: passes + warnings + failures > 0 
        ? Math.round((passes / (passes + warnings + failures)) * 100) 
        : 0
    }
  });
  
  // Add manual review reminder
  results.push({
    id: 'A11Y_MANUAL_REVIEW',
    title: 'Manual review recommended',
    status: 'info',
    details: 'Some accessibility checks require manual review or specialized testing tools',
    suggestion: 'Use Daisy Ace, axe-core, or Pa11y for comprehensive automated testing. Manually test: color contrast (WCAG 1.4.3), keyboard navigation (WCAG 2.1.1), screen reader compatibility'
  });
  
  console.log(`✅ Accessibility checks complete: ${passes} passed, ${warnings} warnings, ${failures} failures`);
  
  return results;
}

module.exports = { runAccessibilityChecks };
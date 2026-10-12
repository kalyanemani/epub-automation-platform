/**
 * Generate nav.xhtml file for EPUB 3 navigation
 * @param {Object} metadata - Book metadata
 * @param {Array} contentFiles - Array of content file objects
 * @returns {string} XHTML content
 */
function generateNavXhtml(metadata, contentFiles) {
    const tocItems = contentFiles
        .map(file => `    <li><a href="${file.href}">${escapeHtml(file.title)}</a></li>`)
        .join('\n');

    // Generate page list
    const pageList = [];
    let pageNum = 1;
    contentFiles.forEach(file => {
        if (file.pageStart) {
            for (let p = file.pageStart; p <= file.pageEnd; p++) {
                pageList.push(`    <li><a href="${file.href}#Page_${p}">${p}</a></li>`);
            }
        }
    });

    return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en-US" lang="en-US">
<head>
<title>${escapeHtml(metadata.title)}</title>
<link href="stylesheet.css" rel="stylesheet" type="text/css" />
</head>
<body epub:type="frontmatter">
<nav epub:type="toc" role="doc-toc" id="toc">
<h1>Table of Contents</h1>
<ol class="none">
${tocItems}
</ol>
</nav>
<nav epub:type="landmarks" hidden="hidden">
<h2>Guide</h2>
<ol class="ol">
  <li><a epub:type="cover" href="cover.xhtml">Cover</a></li>
  <li><a epub:type="titlepage" href="title.xhtml">Title page</a></li>
  <li><a epub:type="bodymatter" href="cover.xhtml#cover">Start</a></li>
</ol>
</nav>
${pageList.length > 0 ? `<nav epub:type="page-list" role="doc-pagelist" hidden="hidden">
<h2>Pages</h2>
<ol class="ol">
${pageList.join('\n')}
</ol>
</nav>` : ''}
</body>
</html>`;
}

/**
 * Escape HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

module.exports = {
    generateNavXhtml
};

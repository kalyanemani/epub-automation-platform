/**
 * Generate XHTML content file
 * @param {Object} options - Content options
 * @returns {string} XHTML content
 */
function generateXhtmlContent(options) {
    const {
        title,
        content,
        filename,
        epubType = 'bodymatter',
        pageNumber = null
    } = options;

    const pageBreak = pageNumber
        ? `<span epub:type="pagebreak" role="doc-pagebreak" title="${pageNumber}" id="Page_${pageNumber}"/>`
        : '';

    return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:m="http://www.w3.org/1998/Math/MathML" xmlns:svg="http://www.w3.org/2000/svg" epub:prefix="index: http://www.index.com/" xml:lang="en" lang="en">
<head>
<title>${escapeHtml(title)}</title>
<link href="stylesheet.css" rel="stylesheet" type="text/css" />
</head>
<body epub:type="${epubType}">
<section epub:type="${epubType === 'cover' ? 'cover' : epubType === 'titlepage' ? 'titlepage' : 'chapter'}" ${epubType === 'chapter' ? 'role="doc-chapter"' : ''}>
${pageBreak ? `<header>\n${pageBreak}\n</header>\n` : ''}
${content}
</section>
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
    generateXhtmlContent
};

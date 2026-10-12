const { create } = require('xmlbuilder2');

/**
 * Generate toc.ncx file for EPUB 2 compatibility
 * @param {Object} metadata - Book metadata
 * @param {Array} contentFiles - Array of content file objects
 * @returns {string} XML content
 */
function generateTocNcx(metadata, contentFiles) {
    const totalPages = contentFiles.reduce((max, file) =>
        Math.max(max, file.pageEnd || 0), 0);

    const doc = create({ version: '1.0', encoding: 'UTF-8' })
        .ele('ncx', {
            xmlns: 'http://www.daisy.org/z3986/2005/ncx/',
            version: '2005-1',
            'xml:lang': 'en-US'
        });

    // Head
    const head = doc.ele('head');
    head.ele('meta', { name: 'dtb:uid', content: `urn:uuid:${generateUUID()}` });
    head.ele('meta', { name: 'dtb:depth', content: '1' });
    head.ele('meta', { name: 'dtb:totalPageCount', content: String(totalPages) });
    head.ele('meta', { name: 'dtb:maxPageNumber', content: String(totalPages) });

    // Doc title and author
    doc.ele('docTitle').ele('text').txt(metadata.title);
    doc.ele('docAuthor').ele('text').txt(metadata.author);

    // Nav map
    const navMap = doc.ele('navMap');

    contentFiles.forEach((file, index) => {
        navMap.ele('navPoint', {
            id: `navpoint-${index + 1}`,
            playOrder: String(index + 1)
        })
            .ele('navLabel')
            .ele('text').txt(file.title)
            .up()
            .ele('content', { src: file.href });
    });

    // Page list
    if (totalPages > 0) {
        const pageList = doc.ele('pageList');
        let playOrder = contentFiles.length + 1;

        contentFiles.forEach(file => {
            if (file.pageStart) {
                for (let p = file.pageStart; p <= file.pageEnd; p++) {
                    pageList.ele('pageTarget', {
                        type: 'normal',
                        playOrder: String(playOrder++)
                    })
                        .ele('navLabel')
                        .ele('text').txt(`Page ${p}`)
                        .up()
                        .ele('content', { src: `${file.href}#Page_${p}` });
                }
            }
        });
    }

    return doc.end({ prettyPrint: true });
}

/**
 * Generate a simple UUID
 * @returns {string} UUID
 */
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

module.exports = {
    generateTocNcx
};

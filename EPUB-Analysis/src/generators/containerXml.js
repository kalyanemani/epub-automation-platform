const { create } = require('xmlbuilder2');

/**
 * Generate container.xml for META-INF directory
 * @returns {string} XML content
 */
function generateContainerXml() {
    const doc = create({ version: '1.0', encoding: 'UTF-8' })
        .ele('container', {
            version: '1.0',
            xmlns: 'urn:oasis:names:tc:opendocument:xmlns:container'
        })
        .ele('rootfiles')
        .ele('rootfile', {
            'full-path': 'OEBPS/content.opf',
            'media-type': 'application/oebps-package+xml'
        })
        .up()
        .up();

    return doc.end({ prettyPrint: true });
}

module.exports = {
    generateContainerXml
};

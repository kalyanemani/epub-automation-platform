const { create } = require('xmlbuilder2');

/**
 * Generate content.opf file
 * @param {Object} metadata - Book metadata
 * @param {Array} contentFiles - Array of content file objects
 * @param {Array} images - Array of image objects
 * @returns {string} XML content
 */
function generateContentOpf(metadata, contentFiles, images) {
    const now = new Date().toISOString();
    const isbn = `urn:uuid:${generateUUID()}`;

    const doc = create({ version: '1.0', encoding: 'utf-8' })
        .ele('package', {
            version: '3.0',
            'unique-identifier': 'book-id',
            'xml:lang': 'en-US',
            xmlns: 'http://www.idpf.org/2007/opf',
            'xmlns:epub': 'http://www.idpf.org/2007/ops'
        });

    // Metadata
    const metadataEle = doc.ele('metadata', {
        'xmlns:dc': 'http://purl.org/dc/elements/1.1/',
        'xmlns:opf': 'http://www.idpf.org/2007/opf'
    });

    metadataEle.ele('dc:title', { id: 't1' }).txt(metadata.title);
    metadataEle.ele('meta', { refines: '#t1', property: 'title-type' }).txt('main');
    metadataEle.ele('meta', { refines: '#t1', property: 'display-seq' }).txt('1');

    metadataEle.ele('dc:creator', { id: 'creator1' }).txt(metadata.author);
    metadataEle.ele('meta', { refines: '#creator1', property: 'role', scheme: 'marc:relators', id: 'role1' }).txt('aut');
    metadataEle.ele('meta', { refines: '#creator1', property: 'display-seq' }).txt('1');

    metadataEle.ele('dc:language').txt('en');
    metadataEle.ele('dc:identifier', { id: 'book-id' }).txt(isbn);

    // Accessibility metadata
    metadataEle.ele('meta', { property: 'schema:accessibilitySummary' })
        .txt('This publication contains well-structured HTML.');
    metadataEle.ele('meta', { property: 'schema:accessMode' }).txt('textual');
    metadataEle.ele('meta', { property: 'schema:accessMode' }).txt('visual');
    metadataEle.ele('meta', { property: 'schema:accessModeSufficient' }).txt('textual');
    metadataEle.ele('meta', { property: 'schema:accessModeSufficient' }).txt('visual');
    metadataEle.ele('meta', { property: 'schema:accessibilityFeature' }).txt('structuralNavigation');
    metadataEle.ele('meta', { property: 'schema:accessibilityFeature' }).txt('readingOrder');
    metadataEle.ele('meta', { property: 'schema:accessibilityFeature' }).txt('alternativeText');
    metadataEle.ele('meta', { property: 'schema:accessibilityFeature' }).txt('displayTransformability');
    metadataEle.ele('meta', { property: 'schema:accessibilityAPI' }).txt('ARIA');
    metadataEle.ele('meta', { property: 'schema:accessibilityHazard' }).txt('none');

    metadataEle.ele('meta', { name: 'cover', content: 'cover-image' });
    metadataEle.ele('meta', { property: 'dcterms:modified' }).txt(now);
    metadataEle.ele('dc:date').txt(now);

    // Manifest
    const manifest = doc.ele('manifest');

    manifest.ele('item', {
        id: 'stylesheet',
        href: 'stylesheet.css',
        'media-type': 'text/css'
    });

    manifest.ele('item', {
        id: 'nav',
        href: 'nav.xhtml',
        'media-type': 'application/xhtml+xml',
        properties: 'nav'
    });

    manifest.ele('item', {
        id: 'ncx',
        href: 'toc.ncx',
        'media-type': 'application/x-dtbncx+xml'
    });

    // Add content files to manifest
    contentFiles.forEach((file, index) => {
        const properties = file.id === 'cover' ? 'cover-image' : undefined;
        manifest.ele('item', {
            id: file.id,
            href: file.href,
            'media-type': 'application/xhtml+xml',
            ...(properties && { properties })
        });
    });

    // Add images to manifest
    images.forEach((image, index) => {
        const properties = image.type === 'cover' ? 'cover-image' : undefined;
        manifest.ele('item', {
            id: image.type === 'cover' ? 'cover-image' : `image-${index}`,
            href: `images/${image.filename}`,
            'media-type': 'image/jpeg',
            ...(properties && { properties })
        });
    });

    // Spine
    const spine = doc.ele('spine', { toc: 'ncx' });

    contentFiles.forEach(file => {
        spine.ele('itemref', {
            idref: file.id,
            linear: 'yes'
        });
    });

    // Guide
    const guide = doc.ele('guide');
    guide.ele('reference', {
        type: 'cover',
        title: 'Cover',
        href: 'cover.xhtml'
    });
    guide.ele('reference', {
        type: 'text',
        title: 'Title page',
        href: 'title.xhtml'
    });

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
    generateContentOpf
};

const fs = require('fs').promises;
const path = require('path');
const archiver = require('archiver');
const { generateContentOpf } = require('./generators/contentOpf');
const { generateNavXhtml } = require('./generators/navXhtml');
const { generateTocNcx } = require('./generators/tocNcx');
const { generateXhtmlContent } = require('./generators/xhtmlContent');
const { generateContainerXml } = require('./generators/containerXml');
const { generateStylesheet } = require('./generators/stylesheet');

/**
 * Generate EPUB file from processed PDF data
 * @param {Object} pdfData - Processed PDF data
 * @param {string} tempDir - Temporary directory
 * @param {string} outputDir - Output directory
 * @returns {string} Path to generated EPUB file
 */
async function generateEPUB(pdfData, tempDir, outputDir) {
    try {
        // Create EPUB structure
        const epubDir = path.join(tempDir, 'epub');
        const metaInfDir = path.join(epubDir, 'META-INF');
        const oebpsDir = path.join(epubDir, 'OEBPS');
        const imagesDir = path.join(oebpsDir, 'images');

        await fs.mkdir(metaInfDir, { recursive: true });
        await fs.mkdir(oebpsDir, { recursive: true });
        await fs.mkdir(imagesDir, { recursive: true });

        // Create mimetype file (must be first, uncompressed)
        await fs.writeFile(
            path.join(epubDir, 'mimetype'),
            'application/epub+zip',
            { encoding: 'utf8' }
        );

        // Generate container.xml
        const containerXml = generateContainerXml();
        await fs.writeFile(
            path.join(metaInfDir, 'container.xml'),
            containerXml,
            { encoding: 'utf8' }
        );

        // Copy images if available
        if (pdfData.images && pdfData.images.length > 0) {
            for (const image of pdfData.images) {
                const destPath = path.join(imagesDir, image.filename);
                await fs.copyFile(image.path, destPath);
            }
        }

        // Generate XHTML content files
        const contentFiles = [];

        // Cover page (only if we have images)
        if (pdfData.images && pdfData.images.length > 0) {
            const coverXhtml = generateXhtmlContent({
                title: pdfData.metadata.title,
                content: `<div class="cover-image">
          <img src="images/cover.jpg" alt="Cover" />
        </div>`,
                filename: 'cover.xhtml',
                epubType: 'cover'
            });
            await fs.writeFile(path.join(oebpsDir, 'cover.xhtml'), coverXhtml);
            contentFiles.push({ id: 'cover', href: 'cover.xhtml', title: 'Cover' });
        }

        // Title page
        const titleXhtml = generateXhtmlContent({
            title: pdfData.metadata.title,
            content: `<div class="title-page">
        <h1 class="title">${escapeHtml(pdfData.metadata.title)}</h1>
        <p class="author">${escapeHtml(pdfData.metadata.author)}</p>
      </div>`,
            filename: 'title.xhtml',
            epubType: 'titlepage',
            pageNumber: 1
        });
        await fs.writeFile(path.join(oebpsDir, 'title.xhtml'), titleXhtml);
        contentFiles.push({ id: 'title', href: 'title.xhtml', title: 'Title Page' });

        // Chapter files
        for (let i = 0; i < pdfData.chapters.length; i++) {
            const chapter = pdfData.chapters[i];
            const filename = `chapter${String(i + 1).padStart(2, '0')}.xhtml`;

            // Convert chapter content to HTML paragraphs
            const paragraphs = chapter.content
                .filter(line => line.trim().length > 0)
                .map((line, idx) => {
                    const trimmed = line.trim();
                    if (trimmed.length === 0) return '';

                    // Check if it's a heading
                    const isHeading =
                        /^(Chapter|CHAPTER|Ch\.|Ch)\s+\d+/i.test(trimmed) ||
                        /^(Part|PART|Section|SECTION)\s+\d+/i.test(trimmed) ||
                        (idx === 0 && trimmed.length < 100);

                    if (isHeading) {
                        return `<h2 class="chapter-title">${escapeHtml(trimmed)}</h2>`;
                    }

                    return `<p class="${idx === 0 ? 'noindent' : 'indent'}">${escapeHtml(trimmed)}</p>`;
                })
                .join('\n');

            const chapterXhtml = generateXhtmlContent({
                title: chapter.title,
                content: paragraphs,
                filename: filename,
                epubType: 'chapter',
                pageNumber: chapter.pageStart
            });

            await fs.writeFile(path.join(oebpsDir, filename), chapterXhtml);
            contentFiles.push({
                id: `chapter${i + 1}`,
                href: filename,
                title: chapter.title,
                pageStart: chapter.pageStart,
                pageEnd: chapter.pageEnd
            });
        }

        // Generate stylesheet
        const stylesheet = generateStylesheet();
        await fs.writeFile(path.join(oebpsDir, 'stylesheet.css'), stylesheet);

        // Generate navigation files
        const navXhtml = generateNavXhtml(pdfData.metadata, contentFiles);
        await fs.writeFile(path.join(oebpsDir, 'nav.xhtml'), navXhtml);

        const tocNcx = generateTocNcx(pdfData.metadata, contentFiles);
        await fs.writeFile(path.join(oebpsDir, 'toc.ncx'), tocNcx);

        // Generate content.opf
        const contentOpf = generateContentOpf(pdfData.metadata, contentFiles, pdfData.images);
        await fs.writeFile(path.join(oebpsDir, 'content.opf'), contentOpf);

        // Package EPUB
        const epubFilename = `${sanitizeFilename(pdfData.metadata.title)}.epub`;
        const epubPath = path.join(outputDir, epubFilename);

        await packageEPUB(epubDir, epubPath);

        return epubPath;
    } catch (error) {
        console.error('Error generating EPUB:', error);
        throw new Error(`Failed to generate EPUB: ${error.message}`);
    }
}

/**
 * Package EPUB directory into .epub file
 * @param {string} epubDir - EPUB directory
 * @param {string} outputPath - Output file path
 */
async function packageEPUB(epubDir, outputPath) {
    return new Promise((resolve, reject) => {
        const output = require('fs').createWriteStream(outputPath);
        const archive = archiver('zip', {
            zlib: { level: 9 }
        });

        output.on('close', () => {
            resolve(outputPath);
        });

        archive.on('error', (err) => {
            reject(err);
        });

        archive.pipe(output);

        // Add mimetype first (uncompressed)
        archive.file(path.join(epubDir, 'mimetype'), {
            name: 'mimetype',
            store: true
        });

        // Add META-INF directory
        archive.directory(path.join(epubDir, 'META-INF'), 'META-INF');

        // Add OEBPS directory
        archive.directory(path.join(epubDir, 'OEBPS'), 'OEBPS');

        archive.finalize();
    });
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

/**
 * Sanitize filename
 * @param {string} filename - Filename to sanitize
 * @returns {string} Sanitized filename
 */
function sanitizeFilename(filename) {
    return filename
        .replace(/[^a-z0-9]/gi, '_')
        .replace(/_+/g, '_')
        .toLowerCase();
}

module.exports = {
    generateEPUB
};

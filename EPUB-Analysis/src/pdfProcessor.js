const fs = require('fs').promises;
const path = require('path');
const pdfParse = require('pdf-parse');

/**
 * Process PDF file and extract content
 * @param {string} pdfPath - Path to PDF file
 * @param {string} tempDir - Temporary directory for processing
 * @returns {Object} Extracted PDF data
 */
async function processPDF(pdfPath, tempDir) {
    try {
        // Read PDF file
        const dataBuffer = await fs.readFile(pdfPath);

        // Parse PDF text content
        const pdfData = await pdfParse(dataBuffer);

        // Extract metadata
        const metadata = {
            title: pdfData.info?.Title || path.basename(pdfPath, '.pdf'),
            author: pdfData.info?.Author || 'Unknown Author',
            subject: pdfData.info?.Subject || '',
            creator: pdfData.info?.Creator || '',
            producer: pdfData.info?.Producer || '',
            creationDate: pdfData.info?.CreationDate || new Date().toISOString(),
            pages: pdfData.numpages
        };

        // Extract text content
        const text = pdfData.text;

        // Split content into chapters based on page breaks
        const chapters = splitIntoChapters(text, pdfData.numpages);

        // Extract images from PDF
        const images = await extractImages(dataBuffer, tempDir);

        return {
            metadata,
            chapters,
            images,
            totalPages: pdfData.numpages
        };
    } catch (error) {
        console.error('Error processing PDF:', error);
        throw new Error(`Failed to process PDF: ${error.message}`);
    }
}

/**
 * Split text content into chapters
 * @param {string} text - Full text content
 * @param {number} totalPages - Total number of pages
 * @returns {Array} Array of chapter objects
 */
function splitIntoChapters(text, totalPages) {
    const chapters = [];

    // Split by common chapter indicators or page breaks
    const lines = text.split('\n');
    let currentChapter = {
        title: 'Chapter 1',
        content: [],
        pageStart: 1,
        pageEnd: 1
    };

    let chapterCount = 1;
    let pageCount = 1;
    let lineCount = 0;
    const linesPerPage = Math.ceil(lines.length / totalPages);

    lines.forEach((line, index) => {
        const trimmedLine = line.trim();

        // Update page count
        lineCount++;
        if (lineCount > linesPerPage) {
            pageCount++;
            lineCount = 0;
        }

        // Check for chapter headings (common patterns)
        const isChapterHeading =
            /^(Chapter|CHAPTER|Ch\.|Ch)\s+\d+/i.test(trimmedLine) ||
            /^(Part|PART|Section|SECTION)\s+\d+/i.test(trimmedLine) ||
            /^\d+\.\s+[A-Z]/i.test(trimmedLine) && trimmedLine.length < 100;

        if (isChapterHeading && currentChapter.content.length > 0) {
            // Save current chapter
            currentChapter.pageEnd = pageCount - 1;
            chapters.push(currentChapter);

            // Start new chapter
            chapterCount++;
            currentChapter = {
                title: trimmedLine || `Chapter ${chapterCount}`,
                content: [],
                pageStart: pageCount,
                pageEnd: pageCount
            };
        }

        currentChapter.content.push(line);
    });

    // Add the last chapter
    if (currentChapter.content.length > 0) {
        currentChapter.pageEnd = totalPages;
        chapters.push(currentChapter);
    }

    // If no chapters were detected, create chapters based on page ranges
    if (chapters.length === 0) {
        const pagesPerChapter = Math.ceil(totalPages / Math.max(1, Math.ceil(totalPages / 10)));
        const linesPerChapter = Math.ceil(lines.length / Math.ceil(totalPages / pagesPerChapter));

        for (let i = 0; i < lines.length; i += linesPerChapter) {
            const chunkLines = lines.slice(i, i + linesPerChapter);
            const chapterNum = Math.floor(i / linesPerChapter) + 1;
            const pageStart = Math.floor(i / linesPerPage) + 1;
            const pageEnd = Math.min(Math.floor((i + linesPerChapter) / linesPerPage) + 1, totalPages);

            chapters.push({
                title: `Chapter ${chapterNum}`,
                content: chunkLines,
                pageStart,
                pageEnd
            });
        }
    }

    return chapters;
}

/**
 * Extract images from PDF
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @param {string} tempDir - Temporary directory
 * @returns {Array} Array of image file paths
 */
async function extractImages(pdfBuffer, tempDir) {
    try {
        // Try to load optional dependencies
        let convert, sharp;
        try {
            convert = require('pdf-img-convert').convert;
            sharp = require('sharp');
        } catch (error) {
            console.warn('Optional image dependencies not available. Skipping image extraction.');
            return [];
        }

        const imagesDir = path.join(tempDir, 'images');
        await fs.mkdir(imagesDir, { recursive: true });

        // Convert PDF pages to images
        const outputImages = await convert(pdfBuffer, {
            width: 1200,
            height: 1600,
            page_numbers: [1], // Extract first page as cover
            base64: false
        });

        const imagePaths = [];

        // Save cover image
        if (outputImages && outputImages.length > 0) {
            const coverPath = path.join(imagesDir, 'cover.jpg');

            // Optimize image with sharp
            await sharp(outputImages[0])
                .jpeg({ quality: 85 })
                .toFile(coverPath);

            imagePaths.push({
                filename: 'cover.jpg',
                path: coverPath,
                type: 'cover'
            });
        }

        return imagePaths;
    } catch (error) {
        console.error('Error extracting images:', error);
        // Return empty array if image extraction fails
        return [];
    }
}

module.exports = {
    processPDF
};

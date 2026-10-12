const fs = require("fs");
const path = require("path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const { extractPdfTextPages } = require("../utils/pdf-text");
const {
  buildTextNormalizationContextFromTexts,
  normalizeTextSegment,
} = require("../utils/text-normalizer");
const {
  decodePdfEntitiesInText,
  isAllowedPdfChange,
  toRenderablePdfText,
} = require("../utils/pdf-text-rules");

function wrapText(text, font, fontSize, maxWidth) {
  const words = toRenderablePdfText(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let currentLine = "";

  words.forEach((word) => {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (!currentLine || font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      currentLine = candidate;
      return;
    }

    lines.push(currentLine);
    currentLine = word;
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length ? lines : [String(text || "")];
}

function relaxPdfContext(context) {
  const strongAttestedWords = new Set(
    Array.from(context.attestedWords || []).filter((word) => {
      const count = context.wordCounts?.get(word) || 0;
      return count > 1 || context.lexicon?.has(word);
    })
  );

  return {
    ...context,
    attestedWords: strongAttestedWords,
  };
}

async function runPdfAutoFix({ pdfPath }) {
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    throw new Error("pdfPath missing or invalid");
  }

  const pdfBytes = fs.readFileSync(pdfPath);
  const parsed = await extractPdfTextPages(pdfPath);
  const context = relaxPdfContext(buildTextNormalizationContextFromTexts(
    parsed.pages.map((page) => page.text)
  ));

  const pdfDoc = await PDFDocument.load(pdfBytes);
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  let replacementsApplied = 0;
  let pagesTouched = 0;

  parsed.pages.forEach((pageData) => {
    const page = pdfDoc.getPage(pageData.pageNumber - 1);
    let touchedPage = false;

    pageData.lines.forEach((line) => {
      const entityPrelude = decodePdfEntitiesInText(line.text);
      const normalized = normalizeTextSegment(entityPrelude.text, context, {
        applyPlaceholderFixes: true,
      });
      const result = {
        text: normalized.text,
        changes: [...entityPrelude.changes, ...normalized.changes],
        reviews: normalized.reviews,
      };
      if (!result?.changes?.length || result.text === line.text) {
        return;
      }

      const disallowedChange = result.changes.find(
        (change) => !isAllowedPdfChange(change, line.text)
      );
      if (disallowedChange) {
        return;
      }

      const fontSize = Math.max(8, Math.min(12, line.height * 0.85));
      const maxWidth = Math.max(120, Math.min(line.width + 16, pageData.width - line.x - 18));
      const wrappedLines = wrapText(result.text, regularFont, fontSize, maxWidth);
      const lineHeight = fontSize * 1.2;
      const boxHeight = Math.max(line.height + 6, wrappedLines.length * lineHeight + 6);
      const boxY = Math.max(2, line.y - fontSize * 0.25);

      page.drawRectangle({
        x: Math.max(1, line.x - 2),
        y: boxY - 2,
        width: maxWidth + 4,
        height: boxHeight,
        color: rgb(1, 1, 1),
        opacity: 1,
      });

      wrappedLines.forEach((wrappedLine, index) => {
        page.drawText(wrappedLine, {
          x: line.x,
          y: boxY + boxHeight - ((index + 1) * lineHeight),
          size: fontSize,
          font: regularFont,
          color: rgb(0, 0, 0),
        });
      });

      replacementsApplied += result.changes.length;
      touchedPage = true;
    });

    if (touchedPage) {
      pagesTouched += 1;
    }
  });

  pdfDoc.setProducer("EPUB Validator PDF Autofix");
  pdfDoc.setSubject("Autofixed PDF text normalization output");

  const fixedPdfPath = pdfPath.replace(/\.pdf$/i, "_fixed.pdf");
  fs.writeFileSync(fixedPdfPath, await pdfDoc.save());

  return {
    fixedPdfPath,
    replacementsApplied,
    pagesTouched,
    sourcePages: parsed.numpages,
    sourceFile: path.basename(pdfPath),
    ocr: parsed.ocr || null,
  };
}

module.exports = { runPdfAutoFix };

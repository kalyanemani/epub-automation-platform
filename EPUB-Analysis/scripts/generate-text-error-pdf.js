const fs = require("fs");
const path = require("path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const INLINE_ERROR_BLOCKS = [
  { page: 2, lines: ["data- base", "infor- mation", "re-entry"] },
  { page: 6, lines: ["machinelearning", "deep neuralnetwork", "artificialintelligence"] },
  { page: 12, lines: ["This is a sampl text.", "He go to school."] },
  { page: 18, lines: ["The report is complet.", "This b0ok needs review."] },
  { page: 24, lines: ["It\u00E2\u20AC\u2122s done.", "Price is 100\u00E2\u201A\u00B9."] },
  { page: 30, lines: ["AT&amp;T", "Hello&nbsp;World"] },
  { page: 36, lines: ["TODO replace this copy.", "??? uncertain text ???"] },
  { page: 42, lines: ["conf luence", "co-operate", "well-being"] },
];

function wrapLines(text, font, fontSize, maxWidth) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
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

  return lines;
}

function drawOverlayBlock(page, block, fonts) {
  const pageSize = page.getSize();
  const margin = 28;
  const width = 255;
  const lineHeight = 12;
  const titleFontSize = 9;
  const bodyFontSize = 9;
  const bodyLines = block.lines.flatMap((line) =>
    wrapLines(line, fonts.regular, bodyFontSize, width - 18)
  );
  const height = 28 + bodyLines.length * lineHeight + 12;
  const x = pageSize.width - width - margin;
  const y = margin;

  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.75, 0.25, 0.18),
    borderWidth: 1,
    opacity: 0.96,
  });

  page.drawText("Validation sample", {
    x: x + 9,
    y: y + height - 16,
    size: titleFontSize,
    font: fonts.bold,
    color: rgb(0.62, 0.16, 0.12),
  });

  let cursorY = y + height - 30;
  bodyLines.forEach((line) => {
    page.drawText(line, {
      x: x + 9,
      y: cursorY,
      size: bodyFontSize,
      font: fonts.regular,
      color: rgb(0.1, 0.1, 0.1),
    });
    cursorY -= lineHeight;
  });
}

async function generateErrorPdf(inputPath, outputPath) {
  const sourceBytes = fs.readFileSync(inputPath);
  const pdf = await PDFDocument.load(sourceBytes);
  const pageCount = pdf.getPageCount();
  const regularFont = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);

  INLINE_ERROR_BLOCKS.forEach((block) => {
    if (block.page < 1 || block.page > pageCount) {
      return;
    }

    drawOverlayBlock(pdf.getPage(block.page - 1), block, {
      regular: regularFont,
      bold: boldFont,
    });
  });

  pdf.setProducer("EPUB Validation Test PDF Generator");
  pdf.setSubject("Intentional inline text corruption cases for UI validation");

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, await pdf.save());
}

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];

  if (!inputPath || !outputPath) {
    console.error("Usage: node scripts/generate-text-error-pdf.js <input.pdf> <output.pdf>");
    process.exit(1);
  }

  await generateErrorPdf(path.resolve(inputPath), path.resolve(outputPath));
  console.log(`Created test PDF: ${path.resolve(outputPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

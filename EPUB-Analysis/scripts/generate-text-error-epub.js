const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

const { unzipToTemp } = require("../src/utils/unzip");

const SAMPLE_BLOCKS = [
  {
    file: "OEBPS/text/9780008551629_Note_to_Readers.xhtml",
    title: "Acceptance Criteria Validation Sample",
    paragraphs: [
      "data- base",
      "infor- mation",
      "conf luence",
      "co-operate",
      "well-being",
      "machinelearning",
      "deep neuralnetwork",
      "artificialintelligence",
    ],
  },
  {
    file: "OEBPS/text/About_the_Publisher.xhtml",
    title: "Acceptance Criteria Validation Sample",
    paragraphs: [
      "This is a sampl text.",
      "He go to school.",
      "The report is complet.",
      "This b0ok needs review.",
      "??? uncertain text ???",
      "Itâ€™s done.",
      "Price is 100â‚¹.",
      "Hello World",
      "Bad symbol � remains here.",
    ],
  },
];

function escapeXmlText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildSampleBlock({ title, paragraphs }) {
  const lines = [
    "",
    '<section class="validation-sample" aria-label="acceptance-criteria-validation-sample">',
    `  <h3>${escapeXmlText(title)}</h3>`,
  ];

  paragraphs.forEach((paragraph) => {
    lines.push(`  <p>${escapeXmlText(paragraph)}</p>`);
  });

  lines.push("</section>", "");
  return lines.join("\n");
}

function appendBlockToXhtml(content, block) {
  const closingBody = /<\/body>/i;
  if (!closingBody.test(content)) {
    throw new Error("Could not find </body> in XHTML file.");
  }

  return content.replace(closingBody, `${block}</body>`);
}

function repackEpub(tempDir, outputPath) {
  const zip = new AdmZip();
  const mimetypePath = path.join(tempDir, "mimetype");

  if (fs.existsSync(mimetypePath)) {
    zip.addLocalFile(mimetypePath, "", "mimetype");
  }

  const addDirectory = (directory, zipPath = "") => {
    const items = fs.readdirSync(directory);

    items.forEach((item) => {
      if (item === "mimetype") {
        return;
      }

      const fullPath = path.join(directory, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        addDirectory(fullPath, path.join(zipPath, item));
        return;
      }

      zip.addLocalFile(fullPath, zipPath);
    });
  };

  addDirectory(tempDir);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  zip.writeZip(outputPath);
}

async function generateErrorEpub(inputPath, outputPath) {
  const resolvedInput = path.resolve(inputPath);
  const resolvedOutput = path.resolve(outputPath);

  if (!fs.existsSync(resolvedInput)) {
    throw new Error(`Input EPUB not found: ${resolvedInput}`);
  }

  const { tempDir } = await unzipToTemp(resolvedInput);
  const applied = [];

  try {
    SAMPLE_BLOCKS.forEach((sample) => {
      const absolutePath = path.join(tempDir, sample.file);
      if (!fs.existsSync(absolutePath)) {
        throw new Error(`Sample target XHTML not found: ${sample.file}`);
      }

      const original = fs.readFileSync(absolutePath, "utf8");
      const updated = appendBlockToXhtml(original, buildSampleBlock(sample));
      fs.writeFileSync(absolutePath, updated, "utf8");

      applied.push({
        file: sample.file,
        paragraphsAdded: sample.paragraphs.length,
      });
    });

    repackEpub(tempDir, resolvedOutput);
    return { outputPath: resolvedOutput, applied };
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn("Failed to cleanup temp dir:", tempDir);
    }
  }
}

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];

  if (!inputPath || !outputPath) {
    console.error(
      "Usage: node scripts/generate-text-error-epub.js <input.epub> <output.epub>"
    );
    process.exit(1);
  }

  const result = await generateErrorEpub(inputPath, outputPath);
  console.log(`Created test EPUB: ${result.outputPath}`);
  result.applied.forEach((entry) => {
    console.log(`- ${entry.file}: added ${entry.paragraphsAdded} sample paragraphs`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

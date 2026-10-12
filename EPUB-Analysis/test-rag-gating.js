const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildTextFixDecider } = require("./src/rag");

function makeDoc(tempDir, name, content) {
  const absolutePath = path.join(tempDir, name);
  fs.writeFileSync(absolutePath, content, "utf8");
  return {
    absolutePath,
    relPath: name.replace(/\\/g, "/"),
  };
}

async function run() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rag-gating-"));

  try {
    const docs = [
      makeDoc(
        tempDir,
        "chapter01.xhtml",
        "<p>The paperback was on the table. A regular thirteen-year-old picked it up.</p>"
      ),
    ];

    const decider = buildTextFixDecider({ docs });

    const splitDecision = decider({
      category: "hyphenation",
      type: "merged-word-split",
      original: "paperback",
      replacement: "paper back",
      confidence: "high",
      excerpt: "The paperback was on the table.",
    });
    assert.strictEqual(splitDecision.apply, false);

    const ocrDecision = decider({
      category: "missing-incorrect",
      type: "ocr-like-token",
      original: "th1rteen",
      replacement: "thirteen",
      confidence: "high",
      excerpt: "A regular th1rteen-year-old picked it up.",
    });
    assert.strictEqual(ocrDecision.apply, true);

    const grammarDecision = decider({
      category: "missing-incorrect",
      type: "grammar-correction",
      original: "he have",
      replacement: "he has",
      confidence: "medium",
      excerpt: "Maybe he have the right answer.",
    });
    assert.strictEqual(grammarDecision.apply, false);

    console.log("rag gating tests passed");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

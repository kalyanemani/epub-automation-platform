const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  buildEpubUploadIndex,
  buildKbChunkIndex,
  readUploadIndex,
  runAgenticQuery,
  searchKbChunks,
  searchUploadIndex,
} = require("./src/rag");

async function run() {
  const kbChunks = buildKbChunkIndex();
  assert(kbChunks.length > 0, "Expected local KB chunks to be available");

  const kbResults = searchKbChunks(kbChunks, "default deny external retrieval", {
    limit: 5,
  });
  assert(kbResults.length > 0, "Expected KB query to return results");
  assert(
    kbResults.some((result) => /default policy|external retrieval|allowlist/i.test(result.text)),
    "Expected KB results to contain allowlist-related content"
  );

  const jsKbResults = searchKbChunks(
    kbChunks,
    "inline event handler localStorage module script epub",
    {
      limit: 5,
    }
  );
  assert(jsKbResults.length > 0, "Expected JavaScript-focused KB query to return results");
  assert(
    jsKbResults.some((result) => /script|localstorage|event handler|module/i.test(result.text)),
    "Expected JavaScript KB results to contain scripting guidance"
  );

  const epubPath = path.join(__dirname, "Testing_with_missing_incorrect_text.epub");
  const indexResult = await buildEpubUploadIndex(epubPath, {
    indexId: "test-epub-rag-index",
  });

  assert(indexResult.chunkCount > 0, "Expected EPUB upload index to contain chunks");

  const storedIndex = readUploadIndex("test-epub-rag-index");
  assert(storedIndex, "Expected stored upload index to be readable");

  const uploadResults = searchUploadIndex(storedIndex, "th1rteen-year-old", {
    limit: 5,
  });

  assert(uploadResults.length > 0, "Expected upload index query to return results");
  assert(
    uploadResults.some((result) => /th1rteen-year-old/i.test(result.text)),
    "Expected upload query to surface the indexed EPUB text"
  );

  assert(storedIndex.summary, "Expected upload index summary metadata");
  assert(
    storedIndex.summary.documentCount > 0,
    "Expected upload index summary to track document count"
  );

  const agentic = await runAgenticQuery({
    query: "th1rteen-year-old OCR correction chapter text",
    issue: { id: "T_MISSING_INCORRECT_TEXT", status: "fail" },
    documentType: "epub",
    uploadIndexPayload: storedIndex,
    autoRefresh: false,
    sourceFile: path.basename(epubPath),
  });

  assert(agentic.coverage, "Expected agentic query to return coverage");
  assert(
    agentic.uploadResults.length > 0,
    "Expected agentic query to include upload-grounded results"
  );
  assert.strictEqual(
    agentic.evidencePlan.issueId,
    "T_MISSING_INCORRECT_TEXT",
    "Expected issue-routed evidence plan"
  );

  fs.unlinkSync(path.join(__dirname, "kb", "uploads_index", "test-epub-rag-index.json"));
  console.log("rag retrieval tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

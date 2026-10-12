const assert = require("assert");

const {
  buildTextNormalizationContextFromTexts,
  normalizeHtmlDocument,
  normalizeTextSegment,
} = require("./src/utils/text-normalizer");

const context = buildTextNormalizationContextFromTexts([
  "database information machine learning neural network artificial intelligence sample complete confluence book goes school re-entry well-being co-operate",
  "deep neural network machine learning artificial intelligence report sample text price hello world",
]);

function normalizePlain(text) {
  return normalizeTextSegment(text, context).text;
}

assert.strictEqual(normalizePlain("data- base"), "database");
assert.strictEqual(normalizePlain("infor- mation"), "information");
assert.strictEqual(normalizePlain("re-entry"), "re-entry");
assert.strictEqual(normalizePlain("co-operate"), "co-operate");
assert.strictEqual(normalizePlain("well- being"), "well-being");
assert.strictEqual(normalizePlain("conf luence"), "confluence");
assert.strictEqual(normalizePlain("machinelearning"), "machine learning");
assert.strictEqual(normalizePlain("deep neuralnetwork"), "deep neural network");
assert.strictEqual(normalizePlain("artificialintelligence"), "artificial intelligence");
assert.strictEqual(normalizePlain("This is a sampl text"), "This is a sample text");
assert.strictEqual(normalizePlain("He go to school"), "He goes to school");
assert.strictEqual(normalizePlain("The report is complet"), "The report is complete");
assert.strictEqual(normalizePlain("This may be true"), "This may be true");
assert.strictEqual(normalizePlain("The renewable source is stable"), "The renewable source is stable");
assert.strictEqual(normalizePlain("THE slicyyye of the Tempeyyyyst blade broughtytytyt down chaos"), "THE slice of the Tempest blade brought down chaos");
assert.strictEqual(normalizePlain("Rosedale and Armstrong"), "Rosedale and Armstrong");
assert.strictEqual(normalizePlain("The book was published"), "The book was published");
assert.strictEqual(normalizePlain("A75 SE1 M5H"), "A75 SE1 M5H");
assert.strictEqual(normalizePlain("AT&amp;T"), "AT&T");
assert.strictEqual(normalizePlain("Hello&nbsp;World"), "Hello World");
assert.strictEqual(normalizePlain("It\u00E2\u20AC\u2122s done"), "It\u2019s done");
assert.strictEqual(normalizePlain("Price is 100\u00E2\u201A\u00B9"), "Price is \u20B9100");

const reviewResult = normalizeTextSegment("TODO replace this copy", context);
assert(reviewResult.reviews.some((review) => review.type === "placeholder-or-uncertain-copy"));

const chapterContext = buildTextNormalizationContextFromTexts([
  "a vision i think Sam said stop Mr P like a bodyguard in the dark",
  "I need to clear my head and think while Sam said the vision felt dark",
  "like a bodyguard Mr P said Sam could think in the dark",
]);

const chapterResult = normalizeTextSegment(
  "A vis-ion, Ithink, saidSam. 'Stop,' MrP said. Sam paused. 'Likea bodyguard?' He couldn't be sure r\u00E9sum\u00E9 in the da@rk. I need to clear caf\u00E9 my head.",
  chapterContext
);

assert(chapterResult.text.includes("vision"));
assert(chapterResult.text.includes("I think"));
assert(chapterResult.text.includes("said Sam"));
assert(chapterResult.text.includes("Mr P"));
assert(chapterResult.text.includes("Like a bodyguard"));
assert(chapterResult.text.includes("dark"));
assert(chapterResult.changes.some((change) => change.type === "inline-hyphenation" && change.replacement === "vision"));
assert(chapterResult.changes.some((change) => change.type === "camelcase-spacing" && change.replacement === "said Sam"));
assert(chapterResult.changes.some((change) => change.type === "title-spacing" && change.replacement === "Mr P"));
assert(chapterResult.changes.some((change) => change.type === "symbol-corruption" && change.replacement === "dark"));
assert(chapterResult.reviews.some((review) => review.type === "accent-variant" && review.snippet === "caf\u00E9"));
assert(chapterResult.reviews.some((review) => review.type === "accent-variant" && review.snippet === "r\u00E9sum\u00E9"));

const htmlResult = normalizeHtmlDocument(
  "<p>AT&amp;T data- base re-entry machinelearning He go to school Price is 100\u00E2\u201A\u00B9</p>",
  context
);

assert(htmlResult.content.includes("AT&amp;T"));
assert(htmlResult.content.includes("database"));
assert(htmlResult.content.includes("re-entry"));
assert(htmlResult.content.includes("machine learning"));
assert(htmlResult.content.includes("He goes to school"));
assert(htmlResult.content.includes("\u20B9100"));
assert(!htmlResult.content.includes("data- base"));

const entityResult = normalizeHtmlDocument("<p>AT&T Hello&nbsp;World</p>", context);
assert(entityResult.content.includes("AT&amp;T"));
assert(entityResult.content.includes("Hello World"));

console.log("text-content tests passed");

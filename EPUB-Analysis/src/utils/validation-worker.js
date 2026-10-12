/**
 * Worker thread entry point for EPUB/PDF validation.
 * Runs in a separate thread so synchronous operations (AdmZip extraction,
 * fs.readFileSync, regex processing) don't block the main event loop.
 */
const { workerData, parentPort } = require("worker_threads");
const path = require("path");

// Load .env relative to the EPUB-Analysis root
require("dotenv").config({ path: path.join(__dirname, "../../.env") });

const validateEpub = require("../validateEpub");
const validatePdf = require("../validatePdf");

(async () => {
    const { filePath, isPdf, enrichAiSuggestions } = workerData;

    try {
        parentPort.postMessage({ type: "stage", stage: "validating" });
        const result = isPdf
            ? await validatePdf(filePath, { enrichAiSuggestions })
            : await validateEpub(filePath, { enrichAiSuggestions });
        parentPort.postMessage({ type: "done", result });
    } catch (e) {
        parentPort.postMessage({ type: "error", error: e.message, stack: e.stack });
    }
})();

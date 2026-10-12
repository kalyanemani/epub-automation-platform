const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const { Worker } = require("worker_threads");
const cors = require("cors");
const pdfParse = require("pdf-parse");
const Epub = require("epub-gen");
const { runAutoFix } = require("./src/autofix/autofix-runner");
const validateEpub = require("./src/validateEpub");
const validatePdf = require("./src/validatePdf");
const { runPdfAutoFix } = require("./src/autofix/pdf-autofix");
const {
    buildIssueQuery,
    buildEvidencePlan,
    buildEpubUploadIndex,
    buildFixPlan,
    buildKbChunkIndex,
    buildPdfUploadIndex,
    cleanupCorruptedIndices,
    fetchReferenceSnapshot,
    getAgenticState,
    getRagStatus,
    invalidateKbChunkIndex,
    readUploadIndex,
    routeIssue,
    runAgenticQuery,
    searchKbChunks,
    searchUploadIndex,
    summarizeValidationAgenticCoverage,
    validateSavedIndex,
    verifyAutofixResult,
} = require("./src/rag");
const TextbookService = require("./src/storage/textbook-service");
const { shortTermMemory } = require("./src/memory/short-term-memory");
const { runtimeStore } = require("./src/storage/runtime-store");
const AgentLogger = require("./src/utils/agent-logger");
const {
    getLlmRuntimeConfig,
    getOllamaDiagnostics,
    logOllamaDiagnostics,
} = require("./src/utils/llm-client");
const { REPORT_THRESHOLDS } = require("./src/utils/report-annotator");
const {
    evaluateAutofixReport,
    evaluateValidationReport,
} = require("./src/utils/validator-agent");
const crypto = require("crypto");

const VALIDATION_CACHE = new Map(); // hash → {result, ts}
const CACHE_TTL_MS = 3600_000;      // 1 hour

function getFileHash(filePath) {
    // Use file contents so identical EPUB uploads hit cache regardless of temp mtime.
    try {
        const fileContents = fs.readFileSync(filePath);
        return crypto.createHash("md5").update(fileContents).digest("hex");
    } catch (error) {
        console.warn("Failed to hash file for cache key:", error.message || error);
        return "";
    }
}

function getCachedResult(hash) {
    const entry = VALIDATION_CACHE.get(hash);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL_MS) { VALIDATION_CACHE.delete(hash); return null; }
    return entry.result;
}

function setCachedResult(hash, result) {
    VALIDATION_CACHE.set(hash, { result, ts: Date.now() });
    // Evict old entries if cache > 50 items
    if (VALIDATION_CACHE.size > 50) {
        const oldest = [...VALIDATION_CACHE.entries()].sort((a,b) => a[1].ts - b[1].ts)[0];
        VALIDATION_CACHE.delete(oldest[0]);
    }
}

// ── Async validation job store ────────────────────────────────────────────────
const VALIDATION_JOBS = new Map(); // jobId → { status, result, error, stage, createdAt }
const JOB_TTL_MS = 7_200_000; // 2 hours

function createValidationJob() {
    const jobId = crypto.randomBytes(16).toString("hex");
    VALIDATION_JOBS.set(jobId, { status: "pending", result: null, error: null, stage: "queued", createdAt: Date.now() });
    return jobId;
}

function getValidationJob(jobId) {
    const job = VALIDATION_JOBS.get(jobId);
    if (!job) return null;
    if (Date.now() - job.createdAt > JOB_TTL_MS) { VALIDATION_JOBS.delete(jobId); return null; }
    return job;
}

function updateValidationJob(jobId, updates) {
    const job = VALIDATION_JOBS.get(jobId);
    if (job) Object.assign(job, updates);
}

// Clean up expired jobs every 10 minutes
setInterval(() => {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, job] of VALIDATION_JOBS.entries()) {
        if (job.createdAt < cutoff) VALIDATION_JOBS.delete(id);
    }
}, 600_000);

/**
 * Run validateEpub / validatePdf in a worker thread so that synchronous
 * operations (AdmZip extraction, fs.readFileSync, regex processing) never
 * block the main event loop.  The optional onStage callback receives
 * intermediate stage strings as the worker progresses.
 */
function runValidationWorker(filePath, isPdf, enrichAiSuggestions = false, onStage = null) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(
            path.join(__dirname, "src/utils/validation-worker.js"),
            { workerData: { filePath, isPdf, enrichAiSuggestions } }
        );
        worker.on("message", msg => {
            if (msg.type === "done") {
                resolve(msg.result);
            } else if (msg.type === "error") {
                reject(new Error(msg.error));
            } else if (msg.type === "stage" && typeof onStage === "function") {
                onStage(msg.stage);
            }
        });
        worker.on("error", reject);
        worker.on("exit", code => {
            if (code !== 0) reject(new Error(`Validation worker exited with code ${code}`));
        });
    });
}

const app = express();
const AdmZip = require("adm-zip");

const uploadsDir = path.join(__dirname, "uploads");
function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}
ensureDirectoryExists(uploadsDir);

const uploadepub = multer({ dest: uploadsDir });

function parseBooleanFlag(value, fallback = false) {
    if (typeof value === "boolean") {
        return value;
    }

    if (typeof value === "number") {
        return value !== 0;
    }

    if (typeof value !== "string") {
        return fallback;
    }

    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
        return true;
    }

    if (["0", "false", "no", "off"].includes(normalized)) {
        return false;
    }

    return fallback;
}

function readBooleanEnv(name, fallback = false) {
    return parseBooleanFlag(process.env[name], fallback);
}

function buildLlmStatus(overrides = {}) {
    const runtimeConfig = getLlmRuntimeConfig();
    const aiSuggestionsDefault = readBooleanEnv("ENABLE_AI_SUGGESTIONS", false);
    const textSuggestionsDefault = readBooleanEnv("ENABLE_TEXT_LLM_SUGGESTIONS", false);
    const autofixLlmDefault = readBooleanEnv("ENABLE_LLM_AUTOFIX", false);
    const textAutofixLlmDefault = readBooleanEnv("ENABLE_TEXT_LLM_AUTOFIX", false);
    const pipelineDebugDefault = readBooleanEnv("PIPELINE_DEBUG", false);
    const ragDebugDefault = readBooleanEnv("RAG_DEBUG", pipelineDebugDefault);
    const llmDebugDefault = readBooleanEnv("LLM_DEBUG", pipelineDebugDefault);

    const aiSuggestionsEffective =
        typeof overrides.enableAiSuggestions === "boolean"
            ? overrides.enableAiSuggestions
            : aiSuggestionsDefault;
    const autofixLlmEffective =
        typeof overrides.enableLlmFixes === "boolean"
            ? overrides.enableLlmFixes
            : autofixLlmDefault;

    return {
        serverEntry: path.basename(__filename),
        defaults: {
            enableAiSuggestions: aiSuggestionsDefault,
            enableTextLlmSuggestions: textSuggestionsDefault,
            enableLlmAutofix: autofixLlmDefault,
            enableTextLlmAutofix: textAutofixLlmDefault,
            pipelineDebug: pipelineDebugDefault,
            ragDebug: ragDebugDefault,
            llmDebug: llmDebugDefault,
        },
        effective: {
            enableAiSuggestions: aiSuggestionsEffective,
            enableTextLlmSuggestions: textSuggestionsDefault,
            enableLlmAutofix: autofixLlmEffective,
            enableTextLlmAutofix: textAutofixLlmDefault,
            pipelineDebug: pipelineDebugDefault,
            ragDebug: ragDebugDefault,
            llmDebug: llmDebugDefault,
        },
        providers: {
            remoteEndpoint: runtimeConfig.remoteEndpoint,
            remoteEnabled: runtimeConfig.remoteEnabled,
            preferLocal: runtimeConfig.preferLocal,
            remoteTimeoutMs: runtimeConfig.remoteTimeoutMs,
            ollama: {
                baseUrl: runtimeConfig.ollama.baseUrl,
                primaryUrl: runtimeConfig.ollama.primaryUrl,
                fallbackUrl: runtimeConfig.ollama.fallbackUrl,
                timeoutMs: runtimeConfig.ollama.timeoutMs,
            },
            models: runtimeConfig.models,
        },
    };
}

function agenticKbRefreshEnabled(value) {
    if (typeof value === "boolean") {
        return value;
    }

    return readBooleanEnv("ENABLE_AGENTIC_KB_REFRESH", false);
}

function extractFixableIssueIds(report = {}) {
    const results = Array.isArray(report?.results) ? report.results : [];
    return Array.from(
        new Set(
            results
                .filter((result) => result.status === "fail" || result.status === "warn")
                .map((result) => result.id)
        )
    );
}

function safeUnlink(filePath) {
    try {
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (error) {
        console.warn("Failed to cleanup upload:", filePath);
    }
}

function buildDownloadUrl(id, requestedName = "") {
    if (!requestedName) {
        return `/download/${id}`;
    }

    return `/download/${id}?filename=${encodeURIComponent(requestedName)}`;
}

function safeAsyncSideEffect(promiseFactory, label) {
    Promise.resolve()
        .then(promiseFactory)
        .catch((error) => {
            console.warn(`${label}: ${error.message}`);
        });
}

function persistOutputArtifact(sourcePath, artifactId) {
    if (!sourcePath || !artifactId || !fs.existsSync(sourcePath)) {
        return null;
    }

    const outputsDir = path.join(__dirname, "outputs");
    if (!fs.existsSync(outputsDir)) {
        fs.mkdirSync(outputsDir, { recursive: true });
    }

    const extension = path.extname(sourcePath);
    const outputPath = path.join(outputsDir, `${artifactId}${extension}`);
    fs.copyFileSync(sourcePath, outputPath);
    return outputPath;
}

function attachAgenticInsights(results = [], agenticRag = null) {
    const analyses = Array.isArray(agenticRag?.analyses) ? agenticRag.analyses : [];
    if (!analyses.length) {
        return results;
    }

    const analysisByIssueId = new Map(
        analyses
            .filter((analysis) => analysis?.issueId)
            .map((analysis) => [analysis.issueId, analysis])
    );

    return results.map((result) => {
        const insight = analysisByIssueId.get(result.id);
        if (!insight) {
            return result;
        }

        return {
            ...result,
            agentic: {
                query: insight.query,
                route: insight.route || null,
                coverage: insight.coverage || null,
                sources: insight.sources || [],
                topKbResults: insight.topKbResults || [],
                topUploadResults: insight.topUploadResults || [],
                refresh: insight.refresh || null,
            },
        };
    });
}

function isZipLikeFile(filePath) {
    try {
        const fd = fs.openSync(filePath, "r");
        const header = Buffer.alloc(4);

        try {
            fs.readSync(fd, header, 0, 4, 0);
        } finally {
            fs.closeSync(fd);
        }

        return (
            header[0] === 0x50 &&
            header[1] === 0x4b &&
            (header[2] === 0x03 || header[2] === 0x05 || header[2] === 0x07) &&
            (header[3] === 0x04 || header[3] === 0x06 || header[3] === 0x08)
        );
    } catch (error) {
        return false;
    }
}

function isPdfLikeFile(filePath) {
    try {
        const fd = fs.openSync(filePath, "r");
        const header = Buffer.alloc(4);

        try {
            fs.readSync(fd, header, 0, 4, 0);
        } finally {
            fs.closeSync(fd);
        }

        return header.toString("ascii") === "%PDF";
    } catch (error) {
        return false;
    }
}

function findOutputFileById(id) {
    const outputsDir = path.join(__dirname, "outputs");
    if (!fs.existsSync(outputsDir)) {
        return null;
    }

    const match = fs
        .readdirSync(outputsDir)
        .find((filename) =>
            filename === `${id}.epub` ||
            filename === `${id}.pdf` ||
            filename === `${id}.html`
        );

    return match ? path.join(outputsDir, match) : null;
}

function getDownloadMetadata(filePath, requestedName) {
    const extension = path.extname(filePath).toLowerCase();
    const fallbackName = path.basename(filePath);
    const safeRequestedName = requestedName
        ? path.basename(String(requestedName))
        : "";

    if (extension === ".pdf") {
        const filename = safeRequestedName || fallbackName;
        return {
            filename: filename.toLowerCase().endsWith(".pdf") ? filename : `${filename}.pdf`,
            mimeType: "application/pdf",
        };
    }

    if (extension === ".html") {
        const filename = safeRequestedName || fallbackName;
        return {
            filename: filename.toLowerCase().endsWith(".html") ? filename : `${filename}.html`,
            mimeType: "text/html; charset=utf-8",
        };
    }

    const filename = safeRequestedName || fallbackName;
    return {
        filename: filename.toLowerCase().endsWith(".epub") ? filename : `${filename}.epub`,
        mimeType: "application/epub+zip",
    };
}

function resolveCalibreExecutable() {
    const candidates = [
        process.env.CALIBRE_EBOOK_CONVERT,
        process.env.CALIBRE_EXE,
        process.env.CALIBRE_HOME
            ? path.join(process.env.CALIBRE_HOME, "ebook-convert.exe")
            : null,
        "C:\\Program Files\\Calibre2\\ebook-convert.exe",
        "C:\\Apps\\CalibrePortable\\Calibre Portable\\Calibre\\ebook-convert.exe",
        process.env.LOCALAPPDATA
            ? path.join(process.env.LOCALAPPDATA, "Apps", "Calibre2", "ebook-convert.exe")
            : null,
    ].filter(Boolean);

    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

const calibreExecutable = resolveCalibreExecutable();
const calibreRuntimeDir = path.join(__dirname, "calibre-runtime");
const calibreConfigDir = path.join(calibreRuntimeDir, "config");
const calibreCacheDir = path.join(calibreRuntimeDir, "cache");
const calibreTempDir = path.join(calibreRuntimeDir, "temp");

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Initialize the storage provider and short-term memory layer on startup.
runtimeStore.initialize().catch((error) => {
    console.error("[Storage] Startup initialization failed:", error.message);
});
shortTermMemory.initialize().catch((error) => {
    console.error("[Memory] Startup initialization failed:", error.message);
});

// --- Living Textbook Registry Endpoints ---

// Register new textbook
app.post("/textbooks", async (req, res) => {
    try {
        const { name, originalFilename } = req.body;
        if (!name) return res.status(400).json({ error: "Textbook name is required" });
        const textbook = await TextbookService.createTextbook(name, originalFilename);
        res.json({ ok: true, textbook });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// List all textbooks
app.get("/textbooks", async (req, res) => {
    try {
        const textbooks = await TextbookService.listTextbooks();
        res.json({ ok: true, textbooks });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get textbook history (editions and runs)
app.get("/textbooks/:id/history", async (req, res) => {
    try {
        const history = await TextbookService.getHistory(req.params.id);
        res.json({ ok: true, textbook_id: req.params.id, history });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/llm-status", async (req, res) => {
    const enableAiSuggestions = parseBooleanFlag(
        req.query?.aiSuggestions,
        undefined
    );
    const enableLlmFixes = parseBooleanFlag(
        req.query?.llmFixes,
        undefined
    );
    const includeGenerateProbe = parseBooleanFlag(req.query?.probe, false);

    try {
        const diagnostics = await getOllamaDiagnostics({
            includeGenerateProbe,
        });

        res.json({
            ok: true,
            llm: {
                ...buildLlmStatus({
                    enableAiSuggestions:
                        typeof req.query?.aiSuggestions === "undefined"
                            ? undefined
                            : enableAiSuggestions,
                    enableLlmFixes:
                        typeof req.query?.llmFixes === "undefined"
                            ? undefined
                            : enableLlmFixes,
                }),
                diagnostics,
            },
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            error: "Failed to collect LLM diagnostics",
            details: error.message,
            llm: buildLlmStatus({
                enableAiSuggestions:
                    typeof req.query?.aiSuggestions === "undefined"
                        ? undefined
                        : enableAiSuggestions,
                enableLlmFixes:
                    typeof req.query?.llmFixes === "undefined"
                        ? undefined
                        : enableLlmFixes,
            }),
        });
    }
});

app.get("/rag/status", (req, res) => {
    res.json({
        ok: true,
        rag: getRagStatus(),
    });
});

app.post("/rag/reindex-kb", (req, res) => {
    invalidateKbChunkIndex();
    const chunks = buildKbChunkIndex();
    res.json({
        ok: true,
        chunkCount: chunks.length,
    });
});

app.post("/rag/route-issue", (req, res) => {
    const issue = req.body?.issue;
    if (!issue || !issue.id) {
        return res.status(400).json({ error: "issue.id is required" });
    }

    const documentType = req.body?.documentType || "epub";
    res.json({
        ok: true,
        route: routeIssue({
            issue,
            documentType,
        }),
    });
});

app.post("/rag/evidence-plan", (req, res) => {
    const issue = req.body?.issue;
    if (!issue || !issue.id) {
        return res.status(400).json({ error: "issue.id is required" });
    }

    const documentType = req.body?.documentType || "epub";
    res.json({
        ok: true,
        plan: buildEvidencePlan({
            issue,
            documentType,
            limit: req.body?.limit || 8,
        }),
    });
});

app.post("/rag/query-kb", (req, res) => {
    const query = String(req.body?.query || "").trim();
    if (!query) {
        return res.status(400).json({ error: "query is required" });
    }

    const issue = req.body?.issue || null;
    const documentType = req.body?.documentType || "epub";
    const evidencePlan = issue?.id
        ? buildEvidencePlan({
            issue,
            documentType,
            limit: req.body?.sourceLimit || 8,
        })
        : null;
    const sourceIds = evidencePlan?.sources?.map((source) => source.id) || [];
    const results = searchKbChunks(
        buildKbChunkIndex(),
        query,
        {
            limit: req.body?.limit || 8,
            sourceIds,
        }
    );

    res.json({
        ok: true,
        evidencePlan,
        results,
    });
});

app.get("/rag/agentic-state", (req, res) => {
    res.json({
        ok: true,
        state: getAgenticState(),
    });
});

app.post("/rag/agentic-query", async (req, res) => {
    try {
        const query = String(req.body?.query || "").trim();
        if (!query) {
            return res.status(400).json({ error: "query is required" });
        }

        const result = await runAgenticQuery({
            query,
            issue: req.body?.issue || null,
            documentType: req.body?.documentType || "epub",
            uploadIndexId: String(req.body?.uploadIndexId || "").trim(),
            autoRefresh: parseBooleanFlag(
                req.body?.autoRefresh,
                agenticKbRefreshEnabled()
            ),
            forceRefresh: parseBooleanFlag(req.body?.forceRefresh, false),
            kbLimit: req.body?.kbLimit || 6,
            uploadLimit: req.body?.uploadLimit || 6,
            sourceLimit: req.body?.sourceLimit || 8,
            timeoutMs: req.body?.timeoutMs,
            sourceFile: req.body?.sourceFile || "",
        });

        res.json({
            ok: true,
            ...result,
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post("/rag/fetch-reference", async (req, res) => {
    try {
        const url = String(req.body?.url || "").trim();
        if (!url) {
            return res.status(400).json({ error: "url is required" });
        }

        const snapshot = await fetchReferenceSnapshot(url, {
            forceRefresh: parseBooleanFlag(req.body?.forceRefresh, false),
            timeoutMs: req.body?.timeoutMs,
        });

        res.json({
            ok: true,
            snapshot,
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post("/rag/index-upload", uploadepub.single("file"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "file is required" });
        }

        const documentType = isPdfLikeFile(req.file.path)
            ? "pdf"
            : isZipLikeFile(req.file.path)
                ? "epub"
                : "";

        if (!documentType) {
            safeUnlink(req.file.path);
            return res.status(400).json({ error: "Only PDF and EPUB files are supported" });
        }

        const indexResult = documentType === "pdf"
            ? await buildPdfUploadIndex(req.file.path, { indexId: req.body?.indexId })
            : await buildEpubUploadIndex(req.file.path, { indexId: req.body?.indexId });

        safeUnlink(req.file.path);
        res.json({
            ok: true,
            indexId: indexResult.indexId,
            documentType: indexResult.documentType,
            sourceFile: indexResult.sourceFile,
            chunkCount: indexResult.chunkCount,
            summary: indexResult.summary || null,
            integrity: indexResult.integrity || null,
            batchStats: indexResult.batchStats || null,
            savedTo: indexResult.savedTo,
        });
    } catch (error) {
        safeUnlink(req.file?.path);
        res.status(500).json({ error: error.message });
    }
});

app.get("/rag/index-health/:indexId", (req, res) => {
    const status = validateSavedIndex(req.params.indexId, { rewrite: false });
    if (!status) {
        return res.status(404).json({ error: "Upload index not found" });
    }

    res.json({
        ok: true,
        ...status,
    });
});

app.post("/rag/index-cleanup/:indexId", (req, res) => {
    const status = validateSavedIndex(req.params.indexId, { rewrite: true });
    if (!status) {
        return res.status(404).json({ error: "Upload index not found" });
    }

    res.json({
        ok: true,
        ...status,
    });
});

app.post("/rag/index-cleanup", (req, res) => {
    const results = cleanupCorruptedIndices({ rewrite: true });
    res.json({
        ok: true,
        indexCount: results.length,
        results,
    });
});

app.post("/rag/query-upload/:indexId", (req, res) => {
    const query = String(req.body?.query || "").trim();
    if (!query) {
        return res.status(400).json({ error: "query is required" });
    }

    const uploadIndex = readUploadIndex(req.params.indexId);
    if (!uploadIndex) {
        return res.status(404).json({ error: "Upload index not found" });
    }

    const results = searchUploadIndex(uploadIndex, query, {
        limit: req.body?.limit || 8,
    });

    res.json({
        ok: true,
        indexId: uploadIndex.indexId,
        documentType: uploadIndex.documentType,
        sourceFile: uploadIndex.sourceFile,
        results,
    });
});

app.post("/rag/query", async (req, res) => {
    const query = String(req.body?.query || "").trim();
    if (!query) {
        return res.status(400).json({ error: "query is required" });
    }

    try {
        const agentic = await runAgenticQuery({
            query,
            issue: req.body?.issue || null,
            documentType: req.body?.documentType || "epub",
            uploadIndexId: String(req.body?.uploadIndexId || "").trim(),
            autoRefresh: parseBooleanFlag(
                req.body?.autoRefresh,
                agenticKbRefreshEnabled()
            ),
            forceRefresh: parseBooleanFlag(req.body?.forceRefresh, false),
            kbLimit: req.body?.kbLimit || 6,
            uploadLimit: req.body?.uploadLimit || 6,
            sourceLimit: req.body?.sourceLimit || 8,
            timeoutMs: req.body?.timeoutMs,
            sourceFile: req.body?.sourceFile || "",
        });

        res.json({
            ok: true,
            evidencePlan: agentic.evidencePlan,
            upload: agentic.upload,
            kbResults: agentic.kbResults,
            uploadResults: agentic.uploadResults,
            agentic: {
                coverage: agentic.coverage,
                refresh: agentic.refresh,
            },
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.get("/api/textbooks", async (req, res) => {
    try {
        res.json(await TextbookService.listTextbooks());
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/api/history/:textbookId", async (req, res) => {
    try {
        res.json(await TextbookService.getHistory(req.params.textbookId));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/api/logs", async (req, res) => {
    try {
        res.json(await runtimeStore.listLogs());
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/api/storage/status", async (req, res) => {
    try {
        res.json(await runtimeStore.getStatus());
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/api/memory/status", async (req, res) => {
    try {
        res.json(await shortTermMemory.getStatus());
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/validate", uploadepub.single("file"), async (req, res) => {
    let runId = "";

    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
        }
        
        AgentLogger.log("FILE_UPLOAD", "Server", { endpoint: "/validate", filename: req.file.originalname });
        
        const { textbook, edition } = await TextbookService.createTextbook(req.file.originalname, req.file.originalname);
        runId = await TextbookService.createRun(edition.id);
        await shortTermMemory.setRunContext(runId, {
            runId,
            textbookId: textbook.id,
            editionId: edition.id,
            sourceFile: req.file.originalname,
            workflow: "validation",
            documentType: isPdfLikeFile(req.file.path) ? "pdf" : "epub",
            status: "running",
            stage: "validation_started",
            createdAt: new Date().toISOString(),
        });
        
        const enableAiSuggestions = parseBooleanFlag(
            req.body?.enableAiSuggestions ?? req.query?.aiSuggestions,
            false
        );
        const isPdfUpload = isPdfLikeFile(req.file.path);

        // Check cache
        const fileHash = getFileHash(req.file.path);
        const cachedResult = getCachedResult(fileHash);
        if (cachedResult) {
            AgentLogger.log("CACHE_HIT", "Server", { hash: fileHash, filename: req.file.originalname });
            // Clean up uploaded file
            try { fs.unlinkSync(req.file.path); } catch (_) {}
            return res.json({ ...cachedResult, cached: true });
        }

        // Run in a worker thread so synchronous ZIP extraction and file reads
        // don't block the main event loop (and don't prevent the timeout from firing).
        const VALIDATE_TIMEOUT_MS = parseInt(process.env.VALIDATE_TIMEOUT_MS || "7200000", 10);
        const validatePromise = runValidationWorker(req.file.path, isPdfUpload, enableAiSuggestions);
        const result = await Promise.race([
            validatePromise,
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Validation exceeded ${Math.round(VALIDATE_TIMEOUT_MS / 60000)}min limit`)), VALIDATE_TIMEOUT_MS)
            ),
        ]);
        setCachedResult(fileHash, result);

        // ── Respond immediately — no waiting for RAG indexing or HTML report ──
        const enrichedResults = attachAgenticInsights(result.results || [], null);
        const validatorAgent = evaluateValidationReport({
            results: enrichedResults,
            documentType: result.documentType || (isPdfUpload ? "pdf" : "epub"),
            sourceFile: req.file.originalname,
        });

        const responsePayload = {
            ...result,
            results: enrichedResults,
            reportPath: "",
            reportUrl: "",
            htmlReportId: null,
            htmlReportUrl: "",
            agenticRag: null,
            thresholds: REPORT_THRESHOLDS,
            validatorAgent,
        };

        AgentLogger.log("VALIDATION_COMPLETE", "Server", { runId, issueCount: enrichedResults.length });

        // Capture before async hand-off (req may be GC'd)
        const capturedFilePath = req.file.path;
        const capturedOriginalName = req.file.originalname;

        // Respond FIRST — storage writes happen after response is flushed
        res.json({
            ...responsePayload,
            textbook_id: textbook.id,
            run_id: runId,
            llm: buildLlmStatus({ enableAiSuggestions }),
        });

        // Non-blocking: persist run record (writes full report JSON to disk)
        safeAsyncSideEffect(async () => {
            await TextbookService.finishRun(runId, responsePayload, "completed");
            await shortTermMemory.updateRunContext(runId, {
                status: "completed",
                stage: "validation_completed",
                issueCount: enrichedResults.length,
                completedAt: new Date().toISOString(),
            });
        }, "[Storage] Failed to persist run record");

        // ── Background: RAG indexing + HTML report (non-blocking) ────────────
        safeAsyncSideEffect(async () => {
            try {
                const uploadIndex = isPdfUpload
                    ? await buildPdfUploadIndex(capturedFilePath)
                    : await buildEpubUploadIndex(capturedFilePath);
                const enableAgenticKbRefresh = parseBooleanFlag(
                    req.body?.agenticKbRefresh ?? req.query?.agenticKbRefresh,
                    agenticKbRefreshEnabled()
                );
                await summarizeValidationAgenticCoverage({
                    report: result,
                    documentType: uploadIndex.documentType,
                    uploadIndexPayload: uploadIndex,
                    autoRefresh: enableAgenticKbRefresh,
                    sourceFile: capturedOriginalName,
                });
            } finally {
                safeUnlink(capturedFilePath);
            }
            try {
                const { generateHtmlReport } = require("./src/generators/html-report-generator");
                generateHtmlReport(
                    enrichedResults,
                    path.join(__dirname, "outputs"),
                    {
                        documentType: result.documentType || (isPdfUpload ? "pdf" : "epub"),
                        sourceFile: capturedOriginalName,
                        thresholds: REPORT_THRESHOLDS,
                        validatorAgent,
                    }
                );
            } catch (_) {}
        }, "[Background] Post-validation indexing/report failed");
    } catch (e) {
        if (runId) {
            safeAsyncSideEffect(
                () => shortTermMemory.updateRunContext(runId, {
                    status: "failed",
                    stage: "validation_failed",
                    error: e.message,
                    completedAt: new Date().toISOString(),
                }),
                "[Memory] Failed to mark validation run context"
            );
            safeAsyncSideEffect(
                () => TextbookService.finishRun(runId, { error: e.message }, "failed"),
                "[Storage] Failed to mark validation run"
            );
        }
        safeUnlink(req.file?.path);
        AgentLogger.log("ERROR", "Server", { error: e.message });
        console.error("Validation failed:", e);
        res.status(500).json({ error: e.message || "Validation failed" });
    }
});

// ── Async validation: submit ──────────────────────────────────────────────────
// Returns a jobId immediately; validation runs in the background with no timeout.
app.post("/validate-async", uploadepub.single("file"), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
    }

    const jobId = createValidationJob();
    res.json({ jobId, status: "pending" });

    // Run validation fully in background — no HTTP timeout constraints
    (async () => {
        const filePath = req.file.path;
        const originalName = req.file.originalname;
        const isPdfUpload = isPdfLikeFile(filePath);
        const _jobStart = Date.now();

        try {
            updateValidationJob(jobId, { status: "running", stage: "checking_cache", startedAt: _jobStart });

            const fileHash = getFileHash(filePath);
            const cachedResult = getCachedResult(fileHash);

            let result;
            if (cachedResult) {
                result = { ...cachedResult, cached: true };
            } else {
                updateValidationJob(jobId, { stage: "validating" });
                // Run in worker thread — synchronous operations (AdmZip, readFileSync)
                // don't block the main loop so polling requests can still be served.
                result = await runValidationWorker(
                    filePath,
                    isPdfUpload,
                    false,
                    (stage) => updateValidationJob(jobId, { stage })
                );
                setCachedResult(fileHash, result);
            }

            const enrichedResults = attachAgenticInsights(result.results || [], null);
            const validatorAgent = evaluateValidationReport({
                results: enrichedResults,
                documentType: result.documentType || (isPdfUpload ? "pdf" : "epub"),
                sourceFile: originalName,
            });

            const responsePayload = {
                ...result,
                results: enrichedResults,
                reportPath: "",
                reportUrl: "",
                htmlReportId: null,
                htmlReportUrl: "",
                agenticRag: null,
                thresholds: REPORT_THRESHOLDS,
                validatorAgent,
                llm: buildLlmStatus({ enableAiSuggestions: false }),
            };

            const _jobElapsed = Date.now() - _jobStart;
            responsePayload._timing = { total_ms: _jobElapsed };
            updateValidationJob(jobId, { status: "done", stage: "complete", result: responsePayload, elapsed_ms: _jobElapsed });
            AgentLogger.log("TIMING", "AsyncJob", { jobId, total_ms: _jobElapsed, cached: !!cachedResult });
            AgentLogger.log("VALIDATION_COMPLETE", "AsyncJob", { jobId, issueCount: enrichedResults.length, total_ms: _jobElapsed });
        } catch (e) {
            updateValidationJob(jobId, { status: "failed", stage: "error", error: e.message });
            AgentLogger.log("ERROR", "AsyncJob", { jobId, error: e.message });
            console.error(`Async validation job ${jobId} failed:`, e);
        } finally {
            safeUnlink(filePath);
        }
    })();
});

// ── Async validation: poll status ─────────────────────────────────────────────
app.get("/validate-status/:jobId", (req, res) => {
    const job = getValidationJob(req.params.jobId);
    if (!job) {
        return res.status(404).json({ error: "Job not found or expired (2h TTL)" });
    }
    if (job.status === "done") {
        return res.json({ status: "done", stage: job.stage, result: job.result, elapsed_ms: job.elapsed_ms });
    }
    if (job.status === "failed") {
        return res.json({ status: "failed", stage: job.stage, error: job.error, elapsed_ms: job.elapsed_ms });
    }
    const runningFor = job.startedAt ? Date.now() - job.startedAt : null;
    return res.json({ status: job.status, stage: job.stage, running_ms: runningFor });
});

app.post("/autofix", uploadepub.single("file"), async (req, res) => {
    console.log("/autofix called");
    const autofixTaskId = crypto.randomUUID();

    try {
        if (!req.file) {
            return res.status(400).json({ error: "File missing" });
        }

        await shortTermMemory.setTaskState(autofixTaskId, {
            taskId: autofixTaskId,
            workflow: "autofix",
            status: "running",
            sourceFile: req.file.originalname,
            startedAt: new Date().toISOString(),
        });

        const report = req.body.report
            ? typeof req.body.report === "string"
                ? JSON.parse(req.body.report)
                : req.body.report
            : null;

        if (isPdfLikeFile(req.file.path)) {
            const pdfReport = report || await validatePdf(req.file.path, {
                enrichAiSuggestions: false,
            });
            const fixPlan = buildFixPlan({
                report: pdfReport,
                documentType: "pdf",
            });
            const fixedPdf = await runPdfAutoFix({
                pdfPath: req.file.path,
                report: pdfReport,
            });

            const id = crypto.randomUUID();
            const outputPath = path.join("outputs", `${id}.pdf`);
            fs.renameSync(fixedPdf.fixedPdfPath, outputPath);
            safeUnlink(req.file.path);
            const verifyAfterFix = parseBooleanFlag(
                req.body?.verifyAutofix ?? req.query?.verifyAutofix,
                true
            );
            const verification = verifyAfterFix
                ? await verifyAutofixResult({
                    documentType: "pdf",
                    filePath: outputPath,
                    originalReport: pdfReport,
                    targetedIssueIds: extractFixableIssueIds(pdfReport),
                })
                : null;

            await shortTermMemory.setTaskState(autofixTaskId, {
                taskId: autofixTaskId,
                workflow: "autofix",
                documentType: "pdf",
                status: "completed",
                fixedFileId: id,
                sourceFile: req.file.originalname,
                completedAt: new Date().toISOString(),
            });

            return res.json({
                success: true,
                autofixTaskId,
                fixedEpubId: id,
                fixedPdfId: id,
                fixedFileId: id,
                downloadUrl: `/download/${id}`,
                fileType: "pdf",
                downloadExtension: ".pdf",
                mimeType: "application/pdf",
                downloadFileName: `${path.parse(req.file.originalname).name || "fixed"}.fixed.pdf`,
                replacementsApplied: fixedPdf.replacementsApplied,
                pagesTouched: fixedPdf.pagesTouched,
                verification,
                agenticRag: {
                    plan: fixPlan.summary,
                    issueCount: fixPlan.issueCount,
                },
                llm: buildLlmStatus({
                    enableAiSuggestions: false,
                    enableLlmFixes: false,
                }),
            });
        }

        if (!isZipLikeFile(req.file.path)) {
            safeUnlink(req.file.path);
            return res.status(400).json({
                error:
                    "Autofix expects an EPUB upload. Convert the PDF first, then upload the generated .epub file to /autofix.",
            });
        }

        if (!report) {
            console.log("No report supplied to /autofix; validating EPUB before autofix.");
            report = await validateEpub(req.file.path, {
                enrichAiSuggestions: false,
                skipVisualChecks: true,
            });
        }

        if (!report) {
            return res.status(400).json({ error: "Report missing" });
        }

        const enableLlmFixes = parseBooleanFlag(
            req.body?.enableLlmFixes ?? req.query?.llmFixes,
            true
        );
        const autofixResult = await runAutoFix({
            epubPath: req.file.path,
            report,
            enableLlmFixes,
            collectDetails: true,
        });
        const fixedEpubPath = autofixResult.fixedEpubPath;

        const id = crypto.randomUUID();
        const outputPath = path.join("outputs", `${id}.epub`);
        fs.renameSync(fixedEpubPath, outputPath);
        safeUnlink(req.file.path);
        const verifyAfterFix = parseBooleanFlag(
            req.body?.verifyAutofix ?? req.query?.verifyAutofix,
            true
        );
        const verification = verifyAfterFix
            ? await verifyAutofixResult({
                documentType: "epub",
                filePath: outputPath,
                originalReport: report,
                targetedIssueIds: autofixResult.fixedNodeRules,
            })
            : null;

        let htmlReportId = null;
        let htmlReportUrl = "";
        const postResults = verification
            ? verification.results || (verification.report && verification.report.results) || []
            : [];
        const validatorAgent = evaluateAutofixReport({
            preResults: report.results || [],
            postResults,
            verification,
            documentType: "epub",
            sourceFile: req.file.originalname,
        });
        if (report && report.results) {
            const { generateFixHtmlReport } = require("./src/generators/html-report-generator");
            const outputDir = path.join(__dirname, "outputs");
            const fixReportPath = generateFixHtmlReport(report.results, postResults, outputDir, {
                documentType: "epub",
                sourceFile: req.file.originalname,
                thresholds: REPORT_THRESHOLDS,
                validatorAgent,
                verification,
            });
            
            // Map the report output so it can be downloaded by `/download/:id`
            htmlReportId = `${id}_report`;
            const reportOutputPath = path.join(outputDir, `${htmlReportId}.html`);
            if (fs.existsSync(fixReportPath)) {
                fs.renameSync(fixReportPath, reportOutputPath);
            }
            htmlReportUrl = buildDownloadUrl(
                htmlReportId,
                `${path.parse(req.file.originalname).name || "fixed"}.autofix-report.html`
            );
        }

        await shortTermMemory.setTaskState(autofixTaskId, {
            taskId: autofixTaskId,
            workflow: "autofix",
            documentType: "epub",
            status: "completed",
            fixedFileId: id,
            sourceFile: req.file.originalname,
            completedAt: new Date().toISOString(),
        });

        const nodeFixCount = autofixResult.fixedNodeRules?.length || 0;
        const textFixCount = autofixResult.textFixResult?.replacementsApplied || 0;
        const altFixCount  = autofixResult.altFixCount || 0;

        res.json({
            success: true,
            autofixTaskId,
            htmlReportId,
            htmlReportUrl,
            fixedEpubId: id,
            fixedFileId: id,
            downloadUrl: `/download/${id}`,
            fileType: "epub",
            downloadExtension: ".epub",
            mimeType: "application/epub+zip",
            downloadFileName: `${path.parse(req.file.originalname).name || "fixed"}.fixed.epub`,
            fixesApplied: nodeFixCount + textFixCount + altFixCount,
            fixesFailed: 0,
            fixedRules: autofixResult.fixedNodeRules || [],
            verification,
            agenticRag: {
                plan: autofixResult.fixPlan?.summary || {},
                issueCount: autofixResult.fixPlan?.issueCount || 0,
                structuredProposals: autofixResult.textFixResult?.proposals?.length || 0,
            },
            textFixSummary: autofixResult.textFixResult
                ? {
                    filesTouched: autofixResult.textFixResult.filesTouched,
                    replacementsApplied: autofixResult.textFixResult.replacementsApplied,
                    manualReviewCount: autofixResult.textFixResult.manualReviewCount,
                    changesByType: autofixResult.textFixResult.changesByType,
                    llmAutofix: autofixResult.textFixResult.llmAutofix || null,
                }
                : null,
            thresholds: REPORT_THRESHOLDS,
            validatorAgent,
            llm: buildLlmStatus({
                enableLlmFixes,
            }),
        });
    } catch (e) {
        safeAsyncSideEffect(
            () => shortTermMemory.setTaskState(autofixTaskId, {
                taskId: autofixTaskId,
                workflow: "autofix",
                status: "failed",
                error: e.message,
                completedAt: new Date().toISOString(),
            }),
            "[Memory] Failed to mark autofix task"
        );
        safeUnlink(req.file?.path);
        console.error("Autofix failed:", e);
        res.status(500).json({ error: e.message });
    }
});

// app.post("/autofix", uploadepub.single("file"), async (req, res) => {
//   console.log("/autofix called");
//   try {
//     console.log("file:", req.file?.path);
//     console.log("report present:", !!req.body.report);
//     if (!req.file || !req.body.report) {
//       console.log("missing file or report");
//       return res.status(400).json({ error: "File or report missing" });
//     }
//
//     const report =
//       typeof req.body.report === "string"
//         ? JSON.parse(req.body.report)
//         : req.body.report;
//     console.log("total rules:", report.results?.length);
//     const fixedEpubPath = await runAutoFix({
//       epubPath: req.file.path,
//       report
//     });
//     console.log("fixed epub path:", fixedEpubPath);
//     res.download(fixedEpubPath, "fixed.epub", () => {
//       try {
//         fs.unlinkSync(req.file.path);
//       } catch (e) {}
//     });
//
//   } catch (e) {
//     console.error("Autofix failed:", e);
//     res.status(500).json({ error: e.message });
//   }
// });

app.get("/download/:id", (req, res) => {
    const filePath = findOutputFileById(req.params.id);
    if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found" });
    }

    const download = getDownloadMetadata(filePath, req.query?.filename);
    res.setHeader("Content-Type", download.mimeType);
    res.setHeader("X-Download-File-Type", path.extname(filePath).replace(".", "").toLowerCase());
    res.download(filePath, download.filename);
});

if (process.platform === "win32" && calibreExecutable) {
    const calibreDir = path.dirname(calibreExecutable);
    [calibreRuntimeDir, calibreConfigDir, calibreCacheDir, calibreTempDir].forEach((dir) => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
    process.env.CALIBRE_CONFIG_DIRECTORY = calibreConfigDir;
    process.env.CALIBRE_CACHE_DIRECTORY = calibreCacheDir;
    process.env.CALIBRE_TEMP_DIR = calibreTempDir;
    if (!process.env.PATH.includes(calibreDir)) {
        process.env.PATH = `${process.env.PATH};${calibreDir}`;
        console.log(`Added Calibre to process.env.PATH: ${calibreDir}`);
    }
    console.log(`Using Calibre executable: ${calibreExecutable}`);
    console.log(`Using Calibre runtime directories: ${calibreRuntimeDir}`);
} else if (process.platform === "win32") {
    console.warn("Calibre executable NOT FOUND in configured or known locations");
}

const uploadDir = path.join(__dirname, "upload");
const outputDir = path.join(__dirname, "outputs");

[uploadDir, outputDir].forEach((dir) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + "-" + file.originalname);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024 },
});

app.post("/convert", upload.single("pdf"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No PDF file uploaded" });
        }

        const inputPath = req.file.path;
        const originalName = path.basename(req.file.originalname, ".pdf");
        const outputFilename = `${originalName}.epub`;
        const outputPath = path.join(outputDir, outputFilename);

        console.log(`Using Calibre to convert: ${req.file.originalname} -> ${outputFilename} (EPUB 3)`);

        if (!calibreExecutable) {
            throw new Error(
                "Calibre executable not found. Set CALIBRE_EBOOK_CONVERT or install Calibre in a supported location."
            );
        }

        const { execFile } = require("child_process");
        const calibreArgs = [
            inputPath,
            outputPath,
            "--authors=Calibre Service",
            `--title=${originalName}`,
            "--epub-version",
            "3",
            "--enable-heuristics",
            "--disable-font-rescaling",
            "--no-default-epub-cover",
            "--linearize-tables",
        ];

        await new Promise((resolve, reject) => {
            execFile(calibreExecutable, calibreArgs, (error, stdout, stderr) => {
                if (error) {
                    console.error("Calibre Stderr:", stderr);
                    return reject(new Error(`Calibre error: ${error.message}`));
                }
                console.log("Calibre Output:", stdout);
                resolve();
            });
        });

        if (!fs.existsSync(outputPath)) {
            throw new Error("Calibre conversion failed - output file not created");
        }

        console.log("Conversion successful, now restructuring to OEBPS and XHTML...");

        try {
            const zip = new AdmZip(outputPath);
            const zipEntries = zip.getEntries();
            const newZip = new AdmZip();
            const addedPaths = new Set();

            newZip.addFile("mimetype", Buffer.from("application/epub+zip"), "mimetype", 0);
            addedPaths.add("mimetype");

            const opfEntry = zipEntries.find((entry) =>
                entry.entryName.toLowerCase().endsWith(".opf")
            );
            if (!opfEntry) {
                throw new Error("Could not find .opf file in the generated EPUB");
            }

            const imageExts = [".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp"];

            zipEntries.forEach((entry) => {
                if (entry.isDirectory) return;

                const entryName = entry.entryName.replace(/\\/g, "/");
                if (entryName === "mimetype") return;

                if (entryName.toLowerCase().startsWith("meta-inf/")) {
                    const metaInfName = entryName.split("/").pop();
                    const newMetaPath = "META-INF/" + metaInfName;
                    if (addedPaths.has(newMetaPath)) return;

                    if (metaInfName.toLowerCase() === "container.xml") {
                        let content = entry.getData().toString("utf8");
                        content = content.replace(/full-path="([^"]+)"/, 'full-path="OEBPS/content.opf"');
                        newZip.addFile(newMetaPath, Buffer.from(content, "utf8"));
                    } else {
                        newZip.addFile(newMetaPath, entry.getData());
                    }
                    addedPaths.add(newMetaPath);
                    return;
                }

                const ext = path.extname(entryName).toLowerCase();
                const basename = path.basename(entryName);
                let newPath = "";

                if (ext === ".opf") {
                    newPath = "OEBPS/content.opf";
                } else if (imageExts.includes(ext)) {
                    newPath = "OEBPS/images/" + basename;
                } else if (ext === ".css") {
                    newPath = "OEBPS/css/" + basename;
                } else if (ext === ".html" || ext === ".xhtml") {
                    newPath = "OEBPS/" + basename.replace(/\.html$/i, ".xhtml");
                } else {
                    newPath = "OEBPS/" + basename;
                }

                if (newPath && !addedPaths.has(newPath)) {
                    let data = entry.getData();

                    if (ext === ".opf") {
                        let content = data.toString("utf8");
                        content = content.replace(/\.html/g, ".xhtml");
                        imageExts.forEach((imageExt) => {
                            const regex = new RegExp(
                                `href="(?!(?:images|css)\/)([^"]+\\${imageExt})"`,
                                "g"
                            );
                            content = content.replace(regex, 'href="images/$1"');
                        });
                        content = content.replace(
                            /href="(?!(?:images|css)\/)([^"]+\.css)"/g,
                            'href="css/$1"'
                        );

                        if (!content.includes('<itemref idref="nav"')) {
                            content = content.replace(
                                "</spine>",
                                '  <itemref idref="nav" linear="no"/>\n  </spine>'
                            );
                        }

                        data = Buffer.from(content, "utf8");
                    } else if (ext === ".html" || ext === ".xhtml") {
                        let content = data.toString("utf8");
                        content = content.replace(/\.html/g, ".xhtml");
                        content = content.replace(
                            /<title>[^<]*<\/title>/i,
                            `<title>${originalName}</title>`
                        );

                        imageExts.forEach((imageExt) => {
                            const regex = new RegExp(
                                `src="(?!(?:images|css)\/)([^"]+\\${imageExt})"`,
                                "g"
                            );
                            content = content.replace(regex, 'src="images/$1"');
                        });
                        content = content.replace(
                            /href="(?!(?:images|css)\/)([^"]+\.css)"/g,
                            'href="css/$1"'
                        );

                        if (basename.toLowerCase() === "nav.xhtml") {
                            const olMatch = content.match(/<ol[^>]*>([\s\S]*?)<\/ol>/i);
                            if (olMatch) {
                                const liMatches = olMatch[1].match(/<li[^>]*>[\s\S]*?<\/li>/gi) || [];
                                const tocItems = [];
                                const pageItems = [];

                                liMatches.forEach((li) => {
                                    const text = li.replace(/<[^>]+>/g, "").trim();
                                    if (/^\d+$/.test(text) || (text.length < 5 && /\d+/.test(text))) {
                                        pageItems.push(li);
                                    } else {
                                        tocItems.push(li);
                                    }
                                });

                                let newNavContent = `
    <nav epub:type="toc" id="toc">
      <h1>Table of Contents</h1>
      <ol>
        ${tocItems.join("\n        ")}
      </ol>
    </nav>`;

                                if (pageItems.length > 0) {
                                    newNavContent += `
    <nav epub:type="page-list" id="page-list" hidden="hidden">
      <ol>
        ${pageItems.join("\n        ")}
      </ol>
    </nav>`;
                                }

                                newNavContent += `
    <nav epub:type="landmarks" id="guide" hidden="hidden">
      <h2>Guide</h2>
      <ol>
        <li><a epub:type="toc" href="nav.xhtml">Table of Contents</a></li>
        <li><a epub:type="bodymatter" href="index_split_000.xhtml">Begin Reading</a></li>
      </ol>
    </nav>`;

                                content = content.replace(/<nav[^>]*>[\s\S]*?<\/nav>/i, newNavContent);
                            }
                        }

                        data = Buffer.from(content, "utf8");
                    } else if (ext === ".css") {
                        let content = data.toString("utf8");
                        imageExts.forEach((imageExt) => {
                            const regex = new RegExp(
                                `url\\(['"]?(?!(?:\\.\\.\\/)?images\/)([^'"]+\\${imageExt})['"]?\\)`,
                                "g"
                            );
                            content = content.replace(regex, "url(../images/$1)");
                        });
                        data = Buffer.from(content, "utf8");
                    }

                    newZip.addFile(newPath, data);
                    addedPaths.add(newPath);
                }
            });

            if (fs.existsSync(outputPath)) {
                fs.unlinkSync(outputPath);
            }
            newZip.writeZip(outputPath);
            console.log("Final restructuring complete. Cleaned up root and duplicates.");
        } catch (restructureErr) {
            console.error("Restructuring Error (Continuing with original):", restructureErr);
        }

        res.download(outputPath, outputFilename, (err) => {
            try {
                if (fs.existsSync(inputPath)) {
                    fs.unlinkSync(inputPath);
                }
            } catch (cleanupErr) {
                console.error("Cleanup error:", cleanupErr);
            }

            if (err && !res.headersSent) {
                res.status(500).json({ error: "Error sending file" });
            }
        });
    } catch (error) {
        console.error("Conversion Error:", error);
        res.status(500).json({
            error: "Conversion failed",
            details: error.message,
            hint: "Ensure Calibre is installed and ebook-convert is in your system PATH",
        });
    }
});

const port = Number(process.env.PORT) || 9000;

app.listen(port, () => {
    console.log(`Validator API running at http://localhost:${port}`);
    void logOllamaDiagnostics();
});

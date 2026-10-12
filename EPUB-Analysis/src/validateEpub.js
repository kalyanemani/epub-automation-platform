const path = require("path");
const fs = require("fs");
const { Worker } = require("worker_threads");

const { unzipToTemp, readTextFile } = require("./utils/unzip");
const { parseXml } = require("./utils/xml");
const { enrichWithAISuggestions } = require("./utils/ai-enricher");
const AgentLogger = require("./utils/agent-logger");
const { annotateResults } = require("./utils/report-annotator");

const { runStructureChecks } = require("./checks/structure-checks");

const CHECK_WORKER_PATH = path.join(__dirname, "utils", "check-worker.js");

function readBooleanEnv(name, fallback = false) {
    const value = process.env[name];
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

function runCheckInWorker({ modulePath, exportName, context, label, timeoutMs }) {
    return new Promise((resolve) => {
        const _workerStart = Date.now();
        const worker = new Worker(CHECK_WORKER_PATH, {
            workerData: {
                modulePath,
                exportName,
                context,
            },
        });

        let settled = false;
        const finish = (results) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            const elapsed = Date.now() - _workerStart;
            AgentLogger.log("TIMING", "CheckWorker", { label, elapsed_ms: elapsed, results: Array.isArray(results) ? results.length : 0 });
            resolve(Array.isArray(results) ? results : []);
        };

        const timer = setTimeout(() => {
            const elapsed = Date.now() - _workerStart;
            AgentLogger.log("TIMING", "CheckWorker", { label, elapsed_ms: elapsed, status: "TIMEOUT" });
            AgentLogger.log("SYSTEM_EVENT", "Validation", {
                message: `${label} timed out after ${timeoutMs}ms - partial results returned`,
            });
            worker.terminate().catch(() => {});
            finish([]);
        }, timeoutMs);

        worker.on("message", (msg) => {
            if (msg?.type === "done") {
                finish(msg.result);
                return;
            }

            if (msg?.type === "error") {
                AgentLogger.log("ERROR", "ValidationCheckWorker", {
                    label,
                    error: msg.error,
                    stack: msg.stack,
                });
                worker.terminate().catch(() => {});
                finish([]);
            }
        });

        worker.on("error", (error) => {
            AgentLogger.log("ERROR", "ValidationCheckWorker", {
                label,
                error: error.message,
                stack: error.stack,
            });
            finish([]);
        });

        worker.on("exit", (code) => {
            if (!settled && code !== 0) {
                AgentLogger.log("ERROR", "ValidationCheckWorker", {
                    label,
                    error: `Worker exited with code ${code}`,
                });
                finish([]);
            }
        });
    });
}

function buildCheckDefinitions({ tempDir, opfAbsolute, opfXml, zipEntries, outputDir, skipVisualChecks }) {
    const checkTimeoutMs = parseInt(process.env.CHECK_TIMEOUT_MS || "12000", 10);
    const textCheckTimeoutMs = parseInt(process.env.TEXT_CHECK_TIMEOUT_MS || process.env.CHECK_TIMEOUT_MS || "300000", 10);
    const visualTimeoutMs = parseInt(process.env.VISUAL_TIMEOUT_MS || "10000", 10);
    const definitions = [
        {
            modulePath: path.join(__dirname, "checks", "metadata-checks.js"),
            exportName: "runMetadataChecks",
            context: { tempDir, opfAbsolute, opfXml },
            label: "MetadataChecks",
            timeoutMs: checkTimeoutMs,
        },
        {
            modulePath: path.join(__dirname, "checks", "media-checks.js"),
            exportName: "runMediaChecks",
            context: { tempDir, opfAbsolute, opfXml },
            label: "MediaChecks",
            timeoutMs: checkTimeoutMs,
        },
        {
            modulePath: path.join(__dirname, "checks", "accessibility-checks.js"),
            exportName: "runAccessibilityChecks",
            context: { tempDir, opfAbsolute, opfXml },
            label: "AccessibilityChecks",
            timeoutMs: checkTimeoutMs,
        },
        {
            modulePath: path.join(__dirname, "checks", "text-content-checks.js"),
            exportName: "runTextContentChecks",
            context: { tempDir, opfAbsolute, opfXml },
            label: "TextContentChecks",
            timeoutMs: textCheckTimeoutMs,
        },
        {
            modulePath: path.join(__dirname, "checks", "layout-checks.js"),
            exportName: "runLayoutChecks",
            context: { tempDir, zipEntries },
            label: "LayoutChecks",
            timeoutMs: checkTimeoutMs,
        },
        {
            modulePath: path.join(__dirname, "checks", "script-checks.js"),
            exportName: "runScriptChecks",
            context: { tempDir, opfAbsolute, opfXml },
            label: "ScriptChecks",
            timeoutMs: checkTimeoutMs,
        },
    ];

    if (!skipVisualChecks) {
        definitions.push({
            modulePath: path.join(__dirname, "checks", "visual-layout-checks.js"),
            exportName: "runVisualLayoutChecks",
            context: { tempDir, outputDir },
            label: "VisualLayoutChecks",
            timeoutMs: visualTimeoutMs,
        });
    }

    return definitions;
}

async function validateEpub(epubPath, options = {}) {
    const enrichAiSuggestions =
        typeof options.enrichAiSuggestions === "boolean"
            ? options.enrichAiSuggestions
            : String(process.env.ENABLE_AI_SUGGESTIONS || "").trim().toLowerCase() === "true";
    const enableMastraWorkflow =
        typeof options.enableMastraWorkflow === "boolean"
            ? options.enableMastraWorkflow
            : String(process.env.ENABLE_MASTRA_WORKFLOW || "").trim().toLowerCase() === "true";
    const skipVisualChecks =
        typeof options.skipVisualChecks === "boolean"
            ? options.skipVisualChecks
            : !readBooleanEnv("ENABLE_VISUAL_LAYOUT_CHECKS", false);

    if (!fs.existsSync(epubPath)) {
        throw new Error("EPUB file not found: " + epubPath);
    }

    const _t0 = Date.now();
    const _phase = (label, since) => AgentLogger.log("TIMING", "ValidateEpub", { phase: label, elapsed_ms: Date.now() - since });

    AgentLogger.log("SYSTEM_EVENT", "Validation", {
        message: "Starting validation for: " + path.basename(epubPath),
    });

    const _tUnzip = Date.now();
    const { tempDir, zipEntries } = await unzipToTemp(epubPath);
    _phase("unzip", _tUnzip);

    try {
        const results = [];

        const _tStructure = Date.now();
        const structureResults = await runStructureChecks({
            tempDir,
            zipEntries,
            epubPath,
        });
        _phase("structure_checks", _tStructure);
        results.push(...structureResults);

        const opfPathRel = structureResults.find((result) => result.id === "S_OPF_PATH")?.details?.opfPath || null;
        const opfAbsolute = opfPathRel ? path.join(tempDir, opfPathRel) : null;
        let opfXml = null;

        if (opfAbsolute && fs.existsSync(opfAbsolute)) {
            opfXml = parseXml(readTextFile(opfAbsolute));
        }

        const outputDir = path.join(__dirname, "..", "outputs");
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        if (skipVisualChecks) {
            AgentLogger.log("SYSTEM_EVENT", "Validation", {
                message: "Visual layout checks skipped for this validation profile.",
            });
        }

        const checkDefinitions = buildCheckDefinitions({
            tempDir,
            opfAbsolute,
            opfXml,
            zipEntries,
            outputDir,
            skipVisualChecks,
        });

        const _tChecks = Date.now();
        const checkResults = await Promise.all(
            checkDefinitions.map((definition) => runCheckInWorker(definition))
        );
        _phase("parallel_check_workers", _tChecks);

        checkResults.forEach((resultList) => {
            results.push(...resultList);
        });

        const _tEnrich = Date.now();
        let enrichedResults = await enrichWithAISuggestions(results, {
            enabled: enrichAiSuggestions,
        });
        _phase("ai_enrichment", _tEnrich);

        if (enableMastraWorkflow) {
            AgentLogger.log("SYSTEM_EVENT", "Mastra", {
                message: "Starting Agentic Workflow enrichment...",
            });

            try {
                const workflowsPath = path.join(__dirname, "mastra", "workflows", "index.js");
                const { documentQaWorkflow: realWorkflow } = require(workflowsPath);
                const sampleChunks = results
                    .filter((result) => result.status === "fail" || result.status === "warn" || result.id.startsWith("L_"))
                    .map((result) => ({
                        text: result.details?.context || result.title || result.id,
                    }));

                const run = await realWorkflow.createRun();
                const workflowRes = await run.execute({
                    inputData: {
                        epubPath,
                        tempDir,
                        snapshotDir: path.join(outputDir, "snapshots"),
                        pdfPath: epubPath.replace(/\.epub$/i, ".pdf"),
                        epubChunks: sampleChunks.slice(0, 5),
                    },
                });

                if (workflowRes?.CssValidationStep?.cssFindings) {
                    workflowRes.CssValidationStep.cssFindings.forEach((finding) => {
                        enrichedResults.push({
                            id: "AGENT_CSS_VIOLATION",
                            title: `CSS Specialist: ${finding.file}`,
                            status: "warn",
                            details: finding.analysis,
                            location: { file: finding.file },
                            suggestion: "Fix the syntax errors identified by the auditor.",
                        });
                    });
                }

                if (workflowRes?.VisualAnalysisStep?.visualFindings) {
                    workflowRes.VisualAnalysisStep.visualFindings.forEach((finding) => {
                        if (finding.analysis && !finding.analysis.toLowerCase().includes("no issues found")) {
                            enrichedResults.push({
                                id: "AGENT_VISUAL_DEFECT",
                                title: `Visual Critic: ${finding.snapshot}`,
                                status: "fail",
                                details: finding.analysis,
                                location: { file: finding.snapshot },
                                suggestion: "Check viewport constraints and responsive layout rules.",
                            });
                        }
                    });
                }
            } catch (workflowErr) {
                AgentLogger.log("ERROR", "MastraWorkflow", {
                    error: workflowErr.message,
                    stack: workflowErr.stack,
                });
                console.error("Mastra Workflow Error:", workflowErr);
            }
        } else {
            AgentLogger.log("SYSTEM_EVENT", "Mastra", {
                message: "Agentic workflow enrichment skipped",
                enabled: false,
            });
        }

        const _tAnnotate = Date.now();
        enrichedResults = annotateResults(enrichedResults, {
            documentType: "epub",
        });
        _phase("annotation", _tAnnotate);

        const summary = {
            totalRules: enrichedResults.length,
            passing: enrichedResults.filter((result) => result.status === "pass").length,
            failing: enrichedResults.filter((result) => result.status === "fail").length,
            warnings: enrichedResults.filter((result) => result.status === "warn").length,
        };

        const totalMs = Date.now() - _t0;
        AgentLogger.log("TIMING", "ValidateEpub", { phase: "TOTAL", elapsed_ms: totalMs });
        AgentLogger.log("SYSTEM_EVENT", "Validation", {
            status: "COMPLETE",
            total_ms: totalMs,
            summary,
        });

        return {
            summary,
            results: enrichedResults,
        };
    } finally {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (error) {
            console.warn("Failed to cleanup temp dir:", tempDir);
        }
    }
}

module.exports = validateEpub;

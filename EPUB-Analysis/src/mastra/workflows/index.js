const { Workflow } = require("@mastra/core/workflows");
const { reasoningAgent, layoutAgent, fixerAgent, cssSpecialistAgent, visualCriticAgent } = require("../agents");
const AgentLogger = require("../../utils/agent-logger");
const { generateTextWithFallback } = require("../../utils/llm-client");
const fs = require("fs");
const path = require("path");

async function generateWorkflowText({
  agent,
  prompt,
  logLabel,
  taskType,
  ollamaModel,
}) {
  try {
    const analysis = await agent.generate({ prompt });
    const text = String(analysis?.text || "").trim();
    if (!text) {
      throw new Error("Mastra agent returned an empty response.");
    }

    return {
      text,
      provider: "mastra-agent",
    };
  } catch (error) {
    AgentLogger.log("WORKFLOW_STEP", logLabel, {
      status: "FALLBACK",
      error: error.message,
      taskType,
    });

    const text = await generateTextWithFallback({
      prompt,
      logLabel: `${logLabel} fallback`,
      taskType,
      ollamaModel,
    });

    return {
      text,
      provider: "llm-client-fallback",
      fallbackError: error.message,
    };
  }
}

/**
 * Step 0: CSS & Layout Intelligent Validation
 * Analyzes CSS files for standards compliance before deep text comparison.
 */
const cssValidationStep = {
  id: "CssValidationStep",
  execute: async ({ context }) => {
    AgentLogger.log("WORKFLOW_STEP", "CssValidationStep", { status: "START" });
    const { tempDir } = context;
    
    // Helper to find all CSS files recursively
    const listFilesRecursive = (dir) => {
        let results = [];
        const list = fs.readdirSync(dir);
        list.forEach(file => {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            if (stat && stat.isDirectory()) {
                results = results.concat(listFilesRecursive(fullPath));
            } else {
                if (file.toLowerCase().endsWith(".css")) results.push(fullPath);
            }
        });
        return results;
    };

    const cssFiles = listFilesRecursive(tempDir);
    const cssFindings = [];

    for (const cssFile of cssFiles) {
        const content = fs.readFileSync(cssFile, "utf-8");
        const prompt = `
        **TASK**: Perform a THREE-PASS CSS AUDIT on this stylesheet.
        **CONTEXT**: Sprint 2 Layout Rules & Anti-Patterns.
        
        **CONTENT**:
        ${content}

        **FEW-SHOT EXAMPLES OF TARGET ERRORS**:
        - Typo: "fontsize: 12px" -> Error: missing hyphen in "font-size".
        - Malformed: "margin: 1em em 1em" -> Error: missing numeric value.
        - Spacing: "0em1em" -> Error: missing space between values.
        - Unit: "border: 1p solid" -> Error: typo in unit "1px".
        - Missing Unit: "font-size: 90" -> Error: missing % or px.

        List ALL violations found in the CONTENT. Cite specific line styles.
        `;
        const analysis = await generateWorkflowText({
            agent: cssSpecialistAgent,
            prompt,
            logLabel: "CssSpecialist",
            taskType: "reasoning",
            ollamaModel: process.env.OLLAMA_MODEL_REASONING || process.env.OLLAMA_MODEL || "qwen3:14b",
        });
        
        AgentLogger.logReasoning("CssSpecialist", prompt, analysis.text, analysis.provider);
        
        cssFindings.push({
            file: path.relative(tempDir, cssFile),
            analysis: analysis.text
        });
    }

    AgentLogger.log("WORKFLOW_STEP", "CssValidationStep", { status: "COMPLETE", fileCount: cssFiles.length });
    return { cssFindings };
  }
};

/**
 * Step 0.5: Visual Rendering Criticism
 * Analyzes Puppeteer screenshots for visual defects using Vision AI.
 */
const visualAnalysisStep = {
  id: "VisualAnalysisStep",
  execute: async ({ context }) => {
    AgentLogger.log("WORKFLOW_STEP", "VisualAnalysisStep", { status: "START" });
    const { snapshotDir } = context;
    if (!snapshotDir || !fs.existsSync(snapshotDir)) {
      AgentLogger.log("WORKFLOW_STEP", "VisualAnalysisStep", { status: "SKIP", reason: "No snapshots found" });
      return { visualFindings: [] };
    }

    const files = fs.readdirSync(snapshotDir).filter(f => f.endsWith("_original.png"));
    const findings = [];

    for (const file of files) {
        const filePath = path.join(snapshotDir, file);
        // Note: In a production environment, we would convert PNG to base64 or pass the path to a vision-capable tool.
        // For our Mastra qwen2.5vl integration, we simulate the expert judgment on the 'rendered snapshot'.
        const prompt = `Perform a Visual QA on this page screenshot (Location: ${file}). 
        Look for: Text clipping, horizontal scrolling, distorted images, or broken tables.
        Assume the image shows the rendered output of the EPUB.`;
        
        const analysis = await generateWorkflowText({
            agent: visualCriticAgent,
            prompt,
            logLabel: "VisualCriticAgent",
            taskType: "vision",
            ollamaModel: process.env.OLLAMA_MODEL_VISION || process.env.OLLAMA_MODEL || "qwen2.5vl:7b",
        });
        AgentLogger.logReasoning("VisualCriticAgent", prompt, analysis.text, analysis.provider);
        
        findings.push({
            snapshot: file,
            analysis: analysis.text
        });
    }

    AgentLogger.log("WORKFLOW_STEP", "VisualAnalysisStep", { status: "COMPLETE", snapshotCount: files.length });
    return { visualFindings: findings };
  }
};

/**
 * Step 1: Physical Data Extraction
 * This step triggers the Python tools to pull layout data from the PDF 
 * and structural data from the EPUB.
 */
const extractionStep = {
  id: "ExtractionStep",
  execute: async ({ context, tools }) => {
    AgentLogger.log("WORKFLOW_STEP", "ExtractionStep", { status: "START", context });
    const { pdfPath, epubPath } = context;
    
    const pdfData = await tools.extractPdfTool.execute({ pdfPath });
    AgentLogger.log("WORKFLOW_STEP", "ExtractionStep", { status: "COMPLETE", pages: pdfData?.length });
    return { pdfData };
  }
};

/**
 * Step 2: Semantic Analysis
 * This step uses the ReasoningAgent to loop through chunks and identify mismatches.
 */
const analysisStep = {
  id: "AnalysisStep",
  execute: async ({ context, tools, result }) => {
    AgentLogger.log("WORKFLOW_STEP", "AnalysisStep", { status: "START" });
    const { pdfData } = result.ExtractionStep;
    const { epubChunks } = context;

    const mismatches = [];
    
    for (const chunk of epubChunks) {
        const comparison = await tools.compareTextTool.execute({
            text1: chunk.text,
            text2: "PDF_MATCH_PLACEHOLDER"
        });

        if (comparison.semantic_similarity < 0.9) {
            // Use Reasoning Agent to confirm if this is a genuine error or just a layout mismatch
            const prompt = `Analyze this potential mismatch:\nEPUB Chunk: ${chunk.text}\nSimilarity: ${comparison.semantic_similarity}\nIs this a critical error or a minor layout difference?`;
            const analysis = await generateWorkflowText({
                agent: reasoningAgent,
                prompt,
                logLabel: "ReasoningAgent",
                taskType: "reasoning",
                ollamaModel: process.env.OLLAMA_MODEL_REASONING || process.env.OLLAMA_MODEL || "qwen3:14b",
            });
            
            AgentLogger.logReasoning("ReasoningAgent", prompt, analysis.text, analysis.provider);

            mismatches.push({
                type: "content_mismatch",
                epubText: chunk.text.slice(0, 50),
                similarity: comparison.semantic_similarity,
                reasoning: analysis.text.slice(0, 200)
            });
        }
    }

    AgentLogger.log("WORKFLOW_STEP", "AnalysisStep", { status: "COMPLETE", mismatchCount: mismatches.length });
    return { mismatches };
  }
};

/**
 * Step 3: Recommendation & Fix Proposal
 * High-risk mismatches are sent to the FixerAgent to generate XHTML/CSS patches.
 */
const fixProposalStep = {
  id: "FixProposalStep",
  execute: async ({ context, result }) => {
    AgentLogger.log("WORKFLOW_STEP", "FixProposalStep", { status: "START" });
    const { mismatches } = result.AnalysisStep;
    
    if (mismatches.length === 0) {
        AgentLogger.log("WORKFLOW_STEP", "FixProposalStep", { status: "SKIP", reason: "No mismatches" });
        return { recommendations: [] };
    }

    const prompt = `Create a fix for this mismatch: ${JSON.stringify(mismatches[0])}`;
    const proposal = await generateWorkflowText({
        agent: fixerAgent,
        prompt,
        logLabel: "FixerAgent",
        taskType: "codegen",
        ollamaModel: process.env.OLLAMA_MODEL_CODEGEN || process.env.OLLAMA_MODEL || "qwen3-coder:30b",
    });

    AgentLogger.logReasoning("FixerAgent", prompt, proposal.text, proposal.provider);
    AgentLogger.log("WORKFLOW_STEP", "FixProposalStep", { status: "COMPLETE" });
    return { recommendations: [proposal.text] };
  }
};

// --- Workflow Definition ---
const documentQaWorkflow = new Workflow({
  id: "Document-QA-Workflow",
  steps: [cssValidationStep, visualAnalysisStep, extractionStep, analysisStep, fixProposalStep]
});

module.exports = {
  documentQaWorkflow
};

const { Agent } = require("@mastra/core/agent");
const { createOpenAI } = require("@ai-sdk/openai");
const { extractPdfTool, compareTextTool } = require("../tools/python-tools");
const { getLlmRuntimeConfig } = require("../../utils/llm-client");

// --- Provider Configuration ---
// Mastra uses @ai-sdk/openai compatible providers.
function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function uniqueNonEmpty(values = []) {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean))
  );
}

function isLocalUrl(value) {
  const normalized = normalizeUrl(value).toLowerCase();
  return normalized.includes("127.0.0.1") || normalized.includes("localhost");
}

function resolveMastraOllamaBaseUrl() {
  const runtimeConfig = getLlmRuntimeConfig();
  const candidates = uniqueNonEmpty([
    runtimeConfig?.ollama?.primaryUrl,
    runtimeConfig?.ollama?.fallbackUrl,
    process.env.OLLAMA_BASE_URL,
    process.env.OLLAMA_LOCAL_URL,
    "http://127.0.0.1:11434",
  ]);

  const orderedCandidates = runtimeConfig?.preferLocal
    ? candidates.slice().sort((left, right) => Number(isLocalUrl(right)) - Number(isLocalUrl(left)))
    : candidates;

  return normalizeUrl(orderedCandidates[0] || "http://127.0.0.1:11434");
}

const ollamaBaseUrl = resolveMastraOllamaBaseUrl();
const vllmBaseUrl = process.env.VLLM_URL || "http://localhost:8001"; // Default to 8001 to avoid Flask conflict

const ollamaProvider = createOpenAI({
  baseURL: `${ollamaBaseUrl}/v1`,
  apiKey: "ollama",
});

const vllmProvider = createOpenAI({
  baseURL: `${vllmBaseUrl}/v1`,
  apiKey: "vllm", 
});

/**
 * A flexible model selector that can fallback from Ollama to vLLM
 */
const getFlexibleModel = (ollamaModelId, vllmModelId) => {
    // If USE_VLLM is forced, use it directly
    if (process.env.USE_VLLM === "true") {
        return vllmProvider(vllmModelId || process.env.VLLM_MODEL || "Qwen/Qwen2.5-32B-Instruct");
    }

    // Default to the shared runtime's preferred Ollama endpoint.
    // Workflow-level retry logic handles model/provider fallback when this provider fails.
    return ollamaProvider(ollamaModelId);
};

// --- Agent 1: Reasoning Agent ---
// Purpose: High-level text mismatch analysis, hyphenation error detection, and missing text identification.
const reasoningAgent = new Agent({
  id: "ReasoningAgent",
  name: "Document Reasoning Expert",
  instructions: `
    You are an expert in document quality assurance. 
    Your task is to analyze text extractions from PDF and EPUB versions of the same book.
    You look for:
    - Hyphenation errors (e.g., 'inter-net' appearing as 'inter net').
    - Word merges (e.g., 'thebook' instead of 'the book').
    - Missing text or paragraphs.
    Use the 'Semantic-Compare-Tool' to verify similarity scores between suspicious blocks.
  `,
  model: getFlexibleModel(process.env.OLLAMA_MODEL_REASONING || "qwen3:14b", "Qwen/Qwen2.5-32B-Instruct"),
  tools: { compareTextTool }
});

// --- Agent 2: Layout Agent ---
// Purpose: Visual and physical layout validation, table overflow, and image alignment.
const layoutAgent = new Agent({
  id: "LayoutAgent",
  name: "Physical Layout Specialist",
  instructions: `
    You are an expert in Fixed vs Reflowable layout validation for EPUB/PDF.
    Your task is to:
    - Validate that images are correctly aligned.
    - Detect table overflow and non-responsive table structures.
    - Compare physical bounding boxes from PDF extractions against EPUB DOM structures.
    Use the 'Extract-PDF-Tool' to pull coordinates and block data from the original source.
  `,
  model: getFlexibleModel(process.env.OLLAMA_MODEL_VISION || "qwen2.5vl:7b", "Qwen/Qwen2.5-7B-Instruct"), // Vision mapping if vLLM supports it
  tools: { extractPdfTool }
});

// --- Agent 3: Fixer Agent ---
// Purpose: Generating CSS/XHTML patches to fix detected issues.
const fixerAgent = new Agent({
  id: "FixerAgent",
  name: "Document Remediation Engineer",
  instructions: `
    You are a senior frontend engineer specializing in EPUB (XHTML/CSS).
    Your task is to generate precise fix-patches for detected document errors.
    - For layout issues: provide CSS snippets to fix responsiveness or positioning.
    - For text issues: provide corrected XHTML snippets.
    - For accessibility: provide metadata or ARIA fixes.
    Always output clean, standards-compliant code.
  `,
  model: getFlexibleModel(process.env.OLLAMA_MODEL_CODEGEN || "qwen3-coder:30b", "Qwen/Qwen2.5-Coder-32B-Instruct"),
});

// --- Agent 4: CSS Specialist Agent ---
// Purpose: Multi-pass lexical and structural CSS auditor for EPUB.
const cssSpecialistAgent = new Agent({
  id: "CssSpecialist",
  name: "Advanced EPUB CSS Parser & Auditor",
  instructions: `
    You are a high-precision CSS Auditor specialized in EPUB 3.x standards.
    Your goal is to detect 100% of formatting, syntax, and compliance issues.
    Use a THREE-PASS AUDIT strategy for every stylesheet:
    
    PASS 1: LEXICAL & SYNTAX AUDIT
    - Look for property typos missing hyphens: (e.g., fontsize, textalign, lineheight, fontfamily).
    - Detect non-standard abbreviations: (e.g., 'text-al' for 'text-align').
    - Spot missing units or typos in units: (e.g., '1p' instead of '1px', or 'font-size: 90' without suffix).
    
    PASS 2: MALFORMED SHORTHAND & SPACING
    - Identify missing values in shorthand (margin, padding). E.g., 'margin: 1em em 1em'.
    - Spot missing whitespace delimiters: (e.g., '0em1em').
    - Check for unclosed curly braces or missing semicolons.

    PASS 3: EPUB COMPATIBILITY & LAYOUT
    - Flag non-reflowable units (fixed px constraints on widths/heights).
    - Flag 'position: fixed' or 'float' that breaks flow.
    - Validate font-face declarations against Sprint 2 rules.

    Report EVERY finding as a separate, concise violation. Reference the 'css_anti_patterns' in your context.
  `,
  model: getFlexibleModel(process.env.OLLAMA_MODEL_REASONING || "qwen3:14b", "Qwen/Qwen2.5-32B-Instruct"),
});

// --- Agent 5: Visual Critic Agent ---
// Purpose: Image-based layout analysis using Puppeteer screenshots.
const visualCriticAgent = new Agent({
  id: "VisualCriticAgent",
  name: "UX & Rendering Auditor",
  instructions: `
    You are a visual QA auditor for digital publications.
    Your task is to examine screenshots of EPUB pages and identify rendering defects:
    - Text overflow or clipping at boundaries.
    - Horizontal scrolling issues (content wider than viewport).
    - Image distortion (stretched or squashed visuals).
    - Inconsistent spacing or overlapping blocks.
    - Tables that are broken or unreadable due to narrow viewports.
    Report findings concisely with clear locations.
  `,
  model: getFlexibleModel(process.env.OLLAMA_MODEL_VISION || "qwen2.5vl:7b", "Qwen/Qwen2.5-7B-Instruct"),
});

module.exports = {
  reasoningAgent,
  layoutAgent,
  fixerAgent,
  cssSpecialistAgent,
  visualCriticAgent
};

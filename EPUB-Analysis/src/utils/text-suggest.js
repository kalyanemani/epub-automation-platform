const { generateTextWithFallback } = require("./llm-client");
const { debugLog } = require("./pipeline-logger");

const DEFAULT_LLM_ENDPOINT = process.env.EPUB_LLM_ENDPOINT || "";
const DEFAULT_OLLAMA_MODEL =
  process.env.OLLAMA_MODEL_TEXT ||
  process.env.OLLAMA_MODEL ||
  "command-r7b:latest";

function textSuggestionsEnabled() {
  return String(process.env.ENABLE_TEXT_LLM_SUGGESTIONS || "")
    .trim()
    .toLowerCase() === "true";
}

function shouldUseLlm(options = {}) {
  if (options.forceLlm === true) {
    return true;
  }

  return textSuggestionsEnabled();
}

function normalizeSnippet(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDeterministicSuggestion(samples = []) {
  const replacements = samples
    .filter((sample) => sample?.suggested && sample?.snippet)
    .slice(0, 3)
    .map((sample) => `"${normalizeSnippet(sample.snippet)}" -> "${normalizeSnippet(sample.suggested)}"`);

  if (replacements.length) {
    return replacements.join("; ");
  }

  return "Review the flagged snippets against the source copy and replace placeholder or OCR-corrupted text.";
}

async function suggestMissingIncorrectText(samples = [], options = {}) {
  if (!shouldUseLlm(options)) {
    return buildDeterministicSuggestion(samples);
  }

  const normalizedSamples = samples
    .slice(0, 4)
    .map((sample, index) => {
      const file = sample.file || `content-${index + 1}`;
      const snippet = normalizeSnippet(sample.snippet || sample.excerpt);
      return `${index + 1}. ${file}: ${snippet}`;
    })
    .filter(Boolean);

  if (!normalizedSamples.length) {
    return "";
  }

  debugLog("llm", "text-suggest.requested", {
    sampleCount: normalizedSamples.length,
    forced: options.forceLlm === true,
  });

  const prompt = [
    "You are reviewing EPUB text quality issues.",
    "Each snippet may contain missing text, OCR corruption, placeholders, or incorrect wording.",
    "Provide only grounded replacement pairs when the safer text is directly recoverable from the snippet itself.",
    "Rules:",
    '- Use at most 3 corrections',
    '- Format each correction on its own line as "wrong" -> "better"',
    '- Never invent names, dates, citations, or wording that is not directly supported by the snippet',
    '- If a snippet is ambiguous, return exactly: manual source check',
    "- No markdown, no explanation, no preamble, no extra prose",
    "",
    "Snippets:",
    ...normalizedSamples,
  ].join("\n");

  try {
    let text = await generateTextWithFallback({
      prompt,
      remoteUrl: DEFAULT_LLM_ENDPOINT,
      remoteTimeoutMs: 15000,
      ollamaModel: DEFAULT_OLLAMA_MODEL,
      taskType: "structured",
      logLabel: options.logLabel || "Missing/incorrect text suggestion",
    });

    const acceptedLines = String(text || "")
      .replace(/^\s*(suggestion|response)\s*:\s*/i, "")
      .split(/\r?\n|;/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter(
        (line) =>
          /^["\u201C\u201D][^"\u201C\u201D]+["\u201C\u201D]\s*->\s*["\u201C\u201D][^"\u201C\u201D]+["\u201C\u201D]$/i.test(
            line
          ) || /^manual source check$/i.test(line)
      )
      .slice(0, 3);

    const suggestion =
      acceptedLines.join("; ") ||
      buildDeterministicSuggestion(samples);

    debugLog("llm", "text-suggest.completed", {
      sampleCount: normalizedSamples.length,
      textLength: suggestion.length,
    });

    return suggestion;
  } catch (error) {
    console.error("Missing/incorrect text suggestion error:", error.message);
    debugLog("llm", "text-suggest.failed", {
      sampleCount: normalizedSamples.length,
      error: error.message,
    });
    return buildDeterministicSuggestion(samples);
  }
}

module.exports = { suggestMissingIncorrectText };

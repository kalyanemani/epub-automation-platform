const { generateTextWithFallback } = require("./llm-client");
const {
  buildDeterministicIssueNarrative,
  buildDeterministicSuggestion,
  cleanText,
} = require("./issue-language");

const DEFAULT_LLM_ENDPOINT = process.env.EPUB_LLM_ENDPOINT || "";
const DEFAULT_OLLAMA_MODEL =
  process.env.OLLAMA_MODEL_SUGGEST ||
  process.env.OLLAMA_MODEL ||
  "command-r7b:latest";
const DEBUG_LLM_PROMPTS =
  String(process.env.DEBUG_LLM_PROMPTS || "").trim().toLowerCase() === "true";

function toSingleLine(value) {
  return cleanText(String(value || "").replace(/\s*\n+\s*/g, " "));
}

function stripMarkdownFences(value) {
  return String(value || "")
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function extractJsonPayload(value) {
  const raw = stripMarkdownFences(value);
  if (!raw) {
    return null;
  }

  const candidates = [raw];
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    candidates.push(raw.slice(start, end + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      continue;
    }
  }

  return null;
}

function normalizeGuidance(result = {}, payload = {}, generatedBy = "llm") {
  const deterministic = buildDeterministicIssueNarrative(result);
  const fallbackSuggestion =
    buildDeterministicSuggestion(result) || deterministic.nextStep;

  const headline = toSingleLine(payload.headline || payload.title) || deterministic.headline;
  const summary =
    cleanText(payload.summary || payload.description || payload.issue_summary) ||
    deterministic.summary;
  const impact =
    cleanText(payload.impact || payload.why_it_matters || payload.risk) ||
    deterministic.impact;
  const nextStep =
    cleanText(payload.next_step || payload.nextStep || payload.action) ||
    deterministic.nextStep;
  const fixSuggestion =
    toSingleLine(
      payload.fix_suggestion ||
        payload.fixSuggestion ||
        payload.suggestion ||
        payload.recommended_fix
    ) || fallbackSuggestion;

  return {
    headline,
    summary,
    impact,
    nextStep,
    fixSuggestion,
    generatedBy,
  };
}

async function aiSuggestion(result) {
  if (!result || result.status === "pass") {
    return {
      ...normalizeGuidance(result, {}, "deterministic"),
      generatedBy: "deterministic",
    };
  }

  const prompt = `
You are helping a non-technical publishing user understand a document quality issue.

Given the rule failure or warning below, return STRICT JSON ONLY with these keys:
{
  "headline": "short plain-English title",
  "summary": "1-2 natural-language sentences that explain what was found",
  "impact": "1-2 natural-language sentences that explain why it matters to the user or reader",
  "next_step": "1 sentence telling the user what to check or do next",
  "fix_suggestion": "1 short actionable sentence"
}

RULE ID: ${result.id}
TITLE: ${result.title}
STATUS: ${result.status}
DETAILS:
${typeof result.details === "string"
  ? result.details
  : JSON.stringify(result.details, null, 2)}

RULES:
- Output valid JSON only
- Use plain English for a business or publishing user
- Avoid unexplained technical jargon; if a technical term is necessary, make it understandable
- Do not invent files, selectors, values, page numbers, or missing text that are not present in the input
- Keep each field concise and specific to the evidence provided
`;

  if (DEBUG_LLM_PROMPTS) {
    console.log(prompt, "prompt_issue_guidance");
  }

  try {
    const response = await generateTextWithFallback({
      prompt,
      remoteUrl: DEFAULT_LLM_ENDPOINT,
      remoteTimeoutMs: 5000,
      ollamaModel: DEFAULT_OLLAMA_MODEL,
      ollamaTimeoutMs: 15000,
      taskType: "structured",
      logLabel: `AI issue guidance ${result.id}`,
    });

    if (DEBUG_LLM_PROMPTS) {
      console.log(response, "response_issue_guidance");
    }

    const parsed = extractJsonPayload(response);
    if (!parsed || typeof parsed !== "object") {
      return normalizeGuidance(
        result,
        { fix_suggestion: response },
        "deterministic"
      );
    }

    return normalizeGuidance(result, parsed, "llm");
  } catch (error) {
    console.error("AI Suggestion Error:", error.message);
    return normalizeGuidance(result, {}, "deterministic");
  }
}

module.exports = { aiSuggestion };

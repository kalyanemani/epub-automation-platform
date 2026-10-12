const { generateTextWithFallback, logLlmUsage } = require("../utils/llm-client");
const { fetch } = require("undici");

const DEFAULT_LLM_ENDPOINT =
  process.env.EPUB_ALT_LLM_ENDPOINT ||
  process.env.EPUB_LLM_ENDPOINT ||
  "";
const DEFAULT_OLLAMA_MODEL =
  process.env.OLLAMA_MODEL_ALT ||
  process.env.OLLAMA_MODEL ||
  "command-r7b:latest";

const FIREWORKS_API_KEY = process.env.FIREWORKS_API_KEY || "";
const FIREWORKS_ALT_MODEL =
  process.env.FIREWORKS_MODEL_ALT ||
  "accounts/fireworks/models/deepseek-v4-pro";
const FIREWORKS_PRIMARY = String(process.env.USE_FIREWORKS_PRIMARY || "true").trim().toLowerCase() !== "false";

function shouldPreferFireworks() {
  return FIREWORKS_API_KEY && FIREWORKS_PRIMARY;
}

async function fireworksAltText(prompt) {
  if (!FIREWORKS_API_KEY) throw new Error("FIREWORKS_API_KEY not configured");
  const resp = await fetch("https://api.fireworks.ai/inference/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${FIREWORKS_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: FIREWORKS_ALT_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 150,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) throw new Error(`Fireworks HTTP ${resp.status}`);
  const data = await resp.json();
  if (!data.choices?.[0]) throw new Error(`Fireworks no choices: ${JSON.stringify(data).slice(0, 200)}`);
  return data.choices[0].message.content || "";
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findImageTag(original, imageSrc) {
  if (!original || !imageSrc) return "";
  const pattern = new RegExp(
    `<img[^>]*src=["']${escapeRegex(imageSrc)}["'][^>]*>`,
    "i"
  );
  const match = original.match(pattern);
  return match ? match[0] : "";
}

function extractExistingAlt(imageTag) {
  if (!imageTag) return null;
  const match = imageTag.match(/alt\s*=\s*(["'])(.*?)\1/i);
  return match ? match[2] : null;
}

function looksDecorative(imageSrc, imageTag) {
  if (!imageTag) return false;

  if (
    /role\s*=\s*["']presentation["']/i.test(imageTag) ||
    /aria-hidden\s*=\s*["']true["']/i.test(imageTag)
  ) {
    return true;
  }

  if (
    /alt\s*=\s*["']\s*["']/i.test(imageTag) &&
    /(star|ornament|divider|separator|border|flourish|rule)\b/i.test(imageSrc)
  ) {
    return true;
  }

  return false;
}

function extractRelevantContext(original, imageSrc) {
  const fullText = String(original || "");
  const hitIndex = fullText.indexOf(imageSrc);

  if (hitIndex === -1) {
    return fullText.slice(0, 2000);
  }

  const start = Math.max(0, hitIndex - 900);
  const end = Math.min(fullText.length, hitIndex + 1100);
  return fullText.slice(start, end);
}

async function requestFix({ filepath, original, issue }) {
  const imageSrc = issue.details?.file || "unknown";
  const issueId = issue.id || "unknown";
  const imageTag = findImageTag(original, imageSrc);
  const existingAlt = extractExistingAlt(imageTag);

  console.log(`[llm-fixer] Processing issue: ${issueId} | image: ${imageSrc} | file: ${filepath}`);

  if (existingAlt !== null) {
    if (existingAlt.trim() === "") {
      console.log("Image already has empty alt attribute:", imageSrc);
      logLlmUsage({
        label: `Alt text ${filepath}`,
        provider: "none",
        model: "none",
        fallbackUsed: false,
        success: true,
        latencyMs: 0,
        bypassed: true,
        reason: "existing_empty_alt",
      });
      return "DECORATIVE";
    }

    console.log("Image already has alt attribute, skipping generation:", imageSrc);
    logLlmUsage({
      label: `Alt text ${filepath}`,
      provider: "none",
      model: "none",
      fallbackUsed: false,
      success: true,
      latencyMs: 0,
      bypassed: true,
      reason: "existing_alt",
      textChars: existingAlt.length,
    });
    return existingAlt;
  }

  if (looksDecorative(imageSrc, imageTag)) {
    console.log("Detected decorative/presentational image:", imageSrc);
    logLlmUsage({
      label: `Alt text ${filepath}`,
      provider: "none",
      model: "none",
      fallbackUsed: false,
      success: true,
      latencyMs: 0,
      bypassed: true,
      reason: "decorative_detected",
    });
    return "DECORATIVE";
  }

  const context = extractRelevantContext(original, imageSrc);
  const prompt = `You are an EPUB accessibility expert. Your job is to generate alt text for an image.

CONTEXT FROM FILE:
${context}

IMAGE LOCATION:
File: ${filepath}
Image src: ${imageSrc}

TASK:
Based on the surrounding text in the file above, generate appropriate alt text for this image.

ALT TEXT RULES:
1. For decorative images (borders, ornaments, chapter separators): Return exactly: DECORATIVE
2. For content images: Provide a concise description (max 125 characters)
3. Use the surrounding paragraphs and headings as context
4. Don't start with "Image of" or "Picture of"
5. Use proper grammar and punctuation
6. Never invent visual details that are not explicitly supported by the surrounding text

EXAMPLES:

Context: "<h1>About the Publisher</h1>"
Image: logo.jpg
Output: HarperCollins Publishers logo

Context: Decorative star border at chapter start
Image: star.jpg
Output: DECORATIVE

OUTPUT FORMAT:
Return ONLY the alt text description. No explanations. No quotes. No extra text.
Just the description itself (or the word DECORATIVE for decorative images).

NOW GENERATE THE ALT TEXT:`;

  console.log(`[llm-fixer] Invoking LLM for issue ${issueId} (${filepath})`);

  const ollamaTimeoutMs = parseInt(process.env.LLM_OLLAMA_TIMEOUT_MS || "30000", 10);
  const ollamaTotalMs = parseInt(process.env.LLM_OLLAMA_TOTAL_TIMEOUT_MS || "45000", 10);

  let text = null;

  if (shouldPreferFireworks()) {
    try {
      const t0 = Date.now();
      text = await fireworksAltText(prompt);
      console.log(`[alt-text] Fireworks succeeded in ${Date.now() - t0}ms`);
      logLlmUsage({
        label: `Alt text ${filepath}`,
        provider: "fireworks",
        model: FIREWORKS_ALT_MODEL,
        fallbackUsed: false,
        success: true,
        latencyMs: Date.now() - t0,
        textChars: text.length,
        task_type: "structured",
      });
    } catch (fwErr) {
      console.warn(`[alt-text] Fireworks failed (${fwErr.message}), trying Ollama...`);
    }
  }

  if (text == null) {
    // Tier 2: Ollama (remote → local) — capped at ollamaTotalMs to avoid multi-plan cascade delay
    try {
      text = await Promise.race([
        generateTextWithFallback({
          prompt,
          remoteUrl: DEFAULT_LLM_ENDPOINT,
          remoteTimeoutMs: 5000,
          ollamaModel: DEFAULT_OLLAMA_MODEL,
          ollamaTimeoutMs,
          taskType: "structured",
          logLabel: `Alt text ${filepath} [issue: ${issueId}]`,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Ollama cascade exceeded ${ollamaTotalMs}ms`)), ollamaTotalMs)
        ),
      ]);
    } catch (err) {
      console.error(`[alt-text] Ollama also failed: ${err.message}`);
    }
  }

  if (text == null) {
    console.error("[alt-text] All tiers failed");
    return null;
  }

  if (text.includes("Thinking...") && text.includes("...done thinking.")) {
    text = text.split("...done thinking.").pop();
  }

  text = text
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^(?:alt text|description|output):\s*/i, "");

  console.log("Generated alt text:", text);
  return text;
}

module.exports = { requestFix };

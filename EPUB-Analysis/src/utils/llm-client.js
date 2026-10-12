const { llmAgent } = require("../undici-agent.js");
const { recordQualityEvent } = require("../rag/quality-monitor");
const { debugLog } = require("./pipeline-logger");
const AgentLogger = require("./agent-logger");
const crypto = require("crypto");
const { shortTermMemory } = require("../memory/short-term-memory");

const PROMPT_CACHE_ENABLED = String(process.env.ENABLE_PROMPT_CACHE || "true").trim().toLowerCase() !== "false";
const PROMPT_CACHE_TTL_SECONDS = Math.max(
  parseInt(process.env.PROMPT_CACHE_TTL_SECONDS || "86400", 10) || 86400,
  24 * 60 * 60
);

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

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function uniqueNonEmpty(values = []) {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean))
  );
}

function isLocalOllamaUrl(baseUrl) {
  const normalized = normalizeUrl(baseUrl).toLowerCase();
  return normalized.includes("127.0.0.1") || normalized.includes("localhost");
}

function normalizeModelName(value) {
  return String(value || "").trim().toLowerCase();
}

function modelAliases(name) {
  const normalized = normalizeModelName(name);
  if (!normalized) {
    return [];
  }

  const aliases = new Set([normalized]);
  const withoutPath = normalized.split("/").pop();
  const withoutTag = withoutPath.split(":")[0];
  aliases.add(withoutPath);
  aliases.add(withoutTag);

  return Array.from(aliases).filter(Boolean);
}

function modelMatchesPreferred(availableModel, preferredModel) {
  const availableAliases = modelAliases(availableModel);
  const preferredAliases = modelAliases(preferredModel);

  return preferredAliases.some((preferred) =>
    availableAliases.some(
      (available) =>
        available === preferred ||
        available.startsWith(`${preferred}:`) ||
        preferred.startsWith(`${available}:`)
    )
  );
}

function scoreModelForTask(taskType, modelName) {
  const normalized = normalizeModelName(modelName);
  if (!normalized) {
    return -100;
  }

  const visionHints = ["vl", "vision", "llava", "bakllava", "moondream", "minicpm"];
  const codeHints = ["coder", "code", "codellama", "starcoder", "deepseek-coder"];
  const reasoningHints = ["qwen3", "deepseek-r1", "qwq", "llama3", "mistral", "phi4"];
  const lightHints = ["3b", "1.5b", "2b", "mini", "small"];
  const isVision = visionHints.some((hint) => normalized.includes(hint));
  const isCode = codeHints.some((hint) => normalized.includes(hint));
  const isReasoning = reasoningHints.some((hint) => normalized.includes(hint));
  const isEmbedding = normalized.includes("embed");

  let score = 0;

  if (isEmbedding) {
    score -= 100;
  }

  switch (String(taskType || "default").toLowerCase()) {
    case "vision":
      score += isVision ? 30 : -10;
      score += isReasoning ? 2 : 0;
      break;
    case "codegen":
      score += isCode ? 25 : -4;
      score += isReasoning ? 2 : 0;
      break;
    case "reasoning":
      score += isReasoning ? 16 : 0;
      score += isCode ? -2 : 0;
      score += isVision ? -4 : 0;
      break;
    case "structured":
      score += isVision ? -5 : 0;
      score += isCode ? 1 : 0;
      score += normalized.includes("qwen") ? 4 : 0;
      score += normalized.includes("llama") ? 3 : 0;
      score += normalized.includes("phi") ? 2 : 0;
      break;
    default:
      score += isVision ? -4 : 0;
      score += isCode ? -1 : 0;
      score += isReasoning ? 4 : 0;
      break;
  }

  score += lightHints.some((hint) => normalized.includes(hint)) ? 1 : 0;
  return score;
}

const DEFAULT_REMOTE_TIMEOUT_MS = parseInt(
  process.env.LLM_REMOTE_TIMEOUT_MS || "12000",
  10
);
const DEFAULT_OLLAMA_TIMEOUT_MS = parseInt(
  process.env.LLM_OLLAMA_TIMEOUT_MS || "90000",
  10
);
const OLLAMA_MODEL_CACHE_TTL_MS = parseInt(
  process.env.OLLAMA_MODEL_CACHE_TTL_MS || "60000",
  10
);
const OLLAMA_DIAGNOSTIC_TIMEOUT_MS = parseInt(
  process.env.OLLAMA_DIAGNOSTIC_TIMEOUT_MS || "12000",
  10
);
const OLLAMA_DISCOVERY_TIMEOUT_MS = parseInt(
  process.env.OLLAMA_DISCOVERY_TIMEOUT_MS || "4000",
  10
);

const DEFAULT_LOCAL_OLLAMA_URL =
  process.env.OLLAMA_LOCAL_URL || "http://127.0.0.1:11434";
const OLLAMA_PRIMARY_URL =
  process.env.OLLAMA_PRIMARY_URL ||
  process.env.OLLAMA_BASE_URL ||
  DEFAULT_LOCAL_OLLAMA_URL;
const OLLAMA_FALLBACK_URL =
  process.env.OLLAMA_FALLBACK_URL ||
  (normalizeUrl(OLLAMA_PRIMARY_URL) === normalizeUrl(DEFAULT_LOCAL_OLLAMA_URL)
    ? ""
    : DEFAULT_LOCAL_OLLAMA_URL);
const DEFAULT_OLLAMA_BASE_URL = OLLAMA_PRIMARY_URL;
const DEFAULT_REMOTE_ENDPOINT = process.env.EPUB_LLM_ENDPOINT || "";

const TASK_MODEL_MAP = {
  vision: process.env.OLLAMA_MODEL_VISION || "qwen2.5vl:7b",
  reasoning: process.env.OLLAMA_MODEL_REASONING || "qwen3:14b",
  structured: process.env.OLLAMA_MODEL_STRUCTURED || "qwen2.5:7b",
  codegen: process.env.OLLAMA_MODEL_CODEGEN || "qwen3-coder:30b",
  default: process.env.OLLAMA_MODEL || "qwen2.5:7b",
};

const DEFAULT_OLLAMA_MODEL = TASK_MODEL_MAP.default;
const OLLAMA_MODEL_CACHE = new Map();
const OLLAMA_DIAGNOSTIC_PROMPT =
  process.env.OLLAMA_DIAGNOSTIC_PROMPT || "Reply with OK.";

function getLlmRuntimeConfig() {
  return {
    remoteEndpoint: DEFAULT_REMOTE_ENDPOINT,
    remoteEnabled: readBooleanEnv(
      "ENABLE_REMOTE_LLM",
      Boolean(process.env.EPUB_LLM_ENDPOINT)
    ),
    preferLocal: readBooleanEnv("LLM_PREFER_LOCAL", true),
    remoteTimeoutMs: DEFAULT_REMOTE_TIMEOUT_MS,
    ollama: {
      baseUrl: DEFAULT_OLLAMA_BASE_URL,
      primaryUrl: OLLAMA_PRIMARY_URL,
      fallbackUrl: OLLAMA_FALLBACK_URL,
      timeoutMs: DEFAULT_OLLAMA_TIMEOUT_MS,
      dynamicModelDiscovery: true,
    },
    models: {
      ...TASK_MODEL_MAP,
    },
  };
}

function resolveModelForTask(taskType) {
  return TASK_MODEL_MAP[taskType] || TASK_MODEL_MAP.default;
}

function getConfiguredOllamaModels() {
  return uniqueNonEmpty(Object.values(TASK_MODEL_MAP));
}

function buildConfiguredModelChecks(availableModels = []) {
  return Object.entries(TASK_MODEL_MAP).map(([taskType, configuredModel]) => {
    const matchedModels = uniqueNonEmpty(
      availableModels.filter((availableModel) =>
        modelMatchesPreferred(availableModel, configuredModel)
      )
    );

    return {
      taskType,
      configuredModel,
      present: matchedModels.length > 0,
      matchedModels,
    };
  });
}

function buildResolvedTaskModels(availableModels = []) {
  return Object.entries(TASK_MODEL_MAP).map(([taskType, configuredModel]) => {
    const matchedModels = uniqueNonEmpty(
      availableModels.filter((availableModel) =>
        modelMatchesPreferred(availableModel, configuredModel)
      )
    );
    const adaptiveCandidates = rankAvailableModels(
      availableModels.filter((modelName) => !matchedModels.includes(modelName)),
      taskType
    );
    const selectedModel = matchedModels[0] || adaptiveCandidates[0] || "";

    return {
      taskType,
      configuredModel,
      matchedModels,
      selectedModel,
      selectedFrom: matchedModels.length
        ? "configured"
        : selectedModel
          ? "adaptive"
          : "unavailable",
      present: Boolean(selectedModel),
      adaptiveCandidates: matchedModels.length ? [] : adaptiveCandidates.slice(0, 3),
    };
  });
}

function buildModelCascade({ ollamaModel, taskType }) {
  // Include task-specific local fallbacks so we always have a usable model
  // when the preferred one (e.g. qwen3:14b) is only on the remote endpoint.
  const localFallbacks = {
    reasoning: process.env.OLLAMA_MODEL_REASONING_LOCAL || "qwen2.5-coder:14b",
    codegen:   process.env.OLLAMA_MODEL_CODEGEN_LOCAL   || "qwen2.5-coder:14b",
  };
  return uniqueNonEmpty([
    ollamaModel,
    taskType ? resolveModelForTask(taskType) : "",
    taskType ? (localFallbacks[taskType] || "") : "",
    process.env.OLLAMA_MODEL_LIGHT || "gemma2:2b",
    DEFAULT_OLLAMA_MODEL,
  ]);
}

function logLlmUsage(payload = {}) {
  const record = Object.fromEntries(
    Object.entries({
      label: payload.label,
      provider: payload.provider,
      model: payload.model,
      endpoint: payload.endpoint,
      fallback_used: payload.fallbackUsed,
      ollama_endpoint_used: payload.ollamaEndpointUsed,
      success: payload.success,
      latency_ms: payload.latencyMs,
      text_chars: payload.textChars,
      remote_error: payload.remoteError,
      final_error: payload.finalError,
      bypassed: payload.bypassed,
      reason: payload.reason,
      task_type: payload.taskType,
      prompt: payload.prompt,
      response: payload.response,
    }).filter(([, value]) => value !== undefined && value !== null)
  );

  console.info("[LLM]", JSON.stringify(record));
  AgentLogger.log("LLM_PROCESSING", payload.label || "llm-client", record);
  recordQualityEvent("generation", {
    provider: payload.provider || "unknown",
    model: payload.model || "unknown",
    taskType: payload.taskType || "default",
    success: payload.success === true,
    fallbackUsed: payload.fallbackUsed === true,
    latencyMs: payload.latencyMs || 0,
    textChars: payload.textChars || 0,
    endpoint: payload.endpoint || "",
  });
}

function extractText(payload) {
  return String(
    payload?.suggestion ||
      payload?.output ||
      payload?.text ||
      payload?.response ||
      ""
  ).trim();
}

async function requestRemote({ prompt, remoteUrl, remoteTimeoutMs }) {
  const response = await fetch(remoteUrl, {
    method: "POST",
    dispatcher: llmAgent,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
    signal: AbortSignal.timeout(remoteTimeoutMs || DEFAULT_REMOTE_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Remote LLM returned ${response.status}`);
  }

  const result = await response.json();
  return extractText(result);
}

async function fetchOllamaModels(baseUrl, ollamaTimeoutMs) {
  const normalizedBaseUrl = normalizeUrl(baseUrl);
  const cached = OLLAMA_MODEL_CACHE.get(normalizedBaseUrl);
  if (cached && Date.now() - cached.fetchedAt < OLLAMA_MODEL_CACHE_TTL_MS) {
    return cached.models;
  }

  try {
    const response = await fetch(`${normalizedBaseUrl}/api/tags`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(ollamaTimeoutMs || OLLAMA_DISCOVERY_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Ollama tags at ${normalizedBaseUrl} returned ${response.status}`);
    }

    const result = await response.json();
    const models = uniqueNonEmpty((result?.models || []).map((entry) => entry?.name));
    OLLAMA_MODEL_CACHE.set(normalizedBaseUrl, {
      fetchedAt: Date.now(),
      models,
    });
    return models;
  } catch (err) {
    OLLAMA_MODEL_CACHE.set(normalizedBaseUrl, {
      fetchedAt: Date.now(),
      models: [],
    });
    throw err;
  }
}

function rankAvailableModels(availableModels = [], taskType) {
  return availableModels
    .map((name) => ({
      name,
      score: scoreModelForTask(taskType, name),
    }))
    .filter((entry) => entry.score > -20)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.name);
}

async function resolveEndpointModelOptions({
  baseUrl,
  preferredModels,
  taskType,
  ollamaTimeoutMs,
}) {
  const normalizedBaseUrl = normalizeUrl(baseUrl);
  const isLocal = isLocalOllamaUrl(normalizedBaseUrl);

  try {
    const availableModels = await fetchOllamaModels(normalizedBaseUrl, ollamaTimeoutMs);
    const preferredMatches = [];

    preferredModels.forEach((preferredModel) => {
      availableModels
        .filter((availableModel) => modelMatchesPreferred(availableModel, preferredModel))
        .forEach((availableModel) => {
          preferredMatches.push(availableModel);
        });
    });

    const fallbackModels = rankAvailableModels(
      availableModels.filter((modelName) => !preferredMatches.includes(modelName)),
      taskType
    );

    return {
      baseUrl: normalizedBaseUrl,
      isLocal,
      availableModels,
      preferredMatches: uniqueNonEmpty(preferredMatches),
      fallbackModels: uniqueNonEmpty(fallbackModels),
      discoveryFailed: false,
    };
  } catch (error) {
    debugLog("llm", "ollama.discovery.failed", {
      baseUrl: normalizedBaseUrl,
      error: error.message,
    });

    return {
      baseUrl: normalizedBaseUrl,
      isLocal,
      availableModels: [],
      preferredMatches: [],
      fallbackModels: [],
      discoveryFailed: true,
    };
  }
}

async function buildOllamaAttemptPlans({
  preferredModels = [],
  taskType,
  ollamaTimeoutMs,
}) {
  const endpoints = uniqueNonEmpty([OLLAMA_PRIMARY_URL, OLLAMA_FALLBACK_URL]);
  const normalizedPrimaryUrl = normalizeUrl(OLLAMA_PRIMARY_URL);

  // Use a short discovery timeout so an unreachable primary doesn't stall the pipeline.
  // Probe both endpoints in parallel, then sort primary first.
  const settled = await Promise.allSettled(
    endpoints.map((endpoint) =>
      resolveEndpointModelOptions({
        baseUrl: endpoint,
        preferredModels,
        taskType,
        ollamaTimeoutMs: OLLAMA_DISCOVERY_TIMEOUT_MS,
      })
    )
  );

  const endpointOptions = settled.map((result, i) =>
    result.status === "fulfilled"
      ? result.value
      : {
          baseUrl: normalizeUrl(endpoints[i]),
          isLocal: isLocalOllamaUrl(endpoints[i]),
          availableModels: [],
          preferredMatches: [],
          fallbackModels: [],
          discoveryFailed: true,
        }
  );

  const plans = [];
  const seenPlans = new Set();
  const addPlan = (option, modelName, usedFallbackModel) => {
    const plan = {
      endpoint: option.baseUrl,
      model: modelName,
      usedFallbackEndpoint: option.baseUrl !== normalizedPrimaryUrl,
      usedFallbackModel,
    };
    const key = `${plan.endpoint}|${plan.model}`;
    if (seenPlans.has(key)) {
      return;
    }

    seenPlans.add(key);
    plans.push(plan);
  };

  // Prefer exact configured-model matches across all endpoints before we try
  // adaptive model substitutions on the primary endpoint.
  endpointOptions.forEach((option) => {
    option.preferredMatches.forEach((modelName) => {
      addPlan(option, modelName, false);
    });
  });

  endpointOptions.forEach((option) => {
    option.fallbackModels.forEach((modelName) => {
      addPlan(option, modelName, true);
    });
  });

  if (plans.length) {
    return plans;
  }

  return endpoints.flatMap((endpoint) =>
    preferredModels.map((modelName) => ({
      endpoint: normalizeUrl(endpoint),
      model: modelName,
      usedFallbackEndpoint: normalizeUrl(endpoint) !== normalizedPrimaryUrl,
      usedFallbackModel: false,
    }))
  );
}

async function requestOllamaAt({ baseUrl, prompt, model, ollamaTimeoutMs }) {
  const normalizedBaseUrl = normalizeUrl(baseUrl);
  const url = `${normalizedBaseUrl}/api/generate`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model || DEFAULT_OLLAMA_MODEL,
      prompt,
      stream: false,
      options: {
        temperature: 0.2,
      },
    }),
    signal: AbortSignal.timeout(ollamaTimeoutMs || DEFAULT_OLLAMA_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Ollama at ${normalizedBaseUrl} returned ${response.status}`);
  }

  const result = await response.json();
  return {
    text: extractText(result),
    endpointUsed: normalizedBaseUrl,
    modelUsed: model || DEFAULT_OLLAMA_MODEL,
  };
}

async function probeOllamaGeneration({ baseUrl, model, ollamaTimeoutMs }) {
  const normalizedBaseUrl = normalizeUrl(baseUrl);
  const startedAt = Date.now();
  const response = await fetch(`${normalizedBaseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: OLLAMA_DIAGNOSTIC_PROMPT,
      stream: false,
      keep_alive: "0s",
      options: {
        temperature: 0,
        num_predict: 8,
      },
    }),
    signal: AbortSignal.timeout(
      Math.min(ollamaTimeoutMs || DEFAULT_OLLAMA_TIMEOUT_MS, 30000)
    ),
  });

  if (!response.ok) {
    throw new Error(`Ollama at ${normalizedBaseUrl} returned ${response.status}`);
  }

  const result = await response.json();
  const text = extractText(result);
  if (!text) {
    throw new Error(`empty response from ${normalizedBaseUrl} using model ${model}`);
  }

  return {
    ok: true,
    latencyMs: Date.now() - startedAt,
    responsePreview: text.slice(0, 80),
  };
}

async function getOllamaDiagnostics({
  includeGenerateProbe = false,
  ollamaTimeoutMs,
} = {}) {
  const timeoutMs = Math.min(
    ollamaTimeoutMs || DEFAULT_OLLAMA_TIMEOUT_MS,
    OLLAMA_DIAGNOSTIC_TIMEOUT_MS
  );
  const endpointDefinitions = [];
  const seenUrls = new Set();

  [
    { label: "primary", url: OLLAMA_PRIMARY_URL },
    { label: "fallback", url: OLLAMA_FALLBACK_URL },
  ].forEach((entry) => {
    const normalizedUrl = normalizeUrl(entry.url);
    if (!normalizedUrl || seenUrls.has(normalizedUrl)) {
      return;
    }

    seenUrls.add(normalizedUrl);
    endpointDefinitions.push({
      label: entry.label,
      url: normalizedUrl,
    });
  });

  const diagnostics = [];
  let primaryHealthy = false;

  for (const endpoint of endpointDefinitions) {
    try {
      const availableModels = await fetchOllamaModels(endpoint.url, timeoutMs);
      const configuredModelChecks = buildConfiguredModelChecks(availableModels);
      const resolvedTaskModels = buildResolvedTaskModels(availableModels);
      const presentCount = configuredModelChecks.filter((entry) => entry.present).length;
      const resolvedCount = resolvedTaskModels.filter((entry) => entry.present).length;
      const endpointDiagnostics = {
        label: endpoint.label,
        url: endpoint.url,
        status: "reachable",
        availableModels,
        configuredModelChecks,
        configuredModelSummary: {
          presentCount,
          totalCount: configuredModelChecks.length,
          allPresent: presentCount === configuredModelChecks.length,
        },
        resolvedTaskModels,
        resolvedTaskSummary: {
          presentCount: resolvedCount,
          totalCount: resolvedTaskModels.length,
          allPresent: resolvedCount === resolvedTaskModels.length,
        },
      };

      if (includeGenerateProbe) {
        const modelsToProbe =
          endpoint.label === "primary" || !primaryHealthy
            ? uniqueNonEmpty(
                resolvedTaskModels
                  .filter((entry) => entry.present)
                  .map((entry) => entry.selectedModel)
              )
            : [];

        endpointDiagnostics.generateProbes = [];
        for (const modelName of modelsToProbe) {
          try {
            endpointDiagnostics.generateProbes.push({
              model: modelName,
              ...(await probeOllamaGeneration({
                baseUrl: endpoint.url,
                model: modelName,
                ollamaTimeoutMs: timeoutMs,
              })),
            });
          } catch (error) {
            endpointDiagnostics.generateProbes.push({
              model: modelName,
              ok: false,
              error: error.message,
            });
          }
        }
      }

      if (endpoint.label === "primary") {
        const failedProbe =
          includeGenerateProbe &&
          Array.isArray(endpointDiagnostics.generateProbes) &&
          endpointDiagnostics.generateProbes.some((probe) => !probe.ok);
        primaryHealthy =
          endpointDiagnostics.resolvedTaskSummary.allPresent && !failedProbe;
      }

      diagnostics.push(endpointDiagnostics);
    } catch (error) {
      diagnostics.push({
        label: endpoint.label,
        url: endpoint.url,
        status: "unreachable",
        error: error.message,
        availableModels: [],
        configuredModelChecks: buildConfiguredModelChecks([]),
        configuredModelSummary: {
          presentCount: 0,
          totalCount: Object.keys(TASK_MODEL_MAP).length,
          allPresent: false,
        },
        resolvedTaskModels: buildResolvedTaskModels([]),
        resolvedTaskSummary: {
          presentCount: 0,
          totalCount: Object.keys(TASK_MODEL_MAP).length,
          allPresent: false,
        },
      });
    }
  }

  const primary = diagnostics.find((entry) => entry.label === "primary");
  const fallback = diagnostics.find((entry) => entry.label === "fallback");
  const overallStatus =
    primary?.status === "reachable" && primary?.configuredModelSummary?.allPresent
      ? "primary_ready"
      : primary?.status === "reachable" && primary?.resolvedTaskSummary?.allPresent
        ? "primary_adaptive_ready"
      : fallback?.status === "reachable" &&
        fallback?.configuredModelSummary?.allPresent
        ? "fallback_ready"
        : fallback?.status === "reachable" &&
            fallback?.resolvedTaskSummary?.allPresent
          ? "fallback_adaptive_ready"
      : "degraded";

  return {
    primaryPreferred: endpointDefinitions[0]?.label === "primary",
    primaryUrl: normalizeUrl(OLLAMA_PRIMARY_URL),
    fallbackUrl: normalizeUrl(OLLAMA_FALLBACK_URL),
    taskModelMap: { ...TASK_MODEL_MAP },
    endpoints: diagnostics,
    overallStatus,
  };
}

async function logOllamaDiagnostics(options = {}) {
  try {
    const diagnostics = await getOllamaDiagnostics({
      includeGenerateProbe: true,
      ...options,
    });

    console.info(
      `[LLM DIAG] primary_first=${diagnostics.primaryPreferred} primary=${diagnostics.primaryUrl} fallback=${diagnostics.fallbackUrl} overall=${diagnostics.overallStatus}`
    );

    diagnostics.endpoints.forEach((endpoint) => {
      console.info(
        `[LLM DIAG] ${endpoint.label} status=${endpoint.status} url=${endpoint.url} configured_models=${endpoint.configuredModelSummary.presentCount}/${endpoint.configuredModelSummary.totalCount}`
      );

      endpoint.configuredModelChecks.forEach((entry) => {
        console.info(
          `[LLM DIAG] ${endpoint.label} task=${entry.taskType} configured=${entry.configuredModel} present=${entry.present} matches=${entry.matchedModels.join(",") || "none"}`
        );
      });

      endpoint.resolvedTaskModels?.forEach((entry) => {
        console.info(
          `[LLM DIAG] ${endpoint.label} resolved task=${entry.taskType} selected=${entry.selectedModel || "none"} source=${entry.selectedFrom}`
        );
      });

      if (Array.isArray(endpoint.generateProbes) && endpoint.generateProbes.length) {
        endpoint.generateProbes.forEach((probe) => {
          console.info(
            `[LLM DIAG] ${endpoint.label} generate model=${probe.model} ok=${probe.ok} latency_ms=${probe.latencyMs || 0} preview=${probe.responsePreview || probe.error || ""}`
          );
        });
      }
    });

    return diagnostics;
  } catch (error) {
    console.warn(`[LLM DIAG] startup diagnostics failed: ${error.message}`);
    return {
      overallStatus: "diagnostic_failed",
      error: error.message,
    };
  }
}

async function requestOllama({
  prompt,
  models = [],
  ollamaTimeoutMs,
  taskType,
}) {
  const plans = await buildOllamaAttemptPlans({
    preferredModels: uniqueNonEmpty(models),
    taskType,
    ollamaTimeoutMs,
  });
  let lastError = null;

  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index];
    const cacheContext = {
      prompt,
      provider: "ollama",
      endpoint: plan.endpoint,
      model: plan.model,
      taskType,
    };
    const cachedText = await readPromptCache(cacheContext);
    if (cachedText) {
      debugLog("llm", "request.ollama.cache.hit", {
        promptChars: String(prompt || "").length,
        endpoint: plan.endpoint,
        model: plan.model,
      });
      return {
        text: cachedText,
        endpointUsed: plan.endpoint,
        modelUsed: plan.model,
        fallbackUsed: index > 0,
        fallbackReason: index > 0 ? "retry_after_failure" : "cache_hit",
        attemptCount: index + 1,
      };
    }

    try {
      const result = await requestOllamaAt({
        baseUrl: plan.endpoint,
        prompt,
        model: plan.model,
        ollamaTimeoutMs,
      });
      if (result.text) {
        await writePromptCache(cacheContext, result.text);
        const fallbackReasons = uniqueNonEmpty([
          plan.usedFallbackEndpoint ? "fallback_endpoint" : "",
          plan.usedFallbackModel ? "fallback_model" : "",
          index > 0 ? "retry_after_failure" : "",
        ]);

        return {
          ...result,
          fallbackUsed: fallbackReasons.length > 0,
          fallbackReason: fallbackReasons.join(","),
          attemptCount: index + 1,
        };
      }

      lastError = new Error(
        `empty response from ${plan.endpoint} using model ${plan.model}`
      );
    } catch (error) {
      lastError = error;
      debugLog("llm", "ollama.request.failed", {
        baseUrl: plan.endpoint,
        model: plan.model,
        error: error.message,
      });
    }
  }

  throw lastError || new Error("No Ollama endpoint or model produced a response.");
}

function buildPromptCacheKey({ prompt, provider, endpoint, model, taskType }) {
  const normalizedEndpoint = normalizeUrl(endpoint || "");
  const normalizedModel = String(model || "").trim();
  const normalizedProvider = String(provider || "").trim();
  const normalizedTaskType = String(taskType || "default").trim();
  const normalizedPrompt = String(prompt || "").trim();
  const hash = crypto
    .createHash("sha256")
    .update(`${normalizedProvider}|${normalizedModel}|${normalizedEndpoint}|${normalizedTaskType}|${normalizedPrompt}`)
    .digest("hex");
  const cacheKey = `llm:${normalizedProvider}:${hash}`;
  debugLog("llm", "cache-key.built", {
    cacheKey,
    provider: normalizedProvider,
    model: normalizedModel,
    taskType: normalizedTaskType,
    promptLength: normalizedPrompt.length,
    promptPreview: normalizedPrompt.slice(0, 150),
  });
  return cacheKey;
}

async function readPromptCache({ prompt, provider, endpoint, model, taskType }) {
  if (!PROMPT_CACHE_ENABLED || PROMPT_CACHE_TTL_SECONDS <= 0) {
    return null;
  }
  try {
    const cacheKey = buildPromptCacheKey({ prompt, provider, endpoint, model, taskType });
    const cached = await shortTermMemory.getPromptCache(cacheKey);
    if (cached) {
      debugLog("llm", "prompt-cache.hit", {
        cacheKey,
        provider,
        model,
        taskType,
        cachedResponseLength: String(cached).length,
      });
    } else {
      debugLog("llm", "prompt-cache.miss", {
        cacheKey,
        provider,
        model,
        taskType,
        promptLength: String(prompt).length,
      });
    }
    return cached;
  } catch (error) {
    debugLog("llm", "prompt-cache.read.failed", {
      error: error.message,
      provider,
      model,
      endpoint,
    });
    return null;
  }
}

async function writePromptCache({ prompt, provider, endpoint, model, taskType }, response) {
  if (!PROMPT_CACHE_ENABLED || PROMPT_CACHE_TTL_SECONDS <= 0) {
    return;
  }
  try {
    const cacheKey = buildPromptCacheKey({ prompt, provider, endpoint, model, taskType });
    await shortTermMemory.setPromptCache(
      cacheKey,
      response,
      PROMPT_CACHE_TTL_SECONDS
    );
    debugLog("llm", "prompt-cache.write", {
      cacheKey,
      provider,
      model,
      taskType,
      ttlSeconds: PROMPT_CACHE_TTL_SECONDS,
      responseLength: String(response).length,
    });
  } catch (error) {
    debugLog("llm", "prompt-cache.write.failed", {
      error: error.message,
      provider,
      model,
      endpoint,
    });
  }
}

async function generateTextWithFallback({
  prompt,
  remoteUrl,
  remoteTimeoutMs,
  ollamaModel,
  ollamaTimeoutMs,
  logLabel = "LLM request",
  taskType,
}) {
  const startedAt = Date.now();
  let remoteError = null;
  let fallbackUsed = false;

  const resolvedModels = buildModelCascade({ ollamaModel, taskType });
  const remoteEnabled =
    Boolean(remoteUrl) &&
    readBooleanEnv(
      "ENABLE_REMOTE_LLM",
      Boolean(process.env.EPUB_LLM_ENDPOINT)
    );
  const preferLocal = readBooleanEnv("LLM_PREFER_LOCAL", true);
  const strategyOrder = preferLocal ? ["ollama", "remote"] : ["remote", "ollama"];

  debugLog("llm", "request.start", {
    label: logLabel,
    promptChars: String(prompt || "").length,
    remoteUrl,
    remoteEnabled,
    preferLocal,
    remoteTimeoutMs: remoteTimeoutMs || DEFAULT_REMOTE_TIMEOUT_MS,
    ollamaModels: resolvedModels,
    ollamaTimeoutMs: ollamaTimeoutMs || DEFAULT_OLLAMA_TIMEOUT_MS,
    taskType: taskType || "default",
    primaryUrl: OLLAMA_PRIMARY_URL,
    fallbackUrl: OLLAMA_FALLBACK_URL,
  });

  async function tryRemote() {
    const cacheContext = {
      prompt,
      provider: "remote",
      endpoint: remoteUrl,
      model: "remote_endpoint",
      taskType,
    };
    const cachedText = await readPromptCache(cacheContext);
    if (cachedText) {
      debugLog("llm", "request.remote.cache.hit", {
        label: logLabel,
        endpoint: remoteUrl,
      });
      return cachedText;
    }

    const remoteText = await requestRemote({
      prompt,
      remoteUrl,
      remoteTimeoutMs,
    });

    if (!remoteText) {
      throw new Error("empty response");
    }

    await writePromptCache(cacheContext, remoteText);

    logLlmUsage({
      label: logLabel,
      provider: "remote",
      model: "remote_endpoint",
      endpoint: remoteUrl,
      fallbackUsed,
      success: true,
      latencyMs: Date.now() - startedAt,
      textChars: remoteText.length,
      taskType,
      prompt,
      response: remoteText,
    });
    debugLog("llm", "request.remote.success", {
      label: logLabel,
      textChars: remoteText.length,
      latencyMs: Date.now() - startedAt,
    });
    return remoteText;
  }

  async function tryOllama() {
    const {
      text,
      endpointUsed,
      modelUsed,
      fallbackUsed: ollamaFallbackUsed,
      fallbackReason,
      attemptCount,
    } = await requestOllama({
      prompt,
      models: resolvedModels,
      ollamaTimeoutMs,
      taskType,
    });

    if (!text) {
      throw new Error("empty response");
    }

    fallbackUsed = fallbackUsed || Boolean(ollamaFallbackUsed);
    logLlmUsage({
      label: logLabel,
      provider: "ollama",
      model: modelUsed,
      endpoint: `${endpointUsed}/api/generate`,
      ollamaEndpointUsed: endpointUsed,
      fallbackUsed,
      success: true,
      latencyMs: Date.now() - startedAt,
      textChars: text.length,
      remoteError,
      reason: fallbackReason,
      taskType,
      prompt,
      response: text,
    });
    debugLog("llm", "request.ollama.success", {
      label: logLabel,
      model: modelUsed,
      endpointUsed,
      textChars: text.length,
      latencyMs: Date.now() - startedAt,
      remoteError,
      fallbackUsed,
      fallbackReason,
      attemptCount,
    });

    return text;
  }

  for (const strategy of strategyOrder) {
    if (strategy === "remote") {
      if (!remoteEnabled) {
        continue;
      }

      try {
        return await tryRemote();
      } catch (error) {
        fallbackUsed = true;
        remoteError = error.message;
        debugLog("llm", "request.remote.failed", {
          label: logLabel,
          error: error.message,
        });
      }

      continue;
    }

    try {
      return await tryOllama();
    } catch (error) {
      fallbackUsed = true;
      remoteError = remoteError || error.message;
    }
  }

  logLlmUsage({
    label: logLabel,
    provider: "ollama",
    model: resolvedModels[0] || DEFAULT_OLLAMA_MODEL,
    endpoint: `${normalizeUrl(OLLAMA_FALLBACK_URL || OLLAMA_PRIMARY_URL)}/api/generate`,
    fallbackUsed,
    success: false,
    latencyMs: Date.now() - startedAt,
    remoteError,
    finalError: remoteError || "No LLM strategy was available.",
    taskType,
  });
  debugLog("llm", "request.failed", {
    label: logLabel,
    model: resolvedModels[0] || DEFAULT_OLLAMA_MODEL,
    latencyMs: Date.now() - startedAt,
    remoteError,
    finalError: remoteError || "No LLM strategy was available.",
  });

  throw new Error(remoteError || "No LLM strategy was available.");
}

module.exports = {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_TIMEOUT_MS,
  DEFAULT_REMOTE_TIMEOUT_MS,
  OLLAMA_PRIMARY_URL,
  OLLAMA_FALLBACK_URL,
  TASK_MODEL_MAP,
  generateTextWithFallback,
  getLlmRuntimeConfig,
  getOllamaDiagnostics,
  logLlmUsage,
  logOllamaDiagnostics,
  resolveModelForTask,
};

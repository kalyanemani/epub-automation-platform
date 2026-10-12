function parseBoolean(value, fallback = false) {
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

function channelToEnvName(channel) {
  return `${String(channel || "pipeline").toUpperCase()}_DEBUG`;
}

function isDebugEnabled(channel = "pipeline") {
  const channelEnv = process.env[channelToEnvName(channel)];
  if (channelEnv !== undefined) {
    return parseBoolean(channelEnv, false);
  }

  return parseBoolean(process.env.PIPELINE_DEBUG, false);
}

function trimString(value, max = 220) {
  const text = String(value || "");
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}...<trimmed:${text.length - max}>`;
}

function sanitize(value, depth = 0) {
  if (value === null || value === undefined) {
    return value;
  }

  if (depth > 2) {
    return "[depth-trimmed]";
  }

  if (typeof value === "string") {
    return trimString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    const slice = value.slice(0, 8).map((item) => sanitize(item, depth + 1));
    if (value.length > 8) {
      slice.push(`...<trimmed:${value.length - 8}>`);
    }
    return slice;
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitize(entry, depth + 1)])
    );
  }

  return trimString(value);
}

function debugLog(channel, event, payload = {}) {
  const AgentLogger = require("./agent-logger");
  if (!isDebugEnabled(channel)) {
    return;
  }

  const label = String(channel || "pipeline").toUpperCase();
  const record = {
    ts: new Date().toISOString(),
    event: String(event || "event"),
    ...sanitize(payload),
  };

  console.info(`[${label} DEBUG]`, JSON.stringify(record));
  
  // Bridge to the new persistent logger
  AgentLogger.log("SYSTEM_EVENT", label, record);
}

module.exports = {
  debugLog,
  isDebugEnabled,
  parseBoolean,
};

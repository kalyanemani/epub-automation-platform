try {
  console.log("Loading Workflow...");
  const { Workflow } = require("@mastra/core/dist/workflows/index.cjs");
  console.log("Workflow loaded successfully");
} catch (e) {
  console.error("Workflow failed:", e.message);
}

try {
  console.log("Loading Agent...");
  const { Agent } = require("@mastra/core/dist/agent/index.cjs");
  console.log("Agent loaded successfully");
} catch (e) {
  console.error("Agent failed:", e.message);
}

const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const { runtimeStore } = require("../storage/runtime-store");

class AgentLogger {
    static serializeDetails(details) {
        try {
            return JSON.parse(JSON.stringify(details ?? {}));
        } catch (error) {
            return {
                serialization_error: error.message,
                preview: String(details),
            };
        }
    }

    /**
     * Log an event to the persistent store
     * @param {string} type - Event type (TOOL_CALL, AGENT_REASONING, WORKFLOW_STEP, etc.)
     * @param {string} source - Origin of the event (ReasoningAgent, ExtractionStep, etc.)
     * @param {object} details - Payload containing inputs, outputs, or reasoning strings.
     */
    static log(type, source, details) {
        const safeDetails = this.serializeDetails(details);
        const entry = {
            type,
            source,
            details: safeDetails,
            timestamp: new Date().toISOString()
        };

        // Also log to console for real-time terminal debugging
        console.log(`[${type}] [${source}] ${JSON.stringify(safeDetails).slice(0, 200)}...`);

        // SYNC LOG TO FILE FOR AGENT DEBUGGING
        try {
            const outputDir = path.join(__dirname, "../../outputs");
            fs.mkdirSync(outputDir, { recursive: true });
            const logFile = path.join(outputDir, "debug.log");
            fs.appendFileSync(
                logFile,
                `[${new Date().toISOString()}] [${type}] [${source}] ${JSON.stringify(safeDetails)}\n`,
                "utf8"
            );
        } catch (error) {}

        try {
            runtimeStore.insertLog({
                id: uuidv4(),
                ...entry,
            }).catch((err) => {
                console.error("Failed to persist agent log:", err);
            });
        } catch (err) {
            console.error("Failed to persist agent log:", err);
        }
    }

    /**
     * Specialized log for tool executions
     */
    static logTool(toolId, input, output, durationMs) {
        this.log("TOOL_CALL", toolId, {
            input,
            output: typeof output === 'string' ? output.slice(0, 1000) : output,
            durationMs
        });
    }

    /**
     * Specialized log for agent reasoning
     */
    static logReasoning(agentId, prompt, response, model) {
        this.log("AGENT_REASONING", agentId, {
            prompt: prompt.slice(0, 500),
            response: response.slice(0, 1000),
            model: model || "unknown"
        });
    }
}

module.exports = AgentLogger;

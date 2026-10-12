const { v4: uuidv4 } = require("uuid");
const { runtimeStore } = require("./runtime-store");

/**
 * Service for managing Textbook and Edition lifecycles using the active storage provider.
 */
class TextbookService {
    
    // Register a new textbook entry
    static async createTextbook(name, originalFilename) {
        const id = uuidv4();
        const record = { id, name, original_filename: originalFilename };
        const textbook = await runtimeStore.createTextbook(record);
        
        // Auto-create the first 'draft' edition
        const firstEdition = await this.createEdition(id, 1, "draft");
        
        return { textbook, edition: firstEdition };
    }

    // List all textbooks
    static async listTextbooks() {
        return runtimeStore.listTextbooks();
    }

    // Create a new edition (version) for a textbook
    static async createEdition(textbookId, versionNumber, status = "draft", artifactPath = null) {
        const id = uuidv4();
        const record = { id, textbook_id: textbookId, version_number: versionNumber, status, artifact_path: artifactPath };
        return runtimeStore.createEdition(record);
    }

    // Record a new validation/autofix run
    static async createRun(editionId) {
        const id = uuidv4();
        const record = { id, edition_id: editionId, status: 'running', report_json: null, started_at: new Date().toISOString() };
        await runtimeStore.createRun(record);
        return id;
    }

    // Complete a run with results
    static async finishRun(runId, reportJson, status = "completed") {
        await runtimeStore.finishRun(runId, reportJson, status);
    }

    // Get textbook history
    static async getHistory(textbookId) {
        return runtimeStore.getHistory(textbookId);
    }
}

module.exports = TextbookService;

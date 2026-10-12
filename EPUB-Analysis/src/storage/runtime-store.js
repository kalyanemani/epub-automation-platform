const { v4: uuidv4 } = require("uuid");

const { db: jsonDb, initializeSchema: initializeJsonSchema } = require("./db");
const { PostgresStorageProvider } = require("./postgres-provider");

function readStorageMode() {
  return String(process.env.EPUB_STORAGE_PROVIDER || "auto").trim().toLowerCase();
}

function normalizeLogRecord(entry = {}) {
  return {
    id: entry.id || uuidv4(),
    type: entry.type || "SYSTEM_EVENT",
    source: entry.source || "unknown",
    details: entry.details || {},
    timestamp: entry.timestamp || new Date().toISOString(),
    created_at: entry.created_at || new Date().toISOString(),
  };
}

class JsonRuntimeStore {
  async initialize() {
    initializeJsonSchema();
  }

  async createTextbook(record = {}) {
    jsonDb.insert("textbooks", record);
    return record;
  }

  async listTextbooks() {
    const textbooks = jsonDb.query("textbooks");
    const editions = jsonDb.readTable("editions");

    return textbooks.map((textbook) => {
      const textbookEditions = editions.filter((edition) => edition.textbook_id === textbook.id);
      const latestEdition = textbookEditions.length
        ? textbookEditions[textbookEditions.length - 1]
        : null;

      return {
        ...textbook,
        current_version: latestEdition ? latestEdition.version_number : 1,
        current_status: latestEdition ? latestEdition.status : "draft",
      };
    });
  }

  async createEdition(record = {}) {
    jsonDb.insert("editions", record);
    return record;
  }

  async createRun(record = {}) {
    jsonDb.insert("runs", record);
    return record;
  }

  async finishRun(runId, reportJson, status = "completed") {
    jsonDb.update(
      "runs",
      (run) => run.id === runId,
      () => ({
        status,
        report_json: reportJson,
        finished_at: new Date().toISOString(),
      })
    );
  }

  async getHistory(textbookId) {
    const editions = jsonDb.query("editions", (edition) => edition.textbook_id === textbookId);
    const runs = jsonDb.readTable("runs");
    const history = [];

    editions.forEach((edition) => {
      runs
        .filter((run) => run.edition_id === edition.id)
        .forEach((run) => {
          history.push({
            version_number: edition.version_number,
            edition_status: edition.status,
            run_status: run.status,
            finished_at: run.finished_at,
            report_json: run.report_json,
          });
        });
    });

    return history.sort(
      (left, right) => new Date(right.finished_at || 0) - new Date(left.finished_at || 0)
    );
  }

  async insertLog(entry = {}) {
    jsonDb.insert("logs", normalizeLogRecord(entry));
  }

  async listLogs() {
    return jsonDb.readTable("logs").sort(
      (left, right) => new Date(left.timestamp || left.created_at || 0) - new Date(right.timestamp || right.created_at || 0)
    );
  }

  getStatus() {
    return {
      provider: "json",
      configured: true,
      fallback: true,
    };
  }
}

class RuntimeStore {
  constructor(options = {}) {
    this.storageMode = options.storageMode || readStorageMode();
    this.jsonStore = options.jsonStore || new JsonRuntimeStore();
    this.postgresStore = options.postgresStore || new PostgresStorageProvider();
    this.activeStore = null;
    this.activeProviderName = "";
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized && this.activeStore) {
      return this.activeStore;
    }

    const preferPostgres = this.storageMode === "postgres" || this.storageMode === "auto";
    if (preferPostgres && this.postgresStore.isConfigured() && this.postgresStore.isSupported()) {
      try {
        await this.postgresStore.initializeSchema();
        this.activeStore = this.postgresStore;
        this.activeProviderName = "postgres";
        this.initialized = true;
        return this.activeStore;
      } catch (error) {
        console.warn(`[Storage] Falling back to JSON store: ${error.message}`);
        if (this.storageMode === "postgres") {
          throw error;
        }
      }
    }

    await this.jsonStore.initialize();
    this.activeStore = this.jsonStore;
    this.activeProviderName = "json";
    this.initialized = true;
    return this.activeStore;
  }

  async store() {
    return this.activeStore || this.initialize();
  }

  async createTextbook(record) {
    return (await this.store()).createTextbook(record);
  }

  async listTextbooks() {
    return (await this.store()).listTextbooks();
  }

  async createEdition(record) {
    return (await this.store()).createEdition(record);
  }

  async createRun(record) {
    return (await this.store()).createRun(record);
  }

  async finishRun(runId, reportJson, status) {
    return (await this.store()).finishRun(runId, reportJson, status);
  }

  async getHistory(textbookId) {
    return (await this.store()).getHistory(textbookId);
  }

  async insertLog(entry) {
    return (await this.store()).insertLog(normalizeLogRecord(entry));
  }

  async listLogs() {
    return (await this.store()).listLogs();
  }

  async getStatus() {
    const active = await this.store();
    return {
      storageMode: this.storageMode,
      activeProvider: this.activeProviderName || "unknown",
      providers: {
        json: this.jsonStore.getStatus(),
        postgres: this.postgresStore.getStatus(),
      },
      initialized: Boolean(active),
    };
  }
}

const runtimeStore = new RuntimeStore();

module.exports = {
  JsonRuntimeStore,
  RuntimeStore,
  normalizeLogRecord,
  runtimeStore,
};

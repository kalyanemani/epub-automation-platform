const fs = require("fs");
const path = require("path");

function optionalRequire(moduleName) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(moduleName);
  } catch (error) {
    return null;
  }
}

function normalizeConnectionString(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

class PostgresStorageProvider {
  constructor(options = {}) {
    this.connectionString = normalizeConnectionString(
      options.connectionString || process.env.POSTGRES_URL || process.env.DATABASE_URL
    );
    this.schemaName = String(
      options.schemaName || process.env.POSTGRES_SCHEMA || "public"
    ).trim();
    this.pg = options.pg || optionalRequire("pg");
    this.pool = null;
  }

  isConfigured() {
    return Boolean(this.connectionString);
  }

  isSupported() {
    return Boolean(this.pg && this.pg.Pool);
  }

  async connect() {
    if (this.pool) {
      return this.pool;
    }

    if (!this.isConfigured()) {
      throw new Error("Postgres connection string is not configured.");
    }

    if (!this.isSupported()) {
      throw new Error("The 'pg' package is not installed.");
    }

    this.pool = new this.pg.Pool({
      connectionString: this.connectionString,
    });
    return this.pool;
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  schemaFilePath() {
    return path.join(__dirname, "schema", "phase1-postgres.sql");
  }

  async initializeSchema() {
    const pool = await this.connect();
    const sql = fs.readFileSync(this.schemaFilePath(), "utf8");
    const renderedSql = sql.replace(/\{\{SCHEMA\}\}/g, this.schemaName);
    await pool.query(renderedSql);
    console.log(`[Storage] Postgres storage initialized using schema '${this.schemaName}'.`);
  }

  async listTextbooks() {
    const pool = await this.connect();
    const query = `
      SELECT
        t.id,
        t.name,
        t.original_filename,
        t.created_at,
        COALESCE(MAX(e.version_number), 1) AS current_version,
        COALESCE(
          (
            SELECT e2.status
            FROM ${this.schemaName}.editions e2
            WHERE e2.textbook_id = t.id
            ORDER BY e2.version_number DESC, e2.created_at DESC
            LIMIT 1
          ),
          'draft'
        ) AS current_status
      FROM ${this.schemaName}.textbooks t
      LEFT JOIN ${this.schemaName}.editions e
        ON e.textbook_id = t.id
      GROUP BY t.id, t.name, t.original_filename, t.created_at
      ORDER BY t.created_at DESC
    `;
    const { rows } = await pool.query(query);
    return rows.map((row) => ({
      ...row,
      current_version: Number(row.current_version || 1),
    }));
  }

  async createTextbook(record = {}) {
    const pool = await this.connect();
    const query = `
      INSERT INTO ${this.schemaName}.textbooks (id, name, original_filename)
      VALUES ($1, $2, $3)
      RETURNING id, name, original_filename, created_at
    `;
    const values = [record.id, record.name, record.original_filename || null];
    const { rows } = await pool.query(query, values);
    return rows[0];
  }

  async createEdition(record = {}) {
    const pool = await this.connect();
    const query = `
      INSERT INTO ${this.schemaName}.editions (
        id,
        textbook_id,
        version_number,
        status,
        artifact_path
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, textbook_id, version_number, status, artifact_path, created_at
    `;
    const values = [
      record.id,
      record.textbook_id,
      record.version_number,
      record.status || "draft",
      record.artifact_path || null,
    ];
    const { rows } = await pool.query(query, values);
    return rows[0];
  }

  async createRun(record = {}) {
    const pool = await this.connect();
    const query = `
      INSERT INTO ${this.schemaName}.runs (
        id,
        edition_id,
        status,
        report_json,
        started_at,
        finished_at
      )
      VALUES ($1, $2, $3, $4::jsonb, $5, $6)
      RETURNING id, edition_id, status, report_json, started_at, finished_at, created_at
    `;
    const values = [
      record.id,
      record.edition_id,
      record.status || "running",
      JSON.stringify(record.report_json || null),
      record.started_at || new Date().toISOString(),
      record.finished_at || null,
    ];
    const { rows } = await pool.query(query, values);
    return rows[0];
  }

  async finishRun(runId, reportJson, status = "completed") {
    const pool = await this.connect();
    const query = `
      UPDATE ${this.schemaName}.runs
      SET status = $2,
          report_json = $3::jsonb,
          finished_at = $4
      WHERE id = $1
    `;
    await pool.query(query, [
      runId,
      status,
      JSON.stringify(reportJson || null),
      new Date().toISOString(),
    ]);
  }

  async getHistory(textbookId) {
    const pool = await this.connect();
    const query = `
      SELECT
        e.version_number,
        e.status AS edition_status,
        r.status AS run_status,
        r.finished_at,
        r.report_json
      FROM ${this.schemaName}.editions e
      LEFT JOIN ${this.schemaName}.runs r
        ON r.edition_id = e.id
      WHERE e.textbook_id = $1
      ORDER BY r.finished_at DESC NULLS LAST, e.version_number DESC
    `;
    const { rows } = await pool.query(query, [textbookId]);
    return rows.map((row) => ({
      version_number: Number(row.version_number || 1),
      edition_status: row.edition_status,
      run_status: row.run_status,
      finished_at: row.finished_at,
      report_json: row.report_json,
    }));
  }

  async insertLog(entry = {}) {
    const pool = await this.connect();
    const query = `
      INSERT INTO ${this.schemaName}.logs (
        id,
        type,
        source,
        details,
        timestamp,
        created_at
      )
      VALUES ($1, $2, $3, $4::jsonb, $5, $6)
      RETURNING id
    `;
    const id = entry.id || entry.log_id;
    const createdAt = entry.created_at || new Date().toISOString();
    await pool.query(query, [
      id,
      entry.type,
      entry.source,
      JSON.stringify(entry.details || {}),
      entry.timestamp || createdAt,
      createdAt,
    ]);
  }

  async listLogs(limit = null) {
    const pool = await this.connect();
    const clause = limit ? "LIMIT $1" : "";
    const query = `
      SELECT id, type, source, details, timestamp, created_at
      FROM ${this.schemaName}.logs
      ORDER BY timestamp ASC, created_at ASC
      ${clause}
    `;
    const { rows } = await pool.query(query, limit ? [limit] : []);
    return rows;
  }

  getStatus() {
    return {
      provider: "postgres",
      configured: this.isConfigured(),
      supported: this.isSupported(),
      schemaName: this.schemaName,
      connectionStringPresent: Boolean(this.connectionString),
    };
  }
}

module.exports = {
  PostgresStorageProvider,
};

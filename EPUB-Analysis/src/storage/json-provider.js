const fs = require("fs");
const path = require("path");

function resolveJsonDbDir() {
  return process.env.EPUB_ANALYSIS_DB_DIR
    ? path.resolve(process.env.EPUB_ANALYSIS_DB_DIR)
    : path.join(__dirname, "../../storage_data");
}

const TABLE_NAMES = ["textbooks", "editions", "runs", "issues", "proposals", "logs"];

function buildTempPath(filePath) {
  const suffix = `${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  return `${filePath}.${suffix}.tmp`;
}

function buildTableMap(baseDir) {
  return TABLE_NAMES.reduce((tables, name) => {
    tables[name] = path.join(baseDir, `${name}.json`);
    return tables;
  }, {});
}

function backupCorruptFile(filePath, rawContent) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${filePath}.corrupt-${timestamp}.bak`;
  fs.writeFileSync(backupPath, rawContent, "utf8");
  return backupPath;
}

function parseTableFile(filePath, tableName) {
  const rawContent = fs.readFileSync(filePath, "utf8");

  try {
    const parsed = JSON.parse(rawContent);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    const backupPath = backupCorruptFile(filePath, rawContent);
    console.warn(
      `[Storage] Recovered corrupt JSON in ${tableName}. Backup created at ${backupPath}.`
    );
    fs.writeFileSync(filePath, JSON.stringify([], null, 2), "utf8");
    return [];
  }
}

function writeTableAtomically(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = buildTempPath(filePath);
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");

  try {
    fs.renameSync(tempPath, filePath);
    return;
  } catch (error) {
    if (!error || !["EPERM", "EACCES"].includes(error.code)) {
      throw error;
    }
  }

  fs.copyFileSync(tempPath, filePath);
  fs.unlinkSync(tempPath);
}

class JsonTableProvider {
  constructor(options = {}) {
    this.baseDir = options.baseDir || resolveJsonDbDir();
    this.tables = buildTableMap(this.baseDir);
  }

  initializeSchema() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }

    Object.entries(this.tables).forEach(([tableName, filePath]) => {
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify([], null, 2), "utf8");
        return;
      }

      parseTableFile(filePath, tableName);
    });

    console.log("[Storage] Local JSON-File DB Initialized.");
  }

  readTable(name) {
    return parseTableFile(this.tables[name], name);
  }

  writeTable(name, data) {
    writeTableAtomically(this.tables[name], Array.isArray(data) ? data : []);
  }

  insert(tableName, record) {
    const table = this.readTable(tableName);
    table.push({ ...record, created_at: new Date().toISOString() });
    this.writeTable(tableName, table);
    return record;
  }

  query(tableName, filterFn) {
    const table = this.readTable(tableName);
    return filterFn ? table.filter(filterFn) : table;
  }

  update(tableName, filterFn, updateFn) {
    const table = this.readTable(tableName);
    const updated = table.map((row) => (filterFn(row) ? { ...row, ...updateFn(row) } : row));
    this.writeTable(tableName, updated);
  }
}

module.exports = {
  JsonTableProvider,
  resolveJsonDbDir,
};

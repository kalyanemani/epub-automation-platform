const { JsonTableProvider } = require("./json-provider");

const provider = new JsonTableProvider();

const db = {
  readTable: (name) => provider.readTable(name),
  writeTable: (name, data) => provider.writeTable(name, data),
  insert: (tableName, record) => provider.insert(tableName, record),
  query: (tableName, filterFn) => provider.query(tableName, filterFn),
  update: (tableName, filterFn, updateFn) => provider.update(tableName, filterFn, updateFn),
};

module.exports = {
  db,
  initializeSchema: () => provider.initializeSchema(),
  provider,
};

const { Agent } = require("undici");

const llmAgent = new Agent({
  headersTimeout: 8 * 60 * 1000,   // 5 minutes
  bodyTimeout:    5 * 60 * 1000,
  connectTimeout: 60 * 1000,
  keepAliveTimeout: 60 * 1000,
  keepAliveMaxTimeout: 5 * 60 * 1000
});

module.exports = { llmAgent };

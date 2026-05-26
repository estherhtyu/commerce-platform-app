const path = require("path");

// Load .env for local CLI use; in deployed App Builder Runtime, values
// come from `params` (wired via `inputs:` in app.config.yaml) instead.
require("dotenv").config({
  path: path.resolve(__dirname, "../../../../.env")
});

// Build a config object from action `params` first, then process.env.
// Throws only when actually called (not at module-require time) so a
// missing env var doesn't crash the action cold start.
function loadConfig(params = {}) {
  const BASE_URL =
    params.COMMERCE_BASE_URL ||
    params.MAGENTO_BASE_URL ||
    process.env.COMMERCE_BASE_URL;

  const TOKEN = params.TOKEN || process.env.TOKEN;

  if (!BASE_URL) {
    throw new Error("COMMERCE_BASE_URL (or MAGENTO_BASE_URL) is missing");
  }
  if (!TOKEN) {
    throw new Error("TOKEN is missing");
  }

  return {
    BASE_URL,
    TOKEN,
    BATCH_SIZE: Number(params.BATCH_SIZE || process.env.BATCH_SIZE || 50),
    BATCH_CONCURRENCY: Number(
      params.BATCH_CONCURRENCY || process.env.BATCH_CONCURRENCY || 3
    ),
    MAX_RETRY: Number(params.MAX_RETRY || process.env.MAX_RETRY || 3),
    POLL_INTERVAL_MS: Number(
      params.POLL_INTERVAL_MS || process.env.POLL_INTERVAL_MS || 3000
    ),
    RETRY_BACKOFF_MS: Number(
      params.RETRY_BACKOFF_MS || process.env.RETRY_BACKOFF_MS || 1000
    )
  };
}

// Back-compat: legacy `const config = require("./config")` callers
// (e.g. local scripts) still get the same fields they had before.
// Wrapped so a missing env var at module-load time can never throw.
let legacy = {};
try {
  legacy = loadConfig({});
} catch (_) {
  legacy = {};
}

module.exports = {
  loadConfig,
  ...legacy
};

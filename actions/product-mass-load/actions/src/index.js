// Minimal logger that mimics info/debug/warn/error using console.*.
// console output is captured by Adobe I/O Runtime and visible via
// `aio app logs` / `aio rt activation logs <id>` / Developer Console.
//
// When an Adobe I/O Runtime activation id is available, it's included
// in every log line so parallel invocations can be told apart.
function createLogger(level = "info", activationId = "") {
  const order = { debug: 10, info: 20, warn: 30, error: 40 };
  const min = order[level] ?? 20;
  const idTag = activationId ? ` [${String(activationId).slice(0, 8)}]` : "";
  const make = (lvl, fn) => (msg) => {
    if (order[lvl] >= min) {
      fn(`[${lvl.toUpperCase()}] [import-products]${idTag} ${msg}`);
    }
  };
  return {
    debug: make("debug", console.log),
    info: make("info", console.log),
    warn: make("warn", console.warn),
    error: make("error", console.error)
  };
}

// Hide secrets and large blobs from log dumps of action params.
function maskParams(params) {
  const SENSITIVE = new Set([
    "TOKEN",
    "OAUTH_CLIENT_SECRET",
    "OAUTH_CLIENT_ID",
    "csvBase64",
    "csvText"
  ]);
  const out = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (k.startsWith("__")) continue;
    if (SENSITIVE.has(k)) {
      out[k] =
        typeof v === "string" ? `<${v.length} chars hidden>` : "<hidden>";
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Decide where to read the CSV from. First match wins:
//   1. params.csvUrl     — HTTP(S) URL to fetch the CSV from (best for large CSVs)
//   2. params.csvBase64  — base64-encoded CSV passed in the invoke params
//   3. params.csvText    — raw CSV string passed in params
//   4. params.useFiles or running in Runtime  — pull from Adobe I/O Files SDK
//   5. Local filesystem (CLI mode)
async function loadCsvProducts(params, logger) {
  const path = require("path");
  const { readCsv, parseCsvBuffer } = require("./csvReader");

  if (params.csvUrl) {
    logger.info(`Reading CSV from URL: ${params.csvUrl}`);
    const axios = require("axios");
    const tFetch = Date.now();
    const res = await axios.get(params.csvUrl, {
      responseType: "arraybuffer",
      timeout: 120000
    });
    const buf = Buffer.from(res.data);
    logger.info(
      `Fetched ${buf.length} bytes in ${Date.now() - tFetch}ms (status ${res.status})`
    );
    return parseCsvBuffer(buf);
  }

  if (params.csvBase64) {
    logger.info(
      `Reading CSV from params.csvBase64 (${params.csvBase64.length} chars)`
    );
    const buf = Buffer.from(params.csvBase64, "base64");
    logger.debug(`Decoded CSV buffer size: ${buf.length} bytes`);
    return parseCsvBuffer(buf);
  }

  if (params.csvText) {
    logger.info(
      `Reading CSV from params.csvText (${params.csvText.length} chars)`
    );
    return parseCsvBuffer(params.csvText);
  }

  if (params.useFiles || (process.env.__OW_ACTIVATION_ID && !params.csvPath)) {
    const Files = require("@adobe/aio-lib-files");
    const files = await Files.init();
    const remotePath = params.csvFilesPath || "products.csv";
    logger.info(`Reading CSV from Files SDK: ${remotePath}`);
    const buf = await files.read(remotePath);
    logger.debug(`Files SDK returned ${buf.length} bytes`);
    return parseCsvBuffer(buf);
  }

  const filePath =
    params.csvPath || path.join(__dirname, "../data/products.csv");
  logger.info(`Reading CSV from disk: ${filePath}`);
  return readCsv(filePath);
}

// Adobe I/O Runtime entrypoint.
async function main(params = {}) {
  const activationId = process.env.__OW_ACTIVATION_ID || "";
  const logger = createLogger(params.LOG_LEVEL || "info", activationId);
  const t0 = Date.now();

  try {
    logger.info("import-products action invoked");
    logger.debug(`runtime: node=${process.version} activationId=${activationId || "(local)"}`);
    logger.debug(`params: ${JSON.stringify(maskParams(params))}`);

    const { uploadProducts } = require("./bulkUploader");
    const { loadConfig } = require("./config");
    const cfg = loadConfig(params);
    logger.debug(
      `config: BASE_URL=${cfg.BASE_URL} BATCH_SIZE=${cfg.BATCH_SIZE} ` +
        `BATCH_CONCURRENCY=${cfg.BATCH_CONCURRENCY} MAX_RETRY=${cfg.MAX_RETRY} ` +
        `POLL_INTERVAL_MS=${cfg.POLL_INTERVAL_MS} RETRY_BACKOFF_MS=${cfg.RETRY_BACKOFF_MS}`
    );

    const tCsv0 = Date.now();
    const products = await loadCsvProducts(params, logger);
    const csvMs = Date.now() - tCsv0;
    logger.info(`Parsed ${products.length} rows from CSV in ${csvMs}ms`);

    if (products.length === 0) {
      logger.warn("CSV is empty — nothing to upload");
      return {
        statusCode: 200,
        body: {
          status: "ok",
          activationId,
          totalProducts: 0,
          message: "empty CSV, nothing to upload"
        }
      };
    }

    const summary = await uploadProducts(products, { cfg, logger });

    const totalMs = Date.now() - t0;
    logger.info(
      `Product mass load completed in ${totalMs}ms ` +
        `(succeeded=${summary.totalSucceeded}, failed=${summary.totalFailed})`
    );

    return {
      statusCode: 200,
      body: { status: "ok", activationId, totalMs, csvParseMs: csvMs, ...summary }
    };
  } catch (err) {
    const message = err.response?.data || err.message || String(err);
    const stack = err.stack || "";
    const elapsedMs = Date.now() - t0;
    logger.error(`import-products failed after ${elapsedMs}ms: ${JSON.stringify(message)}`);
    logger.error(`stack: ${stack}`);

    return {
      statusCode: 500,
      body: { status: "error", activationId, elapsedMs, message, stack }
    };
  }
}

// Local CLI: `node actions/product-mass-load/actions/src/index.js`
// Guarded against running inside OpenWhisk: __OW_ACTIVATION_ID is set by
// Adobe I/O Runtime, so this block executes only when invoked via Node CLI.
if (require.main === module && !process.env.__OW_ACTIVATION_ID) {
  main({ LOG_LEVEL: "debug" })
    .then((res) => {
      console.log("Result:", JSON.stringify(res, null, 2));
      if (res.statusCode !== 200) process.exitCode = 1;
    })
    .catch((err) => {
      console.error("Fatal:", err);
      process.exitCode = 1;
    });
}

exports.main = main;

// upload-csv action.
// One-shot helper: accepts a base64-encoded CSV in `params.csvBase64`,
// writes it to Adobe I/O Files storage at `params.csvFilesPath`
// (default: "products.csv"). The deployed import-products action then
// reads that file at runtime.
//
// Invoke from the project root (PowerShell):
//   $csv = [Convert]::ToBase64String([IO.File]::ReadAllBytes(
//     "actions\product-mass-load\actions\data\products.csv"))
//   aio rt action invoke commerce-platform-app/upload-csv `
//     -p csvBase64 $csv --result

function createLogger(level = "info", activationId = "") {
  const order = { debug: 10, info: 20, warn: 30, error: 40 };
  const min = order[level] ?? 20;
  const idTag = activationId ? ` [${String(activationId).slice(0, 8)}]` : "";
  const make = (lvl, fn) => (msg) => {
    if (order[lvl] >= min) {
      fn(`[${lvl.toUpperCase()}] [upload-csv]${idTag} ${msg}`);
    }
  };
  return {
    debug: make("debug", console.log),
    info: make("info", console.log),
    warn: make("warn", console.warn),
    error: make("error", console.error)
  };
}

async function main(params = {}) {
  const activationId = process.env.__OW_ACTIVATION_ID || "";
  const logger = createLogger(params.LOG_LEVEL || "info", activationId);
  const t0 = Date.now();

  try {
    logger.info("upload-csv action invoked");
    logger.debug(`activationId=${activationId || "(local)"}`);

    if (!params.csvBase64) {
      logger.error("Missing required param: csvBase64");
      return {
        statusCode: 400,
        body: {
          status: "error",
          activationId,
          message:
            "Missing required param 'csvBase64' (base64-encoded CSV content)"
        }
      };
    }

    const remotePath = params.csvFilesPath || "products.csv";
    logger.debug(`Target Files path: ${remotePath}`);
    logger.debug(`csvBase64 length: ${params.csvBase64.length} chars`);

    const buf = Buffer.from(params.csvBase64, "base64");
    logger.info(`Decoded ${buf.length} bytes from csvBase64`);

    const Files = require("@adobe/aio-lib-files");
    logger.debug("Initializing Files SDK...");
    const files = await Files.init();

    logger.info(`Writing to Files storage: ${remotePath}`);
    const tWrite = Date.now();
    await files.write(remotePath, buf);
    logger.info(`Write completed in ${Date.now() - tWrite}ms`);

    // Confirm by listing.
    const list = await files.list("/");
    const found = list.find((f) => f.name === remotePath);
    logger.info(
      `Files in storage: ${list
        .map((f) => `${f.name}(${f.contentLength || "?"})`)
        .join(", ")}`
    );

    const totalMs = Date.now() - t0;
    logger.info(`upload-csv completed in ${totalMs}ms`);

    return {
      statusCode: 200,
      body: {
        status: "ok",
        activationId,
        totalMs,
        remotePath,
        sizeBytes: buf.length,
        confirmed: !!found,
        filesInStorage: list.map((f) => ({
          name: f.name,
          contentLength: f.contentLength
        }))
      }
    };
  } catch (err) {
    const message = err.message || String(err);
    const stack = err.stack || "";
    logger.error(`upload-csv failed after ${Date.now() - t0}ms: ${message}`);
    logger.error(`stack: ${stack}`);

    return {
      statusCode: 500,
      body: {
        status: "error",
        activationId,
        elapsedMs: Date.now() - t0,
        message,
        stack
      }
    };
  }
}

exports.main = main;

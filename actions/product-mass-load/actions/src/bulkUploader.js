const axios = require("axios");
const { mapProduct } = require("./productMapper");

// ---------- helpers ----------

function chunk(data, size) {
  const result = [];
  for (let i = 0; i < data.length; i += size) {
    result.push(data.slice(i, i + size));
  }
  return result;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Decide whether an HTTP error is worth retrying as a transport-level retry.
function isRetriableHttpError(err) {
  if (!err) return false;
  if (err.code === "ECONNRESET" || err.code === "ETIMEDOUT" || err.code === "ECONNABORTED") {
    return true;
  }
  const status = err.response?.status;
  if (!status) return true; // network error, no response
  return status === 408 || status === 429 || status >= 500;
}

// De-dupe rows by SKU within a single batch. Commerce will accept
// duplicates and fail one of them; we'd rather warn early and send once.
function dedupeBySku(batch, logger) {
  const seen = new Set();
  const out = [];
  let dupes = 0;

  for (const row of batch) {
    const sku = row.sku;
    if (!sku) {
      out.push(row);
      continue;
    }
    if (seen.has(sku)) {
      dupes++;
      logger.warn(`Duplicate SKU in batch, skipping: ${sku}`);
      console.log("Duplicate SKU in batch, skipping:", sku);
      continue;
    }
    seen.add(sku);
    out.push(row);
  }

  if (dupes > 0) {
    logger.warn(`De-duplicated ${dupes} row(s) by SKU before submit`);
    console.log("De-duplicated rows by SKU:", dupes);
  }
  return out;
}

// ---------- HTTP with transport-level retry ----------

function createHttp(cfg) {
  return axios.create({
    baseURL: cfg.BASE_URL,
    headers: {
      Authorization: `Bearer ${cfg.TOKEN}`,
      "Content-Type": "application/json"
    },
    timeout: 60000
  });
}

async function httpWithRetry(http, method, url, data, cfg, logger) {
  let attempt = 0;
  let lastErr;

  while (attempt <= cfg.MAX_RETRY) {
    try {
      if (method === "get") return await http.get(url);
      return await http.post(url, data);
    } catch (err) {
      lastErr = err;
      const retriable = isRetriableHttpError(err);
      const status = err.response?.status;
      const msg = err.response?.data || err.message;

      if (!retriable || attempt === cfg.MAX_RETRY) {
        logger.error(
          `HTTP ${method.toUpperCase()} ${url} failed (status=${status}, attempt=${attempt + 1}): ${JSON.stringify(msg)}`
        );
        console.error("HTTP error:", status, msg);
        throw err;
      }

      const wait = cfg.RETRY_BACKOFF_MS * Math.pow(2, attempt);
      logger.warn(
        `HTTP ${method.toUpperCase()} ${url} transient error (status=${status}, attempt=${attempt + 1}), retrying in ${wait}ms`
      );
      console.log("HTTP retry in", wait, "ms; status=", status);
      await sleep(wait);
      attempt++;
    }
  }
  throw lastErr;
}

// ---------- bulk status polling ----------

// Adobe Commerce bulk operation status codes:
//   1 = complete, 2 = retriable failure, 3 = non-retriable failure, 4 = open
async function checkBulkStatus(http, bulkId, batch, cfg, logger) {
  while (true) {
    const res = await httpWithRetry(http, "get", `/V1/bulk/${bulkId}/status`, null, cfg, logger);
    const ops = res.data.operations_list || [];

    const success = ops.filter((op) => op.status === 1);
    const failedRetriable = ops.filter((op) => op.status === 2);
    const failedFinal = ops.filter((op) => op.status === 3);
    const pending = ops.filter(
      (op) => op.status !== 1 && op.status !== 2 && op.status !== 3
    );

    logger.info(
      `Bulk ${bulkId} — Success: ${success.length} | Retriable-fail: ${failedRetriable.length} | Final-fail: ${failedFinal.length} | Pending: ${pending.length}`
    );
    console.log(`Success: ${success.length}`);
    console.log(` Retriable-fail: ${failedRetriable.length}`);
    console.log(` Final-fail: ${failedFinal.length}`);
    console.log(` Pending: ${pending.length}`);

    const logFailure = (f, finalLabel) => {
      const idx = f.id - 1;
      const sku = batch[idx]?.sku || "UNKNOWN";
      logger.error(
        `${finalLabel} SKU=${sku} bulk=${bulkId} message=${f.result_message}`
      );
      console.log(` ${finalLabel} PRODUCT ↓`);
      console.log("   SKU:", sku);
      console.log("   Error:", f.result_message);
    };
    failedRetriable.forEach((f) => logFailure(f, "RETRIABLE-FAILED"));
    failedFinal.forEach((f) => logFailure(f, "FINAL-FAILED"));

    // Pending SKUs: only log a compact summary, not one line per SKU per poll.
    // Use LOG_LEVEL=debug to see a sampled list of which SKUs are still queued.
    if (pending.length > 0) {
      const sampleSkus = pending
        .slice(0, 5)
        .map((p) => batch[p.id - 1]?.sku || "UNKNOWN")
        .join(", ");
      logger.debug(
        `Bulk ${bulkId} still has ${pending.length} pending op(s). ` +
          `Sample SKUs: ${sampleSkus}${pending.length > 5 ? ` ...(+${pending.length - 5} more)` : ""}`
      );
    }

    if (pending.length === 0) {
      logger.info(`Bulk ${bulkId} completed`);
      console.log("Batch completed");
      return {
        retriableIndexes: failedRetriable.map((f) => f.id - 1),
        finalFailures: failedFinal.map((f) => ({
          sku: batch[f.id - 1]?.sku || "UNKNOWN",
          error: f.result_message
        })),
        successCount: success.length
      };
    }

    await sleep(cfg.POLL_INTERVAL_MS);
  }
}

// ---------- submitting a batch ----------

async function submitBatch(http, batch, cfg, logger, submittedBulkIds) {
  logger.info(`Submitting batch of ${batch.length} product(s)`);
  logger.debug(
    `Batch SKUs (first 10): ${batch.slice(0, 10).map((r) => r.sku).join(", ")}` +
      `${batch.length > 10 ? ` ...(+${batch.length - 10} more)` : ""}`
  );
  console.log("Sending batch:", batch.length);

  const tMap = Date.now();
  const payload = await Promise.all(
    batch.map(async (row) => {
      const p = await mapProduct(row);
      if (!p.product.sku || !p.product.price) {
        logger.warn(
          `Invalid product row (missing sku/price): ${JSON.stringify(row)}`
        );
        console.log(" Invalid product:", row);
      }
      return p;
    })
  );
  logger.debug(`mapProduct() for batch took ${Date.now() - tMap}ms`);

  const tPost = Date.now();
  const res = await httpWithRetry(
    http,
    "post",
    "/V1/async/bulk/products",
    payload,
    cfg,
    logger
  );
  logger.debug(`POST /V1/async/bulk/products took ${Date.now() - tPost}ms`);
  const bulkId = res.data.bulk_uuid;

  // Idempotency guard: don't re-process the same bulk_uuid in one run.
  if (submittedBulkIds.has(bulkId)) {
    logger.warn(`Bulk ${bulkId} already submitted in this run, skipping`);
    console.log("Bulk already submitted, skipping:", bulkId);
    return { bulkId, retriableIndexes: [], finalFailures: [], successCount: 0 };
  }
  submittedBulkIds.add(bulkId);

  logger.info(`Bulk submitted: ${bulkId}`);
  console.log("Batch submitted:", bulkId);

  const tPoll = Date.now();
  const status = await checkBulkStatus(http, bulkId, batch, cfg, logger);
  logger.debug(`checkBulkStatus(${bulkId}) took ${Date.now() - tPoll}ms`);
  return { bulkId, ...status };
}

// ---------- per-batch retry of failed products ----------

async function retryFailedProducts(http, retriableIndexes, batch, cfg, logger, submittedBulkIds) {
  if (retriableIndexes.length === 0) {
    return { finalFailures: [], successCount: 0, bulkIds: [] };
  }

  let toRetry = retriableIndexes.map((i) => batch[i]);
  const allFinalFailures = [];
  const allBulkIds = [];
  let totalSuccess = 0;

  for (let attempt = 1; attempt <= cfg.MAX_RETRY; attempt++) {
    const wait = cfg.RETRY_BACKOFF_MS * Math.pow(2, attempt - 1);
    logger.info(
      `Retry attempt ${attempt}/${cfg.MAX_RETRY} for ${toRetry.length} product(s) after ${wait}ms backoff`
    );
    console.log(`Retrying failed products (attempt ${attempt}/${cfg.MAX_RETRY}):`, toRetry.length);
    await sleep(wait);

    try {
      const result = await submitBatch(http, toRetry, cfg, logger, submittedBulkIds);
      allBulkIds.push(result.bulkId);
      totalSuccess += result.successCount;
      allFinalFailures.push(...result.finalFailures);

      if (result.retriableIndexes.length === 0) {
        return { finalFailures: allFinalFailures, successCount: totalSuccess, bulkIds: allBulkIds };
      }

      // Narrow `toRetry` to just the rows that failed retriably this round.
      toRetry = result.retriableIndexes.map((i) => toRetry[i]);
    } catch (err) {
      logger.error(`Retry attempt ${attempt} threw: ${err.response?.data || err.message}`);
      console.error("Retry attempt threw:", err.response?.data || err.message);
      if (attempt === cfg.MAX_RETRY) {
        toRetry.forEach((row) => {
          allFinalFailures.push({
            sku: row?.sku || "UNKNOWN",
            error: `Retry exhausted: ${err.message}`
          });
        });
      }
    }
  }

  // Anything still in `toRetry` after MAX_RETRY is a final failure.
  toRetry.forEach((row) => {
    allFinalFailures.push({
      sku: row?.sku || "UNKNOWN",
      error: "Retry attempts exhausted while still in retriable-failure state"
    });
  });

  return { finalFailures: allFinalFailures, successCount: totalSuccess, bulkIds: allBulkIds };
}

// ---------- concurrency helper ----------

// Run `items` through `processor(item, index)` with at most `limit`
// concurrent promises in flight at any time. Resolves with the array of
// per-item results in input order.
async function withConcurrency(items, limit, processor) {
  const results = new Array(items.length);
  const inFlight = new Set();
  let next = 0;

  async function startOne(i) {
    const p = (async () => {
      try {
        results[i] = await processor(items[i], i);
      } finally {
        inFlight.delete(p);
      }
    })();
    inFlight.add(p);
  }

  while (next < items.length) {
    while (inFlight.size < limit && next < items.length) {
      startOne(next++);
    }
    if (inFlight.size > 0) await Promise.race(inFlight);
  }
  await Promise.all(inFlight);
  return results;
}

// ---------- main upload entry ----------

async function uploadProducts(products, { cfg, logger } = {}) {
  if (!cfg || !logger) {
    throw new Error("uploadProducts requires { cfg, logger }");
  }

  const http = createHttp(cfg);
  const submittedBulkIds = new Set();
  const batches = chunk(products, cfg.BATCH_SIZE);
  const concurrency = Math.max(1, Number(cfg.BATCH_CONCURRENCY) || 1);

  logger.info(`Total products: ${products.length}`);
  logger.info(
    `Total batches: ${batches.length} (size=${cfg.BATCH_SIZE}, concurrency=${concurrency})`
  );
  console.log("Total products:", products.length);
  console.log("Total batches:", batches.length);

  const t0 = Date.now();

  const perBatchResults = await withConcurrency(batches, concurrency, async (rawBatch, i) => {
    const batchNum = i + 1;
    const tag = `[B${batchNum}/${batches.length}]`;
    const batch = dedupeBySku(rawBatch, logger);
    const tBatch = Date.now();

    logger.info(`${tag} start (${batch.length} product(s))`);
    console.log(`${tag} start`);

    try {
      const result = await submitBatch(http, batch, cfg, logger, submittedBulkIds);
      const retry = await retryFailedProducts(
        http,
        result.retriableIndexes,
        batch,
        cfg,
        logger,
        submittedBulkIds
      );

      const okCount = result.successCount + retry.successCount;
      const failCount = result.finalFailures.length + retry.finalFailures.length;

      logger.info(
        `${tag} done in ${Date.now() - tBatch}ms (success=${okCount}, final-failed=${failCount})`
      );

      return {
        ok: true,
        bulkIds: [result.bulkId, ...retry.bulkIds],
        successCount: okCount,
        failures: [...result.finalFailures, ...retry.finalFailures]
      };
    } catch (err) {
      logger.error(
        `${tag} failed at submit after ${Date.now() - tBatch}ms: ` +
          `${JSON.stringify(err.response?.data || err.message)}`
      );
      console.error(" Batch error:", err.response?.data || err.message);
      return {
        ok: false,
        bulkIds: [],
        successCount: 0,
        failures: batch.map((row) => ({
          sku: row?.sku || "UNKNOWN",
          error: `Batch submit failed: ${err.message}`
        }))
      };
    }
  });

  let totalSucceeded = 0;
  const allFailures = [];
  const allBulkIds = [];
  for (const r of perBatchResults) {
    totalSucceeded += r.successCount;
    allFailures.push(...r.failures);
    allBulkIds.push(...r.bulkIds);
  }

  const totalMs = Date.now() - t0;

  const summary = {
    totalProducts: products.length,
    totalBatches: batches.length,
    concurrency,
    totalSucceeded,
    totalFailed: allFailures.length,
    failures: allFailures,
    bulkIds: allBulkIds,
    uploadMs: totalMs
  };

  logger.info(
    `Upload summary: succeeded=${summary.totalSucceeded} failed=${summary.totalFailed} batches=${summary.totalBatches} in ${totalMs}ms`
  );
  console.log("Upload summary:", summary);

  return summary;
}

module.exports = { uploadProducts };

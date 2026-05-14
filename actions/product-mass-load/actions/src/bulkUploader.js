const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const config = require("./config");
const { mapProduct } = require("./productMapper");

const http = axios.create({
  baseURL: config.BASE_URL,
  headers: {
    Authorization: `Bearer ${config.TOKEN}`,
    "Content-Type": "application/json",
  },
});

function chunk(data, size) {
  const result = [];
  for (let i = 0; i < data.length; i += size) {
    result.push(data.slice(i, i + size));
  }
  return result;
}

async function sendBatch(batch, attempt = 1) {
  try {
    console.log("Sending batch with products:", batch.length);
    const payload = await Promise.all(batch.map(mapProduct));

    const res = await http.post(
      "/V1/async/bulk/products",
      payload
    );
    console.log('payload', payload);
    console.log("Batch submitted:", res.data.bulk_uuid);
    return res.data;
  } catch (err) {
    console.error('Error submitting batch:', err.response?.data || err.message);
    if (attempt <= config.MAX_RETRY && err.response?.status >= 500) {
      console.warn(`Retrying batch, attempt ${attempt}`);
      return sendBatch(batch, attempt + 1);
    }
    throw err;
  }
}

async function uploadProducts(products) {
  const batches = chunk(products, config.BATCH_SIZE);
  
console.log("Total products:", products.length);
  console.log("Total batches:", batches.length);

  batches.forEach((b, i) => {
    console.log(`Batch ${i + 1} size:`, b.length);
  });

  for (const batch of batches) {
    await sendBatch(batch);
  }
}

module.exports = { uploadProducts };
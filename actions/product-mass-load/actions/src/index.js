const path = require("path");
const { readCsv } = require("./csvReader");
const { uploadProducts } = require("./bulkUploader");

async function run() {
  try {
    const filePath = path.join(__dirname, "../data/products.csv");
    const products = await readCsv(filePath);

    console.log(`Loaded ${products.length} products from CSV`);
    await uploadProducts(products);

    console.log("Product mass load triggered successfully");
  } catch (err) {
    console.error("Error:", err.response?.data || err.message);
  }
}

run();
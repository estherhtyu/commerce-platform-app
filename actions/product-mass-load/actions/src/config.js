
const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, "../../../../.env")
});

if (!process.env.COMMERCE_BASE_URL) {
  throw new Error("COMMERCE_BASE_URL is missing");
}

if (!process.env.TOKEN) {
  throw new Error("COMMERCE_ADMIN_TOKEN is missing");
}

module.exports = {
  BASE_URL: process.env.COMMERCE_BASE_URL,
  TOKEN: process.env.TOKEN,
  BATCH_SIZE: Number(process.env.BATCH_SIZE || 50),
  MAX_RETRY: Number(process.env.MAX_RETRY || 3),
};
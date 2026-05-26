const fs = require("fs");
const { Readable } = require("stream");
const csv = require("csv-parser");

// Parse a CSV from a Node Readable stream. Attaches error handlers to
// BOTH the source and the parser so ENOENT etc. don't escape as
// uncaughtException (which kills the action container).
function parseCsvStream(source) {
  return new Promise((resolve, reject) => {
    const rows = [];
    const parser = csv();

    source.on("error", reject);
    parser.on("error", reject);
    parser.on("data", (row) => rows.push(row));
    parser.on("end", () => resolve(rows));

    source.pipe(parser);
  });
}

// Parse from a local file path (CLI mode).
function readCsv(filePath) {
  return parseCsvStream(fs.createReadStream(filePath));
}

// Parse from an in-memory Buffer or string (Runtime mode after pulling
// the CSV from Files SDK).
function parseCsvBuffer(bufferOrString) {
  const buf = Buffer.isBuffer(bufferOrString)
    ? bufferOrString
    : Buffer.from(String(bufferOrString), "utf8");
  return parseCsvStream(Readable.from(buf));
}

module.exports = { readCsv, parseCsvBuffer };

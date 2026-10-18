/* Loads the browser scripts into Node for the checks. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
globalThis.self = globalThis;
globalThis.pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
globalThis.PDFLib = require("pdf-lib");
globalThis.fontkit = require("@pdf-lib/fontkit");
const JS = path.join(__dirname, "..", "assets", "js");
function load(name) { vm.runInThisContext(fs.readFileSync(path.join(JS, name), "utf8"), { filename: name }); }
["wordfreq.js", "text.js", "extract.js", "ai.js", "similarity.js", "sources.js", "report.js"].forEach(f => { if (fs.existsSync(path.join(JS, f))) load(f); });
module.exports = globalThis.VT;

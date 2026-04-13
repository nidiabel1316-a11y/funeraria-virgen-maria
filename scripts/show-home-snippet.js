const fs = require("fs");
const s = fs.readFileSync(require("path").join(__dirname, "..", "index.html"), "utf8");
const i = s.indexOf('{tab==="home"');
const j = s.indexOf('{tab==="pay"', i);
const block = s.slice(i, j);
const idx = block.indexOf(":null}");
console.log("len", block.length, ":null} at", idx);
console.log(block.slice(Math.max(0, idx - 80), idx + 120));

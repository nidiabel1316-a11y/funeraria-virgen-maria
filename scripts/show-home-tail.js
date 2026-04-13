const fs = require("fs");
const s = fs.readFileSync(require("path").join(__dirname, "..", "index.html"), "utf8");
const i = s.indexOf('{tab==="home"');
const j = s.indexOf('{tab==="pay"', i);
const block = s.slice(i, j);
console.log("TAIL:", block.slice(-400));

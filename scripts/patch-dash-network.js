const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "index.html");
let s = fs.readFileSync(file, "utf8");

const startPat =
  '<div className="cd" style={{padding:12,marginBottom:14,maxWidth:420,marginLeft:"auto",marginRight:"auto",border:`1px solid ${A}`,borderRadius:10}}><div style={{fontSize:11,fontWeight:700,color:P,marginBottom:6}}>Foto en «Mi red»</div>';
const i0 = s.indexOf(startPat);
const endPat = '</div>:null}</div><div className="rg" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>';
const i1 = s.indexOf(endPat, i0);
if (i0 === -1 || i1 === -1) {
  console.error("Bloque foto no encontrado", i0, i1);
  process.exit(1);
}
s = s.slice(0, i0) + s.slice(i1);

const oldTree =
  "if(root.children)root.children.forEach(collapse);const dur=pv?750:650;";
const newTree =
  "const dur=pv?750:650;";
if (!s.includes(oldTree)) {
  console.error("No se encontró collapse en FvmD3Tree");
  process.exit(1);
}
s = s.replace(oldTree, newTree);

fs.writeFileSync(file, s);
console.log("OK patch-dash-network");

const fs = require("fs");
const p = "c:/Users/aboga/funerariavirgenmaria/index.html";
let c = fs.readFileSync(p, "utf8");

const oldDash =
  'const[payL,sPayL]=useState(false);const mapMe=m=>{';
const newDash =
  'const[payL,sPayL]=useState(false);const[abd,sAb]=useState([]);const mapMe=m=>{';
if (!c.includes(oldDash)) {
  console.error("payL state not found");
  process.exit(1);
}
c = c.replace(oldDash, newDash);

const oldEff =
  '},[tab]);const cp=()=>{if(!u)return;navigator.clipboard?.writeText(`https://funerariavirgenmaria.com/ref/${u.cd}`);sTo({msg:"Copiado!",tp:"ok"})};';
const newEff =
  '},[tab]);useEffect(()=>{if(!getFvmSession()||tab!=="home")return;let ok=true;(async()=>{try{const x=await api("/auth/academy-broadcasts");if(ok)sAb(x.broadcasts||[])}catch(e){if(ok)sAb([])}})();return()=>{ok=false}},[tab]);const cp=()=>{if(!u)return;navigator.clipboard?.writeText(`https://funerariavirgenmaria.com/ref/${u.cd}`);sTo({msg:"Copiado!",tp:"ok"})};';
if (!c.includes(oldEff)) {
  console.error("useEffect after comms not found");
  process.exit(1);
}
c = c.replace(oldEff, newEff);

const oldHome =
  '{tab==="home"&&<div className="anim-fast"><div className="cd fvm-id-box" style={{padding:12,marginBottom:14,maxWidth:420,marginLeft:"auto",marginRight:"auto",border:`1px solid ${A}`,borderRadius:10,background:`linear-gradient(135deg,${P}06,${A}10)`}}>';
const newHome =
  '{tab==="home"&&<div className="anim-fast">{abd&&abd.length>0&&<div className="cd" style={{padding:14,marginBottom:12,background:`${A}12`,border:`1px solid ${A}`,borderRadius:10}}><div style={{fontSize:11,fontWeight:700,color:P,marginBottom:8}}>📚 Avisos — Academia</div>{abd.map(br=><div key={br.id} style={{marginBottom:10,padding:10,background:"#fff",borderRadius:8}}><div style={{fontWeight:700,color:P}}>{br.title}</div>{br.course_name&&<div style={{fontSize:11,color:TL}}>Curso: {br.course_name}{br.start_date?` · Inicio: ${String(br.start_date).slice(0,10)}`:""}</div>}{br.body&&<p style={{fontSize:11,marginTop:6,lineHeight:1.4}}>{br.body}</p>}</div>)}</div>}<div className="cd fvm-id-box" style={{padding:12,marginBottom:14,maxWidth:420,marginLeft:"auto",marginRight:"auto",border:`1px solid ${A}`,borderRadius:10,background:`linear-gradient(135deg,${P}06,${A}10)`}}>';
if (!c.includes(oldHome)) {
  console.error("home tab start not found");
  process.exit(1);
}
c = c.replace(oldHome, newHome);

fs.writeFileSync(p, c);
console.log("dash patched");

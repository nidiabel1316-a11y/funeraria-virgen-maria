const fs = require("fs");
const p = "c:/Users/aboga/funerariavirgenmaria/index.html";
let c = fs.readFileSync(p, "utf8");

const oldBenef = `[{i:"⚖️",t:"Asesoría Legal"},{i:"🎓",t:"Academia"},{i:"💼",t:"Bolsa Empleo"},{i:"💰",t:"Incentivos 10%"}].map(b=><div key={b.t} style={{background:"rgba(255,255,255,.08)",borderRadius:10,padding:18,border:"1px solid rgba(197,165,90,.15)"}}><div style={{fontSize:28,marginBottom:6}}>{b.i}</div><h3 className="sf" style={{color:A,fontSize:14}}>{b.t}</h3></div>)`;

const newBenef = `[{i:"⚖️",t:"Asesoría Legal",a:"asesoria"},{i:"🎓",t:"Academia",a:"academy"},{i:"💼",t:"Bolsa Empleo",a:"jobs"},{i:"💰",t:"Incentivos 10%",a:"incentivos"}].map(b=><div key={b.t} role="button" tabIndex={0} onClick={()=>b.a==="incentivos"?sc("incentivos-mlm"):go(b.a)} onKeyDown={e=>e.key==="Enter"&&(b.a==="incentivos"?sc("incentivos-mlm"):go(b.a))} style={{background:"rgba(255,255,255,.08)",borderRadius:10,padding:18,border:"1px solid rgba(197,165,90,.15)",cursor:"pointer"}}><div style={{fontSize:28,marginBottom:6}}>{b.i}</div><h3 className="sf" style={{color:A,fontSize:14}}>{b.t}</h3></div>)`;

if (!c.includes(oldBenef)) {
  console.error("beneficio block not found");
  process.exit(1);
}
c = c.replace(oldBenef, newBenef);

const oldSec =
  '<section style={{padding:"56px 24px",maxWidth:1200,margin:"0 auto"}}><h2 className="sf" style={{fontSize:30,color:P,textAlign:"center",marginBottom:20}}>Incentivos MLM</h2>';
const newSec =
  '<section id="incentivos-mlm" style={{padding:"56px 24px",maxWidth:1200,margin:"0 auto"}}><h2 className="sf" style={{fontSize:30,color:P,textAlign:"center",marginBottom:20}}>Incentivos MLM</h2>';
if (!c.includes(oldSec)) {
  console.error("incentivos section not found");
  process.exit(1);
}
c = c.replace(oldSec, newSec);

const oldApp =
  'return<>{pg==="landing"&&<Landing go={go}/>}{pg==="reg"&&<Register go={go}/>}{pg==="login"&&<Login go={go}/>}{pg==="forgot"&&<ForgotPassword go={go}/>}{pg==="resetpw"&&<ResetPassword go={go}/>}{pg==="dash"&&<Dash go={go}/>}{pg==="admin"&&<AdminPanel go={go}/>}</>';
const newApp =
  'return<>{pg==="landing"&&<Landing go={go}/>}{pg==="asesoria"&&<PageAsesoria go={go}/>}{pg==="academy"&&<PageAcademia go={go}/>}{pg==="jobs"&&<PageJobs go={go}/>}{pg==="reg"&&<Register go={go}/>}{pg==="login"&&<Login go={go}/>}{pg==="forgot"&&<ForgotPassword go={go}/>}{pg==="resetpw"&&<ResetPassword go={go}/>}{pg==="dash"&&<Dash go={go}/>}{pg==="admin"&&<AdminPanel go={go}/>}</>';
if (!c.includes(oldApp)) {
  console.error("App return not found");
  process.exit(1);
}
c = c.replace(oldApp, newApp);

fs.writeFileSync(p, c);
console.log("patched");

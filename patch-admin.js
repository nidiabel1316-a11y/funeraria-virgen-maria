const fs = require("fs");
const p = "c:/Users/aboga/funerariavirgenmaria/index.html";
let c = fs.readFileSync(p, "utf8");

const s1 =
  'const [repExY,setRepExY]=useState(()=>String(new Date().getFullYear())); const adminApi=async(path,opt={})=>';
const s1n =
  'const [repExY,setRepExY]=useState(()=>String(new Date().getFullYear())); const [acRegs,setAR]=useState(null); const [acBr,setAB]=useState(null); const [acLd,setAL]=useState(false); const [btit,sBt]=useState(""); const [bbod,sBb]=useState(""); const [bcrs,sBc]=useState(""); const [bdat,sBd]=useState(""); const adminApi=async(path,opt={})=>';
if (!c.includes(s1)) {
  console.error("s1 not found");
  process.exit(1);
}
c = c.replace(s1, s1n);

const s2 =
  '},[tok,view]); const login=async()=>{ sErr(""); try{ const r=await adminApi("/admin/login",{method:"POST",body:JSON.stringify({user:usr,password:pw})}); localStorage.setItem("fvm_admin_tok",r.token); setTok(r.token); sView("dashboard"); }catch(e){sErr(e.message||"Error")} };';
const s2n =
  '},[tok,view]); useEffect(()=>{ if(!tok||view!=="academia")return; let ok=true; setAL(true); (async()=>{ try{ const [a,b]=await Promise.all([adminApi("/admin/academy/registrations"),adminApi("/admin/academy/broadcasts")]); if(ok){ setAR(a.registrations||[]); setAB(b.broadcasts||[]); } }catch(e){ if(ok){ setAR([]); setAB([]); } } finally{ if(ok)setAL(false); } })(); return()=>{ok=false}; },[tok,view]); const login=async()=>{ sErr(""); try{ const r=await adminApi("/admin/login",{method:"POST",body:JSON.stringify({user:usr,password:pw})}); localStorage.setItem("fvm_admin_tok",r.token); setTok(r.token); sView("dashboard"); }catch(e){sErr(e.message||"Error")} };';
if (!c.includes(s2)) {
  console.error("s2 not found");
  process.exit(1);
}
c = c.replace(s2, s2n);

const s3 = '{navItem("contratos","Contratos","📋")} {navItem("config","Config","⚙️")} </nav>';
const s3n =
  '{navItem("contratos","Contratos","📋")} {navItem("academia","Academia","📚")} {navItem("config","Config","⚙️")} </nav>';
if (!c.includes(s3)) {
  console.error("s3 not found");
  process.exit(1);
}
c = c.replace(s3, s3n);

const s4 =
  '<span style={{fontSize:22}}>{view==="dashboard"?"📊":view==="asociados"?"👥":view==="comisiones"?"💰":view==="red"?"🌐":view==="reportes"?"📈":view==="contratos"?"📋":"⚙️"}</span> <h1 style={{margin:0,fontSize:18,color:AD.maroon,fontWeight:700}}>{view==="dashboard"?"Dashboard":view==="asociados"?"Asociados":view==="comisiones"?"Comisiones":view==="red"?"Red Global":view==="reportes"?"Reportes":view==="contratos"?"Contratos / solicitudes":"Config"}</h1>';
const s4n =
  '<span style={{fontSize:22}}>{view==="dashboard"?"📊":view==="asociados"?"👥":view==="comisiones"?"💰":view==="red"?"🌐":view==="reportes"?"📈":view==="contratos"?"📋":view==="academia"?"📚":"⚙️"}</span> <h1 style={{margin:0,fontSize:18,color:AD.maroon,fontWeight:700}}>{view==="dashboard"?"Dashboard":view==="asociados"?"Asociados":view==="comisiones"?"Comisiones":view==="red"?"Red Global":view==="reportes"?"Reportes":view==="contratos"?"Contratos / solicitudes":view==="academia"?"Academia & bolsa":"Config"}</h1>';
if (!c.includes(s4)) {
  console.error("s4 not found");
  process.exit(1);
}
c = c.replace(s4, s4n);

const s5 = '{view==="config"&&( <div style={{padding:24}}> <div style={{background:AD.card,borderRadius:12,padding:24,border:"1px solid "+AD.border,maxWidth:560}}> <h3 style={{color:AD.maroon,marginTop:0}}>Configuración (Hostinger)</h3>';
const s5n =
  '{view==="academia"&&( <div style={{padding:24}}> <p style={{color:AD.muted,fontSize:13,maxWidth:720,marginBottom:16}}>Inscripciones a cursos y avisos que verán los afiliados en su panel.</p> {acLd?<div style={{color:AD.muted}}>Cargando…</div>:( <> <div style={{background:AD.card,borderRadius:12,padding:20,border:"1px solid "+AD.border,marginBottom:20}}> <h3 style={{color:AD.maroon,marginTop:0,fontSize:15}}>Nuevo aviso / curso (afiliados)</h3> <input className="inp" placeholder="Título" value={btit} onChange={e=>sBt(e.target.value)} style={{marginBottom:8,width:"100%"}}/> <textarea className="inp" placeholder="Mensaje (opcional)" rows={3} value={bbod} onChange={e=>sBb(e.target.value)} style={{width:"100%",marginBottom:8}}/> <input className="inp" placeholder="Nombre del curso (opcional)" value={bcrs} onChange={e=>sBc(e.target.value)} style={{marginBottom:8}}/> <label style={{fontSize:11}}>Fecha inicio (opcional)</label> <input className="inp" type="date" value={bdat} onChange={e=>sBd(e.target.value)} style={{marginBottom:12,maxWidth:200}}/> <button type="button" className="bp" onClick={async()=>{ try{ await adminApi("/admin/academy/broadcasts",{method:"POST",body:JSON.stringify({title:btit,body:bbod,courseName:bcrs,startDate:bdat||null})}); setToast({m:"Aviso publicado",tp:"ok"}); sBt("");sBb("");sBc("");sBd(""); const b=await adminApi("/admin/academy/broadcasts"); setAB(b.broadcasts||[]); }catch(e){ setToast({m:e.message,tp:"err"}); } }}>Publicar aviso</button> </div> <div style={{background:AD.card,borderRadius:12,border:"1px solid "+AD.border,overflow:"auto",marginBottom:20}}> <div style={{padding:"12px 14px",borderBottom:"1px solid "+AD.border,fontWeight:700,color:AD.maroon}}>Preinscripciones recientes</div> <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}> <thead><tr style={{background:"#F9FAFB"}}><th style={{padding:8,textAlign:"left"}}>Fecha</th><th>Nombre</th><th>Correo</th><th>Interés</th></tr></thead> <tbody> {(acRegs&&acRegs.length)?acRegs.map(r=>( <tr key={r.id} style={{borderBottom:"1px solid "+AD.border}}> <td style={{padding:8}}>{r.created_at?String(r.created_at).slice(0,19):""}</td> <td style={{padding:8}}>{r.full_name}</td> <td style={{padding:8}}>{r.email}</td> <td style={{padding:8,maxWidth:200}}>{r.course_interest||"—"}</td> </tr> )):<tr><td colSpan={4} style={{padding:16,color:AD.muted}}>Sin inscripciones. Ejecuta migrate_academy_jobs.sql si la tabla no existe.</td></tr>} </tbody> </table> </div> <div style={{background:AD.card,borderRadius:12,border:"1px solid "+AD.border,overflow:"auto"}}> <div style={{padding:"12px 14px",borderBottom:"1px solid "+AD.border,fontWeight:700,color:AD.maroon}}>Avisos enviados</div> <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}> <thead><tr style={{background:"#F9FAFB"}}><th style={{padding:8,textAlign:"left"}}>Fecha</th><th>Título</th><th>Curso</th><th>Inicio</th></tr></thead> <tbody> {(acBr&&acBr.length)?acBr.map(r=>( <tr key={r.id} style={{borderBottom:"1px solid "+AD.border}}> <td style={{padding:8}}>{r.created_at?String(r.created_at).slice(0,19):""}</td> <td style={{padding:8}}>{r.title}</td> <td style={{padding:8}}>{r.course_name||"—"}</td> <td style={{padding:8}}>{r.start_date?String(r.start_date).slice(0,10):"—"}</td> </tr> )):<tr><td colSpan={4} style={{padding:16,color:AD.muted}}>Sin avisos aún.</td></tr>} </tbody> </table> </div> </> )} </div> )} {view==="config"&&( <div style={{padding:24}}> <div style={{background:AD.card,borderRadius:12,padding:24,border:"1px solid "+AD.border,maxWidth:560}}> <h3 style={{color:AD.maroon,marginTop:0}}>Configuración (Hostinger)</h3>';
if (!c.includes(s5)) {
  console.error("s5 not found");
  process.exit(1);
}
c = c.replace(s5, s5n);

fs.writeFileSync(p, c);
console.log("admin patched");

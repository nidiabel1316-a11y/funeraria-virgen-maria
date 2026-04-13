# -*- coding: utf-8 -*-
"""Parche one-shot: contraseña en afiliación + login + cambio en dashboard."""
from pathlib import Path

p = Path(__file__).parent / "index.html"
text = p.read_text(encoding="utf-8")

# 1) Helpers localStorage (después de WA)
needle = 'const WA="573001234567";'
insert = needle + 'const FVM_UK="fvm_users",FVM_SK="fvm_session_doc";const getFvmUsers=()=>{try{return JSON.parse(localStorage.getItem(FVM_UK)||"{}")}catch(e){return{}}};const setFvmUser=(doc,d)=>{const o=getFvmUsers();o[doc]=d;localStorage.setItem(FVM_UK,JSON.stringify(o))};const getFvmSession=()=>localStorage.getItem(FVM_SK);const setFvmSession=d=>localStorage.setItem(FVM_SK,d);const clearFvmSession=()=>localStorage.removeItem(FVM_SK);'
if insert not in text:
    assert needle in text, "WA constant not found"
    text = text.replace(needle, insert, 1)

# 2) Estado Register: pw y pw2
old2 = 'pi:"premium",ben:[],pet:[]});const[err,sE]=useState({});const[cok,sC]=useState(false);const pl=PLANS.find'
new2 = 'pi:"premium",ben:[],pet:[],pw:"",pw2:""});const[err,sE]=useState({});const[cok,sC]=useState(false);const pl=PLANS.find'
if old2 in text:
    text = text.replace(old2, new2, 1)

# 3) Validación paso 1
old3 = 'if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(fd.em))e.em="Inválido";}sE(e);return!Object.keys(e).length};const nx=()=>'
new3 = 'if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(fd.em))e.em="Inválido";if(!fd.pw||fd.pw.length<8)e.pw="Mínimo 8 caracteres";else if(fd.pw!==fd.pw2)e.pw2="No coinciden";}sE(e);return!Object.keys(e).length};const nx=()=>'
if old3 in text:
    text = text.replace(old3, new3, 1)

# 4) Campos contraseña en paso 1 (después de Referido)
old4 = 'Referido</label><input className="inp" value={fd.rc} onChange={e=>up("rc",e.target.value)} style={{marginTop:2}}/></div></div></div>}'
new4 = 'Referido</label><input className="inp" value={fd.rc} onChange={e=>up("rc",e.target.value)} style={{marginTop:2}}/></div><div style={{gridColumn:"1/-1"}}><label style={{fontSize:10,fontWeight:600}}>Contraseña *</label><input className={`inp ${err.pw?"er":""}`} type="password" value={fd.pw} onChange={e=>up("pw",e.target.value)} placeholder="Mínimo 8 caracteres" autoComplete="new-password" style={{marginTop:2}}/>{err.pw&&<div className="em">{err.pw}</div>}</div><div style={{gridColumn:"1/-1"}}><label style={{fontSize:10,fontWeight:600}}>Confirmar contraseña *</label><input className={`inp ${err.pw2?"er":""}`} type="password" value={fd.pw2} onChange={e=>up("pw2",e.target.value)} autoComplete="new-password" style={{marginTop:2}}/>{err.pw2&&<div className="em">{err.pw2}</div>}</div></div></div>}'
if old4 in text:
    text = text.replace(old4, new4, 1)

# 5) Guardar usuario al pagar
old5 = 'setTimeout(()=>go("dash"),1500)'
new5 = 'setTimeout(()=>{setFvmUser(fd.dn.replace(/\\D/g,"")||fd.dn,{nm:fd.fn,em:fd.em,password:fd.pw,pl:fd.pi,ben:fd.ben.length});setFvmSession((fd.dn.replace(/\\D/g,"")||fd.dn));go("dash")},1500)'
if old5 in text:
    text = text.replace(old5, new5, 1)

# 6) Mi Cuenta -> login
text = text.replace('onClick={()=>go("dash")} style={{padding:"6px 12px",fontSize:11}}>Mi Cuenta</button>',
                    'onClick={()=>go("login")} style={{padding:"6px 12px",fontSize:11}}>Mi Cuenta</button>', 1)

# 7) Componente Login (antes de function App)
login_block = '''const Login=({go})=>{const[id,sI]=useState("");const[pw,sP]=useState("");const[e,sE]=useState("");const login=()=>{sE("");const u=getFvmUsers();const clean=id.replace(/\\D/g,"");const tid=id.trim().toLowerCase();let doc=Object.keys(u).find(d=>d===clean);if(!doc)doc=Object.keys(u).find(d=>u[d].em&&u[d].em.toLowerCase()===tid);if(!doc||u[doc].password!==pw){sE("Correo/cédula o contraseña incorrectos");return;}setFvmSession(doc);go("dash");};return<div style={{minHeight:"100vh",background:`linear-gradient(135deg,${P},${PD})`,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}><div className="cd anim" style={{maxWidth:380,width:"100%",padding:32}}><Logo s={50}/><h2 className="sf" style={{color:P,marginTop:8,fontSize:20}}>Mi Cuenta</h2><p style={{color:TL,fontSize:12,marginBottom:18}}>Ingresa con tu correo o cédula y la contraseña que creaste al afiliarte.</p><div style={{textAlign:"left",marginBottom:10}}><label style={{fontSize:11,fontWeight:600}}>Correo o cédula</label><input className="inp" value={id} onChange={e=>sI(e.target.value)} placeholder="email@ejemplo.com o documento" onKeyDown={ev=>ev.key==="Enter"&&login()} style={{marginTop:3}}/></div><div style={{textAlign:"left",marginBottom:14}}><label style={{fontSize:11,fontWeight:600}}>Contraseña</label><input className="inp" type="password" value={pw} onChange={e=>sP(e.target.value)} onKeyDown={ev=>ev.key==="Enter"&&login()} style={{marginTop:3}}/></div>{e&&<div className="em" style={{marginBottom:8}}>{e}</div>}<button className="bp" onClick={login} style={{width:"100%",justifyContent:"center",padding:12}}>Entrar</button><button onClick={()=>go("reg")} style={{marginTop:12,background:"none",border:"none",color:P,cursor:"pointer",fontSize:11,width:"100%"}}>¿No tienes cuenta? Afiliarse</button><button onClick={()=>go("landing")} style={{marginTop:8,background:"none",border:"none",color:TL,cursor:"pointer",fontSize:11}}>← Volver</button></div></div>};

'''
if 'const Login=({go})=>' not in text:
    assert 'function App(){' in text
    text = text.replace('function App(){', login_block + 'function App(){', 1)

# 8) App: ruta login
old8 = '{pg==="landing"&&<Landing go={go}/>}{pg==="reg"&&<Register go={go}/>}{pg==="dash"&&<Dash go={go}/>}'
new8 = '{pg==="landing"&&<Landing go={go}/>}{pg==="reg"&&<Register go={go}/>}{pg==="login"&&<Login go={go}/>}{pg==="dash"&&<Dash go={go}/>}'
if old8 in text:
    text = text.replace(old8, new8, 1)

# 9) Reemplazar Dash completo — buscar inicio y fin
start = text.find('const Dash=({go})=>{')
end = text.find('function App(){')
assert start != -1 and end != -1 and start < end
dash_new = r'''const Dash=({go})=>{const[tab,sT]=useState("home");const[toast,sTo]=useState(null);const[u,sU]=useState(null);const[cpw,sCp]=useState("");const[npw,sNp]=useState("");const[npw2,sNp2]=useState("");const[pe,sPe]=useState("");useEffect(()=>{const doc=getFvmSession();if(!doc){go("login");return;}const store=getFvmUsers()[doc];if(!store){clearFvmSession();go("login");return;}const pln=PLANS.find(p=>p.id===store.pl);sU({nm:store.nm,pl:pln?pln.n.replace("Plan ",""):store.pl,cd:"FVM-"+String(doc).slice(-6).toUpperCase(),bal:640000,net:72,dir:8,com:640000,doc});},[go]);const cp=()=>{if(!u)return;navigator.clipboard?.writeText(`funerariavmaria.com/ref/${u.cd}`);sTo({msg:"Copiado!",tp:"ok"})};const wa=()=>{if(!u)return;window.open(`https://wa.me/?text=${encodeURIComponent(`Te invito: funerariavmaria.com/ref/${u.cd}`)}`)};const salir=()=>{clearFvmSession();go("landing")};const cambiarPw=()=>{sPe("");const doc=getFvmSession();const store=getFvmUsers()[doc];if(!store){sPe("Sesión inválida");return;}if(store.password!==cpw){sPe("Contraseña actual incorrecta");return;}if(!npw||npw.length<8){sPe("La nueva debe tener mínimo 8 caracteres");return;}if(npw!==npw2){sPe("Las nuevas no coinciden");return;}setFvmUser(doc,{...store,password:npw});sCp("");sNp("");sNp2("");sTo({msg:"Contraseña actualizada",tp:"ok"});};const tabs=[{id:"home",l:"Dashboard",i:"📊"},{id:"tree",l:"Mi Red",i:"🌳"},{id:"comms",l:"Comisiones",i:"💰"},{id:"contract",l:"Contrato",i:"📄"},{id:"refs",l:"Referidos",i:"📱"},{id:"secu",l:"Contraseña",i:"🔐"}];
if(!u)return<div style={{minHeight:"100vh",background:GR,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{color:P,fontSize:14}}>Cargando…</div></div>;
return<div style={{display:"flex",minHeight:"100vh",background:GR}}>{toast&&<Toast msg={toast.msg} tp={toast.tp} hide={()=>sTo(null)}/>}
<aside className="sb" style={{width:190,background:P,display:"flex",flexDirection:"column",flexShrink:0}}><div style={{padding:"12px 10px",display:"flex",alignItems:"center",gap:6,borderBottom:"1px solid rgba(255,255,255,.1)"}}><Logo s={22} w/><span className="sf" style={{color:"#fff",fontSize:11}}>Mi Cuenta</span></div><nav style={{flex:1,padding:"6px 4px"}}>{tabs.map(t=><div key={t.id} onClick={()=>sT(t.id)} style={{display:"flex",alignItems:"center",gap:6,padding:"7px 8px",borderRadius:6,cursor:"pointer",marginBottom:2,background:tab===t.id?`${A}22`:"transparent",color:tab===t.id?A:"rgba(255,255,255,.5)"}}><span style={{fontSize:13}}>{t.i}</span><span style={{fontSize:11,fontWeight:tab===t.id?600:400}}>{t.l}</span></div>)}</nav><div style={{padding:6,borderTop:"1px solid rgba(255,255,255,.1)"}}><div onClick={salir} style={{padding:"5px 8px",cursor:"pointer",color:"rgba(255,255,255,.4)",fontSize:11}}>← Salir</div></div></aside>
<main style={{flex:1,overflow:"auto"}}><header style={{background:"#fff",padding:"9px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${BD}`}}><h1 className="sf" style={{fontSize:15,color:P}}>{tabs.find(t=>t.id===tab)?.i} {tabs.find(t=>t.id===tab)?.l}</h1><div style={{display:"flex",alignItems:"center",gap:6}}><div style={{textAlign:"right"}}><div style={{fontSize:11,fontWeight:600}}>{u.nm}</div><div style={{fontSize:9,color:A}}>{u.pl}</div></div><div style={{width:26,height:26,borderRadius:"50%",background:P,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700}}>{u.nm.split(" ").map(x=>x[0]).join("").slice(0,2).toUpperCase()}</div></div></header>
<div style={{padding:16}}>
{tab==="home"&&<div className="anim"><div className="rg" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>{[{l:"Balance",v:fmt(u.bal),c:OK},{l:"Red",v:u.net,c:P},{l:"Directos",v:u.dir,c:A},{l:"Comisión",v:fmt(u.com),c:P}].map(k=><div key={k.l} className="cd" style={{padding:12}}><div style={{fontSize:9,color:TL,fontWeight:600,marginBottom:3}}>{k.l}</div><div className="sf" style={{fontSize:18,fontWeight:700,color:k.c}}>{k.v}</div></div>)}</div><div className="cd" style={{padding:12,background:`${A}06`}}><div style={{fontSize:11,fontWeight:600,marginBottom:5}}>Tu Enlace</div><div style={{display:"flex",gap:5,flexWrap:"wrap"}}><input className="inp" value={`funerariavmaria.com/ref/${u.cd}`} readOnly style={{flex:1,minWidth:140,fontSize:11}}/><button className="bp" onClick={cp} style={{padding:"6px 10px",fontSize:11}}>{IC.cp} Copiar</button><button className="ba" onClick={wa} style={{padding:"6px 10px",fontSize:11}}>WA</button></div></div></div>}
{tab==="tree"&&<div className="anim"><Tree/></div>}
{tab==="comms"&&<div className="anim"><div style={{background:`linear-gradient(135deg,${P},${PD})`,borderRadius:10,padding:20,color:"#fff",marginBottom:16}}><div style={{fontSize:11,opacity:.7}}>Balance</div><div className="sf" style={{fontSize:28,fontWeight:700}}>{fmt(u.bal)}</div><button className="ba" onClick={()=>sTo({msg:"Retiro solicitado",tp:"ok"})} style={{marginTop:10,padding:"6px 16px",fontSize:11}}>Retiro</button></div><div className="cd tw"><table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr style={{borderBottom:`2px solid ${BD}`}}>{["Mes","N1","N2","N3","Total","Est"].map(h=><th key={h} style={{textAlign:"left",padding:"5px 6px",fontSize:9,color:TL,fontWeight:600}}>{h}</th>)}</tr></thead><tbody>{[{m:"Mar",a:80000,b:320000,c:240000},{m:"Feb",a:70000,b:280000,c:180000}].map(r=><tr key={r.m} style={{borderBottom:`1px solid ${BD}`}}><td style={{padding:6,fontWeight:600,fontSize:11}}>{r.m} 2026</td><td style={{padding:6,fontSize:11}}>{fmt(r.a)}</td><td style={{padding:6,fontSize:11}}>{fmt(r.b)}</td><td style={{padding:6,fontSize:11}}>{fmt(r.c)}</td><td style={{padding:6,fontWeight:700,color:OK,fontSize:11}}>{fmt(r.a+r.b+r.c)}</td><td style={{padding:6}}><span className="badge" style={{background:`${OK}15`,color:OK}}>OK</span></td></tr>)}</tbody></table></div></div>}
{tab==="contract"&&<div className="anim"><div className="cd" style={{padding:24}}><div style={{textAlign:"center",marginBottom:14}}><Logo s={40}/><h2 className="sf" style={{fontSize:16,color:P,marginTop:5}}>CONTRATO</h2><div style={{color:TL,fontSize:11}}>FUNERARIA VM S.A.S.</div></div><div className="gl"/><div className="rg" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}><div><div style={{fontSize:9,color:TL}}>NOMBRE</div><div style={{fontWeight:600,fontSize:13}}>{u.nm.toUpperCase()}</div></div><div><div style={{fontSize:9,color:TL}}>DOC. SESIÓN</div><div style={{fontWeight:600}}>{u.doc||"—"}</div></div><div><div style={{fontSize:9,color:TL}}>PLAN</div><div style={{fontWeight:700,color:P}}>{u.pl} — {fmt(PLANS.find(p=>p.n.includes(u.pl))?.pr||100000)}</div></div><div><div style={{fontSize:9,color:TL}}>ESTADO</div><div style={{color:OK,fontWeight:600}}>● ACTIVO</div></div></div><div className="gl"/><button className="bp" onClick={()=>window.print()} style={{width:"100%",justifyContent:"center",fontSize:12}}>📄 PDF</button></div></div>}
{tab==="refs"&&<div className="anim"><div className="cd" style={{padding:16}}><h3 className="sf" style={{fontSize:15,color:P,marginBottom:8}}>Comparte</h3><div style={{display:"flex",gap:5,marginBottom:10,flexWrap:"wrap"}}><input className="inp" value={`funerariavmaria.com/ref/${u.cd}`} readOnly style={{flex:1,minWidth:140,fontSize:11}}/><button className="bp" onClick={cp} style={{padding:"6px 10px",fontSize:11}}>{IC.cp}</button></div><div className="rg" style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}><button className="ba" onClick={wa} style={{justifyContent:"center",padding:"6px",fontSize:11}}>📱 WA</button><button className="bo" style={{justifyContent:"center",padding:"6px",fontSize:11}}>📘 FB</button><button className="bo" onClick={cp} style={{justifyContent:"center",padding:"6px",fontSize:11}}>📸 IG</button></div></div></div>}
{tab==="secu"&&<div className="anim"><div className="cd" style={{padding:20}}><h3 className="sf" style={{fontSize:16,color:P,marginBottom:6}}>Cambiar contraseña</h3><p style={{color:TL,fontSize:11,marginBottom:14}}>Puedes actualizarla cuando quieras.</p><div style={{marginBottom:10}}><label style={{fontSize:10,fontWeight:600}}>Contraseña actual</label><input className="inp" type="password" value={cpw} onChange={e=>sCp(e.target.value)} style={{marginTop:3}}/></div><div style={{marginBottom:10}}><label style={{fontSize:10,fontWeight:600}}>Nueva contraseña</label><input className="inp" type="password" value={npw} onChange={e=>sNp(e.target.value)} placeholder="Mínimo 8 caracteres" style={{marginTop:3}}/></div><div style={{marginBottom:10}}><label style={{fontSize:10,fontWeight:600}}>Confirmar nueva</label><input className="inp" type="password" value={npw2} onChange={e=>sNp2(e.target.value)} style={{marginTop:3}}/></div>{pe&&<div className="em" style={{marginBottom:8}}>{pe}</div>}<button className="bp" onClick={cambiarPw} style={{width:"100%",justifyContent:"center",marginTop:6}}>Guardar nueva contraseña</button></div></div>}
</div></main></div>};

'''
text = text[:start] + dash_new + text[end:]

p.write_text(text, encoding="utf-8")
print("OK: parche aplicado")

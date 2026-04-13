# -*- coding: utf-8 -*-
from pathlib import Path
p = Path(__file__).parent / "index.html"
text = p.read_text(encoding="utf-8")
if "const Login=({go})=>" in text:
    print("Login ya existe")
    exit(0)
login_block = r'''const Login=({go})=>{const[id,sI]=useState("");const[pw,sP]=useState("");const[e,sE]=useState("");const login=()=>{sE("");const u=getFvmUsers();const clean=id.replace(/\D/g,"");const tid=id.trim().toLowerCase();let doc=Object.keys(u).find(d=>d===clean);if(!doc)doc=Object.keys(u).find(d=>u[d].em&&u[d].em.toLowerCase()===tid);if(!doc||u[doc].password!==pw){sE("Correo/cédula o contraseña incorrectos");return;}setFvmSession(doc);go("dash");};return<div style={{minHeight:"100vh",background:`linear-gradient(135deg,${P},${PD})`,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}><div className="cd anim" style={{maxWidth:380,width:"100%",padding:32}}><Logo s={50}/><h2 className="sf" style={{color:P,marginTop:8,fontSize:20}}>Mi Cuenta</h2><p style={{color:TL,fontSize:12,marginBottom:18}}>Ingresa con tu correo o cédula y la contraseña que creaste al afiliarte.</p><div style={{textAlign:"left",marginBottom:10}}><label style={{fontSize:11,fontWeight:600}}>Correo o cédula</label><input className="inp" value={id} onChange={e=>sI(e.target.value)} placeholder="email@ejemplo.com o documento" onKeyDown={ev=>ev.key==="Enter"&&login()} style={{marginTop:3}}/></div><div style={{textAlign:"left",marginBottom:14}}><label style={{fontSize:11,fontWeight:600}}>Contraseña</label><input className="inp" type="password" value={pw} onChange={e=>sP(e.target.value)} onKeyDown={ev=>ev.key==="Enter"&&login()} style={{marginTop:3}}/></div>{e&&<div className="em" style={{marginBottom:8}}>{e}</div>}<button className="bp" onClick={login} style={{width:"100%",justifyContent:"center",padding:12}}>Entrar</button><button onClick={()=>go("reg")} style={{marginTop:12,background:"none",border:"none",color:P,cursor:"pointer",fontSize:11,width:"100%"}}>¿No tienes cuenta? Afiliarse</button><button onClick={()=>go("landing")} style={{marginTop:8,background:"none",border:"none",color:TL,cursor:"pointer",fontSize:11}}>← Volver</button></div></div>};

'''
assert "function App(){" in text
text = text.replace("function App(){", login_block + "function App(){", 1)
p.write_text(text, encoding="utf-8")
print("OK")

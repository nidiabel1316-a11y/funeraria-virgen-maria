/**
 * Parchea index.html: jerarquía con fotos, FvmD3Tree estilo Pro Visión, NetworkTree proVision,
 * mapMe.photo y bloque de foto en inicio.
 */
const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "index.html");
let s = fs.readFileSync(file, "utf8");

const oldHierarchy = `const fvmBuildHierarchyFromNetwork=d=>{if(!d||!d.root)return null;const L=n=>(n.fullName||"—")+" · "+(PLANS.find(p=>p.id===n.planId)?.n.replace("Plan ","")||n.planId||"");const img=id=>"https://i.pravatar.cc/100?u="+encodeURIComponent(String(id));const rid=String(d.root.id);const root={name:L({fullName:d.root.fullName,planId:d.root.planId}),id:rid,img:img(rid),children:[]};const map=new Map([[rid,root]]);const mk=n=>{const o={name:L(n),id:String(n.id),img:img(n.id),children:[]};map.set(String(n.id),o);return o;};(d.level1||[]).forEach(n=>{root.children.push(mk(n));});(d.level2||[]).forEach(n=>{const o=mk(n);const p=map.get(String(n.sponsorId));if(p)p.children.push(o);});(d.level3||[]).forEach(n=>{const o=mk(n);const p=map.get(String(n.sponsorId));if(p)p.children.push(o);});return root;};`;

const newHierarchy = `const fvmBuildHierarchyFromNetwork=d=>{if(!d||!d.root)return null;const L=n=>(n.fullName||"—")+" · "+(PLANS.find(p=>p.id===n.planId)?.n.replace("Plan ","")||n.planId||"");const imgFallback=id=>"https://i.pravatar.cc/100?u="+encodeURIComponent(String(id));const pickImg=n=>{const u=n&&n.profilePhotoUrl;if(typeof u==="string"&&u.trim().length>0)return u.trim();return imgFallback(n.id);};const rid=String(d.root.id);const root={name:L({fullName:d.root.fullName,planId:d.root.planId}),id:rid,img:pickImg(d.root),children:[]};const map=new Map([[rid,root]]);const mk=n=>{const o={name:L(n),id:String(n.id),img:pickImg(n),children:[]};map.set(String(n.id),o);return o;};(d.level1||[]).forEach(n=>{root.children.push(mk(n));});(d.level2||[]).forEach(n=>{const o=mk(n);const p=map.get(String(n.sponsorId));if(p)p.children.push(o);});(d.level3||[]).forEach(n=>{const o=mk(n);const p=map.get(String(n.sponsorId));if(p)p.children.push(o);});return root;};`;

if (!s.includes(oldHierarchy)) {
  console.error("No se encontró fvmBuildHierarchyFromNetwork esperado.");
  process.exit(1);
}
s = s.replace(oldHierarchy, newHierarchy);

const idxTree = s.indexOf("const FvmD3Tree=");
const idxNet = s.indexOf("const NetworkTree=");
if (idxTree === -1 || idxNet === -1 || idxNet <= idxTree) {
  console.error("Bloque FvmD3Tree / NetworkTree no encontrado.");
  process.exit(1);
}

const newFvm = `const FvmD3Tree=({data,translateX=280,dark,proVision})=>{const ref=useRef(null);const ttRef=useRef(null);const pv=!!proVision;useEffect(()=>{if(typeof d3==="undefined"||!data||!ref.current)return;const el=ref.current;d3.select(el).selectAll("svg").remove();const tw=Math.max(el.clientWidth||800,320);const th=520;const margin={top:20,right:20,bottom:20,left:20};const tx=Number(translateX)||280;const strokeFor=nd=>{if(pv){if(nd.depth===0)return"#D4AF37";if(nd.depth===1)return"#28a745";if(nd.depth===2)return"#007bff";return"#6f42c1";}if(nd.depth===0)return A;if(nd.depth===1)return OK;if(nd.depth===2)return"#1E88E5";return"#8E24AA";};const diagonal=(s,t)=>"M "+s.y+" "+s.x+" C "+(s.y+t.y)/2+" "+s.x+","+(s.y+t.y)/2+" "+t.x+","+t.y+" "+t.x;const svg=d3.select(el).append("svg").attr("width",tw).attr("height",th).attr("style","display:block;cursor:grab;max-width:100%;");const outer=svg.append("g");const g=outer.append("g").attr("transform","translate("+tx+","+margin.top+")");svg.call(d3.zoom().scaleExtent([0.12,3]).on("zoom",e=>{outer.attr("transform",e.transform);}));const raw=JSON.parse(JSON.stringify(data));const hierarchy=d3.hierarchy(raw,x=>(x.children&&x.children.length)?x.children:null);let root=hierarchy;root.x0=th/2;root.y0=0;const tree=d3.tree().nodeSize(pv?[60,250]:[50,210]);function collapse(nd){if(nd.children){nd._children=nd.children;nd._children.forEach(collapse);nd.children=null;}}if(root.children)root.children.forEach(collapse);const dur=pv?750:650;const depthStep=pv?250:210;function update(src){const treeData=tree(root);const nodes=treeData.descendants();const links=nodes.slice(1);nodes.forEach(nd=>{nd.y=nd.depth*depthStep;});const nk=nd=>nd.data.id||nd.data.name+"_"+nd.depth;const node=g.selectAll("g.fvm-node").data(nodes,nk);const nodeEnter=node.enter().append("g").attr("class","fvm-node").attr("transform","translate("+src.y0+","+src.x0+")").on("click",(ev,nd)=>{ev.stopPropagation();if(nd.children){nd._children=nd.children;nd.children=null;}else{nd.children=nd._children;nd._children=null;}update(nd);}).on("mouseover",(ev,nd)=>{d3.select(ttRef.current).style("opacity",0.95).html("<strong>"+nd.data.name+"</strong><br/>Nivel: "+nd.depth).style("left",ev.pageX+15+"px").style("top",ev.pageY-28+"px");}).on("mouseout",()=>d3.select(ttRef.current).style("opacity",0));nodeEnter.append("circle").attr("r",pv?25:26).attr("fill",pv?"#1e293b":(dark?"#1e293b":"#fff")).attr("stroke-width",3).attr("stroke",strokeFor);nodeEnter.append("image").attr("href",nd=>nd.data.img).attr("x",pv?-20:-22).attr("y",pv?-20:-22).attr("width",pv?40:44).attr("height",pv?40:44).attr("style","clip-path:circle(50% at 50% 50%);pointer-events:none;");nodeEnter.append("text").attr("dy","0.35em").attr("x",nd=>nd.children||nd._children?(pv?-30:-34):(pv?30:34)).attr("text-anchor",nd=>nd.children||nd._children?"end":"start").attr("fill",pv?"#f8fafc":(dark?"#f8fafc":T)).attr("font-size",pv?12:11).attr("font-weight",600).text(nd=>{const n=nd.data.name||"";return n.length>28?n.slice(0,26)+"…":n;});const nodeMerge=nodeEnter.merge(node);nodeMerge.transition().duration(dur).attr("transform",nd=>"translate("+nd.y+","+nd.x+")");node.exit().transition().duration(dur).attr("transform","translate("+src.y+","+src.x+")").remove();const link=g.selectAll("path.fvm-link").data(links,nk);const linkEnter=link.enter().append("path").attr("class","fvm-link").attr("fill","none").attr("stroke",pv?"#334155":(dark?"#475569":"#94a3b8")).attr("stroke-opacity",pv?0.4:0.5).attr("stroke-width",2).attr("d",nd=>{const o={x:src.x0,y:src.y0};return diagonal(o,o);});linkEnter.merge(link).transition().duration(dur).attr("d",nd=>diagonal(nd.parent,nd));link.exit().transition().duration(dur).attr("d",nd=>{const o={x:src.x,y:src.y};return diagonal(o,o);}).remove();nodes.forEach(nd=>{nd.x0=nd.x;nd.y0=nd.y;});}update(root);return()=>{d3.select(el).selectAll("svg").remove();};},[data,translateX,dark,proVision]);return<div style={{position:"relative",width:"100%",minHeight:520,background:pv?"#0f172a":(dark?"#0f172a":"linear-gradient(180deg,#FAFAFA,#F0EDE8)"),borderRadius:12,border:pv?"1px solid #334155":(dark?"1px solid #334155":"1px solid "+BD),overflow:"hidden"}}><div ref={ttRef} style={{position:"fixed",padding:12,background:"rgba(30,41,59,.95)",border:"1px solid "+(pv?"#D4AF37":A),borderRadius:8,pointerEvents:"none",opacity:0,zIndex:200,fontSize:12,color:"#fff",maxWidth:300,boxShadow:pv?"0 10px 15px -3px rgba(0,0,0,.5)":"none"}}/><div ref={ref} style={{width:"100%",minHeight:500}}/></div>;};`;

s = s.slice(0, idxTree) + newFvm + s.slice(idxNet);

const oldNet = `<FvmD3Tree data={H} translateX={300} dark={false}/></div>}`;
const newNet = `<FvmD3Tree data={H} translateX={300} dark={false} proVision/></div>}`;
if (!s.includes(oldNet)) {
  console.error("No se encontró NetworkTree FvmD3Tree esperado.");
  process.exit(1);
}
s = s.replace(oldNet, newNet);

if (!s.includes("cfd:m.contractIssueDate||null,affPaid:")) {
  console.error("mapMe: patrón affPaid no encontrado.");
  process.exit(1);
}
if (!s.includes("photo:m.profilePhotoUrl")) {
  s = s.replace(
    "cfd:m.contractIssueDate||null,affPaid:",
    "cfd:m.contractIssueDate||null,photo:m.profilePhotoUrl||\"\",affPaid:"
  );
}

const anchor = `</b></div></div><div className="rg" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>`;
const photoBlock = `</b></div></div><div className="cd" style={{padding:12,marginBottom:14,maxWidth:420,marginLeft:"auto",marginRight:"auto",border:\`1px solid \${A}\`,borderRadius:10}}><div style={{fontSize:11,fontWeight:700,color:P,marginBottom:6}}>Foto en «Mi red»</div><p style={{fontSize:10,color:TL,marginBottom:8,lineHeight:1.4}}>Tu patrocinador verá esta imagen en el árbol MLM. JPG o PNG (recomendado menos de 600 KB).</p><input type="file" accept="image/*" className="inp no-print" onChange={async e=>{const f=e.target.files?.[0];if(!f||!u)return;if(f.size>700000){sTo({msg:"Archivo demasiado grande (máx. ~700 KB).",tp:"err"});return;}const r=new FileReader();r.onload=async()=>{try{const b64=String(r.result||"");if(!b64.startsWith("data:image/")){sTo({msg:"Solo imágenes.",tp:"err"});return;}await api("/auth/profile",{method:"PUT",body:JSON.stringify({profilePhotoUrl:b64})});sU(mapMe(await api("/auth/me")));sTo({msg:"Foto guardada. Aparecerá en la red de tu patrocinador.",tp:"ok"})}catch(err){sTo({msg:err.message||"Error al guardar",tp:"err"})}};r.readAsDataURL(f)}} style={{fontSize:11}}/>{u.photo?<div style={{marginTop:10,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}><img src={u.photo} alt="" style={{width:72,height:72,borderRadius:"50%",objectFit:"cover",border:\`2px solid \${P}\`}}/><button type="button" className="ba no-print" onClick={async()=>{try{await api("/auth/profile",{method:"PUT",body:JSON.stringify({profilePhotoUrl:""})});sU(mapMe(await api("/auth/me")));sTo({msg:"Foto eliminada.",tp:"ok"})}catch(err){sTo({msg:err.message||"Error",tp:"err"})}}}>Quitar foto</button></div>:null}</div><div className="rg" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>`;

if (!s.includes(anchor)) {
  console.error("Ancla home (métricas) no encontrada.");
  process.exit(1);
}
s = s.replace(anchor, photoBlock);

fs.writeFileSync(file, s);
console.log("OK: index.html parcheado.");

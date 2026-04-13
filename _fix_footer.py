from pathlib import Path
import re
p=Path(r"c:\Users\aboga\funerariavirgenmaria\index.html")
s=p.read_text(encoding="utf-8",errors="replace")
new_footer = '<footer style={{background:"#1A1A1A",padding:"28px 24px",textAlign:"center"}}><Logo s={28} w/><div className="sf" style={{color:"#fff",fontSize:12,marginTop:6}}>Funeraria Virgen Maria S.A.S.</div><div style={{color:"rgba(255,255,255,.3)",fontSize:10,marginTop:3}}>NIT: {FVM_NIT} | Medellin</div><div style={{color:"rgba(255,255,255,.55)",fontSize:11,marginTop:8,lineHeight:1.6}}>WhatsApp: {String(FVM_WA).replace(/^57/,"")} · Correo: {FVM_EMAIL} · Direccion: {FVM_ADDRESS}</div><div style={{color:"rgba(255,255,255,.2)",fontSize:9,marginTop:8}}>© {new Date().getFullYear()}</div></footer>'
s = re.sub(r'<footer style=\{\{background:"#1A1A1A",padding:"28px 24px",textAlign:"center"\}\}>.*?</footer>', new_footer, s, count=1, flags=re.S)
# limpieza final de caracteres de reemplazo
s=s.replace('�','')
p.write_text(s,encoding='utf-8')
print('ok')

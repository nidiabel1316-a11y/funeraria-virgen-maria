from pathlib import Path
import re
p = Path(r"c:\Users\aboga\funerariavirgenmaria\index.html")
s = p.read_text(encoding="utf-8", errors="replace")

s = re.sub(
    r'</nav><div style=\{\{maxWidth:1200,margin:"0 auto",padding:"0 24px",width:"100%",zIndex:2,marginTop:10\}\}>.*?<div style=\{\{flex:1,display:"flex",alignItems:"center",maxWidth:1200,margin:"0 auto",padding:"0 24px",width:"100%",zIndex:1\}\}>',
    '</nav><div style={{flex:1,display:"flex",alignItems:"center",maxWidth:1200,margin:"0 auto",padding:"0 24px",width:"100%",zIndex:1}}>',
    s,
    flags=re.S,
)

s = s.replace('const WA="573001234567";', '')

repls = [
    ("Direcci��n", "Direccion"),
    ("Mar��a", "Maria"),
    ("Medell��n", "Medellin"),
    ("Ã‚Â", ""),
    ("��", ""),
]
for a, b in repls:
    s = s.replace(a, b)
s = s.replace("�", "")

s = s.replace(
    'NIT: {FVM_NIT} | Medellin</div><div style={{color:"rgba(255,255,255,.2)",fontSize:9,marginTop:8}}>',
    'NIT: {FVM_NIT} | Medellin</div><div style={{color:"rgba(255,255,255,.55)",fontSize:11,marginTop:8,lineHeight:1.6}}>WhatsApp: {String(FVM_WA).replace(/^57/,"")} · Correo: {FVM_EMAIL} · Direccion: {FVM_ADDRESS}</div><div style={{color:"rgba(255,255,255,.2)",fontSize:9,marginTop:8}}>'
)

s = s.replace(
    '</style><script type="text/babel">',
    '@media (max-width:980px){.sb{width:100%!important}.sb nav{display:flex!important;overflow-x:auto!important;gap:6px!important;padding:8px!important}.sb nav>div{min-width:max-content!important;margin-bottom:0!important}.sb>div:last-child{display:none!important}}@media (max-width:680px){.sb{position:sticky;top:0;z-index:5}}</style><script type="text/babel">'
)

p.write_text(s, encoding="utf-8")
print("ok", len(s))

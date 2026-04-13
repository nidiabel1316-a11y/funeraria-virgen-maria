from pathlib import Path
t = Path(r"c:\Users\aboga\funerariavirgenmaria\index.html").read_text(encoding="utf-8")
i = t.find('if(ok)setStatsLd(false)} })(); return()=>{ok=false}; },[tok,view]); useEffect(()=>{ if(!tok||view!=="comisiones")return;')
print(repr(t[i:i+200]))

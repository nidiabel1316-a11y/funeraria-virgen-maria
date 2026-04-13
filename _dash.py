from pathlib import Path
t = Path("index.html").read_text(encoding="utf-8")
k = t.find('view==="dashboard"')
Path("_dash.txt").write_text(t[k:k+3500], encoding="utf-8")

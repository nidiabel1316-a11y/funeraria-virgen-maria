from pathlib import Path
p=Path(r"c:\Users\aboga\funerariavirgenmaria\index.html")
s=p.read_text(encoding="utf-8",errors="replace")
repl={
"Ã¡":"á","Ã©":"é","Ã­":"í","Ã³":"ó","Ãº":"ú","Ã±":"ñ","Ã¼":"ü",
"Ã":"Á","Ã‰":"É","Ã":"Í","Ã“":"Ó","Ãš":"Ú","Ã‘":"Ñ","Ãœ":"Ü",
"MarÃ­a":"Maria","MedellÃ­n":"Medellin","DirecciÃ³n":"Direccion","ContraseÃ±a":"Contrasena","cÃ©dula":"cedula"
}
for a,b in repl.items():
    s=s.replace(a,b)
p.write_text(s,encoding='utf-8')
print('ok')

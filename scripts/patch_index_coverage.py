from pathlib import Path

p = Path(__file__).resolve().parents[1] / "index.html"
t = p.read_text(encoding="utf-8")

repls = [
    (
        'Mensualidad cubierta hasta (YYYY-MM)</div><div style={{fontWeight:700,fontSize:12}}>{u.monthlyPT||"—"}',
        'Mensualidad cubierta hasta (fecha de vencimiento)</div><div style={{fontWeight:700,fontSize:12}}>{fvmFmtCov(u.monthlyPT)}',
    ),
    (
        'Mensual hasta {affDetail.affiliate.monthlyPaidThrough||"—"}',
        'Mensual hasta {fvmFmtCov(affDetail.affiliate.monthlyPaidThrough)}',
    ),
    (
        '<div><b>Mensualidad cubierta hasta:</b> {cashFound.monthlyPaidThrough||"-"}</div> <div><b>Mes que pagarás:</b> {cashType==="monthly"?(cashFound.monthlyPaidThrough?cashFound.monthlyPaidThrough+" -> siguiente":"Mes actual -> siguiente"):"Afiliación / inscripción"}</div>',
        '<div><b>Mensualidad cubierta hasta:</b> {fvmFmtCov(cashFound.monthlyPaidThrough)}</div> <div><b>Próximo periodo:</b> {cashType==="monthly"?(cashFound.monthlyPaidThrough?"Se suma 1 mes al vencimiento: "+fvmFmtCov(cashFound.monthlyPaidThrough):"Sin vencimiento previo"):"Afiliación / inscripción"}</div>',
    ),
    (
        'const bef=(cashFound&&cashFound.monthlyPaidThrough)?cashFound.monthlyPaidThrough:"-";const aft=o.monthlyPaidThrough||"-";setToast({m:"Pago en efectivo registrado ("+bef+" -> "+aft+")",tp:"ok"})',
        'setToast({m:"Pago en efectivo registrado. Vencimiento: "+fvmFmtCov(cashFound?.monthlyPaidThrough)+" → "+fvmFmtCov(o.monthlyPaidThrough),tp:"ok"})',
    ),
    (
        '<div><b>Mensualidad cubierta hasta:</b> {cashLast.monthlyPaidThrough||"—"}</div>',
        '<div><b>Mensualidad cubierta hasta:</b> {fvmFmtCov(cashLast.monthlyPaidThrough)}</div>',
    ),
    (
        '<th style={{padding:8,textAlign:"left"}}>Mes antes</th><th style={{padding:8,textAlign:"left"}}>Mes después</th>',
        '<th style={{padding:8,textAlign:"left"}}>Venc. anterior</th><th style={{padding:8,textAlign:"left"}}>Venc. nuevo</th>',
    ),
    (
        '{h.monthlyPaidThroughBefore||"-"}</td><td style={{padding:8}}>{h.monthlyPaidThroughAfter||"-"}',
        '{fvmFmtCov(h.monthlyPaidThroughBefore)}</td><td style={{padding:8}}>{fvmFmtCov(h.monthlyPaidThroughAfter)}',
    ),
    (
        '<td style={{padding:8}}>{p.monthlyPaidThrough||"—"}</td> <td style={{padding:8}}>{p.phone||"—"}</td> </tr> )):<tr><td colSpan={6}',
        '<td style={{padding:8}}>{fvmFmtCov(p.monthlyPaidThrough)}</td> <td style={{padding:8}}>{p.phone||"—"}</td> </tr> )):<tr><td colSpan={6}',
    ),
    (
        '{n.monthlyPaidThrough||"â€”"}</td><td style={{padding:10,color:pb.c,fontWeight:600}}>{pb.st}</td></tr>}):<tr><td colSpan={6}',
        '{fvmFmtCov(n.monthlyPaidThrough)}</td><td style={{padding:10,color:pb.c,fontWeight:600}}>{pb.st}</td></tr>}):<tr><td colSpan={6}',
    ),
    (
        '<td style={{padding:6}}>{n.monthlyPaidThrough||"â€”"}</td><td style={{padding:6}}>{n.receivesCommission?"Sí":"No"}</td>',
        '<td style={{padding:6}}>{fvmFmtCov(n.monthlyPaidThrough)}</td><td style={{padding:6}}>{n.receivesCommission?"Sí":"No"}</td>',
    ),
]

for old, new in repls:
    if old not in t:
        print("MISSING:", old[:70], "...")
    else:
        t = t.replace(old, new, 1)
        print("OK:", old[:50])

p.write_text(t, encoding="utf-8")
print("done")

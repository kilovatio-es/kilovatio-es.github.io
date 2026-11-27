"""Kilovatio — precio de la luz de cada mes (precio-luz-<mes>-<año>.html) y resumen de todos los meses (precio-luz-meses.html).
Se generan con los mismos datos y plantilla que las páginas de cada día; los llama luz_pages.write_all."""
import html
import os
from datetime import date

import luz_pages as L

e = html.escape
HUB = "precio-luz-meses.html"


def mes_name(ym):
    y, m = ym.split("-")
    return f"precio-luz-{L.MESES[int(m) - 1]}-{y}.html"


def mes_txt(ym, cap=False):
    y, m = ym.split("-")
    s = f"{L.MESES[int(m) - 1]} de {y}"
    return s[:1].upper() + s[1:] if cap else s


def prev_ym(ym, n=1):
    y, m = map(int, ym.split("-"))
    m -= n
    while m < 1:
        m += 12
        y -= 1
    return f"{y}-{m:02d}"


def c3(x):
    return f"{x:.3f}".replace(".", ",")


def pc(x):
    return f"{x:+.0f} %".replace("+", "+").replace("-", "−")


def stats(data, ym):
    ks = sorted(k for k in data["days"] if k.startswith(ym))
    if not ks:
        return None
    day = {}
    hours = [[0, 0] for _ in range(24)]
    lab, fin = [], []
    raw = []
    for k in ks:
        f = L.tx(k)
        vals = [(h, p * f) for h, p in enumerate(data["days"][k]) if p is not None]
        a = sum(v for _, v in vals) / len(vals)
        lo, hi = min(vals, key=lambda x: x[1]), max(vals, key=lambda x: x[1])
        day[k] = {"avg": a, "lo": lo, "hi": hi}
        for h, v in vals:
            hours[h][0] += v
            hours[h][1] += 1
        (fin if L.d_of(k).weekday() >= 5 else lab).append(a)
        raw += [p for p in data["days"][k] if p is not None]
    hav = [s / n if n else None for s, n in hours]
    avg = sum(d["avg"] for d in day.values()) / len(day)
    best2 = min(((h, (hav[h] + hav[h + 1]) / 2) for h in range(23) if hav[h] is not None and hav[h + 1] is not None), key=lambda x: x[1])
    return {"ks": ks, "day": day, "avg": avg, "hav": hav, "lab": sum(lab) / len(lab) if lab else None, "fin": sum(fin) / len(fin) if fin else None,
            "lo": min(ks, key=lambda k: day[k]["avg"]), "hi": max(ks, key=lambda k: day[k]["avg"]), "best2": best2,
            "sin": sum(raw) / len(raw)}


def bars_svg(items, avg, label_fn, link_fn=None, h=200):
    """Gráfico de barras: verde si está por debajo de la media, rojo si está por encima (±8 %)."""
    W, T, B = 640, 12, 24
    n = len(items)
    mx = max(v for _, v in items) * 1.08
    step = W / n
    bw = max(step * 0.68, 2)
    out = []
    for i, (k, v) in enumerate(items):
        x = i * step + (step - bw) / 2
        y = T + (h - T - B) * (1 - v / mx)
        col = "var(--good)" if v < avg * 0.92 else "var(--bad)" if v > avg * 1.08 else "var(--mid)"
        rect = (f'<rect x="{x:.1f}" y="{y:.1f}" width="{bw:.1f}" height="{h - B - y:.1f}" rx="2" fill="{col}">'
                f'<title>{e(label_fn(k, v))}</title></rect>')
        out.append(f'<a href="{link_fn(k)}">{rect}</a>' if link_fn else rect)
    ya = T + (h - T - B) * (1 - avg / mx)
    out.append(f'<line x1="0" x2="{W}" y1="{ya:.1f}" y2="{ya:.1f}" stroke="var(--ink)" stroke-dasharray="4 4" opacity=".5"/>')
    return out, W, h, step, B


def chart(items, avg, label_fn, tick_fn, link_fn=None, aria=""):
    out, W, h, step, B = bars_svg(items, avg, label_fn, link_fn)
    ticks = "".join(f'<text x="{i * step + step / 2:.1f}" y="{h - 7}" text-anchor="middle">{e(t)}</text>'
                    for i, (k, _) in enumerate(items) for t in [tick_fn(i, k)] if t)
    return f'<svg viewBox="0 0 {W} {h}" class="mchart" role="img" aria-label="{e(aria)}">{"".join(out)}{ticks}</svg>'


def month_block(data, ym, S, today_k, months):
    cur = ym == today_k[:7]
    pm, ly = prev_ym(ym), prev_ym(ym, 12)
    SP, SL = (stats(data, pm) if pm in months else None), (stats(data, ly) if ly in months else None)
    first, last = S["ks"][0], S["ks"][-1]
    parcial = (f" (del {L.d_of(first).day} al {L.d_of(last).day})" if (cur or L.d_of(first).day > 1) else "")
    comp = []
    if SP:
        comp.append(f"un <b>{abs(L.pct(S['avg'], SP['avg'])):.0f} % {'más' if S['avg'] > SP['avg'] else 'menos'}</b> que en {mes_txt(pm)} ({c3(SP['avg'])} €/kWh)")
    if SL:
        comp.append(f"un {abs(L.pct(S['avg'], SL['avg'])):.0f} % {'más' if S['avg'] > SL['avg'] else 'menos'} que en {mes_txt(ly)}")
    lead = (f"En {mes_txt(ym)}{parcial}, el precio medio de la luz (PVPC) {'va por' if cur else 'fue de'} <b>{c3(S['avg'])} €/kWh</b> con impuestos"
            + (", " + " y ".join(comp) if comp else "") + ".")
    lo, hi = S["lo"], S["hi"]
    b2 = S["best2"]
    k = [
        f'<div class="ans sun"><small>Precio medio</small><b class="num">{c3(S["avg"])} €</b><span>por kWh con impuestos · {c3(S["sin"])} € sin impuestos</span></div>',
        f'<div class="ans good"><small>Día más barato</small><b class="num">{c3(S["day"][lo]["avg"])} €</b><span><a href="{L.page_name(lo)}">{e(L.fecha_larga(lo, year=False))}</a></span></div>',
        f'<div class="ans bad"><small>Día más caro</small><b class="num">{c3(S["day"][hi]["avg"])} €</b><span><a href="{L.page_name(hi)}">{e(L.fecha_larga(hi, year=False))}</a></span></div>',
        f'<div class="ans good"><small>Mejores horas</small><b class="num">{L.span(b2[0], 2)}</b><span>de media, a {c3(b2[1])} €/kWh</span></div>',
    ]
    days_items = [(kk, S["day"][kk]["avg"]) for kk in S["ks"]]
    dchart = chart(days_items, S["avg"], lambda kk, v: f"{L.fecha_larga(kk, year=False)}: {c3(v)} €/kWh",
                   lambda i, kk: str(L.d_of(kk).day) if (L.d_of(kk).day == 1 or L.d_of(kk).day % 5 == 0) else "",
                   L.page_name, f"Precio medio de cada día de {mes_txt(ym)}")
    hitems = [(h, v) for h, v in enumerate(S["hav"]) if v is not None]
    havg = sum(v for _, v in hitems) / len(hitems)
    hchart = chart(hitems, havg, lambda h, v: f"{L.span(h)}: {c3(v)} €/kWh de media",
                   lambda i, h: f"{h:02d}" if h % 3 == 0 else "", None, f"Precio medio por hora en {mes_txt(ym)}")
    cheap = sorted(hitems, key=lambda x: x[1])[:3]
    dear = sorted(hitems, key=lambda x: -x[1])[:3]
    wk = ""
    if S["lab"] and S["fin"]:
        wk = (f" Los fines de semana la luz salió de media a {c3(S['fin'])} €/kWh, un {abs(L.pct(S['fin'], S['lab'])):.0f} % "
              f"{'más barata' if S['fin'] < S['lab'] else 'más cara'} que entre semana ({c3(S['lab'])} €/kWh).")
    rows = "".join(
        f'<tr><td><a href="{L.page_name(kk)}">{e(L.fecha_larga(kk, year=False))}</a></td><td class="num">{c3(S["day"][kk]["avg"])} €</td>'
        f'<td class="num">{c3(S["day"][kk]["lo"][1])} € <span class="muted">({L.hh(S["day"][kk]["lo"][0])})</span></td>'
        f'<td class="num">{c3(S["day"][kk]["hi"][1])} € <span class="muted">({L.hh(S["day"][kk]["hi"][0])})</span></td></tr>'
        for kk in reversed(S["ks"]))
    nav = []
    if pm in months:
        nav.append(f'<a class="btn" href="{mes_name(pm)}">← {mes_txt(pm, True)}</a>')
    nav.append(f'<a class="btn ghost" href="{HUB}">Todos los meses</a>')
    nx = prev_ym(ym, -1)
    if nx in months:
        nav.append(f'<a class="btn" href="{mes_name(nx)}">{mes_txt(nx, True)} →</a>')
    tax_note = ""
    t1, t2 = L.tax_info(first), L.tax_info(last)
    if t1["iva"] != 21 or t2["iva"] != 21 or t1["iva"] != t2["iva"]:
        tax_note = " Ojo: ese mes hubo impuestos rebajados en algunos días (IVA del 10 % y 0,5 % de impuesto eléctrico); los precios incluyen los impuestos de cada día."
    return f'''<div class="mes">
  <p class="crumbs"><a href="index.html">Inicio</a> › <a href="{HUB}">Precio de la luz por meses</a> › {mes_txt(ym, True)}</p>
  <p class="lead-m">{lead}{wk}</p>
  <div class="kpis gk">{"".join(k)}</div>
  {f'<div class="callout sun">Mes en curso: se actualiza cada día. Mira el <a href="index.html">precio de hoy</a> y el de <a href="precio-luz-manana.html">mañana</a>.</div>' if cur else ""}
  <section class="panel chartp"><div class="ch-head"><h2>Precio medio de cada día</h2><ul class="legend"><li><i style="background:var(--good)"></i>Más barato que la media</li><li><i style="background:var(--bad)"></i>Más caro</li></ul></div>
  {dchart}<p class="note">Pulsa en un día para ver su precio hora a hora. La línea discontinua es la media del mes.</p></section>
  <section class="panel chartp"><div class="ch-head"><h2>A qué hora fue más barata la luz</h2></div>
  {hchart}<p class="note">Más baratas: {", ".join(f"{L.span(h)} ({c3(v)} €)" for h, v in cheap)}. Más caras: {", ".join(f"{L.span(h)} ({c3(v)} €)" for h, v in dear)}.</p></section>
  <section class="mes-sec"><h2>Precio de la luz día a día en {mes_txt(ym)}</h2>
  <div class="tablewrap"><table><thead><tr><th>Día</th><th class="num">Media</th><th class="num">Hora más barata</th><th class="num">Hora más cara</th></tr></thead><tbody>{rows}</tbody></table></div>
  <p class="note">Precios del PVPC (tarifa regulada) de Red Eléctrica, en €/kWh con los impuestos de cada día: impuesto eléctrico e IVA.{tax_note} No incluyen la potencia ni el contador.</p></section>
  <div class="cta panel"><div><h2>¿Cuánto pagarías tú?</h2><p class="muted">Compara el PVPC con todas las ofertas con tu consumo real, o mira las <a href="mejores-tarifas-luz.html">mejores tarifas del mes</a>.</p></div><a class="btn primary big" href="comparador-tarifas.html">Calcular mi tarifa más barata</a></div>
  <nav class="mes-nav" aria-label="Otros meses">{"".join(nav)}</nav>
</div>'''


def hub_block(data, months, SS, today_k):
    items = [(ym, SS[ym]["avg"]) for ym in months]
    tot = sum(v for _, v in items) / len(items)
    ch = chart(items, tot, lambda ym, v: f"{mes_txt(ym)}: {c3(v)} €/kWh",
               lambda i, ym: L.MESES[int(ym[5:]) - 1][:3], mes_name, "Precio medio de la luz por meses")
    cheap, dear = min(months, key=lambda m: SS[m]["avg"]), max(months, key=lambda m: SS[m]["avg"])
    rows = ""
    for i, ym in enumerate(reversed(months)):
        S = SS[ym]
        pm = prev_ym(ym)
        ch_txt = f'{L.pct(S["avg"], SS[pm]["avg"]):+.0f} %'.replace("-", "−") if pm in SS else "—"
        enc = ' <span class="muted">(en curso)</span>' if ym == today_k[:7] else ""
        rows += (f'<tr><td><a href="{mes_name(ym)}">{mes_txt(ym, True)}</a>{enc}</td>'
                 f'<td class="num">{c3(S["avg"])} €</td><td class="num">{ch_txt}</td>'
                 f'<td class="num">{c3(S["day"][S["lo"]]["avg"])} €</td><td class="num">{c3(S["day"][S["hi"]]["avg"])} €</td></tr>')
    return f'''<div class="mes">
  <p class="crumbs"><a href="index.html">Inicio</a> › Precio de la luz por meses</p>
  <p class="lead-m">El precio medio de la luz (PVPC, con impuestos) de cada mes desde {mes_txt(months[0])}. El mes más barato fue <a href="{mes_name(cheap)}">{mes_txt(cheap)}</a> ({c3(SS[cheap]["avg"])} €/kWh) y el más caro, <a href="{mes_name(dear)}">{mes_txt(dear)}</a> ({c3(SS[dear]["avg"])} €/kWh).</p>
  <section class="panel chartp"><div class="ch-head"><h2>Precio medio de cada mes</h2><ul class="legend"><li><i style="background:var(--good)"></i>Más barato que la media</li><li><i style="background:var(--bad)"></i>Más caro</li></ul></div>
  {ch}<p class="note">Pulsa en un mes para ver su detalle día a día y hora a hora.</p></section>
  <section class="mes-sec"><h2>Todos los meses</h2>
  <div class="tablewrap"><table><thead><tr><th>Mes</th><th class="num">Media</th><th class="num">Frente al mes anterior</th><th class="num">Día más barato</th><th class="num">Día más caro</th></tr></thead><tbody>{rows}</tbody></table></div>
  <p class="note">Media de los precios medios diarios del PVPC (tarifa regulada) de Red Eléctrica, en €/kWh con los impuestos de cada día. Los meses del principio y el mes en curso pueden estar incompletos.</p></section>
  <div class="cta panel"><div><h2>¿Te compensa el PVPC?</h2><p class="muted">Compáralo con todas las ofertas de precio fijo con tu consumo.</p></div><a class="btn primary big" href="comparador-tarifas.html">Comparar tarifas</a></div>
</div>'''


def write_all(data, root, today_k, tpl):
    months = sorted({k[:7] for k in data["days"]})
    # Solo meses con al menos 7 días de datos (el primero del histórico puede venir muy incompleto)
    SS = {}
    for ym in months:
        S = stats(data, ym)
        if S and len(S["ks"]) >= 7:
            SS[ym] = S
    months = [m for m in months if m in SS]
    if not months:
        return 0, []
    changed, pages = 0, []
    for ym in months:
        S = SS[ym]
        cur = ym == today_k[:7]
        title = f"Precio de la luz en {mes_txt(ym)}: media, días y horas más baratas · Kilovatio"
        desc = (f"El precio medio de la luz en {mes_txt(ym)} {'va' if cur else 'fue'} de {c3(S['avg'])} €/kWh con impuestos. "
                "Día más barato y más caro, mejores horas y precio día a día del PVPC.")
        h1 = f"Precio de la luz en {mes_txt(ym)}"
        page = L.fill(tpl, title, desc, h1, month_block(data, ym, S, today_k, months), mes_name(ym))
        changed += L.write_if_changed(os.path.join(root, mes_name(ym)), page)
        pages.append(mes_name(ym))
    title = "Precio de la luz por meses: evolución del PVPC mes a mes · Kilovatio"
    desc = "Precio medio de la luz de cada mes con impuestos, comparado con el mes anterior, con el día más barato y el más caro."
    page = L.fill(tpl, title, desc, "Precio de la luz por meses", hub_block(data, months, SS, today_k), HUB)
    changed += L.write_if_changed(os.path.join(root, HUB), page)
    return changed, [HUB] + list(reversed(pages))

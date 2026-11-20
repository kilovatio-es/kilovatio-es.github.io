"""
Genera las páginas del precio de la luz con los números escritos en el HTML (para que Google los lea):
  - index.html                 -> precio de la luz HOY (portada)
  - precio-luz-manana.html     -> precio de la luz MAÑANA
  - precio-luz-AAAA-MM-DD.html -> una página por cada día del histórico
  - sitemap.xml                -> páginas fijas + páginas de cada día
Usa las plantillas de plantillas/ (las crea build.py) y data/energia.json. Solo biblioteca estándar.
"""
import html, json, os, re
from datetime import date, datetime, timedelta

SITE = "https://kilovatio-es.github.io/"
TAX = 1.0511 * 1.21  # por defecto; los tipos de cada día salen de data["tax"] (data/referencias.json)
SCHED = []


def tax_info(k):
    """Impuestos vigentes el día k: {iva, iee (en %), factor, norma}."""
    for t in SCHED:
        if t["desde"] <= k and (t.get("hasta") is None or k <= t["hasta"]):
            return dict(t, factor=(1 + t["iee"] / 100) * (1 + t["iva"] / 100))
    return {"iva": 21, "iee": 5.11269632, "factor": TAX, "norma": "Tipos generales"}


def tx(k):
    return tax_info(k)["factor"]


def pct_txt(x):
    return (f"{x:.2f}".rstrip("0").rstrip(".")).replace(".", ",") + " %"
DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre",
         "octubre", "noviembre", "diciembre"]
# (nombre, horas seguidas, kWh del ciclo)
APARATOS = [
    ("Lavadora", 2, 0.9, "ciclo de 40 °C"),
    ("Lavavajillas", 2, 1.0, "programa eco"),
    ("Secadora", 2, 2.5, "ciclo completo"),
    ("Horno", 1, 1.4, "1 hora"),
    ("Termo eléctrico", 2, 3.0, "calentar el depósito"),
    ("Coche eléctrico", 3, 22.0, "22 kWh a 7,4 kW"),
]
FIXED_PAGES = ["", "mi-kilovatio.html", "mapa.html", "placas-solares.html", "tarifa-pvpc-o-fija.html", "potencia-contratada.html",
               "calefaccion.html", "coche-electrico.html", "consumo-electrodomesticos.html", "guia-factura-luz.html"]

e = html.escape


def n3(x):
    return f"{x:.3f}".replace(".", ",")


def eur(x):
    return f"{x:.2f}".replace(".", ",") + " €"


def hh(h):
    return f"{h % 24:02d}:00"


def span(h, n=1):
    return f"{hh(h)}–{hh(h + n)}"


def d_of(k):
    return datetime.strptime(k, "%Y-%m-%d").date()


def fecha_larga(k, year=True, weekday=True):
    d = d_of(k)
    s = f"{d.day} de {MESES[d.month - 1]}" + (f" de {d.year}" if year else "")
    return (DIAS[d.weekday()] + " " if weekday else "") + s


def page_name(k):
    return f"precio-luz-{k}.html"


def pct(a, b):
    return (a / b - 1) * 100 if b else 0


def day_stats(prices, k):
    """prices: lista de 24 €/kWh sin impuestos (puede tener None). Devuelve datos con impuestos."""
    TAX = tx(k)
    pts = [(h, p * TAX) for h, p in enumerate(prices) if p is not None]
    vals = sorted(p for _, p in pts)
    q1, q2 = vals[len(vals) // 3], vals[len(vals) * 2 // 3]
    lo = min(pts, key=lambda x: x[1])
    hi = max(pts, key=lambda x: x[1])
    avg = sum(vals) / len(vals)
    full = [None if p is None else p * TAX for p in prices]

    def window(n, best=True):
        res = None
        for s in range(0, 25 - n):
            seg = full[s:s + n]
            if None in seg:
                continue
            a = sum(seg) / n
            if res is None or (a < res[1] if best else a > res[1]):
                res = (s, a)
        return res

    return {"pts": pts, "full": full, "q1": q1, "q2": q2, "lo": lo, "hi": hi, "avg": avg, "window": window}


def level(p, st):
    return "good" if p < st["q1"] else "bad" if p >= st["q2"] else "mid"


LEVEL_TXT = {"good": "Barata", "mid": "Media", "bad": "Cara"}


def render_block(data, k, kind, today_k):
    """Bloque principal de un día. kind: 'hoy' | 'manana' | 'dia'."""
    days = data["days"]
    st = day_stats(days[k], k)
    keys = sorted(days)
    i = keys.index(k)
    prev_k = keys[i - 1] if i > 0 and (d_of(k) - d_of(keys[i - 1])).days == 1 else None
    next_k = keys[i + 1] if i + 1 < len(keys) and (d_of(keys[i + 1]) - d_of(k)).days == 1 else None
    year_k = (d_of(k) - timedelta(days=364)).isoformat()  # mismo día de la semana, hace un año
    past30 = [x for x in keys if x < k][-30:]
    avg30 = None
    if len(past30) >= 20:
        vv = [p * tx(x) for x in past30 for p in days[x] if p is not None]
        avg30 = sum(vv) / len(vv)

    nombre = {"hoy": "hoy", "manana": "mañana"}.get(kind, "el " + fecha_larga(k, weekday=False))
    cuando = {"hoy": "Hoy, " + fecha_larga(k, year=False), "manana": "Mañana, " + fecha_larga(k, year=False)}.get(kind, fecha_larga(k).capitalize())
    lo_h, lo_p = st["lo"]
    hi_h, hi_p = st["hi"]

    # Valoración del día frente a los últimos 30 días
    verdict = ""
    if avg30:
        r = pct(st["avg"], avg30)
        if r <= -10:
            verdict = ("good", "Día barato", f"un {abs(r):.0f} % por debajo de la media de los últimos 30 días")
        elif r >= 10:
            verdict = ("bad", "Día caro", f"un {r:.0f} % por encima de la media de los últimos 30 días")
        else:
            verdict = ("mid", "Día normal", "en la media de los últimos 30 días")

    out = []
    # ---- Selector de día (una sola pestaña con tres vistas) ----
    tabs = [("index.html", "Hoy", kind == "hoy"), ("precio-luz-manana.html", "Mañana", kind == "manana")]
    out.append('<div class="daynav">')
    cur_attr = ' aria-current="page"'
    out.append('<div class="seg" role="navigation" aria-label="Día">' + "".join(
        f'<a href="{href}"{cur_attr if cur else ""}>{lab}</a>' for href, lab, cur in tabs) + "</div>")
    out.append(f'<label class="pickday"><span>Otro día</span><input type="date" id="pick" value="{k}" min="{keys[0]}" max="{keys[-1]}" aria-label="Elegir día"></label>')
    out.append("</div>")

    # ---- Titular: la respuesta en tres segundos ----
    out.append(f'<p class="eyebrow">{e(cuando)} · PVPC con impuestos</p>')
    out.append('<div class="answer">')
    out.append(f'<div class="ans good"><small>Hora más barata</small><b>{span(lo_h)}</b><span class="num">{n3(lo_p)} €/kWh</span></div>')
    out.append(f'<div class="ans bad"><small>Hora más cara</small><b>{span(hi_h)}</b><span class="num">{n3(hi_p)} €/kWh</span></div>')
    av_cls = verdict[0] if verdict else "mid"
    out.append(f'<div class="ans {av_cls}"><small>Precio medio del día</small><b class="num">{n3(st["avg"])}</b><span>€/kWh{(" · " + verdict[1]) if verdict else ""}</span></div>')
    out.append('<div class="ans now" id="nowcard" hidden><small>Ahora</small><b class="num" id="now-p">—</b><span id="now-t"></span></div>')
    out.append("</div>")

    # Frase resumen (también es lo que Google puede usar como fragmento)
    comp = []
    if prev_k:
        pa = sum(p for p in days[prev_k] if p is not None) / len([p for p in days[prev_k] if p is not None]) * tx(prev_k)
        r = pct(st["avg"], pa)
        comp.append(f'un {abs(r):.0f} % {"más barato" if r < 0 else "más caro"} que el {DIAS[d_of(prev_k).weekday()]}' if abs(r) >= 1 else f'casi igual que el {DIAS[d_of(prev_k).weekday()]}')
    if year_k in days:
        ya = [p for p in days[year_k] if p is not None]
        ya = sum(ya) / len(ya) * tx(year_k)
        r = pct(st["avg"], ya)
        comp.append(f'un {abs(r):.0f} % {"menos" if r < 0 else "más"} que hace un año ({n3(ya)} €/kWh)')
    lead = (f'El precio medio de la luz {e(nombre)} ({fecha_larga(k)}) es de <strong>{n3(st["avg"])} €/kWh</strong>'
            + (", " + " y ".join(comp) if comp else "") + ". "
            f'La hora más barata es de <strong>{span(lo_h)}</strong> ({n3(lo_p)} €/kWh) y la más cara, de <strong>{span(hi_h)}</strong> ({n3(hi_p)} €/kWh).')
    if verdict:
        lead += f" Es un {verdict[1].lower()}: {verdict[2]}."
    out.append(f'<p class="lead">{lead}</p>')

    # ---- Semáforo de 24 horas ----
    out.append('<section class="panel sema-wrap" aria-labelledby="h-sema">')
    out.append(f'<div class="sema-head"><h2 id="h-sema">Semáforo de la luz {e(nombre)}, hora a hora</h2>'
               '<div class="legend"><span><i style="background:var(--good)"></i>Barata</span><span><i style="background:var(--mid)"></i>Media</span><span><i style="background:var(--bad)"></i>Cara</span></div></div>')
    out.append('<ol class="sema" id="sema">')
    for h, p in enumerate(st["full"]):
        if p is None:
            out.append(f'<li class="na" data-h="{h}"><span class="h">{hh(h)}</span><span class="p">—</span></li>')
            continue
        lv = level(p, st)
        out.append(f'<li class="{lv}" data-h="{h}" title="{span(h)} · {n3(p)} €/kWh · {LEVEL_TXT[lv]}"><span class="h">{hh(h)}</span><span class="p">{n3(p)}</span></li>')
    out.append("</ol>")
    out.append('<p class="note">Colores relativos a este día: verde, el tercio de horas más barato; rojo, el más caro. '
               f'Precios PVPC (tarifa 2.0TD, península) en €/kWh con los impuestos vigentes ese día: impuesto eléctrico ({pct_txt(tax_info(k)["iee"])}) e IVA ({pct_txt(tax_info(k)["iva"])}). Fuente: Red Eléctrica.</p>')
    out.append('<details class="chartbox"><summary>Ver gráfico</summary><svg class="chart" id="chart" role="img" aria-label="Precio de la luz por horas"></svg></details>')
    out.append("</section>")

    # ---- ¿Cuándo pongo cada aparato? ----
    out.append('<section class="panel" aria-labelledby="h-apps">')
    out.append(f'<h2 id="h-apps">¿Cuándo pongo la lavadora {e(nombre)}?</h2>')
    out.append('<p class="muted">La mejor franja seguida para cada aparato y lo que cuesta, frente a hacerlo en las horas más caras.</p>')
    out.append('<div class="tablewrap"><table class="apps"><thead><tr><th>Aparato</th><th>Mejor franja</th><th class="num">Cuesta</th><th class="num">En la peor franja</th><th class="num">Ahorras</th></tr></thead><tbody>')
    for name, n, kwh, note in APARATOS:
        b, w = st["window"](n, True), st["window"](n, False)
        if not b or not w:
            continue
        out.append(f'<tr data-n="{n}" data-kwh="{kwh}" data-worst="{kwh * w[1]:.4f}"><td><b>{name}</b><small>{note}</small></td><td class="mono">{span(b[0], n)}</td>'
                   f'<td class="num">{eur(kwh * b[1])}</td><td class="num">{eur(kwh * w[1])} <small>({span(w[0], n)})</small></td>'
                   f'<td class="num save">{eur(kwh * (w[1] - b[1]))}</td></tr>')
    out.append("</tbody></table></div>")
    out.append('<p class="note">Consumos típicos; el tuyo depende del aparato y del programa. Si un ciclo dura más de lo indicado, elige el principio de la franja verde.</p>')
    out.append("</section>")

    # ---- Navegación entre días y calendario ----
    out.append('<nav class="prevnext" aria-label="Días">')
    out.append(f'<a href="{page_name(prev_k)}">← {e(fecha_larga(prev_k, year=False))}</a>' if prev_k else "<span></span>")
    out.append(f'<a href="{page_name(next_k)}">{e(fecha_larga(next_k, year=False))} →</a>' if next_k else "<span></span>")
    out.append("</nav>")
    out.append(calendar(data, k, today_k))

    # Datos para el gráfico y para «ahora» (los usa el JavaScript de la página)
    out.append('<script>window.LUZ=' + json.dumps({"date": k, "kind": kind, "p": [None if p is None else round(p, 5) for p in st["full"]],
                                                   "q": [round(st["q1"], 5), round(st["q2"], 5)]}) + ";</script>")
    title_core = {"hoy": f"Precio de la luz hoy, {fecha_larga(k, year=False)}",
                  "manana": f"Precio de la luz mañana, {fecha_larga(k, year=False)}"}.get(kind, f"Precio de la luz el {fecha_larga(k, weekday=False)}")
    title = f"{title_core}: más barata a las {hh(lo_h)} · Kilovatio"
    desc = (f"Precio de la luz {nombre} ({fecha_larga(k)}) hora a hora: la hora más barata es {span(lo_h)} ({n3(lo_p)} €/kWh) "
            f"y la más cara {span(hi_h)} ({n3(hi_p)} €/kWh). Media {n3(st['avg'])} €/kWh con impuestos. Semáforo de 24 horas y mejor hora para cada aparato.")
    h1 = {"hoy": "Precio de la luz hoy", "manana": "Precio de la luz mañana"}.get(kind, f"Precio de la luz el {fecha_larga(k, weekday=False)}")
    return title, desc, h1, "\n".join(out)


def calendar(data, k, today_k):
    days = data["days"]
    d = d_of(k)
    first = d.replace(day=1)
    nxt = (first + timedelta(days=32)).replace(day=1)
    month_keys = [x for x in sorted(days) if x[:7] == k[:7]]
    avgs = {}
    for x in month_keys:
        v = [p for p in days[x] if p is not None]
        avgs[x] = sum(v) / len(v) * tx(x)
    srt = sorted(avgs.values())
    q1 = srt[len(srt) // 3] if srt else 0
    q2 = srt[len(srt) * 2 // 3] if srt else 0
    out = [f'<section class="panel cal" aria-labelledby="h-cal"><div class="cal-head"><h2 id="h-cal">Precio medio de cada día · {MESES[d.month - 1]} de {d.year}</h2>']
    prev_m = (first - timedelta(days=1)).replace(day=1)
    pm = [x for x in sorted(days) if x[:7] == prev_m.isoformat()[:7]]
    nm = [x for x in sorted(days) if x[:7] == nxt.isoformat()[:7]]
    out.append('<div class="cal-nav">' + (f'<a href="{page_name(pm[-1])}" aria-label="Mes anterior">← {MESES[prev_m.month - 1]}</a>' if pm else "")
               + (f'<a href="{page_name(nm[0])}" aria-label="Mes siguiente">{MESES[nxt.month - 1]} →</a>' if nm else "") + "</div></div>")
    out.append('<div class="calgrid" role="list">' + "".join(f'<span class="dow">{x}</span>' for x in ["L", "M", "X", "J", "V", "S", "D"]))
    out.extend('<span class="pad"></span>' for _ in range(first.weekday()))
    cur = first
    while cur < nxt:
        key = cur.isoformat()
        if key in avgs:
            a = avgs[key]
            lv = "good" if a < q1 else "bad" if a >= q2 else "mid"
            cls = lv + (" cur" if key == k else "")
            out.append(f'<a role="listitem" class="{cls}" href="{page_name(key)}" title="{fecha_larga(key)} · media {n3(a)} €/kWh"><b>{cur.day}</b><span>{n3(a)}</span></a>')
        else:
            out.append(f'<span role="listitem" class="empty"><b>{cur.day}</b></span>')
        cur += timedelta(days=1)
    out.append("</div>")
    if avgs:
        lo = min(avgs, key=avgs.get)
        hi = max(avgs, key=avgs.get)
        allv = list(avgs.values())
        out.append(f'<p class="note">Media de {MESES[d.month - 1]} hasta ahora: <b>{n3(sum(allv) / len(allv))} €/kWh</b> con impuestos. '
                   f'Día más barato: {d_of(lo).day} ({n3(avgs[lo])}); más caro: {d_of(hi).day} ({n3(avgs[hi])}). Pulsa un día para ver sus horas.</p>')
    out.append("</section>")
    return "\n".join(out)


def pending_block(data, k_tomorrow, today_k):
    """Mañana todavía sin publicar."""
    out = ['<div class="daynav"><div class="seg" role="navigation" aria-label="Día"><a href="index.html">Hoy</a><a href="precio-luz-manana.html" aria-current="page">Mañana</a></div></div>',
           f'<p class="eyebrow">Mañana, {e(fecha_larga(k_tomorrow, year=False))}</p>',
           '<div class="callout sun pending"><b>Los precios de mañana todavía no están publicados.</b> '
           'Red Eléctrica los publica cada tarde hacia las 20:15–20:30 y aparecen aquí a partir de las 20:45. '
           'Mientras tanto, mira <a href="index.html">el precio de la luz de hoy</a>.</div>']
    if today_k in data["days"]:
        st = day_stats(data["days"][today_k], today_k)
        lo_h, lo_p = st["lo"]
        out.append(f'<p class="lead">Hoy, {fecha_larga(today_k, year=False)}, la hora más barata es de <strong>{span(lo_h)}</strong> ({n3(lo_p)} €/kWh) '
                   f'y la media del día es de {n3(st["avg"])} €/kWh con impuestos.</p>')
        out.append(calendar(data, today_k, today_k))
    title = f"Precio de la luz mañana, {fecha_larga(k_tomorrow, year=False)} · Kilovatio"
    desc = f"Precio de la luz mañana ({fecha_larga(k_tomorrow)}) hora a hora. Se publica cada tarde hacia las 20:30: hora más barata, más cara y semáforo de 24 horas."
    return title, desc, "Precio de la luz mañana", "\n".join(out)


def fill(tpl, title, desc, h1, block, path):
    return (tpl.replace("%%TITLE%%", e(title)).replace("%%DESC%%", e(desc)).replace("%%H1%%", e(h1))
            .replace("%%CANON%%", SITE + path).replace("<!--LUZ-->", block))


def write_if_changed(path, text):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            if f.read() == text:
                return False
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    return True


def write_all(data, root, today_k):
    global SCHED
    SCHED = data.get("tax") or []
    tdir = os.path.join(root, "plantillas")
    tpl_hoy = open(os.path.join(tdir, "luz-hoy.html"), encoding="utf-8").read()
    tpl_dia = open(os.path.join(tdir, "luz-dia.html"), encoding="utf-8").read()
    days = data["days"]
    complete = sorted(k for k, v in days.items() if sum(x is not None for x in v) >= 23)
    data = dict(data, days={k: days[k] for k in complete})
    changed = 0
    tomorrow_k = (d_of(today_k) + timedelta(days=1)).isoformat()
    # Hoy (portada)
    if today_k in data["days"]:
        changed += write_if_changed(os.path.join(root, "index.html"), fill(tpl_hoy, *render_block(data, today_k, "hoy", today_k), ""))
    # Mañana
    if tomorrow_k in data["days"]:
        page = fill(tpl_dia, *render_block(data, tomorrow_k, "manana", today_k), "precio-luz-manana.html")
    else:
        page = fill(tpl_dia, *pending_block(data, tomorrow_k, today_k), "precio-luz-manana.html")
    changed += write_if_changed(os.path.join(root, "precio-luz-manana.html"), page)
    # Un día por página
    for k in complete:
        changed += write_if_changed(os.path.join(root, page_name(k)), fill(tpl_dia, *render_block(data, k, "dia", today_k), page_name(k)))
    # Sitemap
    urls = [SITE + p for p in FIXED_PAGES] + [SITE + "precio-luz-manana.html"] + [SITE + page_name(k) for k in reversed(complete)]
    sm = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "".join(
        f"  <url><loc>{u}</loc></url>\n" for u in urls) + "</urlset>\n"
    changed += write_if_changed(os.path.join(root, "sitemap.xml"), sm)
    print(f"Páginas de la luz: {len(complete) + 2} generadas, {changed} archivos cambiados")


if __name__ == "__main__":
    import sys
    root = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(root, "data", "energia.json"), encoding="utf-8") as f:
        d = json.load(f)
    today = sys.argv[2] if len(sys.argv) > 2 else datetime.now().strftime("%Y-%m-%d")
    write_all(d, root, today)

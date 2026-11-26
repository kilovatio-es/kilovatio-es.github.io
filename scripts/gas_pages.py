"""Kilovatio — páginas de gasolineras más baratas: España, cada provincia y cada localidad con 5 o más gasolineras.
Se generan una vez al día desde data/gasolineras.json (precios oficiales del Ministerio, en milésimas de euro)."""
import html
import json
import math
import os
import re
import unicodedata
from datetime import datetime

import kvsite

SITE = "https://kilovatio-es.github.io/"
MIN_MUNI = 5          # gasolineras mínimas para que una localidad tenga página propia
TOP = 15              # gasolineras que salen en cada ranking (el resto, con «Ver todas»)
FUELS = [("g95", "Gasolina 95", "gasolina 95"), ("dA", "Diésel", "diésel"), ("g98", "Gasolina 98", "gasolina 98"),
         ("glp", "GLP (autogás)", "GLP")]
ISLAS = {"Palmas (Las)", "Santa Cruz De Tenerife", "Ceuta", "Melilla"}   # impuestos distintos: fuera del ranking peninsular
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
e = html.escape


# ---------- Nombres y enlaces ----------
def slug(s):
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def nice_place(s):
    """«Coruña (A)» → «A Coruña»; «Alicante/Alacant» → «Alicante»; «Santa Cruz De Tenerife» → «Santa Cruz de Tenerife»."""
    s = s.split(" / ")[0].split("/")[0].strip()
    m = re.match(r"^(.*)\s+\(([^)]+)\)$", s)
    if m:
        art = m.group(2)
        s = (art + m.group(1)) if art.endswith("'") else f"{art} {m.group(1)}"
    s = re.sub(r"\b(De|Del|La|Las|Los|El|Y)\b", lambda x: x.group(1).lower(), s)
    return s[:1].upper() + s[1:]


def nice_text(s):
    if s.isupper() and len(s) > 3:
        s = s.title()
        s = re.sub(r"\b(De|Del|La|Las|Los|El|Y|A|En)\b", lambda x: x.group(1).lower(), s)
        s = re.sub(r"\bN(º|o)\b", "nº", s)
    return s.strip()


def brand(s):
    s = (s or "").strip()
    if not s or re.match(r"^(n[ºo°]\s*[\d.]+|\d+)$", s, re.I):
        return "Gasolinera"
    return nice_text(s) if len(s) > 4 else s


def prov_page(p):
    return f"gasolineras-{slug(nice_place(p))}.html"


def muni_page(p, m):
    return f"gasolineras-{slug(nice_place(p))}-{slug(nice_place(m))}.html"


def eur(mil, dec=3):
    return f"{mil / 1000:.{dec}f}".replace(".", ",")


def eur2(x):
    s = f"{x:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return s + " €"


def cents(mil):
    c = round(mil / 10, 1)
    return (f"{c:.1f}".replace(".", ",").replace(",0", "")) + " céntimos"


def is24(h):
    return bool(re.search(r"24\s*h", h or "", re.I))


# ---------- Datos ----------
def load(root):
    with open(os.path.join(root, "data", "gasolineras.json"), encoding="utf-8") as f:
        d = json.load(f)
    c = {k: i for i, k in enumerate(d["cols"])}
    st = []
    for r in d["rows"]:
        s = {"lat": r[c["lat"]], "lon": r[c["lon"]], "rot": brand(r[c["rotulo"]]), "dir": nice_text(r[c["direccion"]]),
             "muni": r[c["municipio"]], "prov": r[c["provincia"]], "hor": r[c["horario"]]}
        for k, _, _ in FUELS:
            s[k] = r[c[k]] or 0
        st.append(s)
    return d, clean(st)


def where(s):
    m, p = nice_place(s["muni"]), nice_place(s["prov"])
    return m if m == p else f"{m}, {p}"


def clean(st):
    """Quita precios imposibles (errores de tecleo de la gasolinera): fuera del 60 %–160 % de la mediana nacional."""
    for k, _, _ in FUELS:
        v = sorted(s[k] for s in st if s[k])
        if not v:
            continue
        med = v[len(v) // 2]
        for s in st:
            if s[k] and not (0.6 * med <= s[k] <= 1.6 * med):
                s[k] = 0
    return st


def avg(stations, k):
    v = [s[k] for s in stations if s[k]]
    return sum(v) / len(v) if v else 0


def ranked(stations, k):
    return sorted((s for s in stations if s[k]), key=lambda s: (s[k], s["rot"]))


# ---------- Piezas HTML ----------
HEAD = """<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
<meta name="description" content="{desc}">
<meta property="og:type" content="website">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:locale" content="es_ES">
<link rel="canonical" href="{canon}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='11' fill='%23e39f12'/%3E%3Cpath d='M13 4 7 13h5l-1 7 6-9h-5l1-7Z' fill='%23fff'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<link rel="stylesheet" href="style.css">
<script src="common.js"></script>
{ld}
</head>
<body>
"""


def page(path, page_name, title, desc, body, ld=None):
    ldtxt = f'<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>' if ld else ""
    out = (HEAD.format(title=e(title), desc=e(desc), canon=SITE + page_name, ld=ldtxt)
           + kvsite.header(page_name) + "\n" + body + "\n" + kvsite.FOOTER + '\n<script src="gas.js"></script>\n</body>\n</html>\n')
    old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
    if old != out:
        with open(path, "w", encoding="utf-8") as f:
            f.write(out)
        return 1
    return 0


def station_li(i, s, k, ref):
    maps = f"https://www.google.com/maps/dir/?api=1&destination={s['lat']},{s['lon']}"
    d = s[k] - ref
    dif = (f'<span class="gd good">−{cents(-d)}</span>' if d <= -5 else
           f'<span class="gd bad">+{cents(d)}</span>' if d >= 5 else '<span class="gd">en la media</span>')
    return (f'<li><span class="gp num">{i}</span><div class="gw"><b>{e(s["rot"])}</b>'
            f'<span>{e(s["dir"])} · {e(nice_place(s["muni"]))}</span>'
            + ('<span class="g24">24 h</span>' if is24(s["hor"]) else "")
            + f'</div><div class="gc"><b class="num">{eur(s[k])} €</b>{dif}'
            f'<a href="{maps}" rel="noopener" target="_blank">Cómo llegar</a></div></li>')


def rankings(stations, where, top=TOP):
    """Pestañas por carburante con las gasolineras más baratas de cada uno."""
    tabs, panes = [], []
    for k, label, _ in FUELS:
        r = ranked(stations, k)
        if len(r) < (1 if k in ("g95", "dA") else 3):
            continue
        a = avg(stations, k)
        first = not tabs
        tabs.append(f'<button type="button" data-f="{k}" aria-pressed="{str(first).lower()}">{label}</button>')
        lis = "".join(station_li(i + 1, s, k, a) for i, s in enumerate(r[:top]))
        more = (f'<button type="button" class="btn gall" data-f="{k}">Ver las {len(r)} gasolineras con {e(label.lower())}</button>'
                if len(r) > top else "")
        panes.append(f'<div class="gpane" data-f="{k}"{"" if first else " hidden"}><h3 class="sr">{label}: las más baratas {e(where)}</h3>'
                     f'<ol class="grank">{lis}</ol>{more}</div>')
    return (f'<div class="seg gtabs" role="group" aria-label="Carburante">{"".join(tabs)}</div>' + "".join(panes))


def near_block():
    return ('<div class="gnear"><button type="button" class="btn primary" id="near">📍 Las más baratas cerca de mí</button>'
            '<span class="muted">Usamos tu ubicación solo en tu navegador.</span><div id="near-res"></div></div>')


def kpi(cls, small, big, sub):
    return f'<div class="ans {cls}"><small>{small}</small><b class="num">{big}</b><span>{sub}</span></div>'


def fecha_txt(src):
    try:
        dt = datetime.strptime(src, "%d/%m/%Y %H:%M:%S")
        return f"{dt.day} de {MESES[dt.month - 1]} de {dt.year} a las {dt:%H:%M}", f"{dt.day} de {MESES[dt.month - 1]}"
    except Exception:  # noqa: BLE001
        return src or "hoy", "hoy"


# ---------- Páginas ----------
def place_body(name, stations, nat, crumbs, fecha, dia, extra, scope_attr, rank_txt=""):
    g, dz = ranked(stations, "g95"), ranked(stations, "dA")
    ag, ad = avg(stations, "g95"), avg(stations, "dA")
    lead = []
    if g:
        lead.append(f"La gasolina 95 más barata de {e(name)} está hoy a <b>{eur(g[0]['g95'])} €/l</b> en {e(g[0]['rot'])}"
                    f" ({e(nice_place(g[0]['muni']))})" + (f", {cents(ag - g[0]['g95'])} por debajo de la media ({eur(ag)} €/l)" if ag - g[0]["g95"] >= 5 else "") + ".")
    if dz:
        lead.append(f"El diésel más barato, a <b>{eur(dz[0]['dA'])} €/l</b> en {e(dz[0]['rot'])} ({e(nice_place(dz[0]['muni']))}).")
    k = []
    if g:
        k.append(kpi("good", "Gasolina 95 más barata", f"{eur(g[0]['g95'])} €", f"{e(g[0]['rot'])} · {e(nice_place(g[0]['muni']))}"))
    if dz:
        k.append(kpi("good", "Diésel más barato", f"{eur(dz[0]['dA'])} €", f"{e(dz[0]['rot'])} · {e(nice_place(dz[0]['muni']))}"))
    if ag and nat["g95"]:
        dd = ag - nat["g95"]
        k.append(kpi("bad" if dd > 5 else "good" if dd < -5 else "mid", "Gasolina 95 de media", f"{eur(ag)} €",
                     ("en la media de España" if abs(dd) < 5 else f"{cents(abs(dd))} {'más cara' if dd > 0 else 'más barata'} que la media de España") + rank_txt))
    if g and ag:
        k.append(kpi("sun", "Llenando 50 litros", eur2((ag - g[0]["g95"]) * 50 / 1000), "ahorras en la más barata frente a la media"))
    return f"""<main class="wrap gas" {scope_attr}>
  <div class="intro">
    <p class="crumbs">{crumbs}</p>
    <p class="eyebrow">Precio de la gasolina hoy · {e(dia)}</p>
    <h1>Gasolineras más baratas en {e(name)} hoy</h1>
    <p>{" ".join(lead)}</p>
    <p class="note">Precios oficiales del Ministerio para la Transición Ecológica, actualizados el {e(fecha)}.</p>
  </div>
  <div class="kpis gk">{"".join(k)}</div>
  {near_block()}
  <section class="gsec"><h2>Ranking de precios: de la más barata a la más cara</h2>
  <p class="muted">{len(stations)} gasolineras abiertas al público. Junto a cada precio, lo que se aleja de la media {e("de " + name)}.</p>
  {rankings(stations, "en " + name)}</section>
  {extra}
  <article class="explain">
    <h2>Cómo ahorrar al repostar</h2>
    <ul>
      <li><strong>Compara antes de salir:</strong> entre la gasolinera más barata y la más cara de una misma zona suele haber más de 10 céntimos por litro, unos 5 € en cada depósito.</li>
      <li><strong>Las de marca blanca y las de los hipermercados</strong> suelen estar entre las más baratas; las de autopista y las del centro de las ciudades, entre las más caras.</li>
      <li><strong>No merece la pena desviarse mucho:</strong> ir 10 km más lejos a por 3 céntimos menos casi nunca compensa (gastas alrededor de un litro).</li>
      <li>¿Piensas en un coche eléctrico? Compara cuánto te costaría cada kilómetro en la <a href="coche-electrico.html">calculadora del coche eléctrico</a> y busca puntos de carga en el <a href="mapa.html">mapa</a>.</li>
    </ul>
  </article>
</main>"""


def write_all(root, now=None):
    d, st = load(root)
    if len(st) < 5000:
        print(f"Páginas de gasolineras: solo {len(st)} gasolineras; no se regeneran")
        return []
    fecha, dia = fecha_txt(d.get("source"))
    pen = [s for s in st if s["prov"] not in ISLAS]
    nat = {k: avg(pen, k) for k, _, _ in FUELS}
    provs = {}
    for s in st:
        provs.setdefault(s["prov"], []).append(s)
    # Ranking de provincias por precio medio de la gasolina 95 (península y Baleares)
    prov_avg = sorted(((p, avg(v, "g95")) for p, v in provs.items() if p not in ISLAS), key=lambda x: x[1])
    pos = {p: i + 1 for i, (p, _) in enumerate(prov_avg)}
    written, pages = 0, []

    for p, sts in provs.items():
        name = nice_place(p)
        munis = {}
        for s in sts:
            munis.setdefault(s["muni"], []).append(s)
        mlist = []
        for m, ms in munis.items():
            fname = muni_page(p, m)
            has = len(ms) >= MIN_MUNI or os.path.exists(os.path.join(root, fname))
            mlist.append((m, ms, fname if has else None))
        mlist.sort(key=lambda x: (-len(x[1]), nice_place(x[0])))
        rows = "".join(
            f'<tr><td>{f"<a href={chr(34)}{f}{chr(34)}>" + e(nice_place(m)) + "</a>" if f else e(nice_place(m))}</td>'
            f'<td class="num">{len(ms)}</td><td class="num">{eur(ranked(ms, "g95")[0]["g95"]) + " €" if ranked(ms, "g95") else "—"}</td>'
            f'<td class="num">{eur(ranked(ms, "dA")[0]["dA"]) + " €" if ranked(ms, "dA") else "—"}</td></tr>'
            for m, ms, f in mlist)
        extra = (f'<section class="gsec"><h2>Gasolineras más baratas por localidad en {e(name)}</h2>'
                 '<div class="tablewrap"><table><thead><tr><th>Localidad</th><th class="num">Gasolineras</th>'
                 '<th class="num">Gasolina 95 más barata</th><th class="num">Diésel más barato</th></tr></thead>'
                 f'<tbody>{rows}</tbody></table></div></section>')
        rk = f" · la {pos[p]}.ª más barata de {len(prov_avg)}" if p in pos else ""
        crumbs = '<a href="index.html">Inicio</a> › <a href="gasolineras.html">Gasolineras</a> › ' + e(name)
        g = ranked(sts, "g95")
        title = f"Gasolineras más baratas en {name} hoy: precio de la gasolina y el diésel · Kilovatio"
        desc = (f"Gasolina 95 desde {eur(g[0]['g95'])} €/l en {name} hoy. Ranking de las {len(sts)} gasolineras por precio, "
                "de la más barata a la más cara, con datos oficiales actualizados cada día." if g else f"Precios de las gasolineras de {name} hoy.")
        fname = prov_page(p)
        body = place_body(name, sts, nat, crumbs, fecha, dia, extra, f'data-prov="{e(p)}"', rk)
        written += page(os.path.join(root, fname), fname, title, desc, body, breadcrumb([("Gasolineras", "gasolineras.html"), (name, fname)]))
        pages.append(fname)

        # Localidades
        cents_ll = {m: (sum(s["lat"] for s in ms) / len(ms), sum(s["lon"] for s in ms) / len(ms)) for m, ms, f in mlist if f}
        for m, ms, f in mlist:
            if not f:
                continue
            mname = nice_place(m)
            la, lo = cents_ll[m]
            near = sorted((x for x in cents_ll if x != m), key=lambda x: dist(la, lo, *cents_ll[x]))[:8]
            links = "".join(f'<li><a href="{muni_page(p, x)}">{e(nice_place(x))}</a></li>' for x in near)
            extra = (f'<section class="gsec"><h2>Gasolineras baratas cerca de {e(mname)}</h2><ul class="glinks">{links}'
                     f'<li><a href="{prov_page(p)}"><b>Toda la provincia de {e(name)}</b></a></li></ul></section>')
            crumbs = ('<a href="index.html">Inicio</a> › <a href="gasolineras.html">Gasolineras</a> › '
                      f'<a href="{prov_page(p)}">{e(name)}</a> › {e(mname)}')
            gm = ranked(ms, "g95")
            label = mname if mname == name else f"{mname} ({name})"
            title = f"Gasolineras más baratas en {label} hoy · Kilovatio"
            desc = (f"Gasolina 95 desde {eur(gm[0]['g95'])} €/l en {mname} hoy. Las {len(ms)} gasolineras ordenadas por precio "
                    "con datos oficiales del día." if gm else f"Precios de las gasolineras de {mname} hoy.")
            body = place_body(label, ms, nat, crumbs, fecha, dia, extra, f'data-prov="{e(p)}" data-muni="{e(m)}"')
            written += page(os.path.join(root, f), f, title, desc, body,
                            breadcrumb([("Gasolineras", "gasolineras.html"), (name, prov_page(p)), (mname, f)]))
            pages.append(f)

    # Portada de gasolineras: España
    prow = "".join(
        f'<tr><td><a href="{prov_page(p)}">{e(nice_place(p))}</a></td><td class="num">{eur(a)} €</td>'
        f'<td class="num">{eur(avg(provs[p], "dA"))} €</td><td class="num">{eur(ranked(provs[p], "g95")[0]["g95"])} €</td></tr>'
        for p, a in prov_avg)
    isl = "".join(f'<li><a href="{prov_page(p)}">{e(nice_place(p))}</a></li>' for p in sorted(provs) if p in ISLAS)
    g, dz = ranked(pen, "g95"), ranked(pen, "dA")
    k = [kpi("mid", "Gasolina 95 · media", f"{eur(nat['g95'])} €", "por litro en la península y Baleares"),
         kpi("mid", "Diésel · media", f"{eur(nat['dA'])} €", "por litro en la península y Baleares"),
         kpi("good", "Provincia más barata", e(nice_place(prov_avg[0][0])), f"gasolina 95 a {eur(prov_avg[0][1])} € de media"),
         kpi("bad", "Provincia más cara", e(nice_place(prov_avg[-1][0])), f"gasolina 95 a {eur(prov_avg[-1][1])} € de media")]
    body = f"""<main class="wrap gas">
  <div class="intro">
    <p class="crumbs"><a href="index.html">Inicio</a> › Gasolineras</p>
    <p class="eyebrow">Precio de la gasolina hoy · {e(dia)}</p>
    <h1>Gasolineras más baratas de España hoy</h1>
    <p>Los precios de las {len(st):,} gasolineras de España, ordenados de más baratos a más caros, por provincia y por localidad. La gasolina 95 más barata de la península está hoy a <b>{eur(g[0]['g95'])} €/l</b> en {e(g[0]['rot'])} ({e(where(g[0]))}) y el diésel, a <b>{eur(dz[0]['dA'])} €/l</b> en {e(dz[0]['rot'])} ({e(where(dz[0]))}).</p>
    <p class="note">Precios oficiales del Ministerio para la Transición Ecológica, actualizados el {e(fecha)}.</p>
  </div>
  <div class="kpis gk">{"".join(k)}</div>
  {near_block()}
  <section class="gsec"><h2>Precio medio por provincia</h2>
  <p class="muted">De la más barata a la más cara en gasolina 95. Pulsa en tu provincia para ver todas sus gasolineras ordenadas por precio.</p>
  <div class="tablewrap"><table class="gprov"><thead><tr><th>Provincia</th><th class="num">Gasolina 95</th><th class="num">Diésel</th><th class="num">La más barata</th></tr></thead><tbody>{prow}</tbody></table></div>
  <div class="muted">Canarias, Ceuta y Melilla tienen impuestos más bajos y van aparte: <ul class="glinks inl">{isl}</ul></div></section>
  <section class="gsec"><h2>Las más baratas de la península y Baleares</h2>
  {rankings(pen, "de España", 20)}</section>
  <article class="explain">
    <h2>Por qué cambia tanto el precio de una gasolinera a otra</h2>
    <p>Más de la mitad de lo que pagas son impuestos (el impuesto de hidrocarburos y el IVA), iguales en toda la península. La diferencia está en el margen de cada gasolinera: la competencia de la zona, si es de marca blanca o de una gran petrolera, si está en una autopista o junto a un hipermercado. Por eso dos gasolineras de la misma calle pueden diferir en más de 10 céntimos por litro.</p>
    <p>Los precios vienen del Geoportal del Ministerio para la Transición Ecológica, donde las gasolineras están obligadas a comunicarlos. Los actualizamos cada día; puedes verlos también en el <a href="mapa.html">mapa de gasolineras y puntos de carga</a>.</p>
  </article>
</main>"""
    title = "Gasolineras más baratas de España hoy: precio de la gasolina y el diésel por provincia · Kilovatio"
    desc = (f"Gasolina 95 a {eur(nat['g95'])} €/l y diésel a {eur(nat['dA'])} €/l de media hoy. "
            "Las gasolineras más baratas de cada provincia y localidad, ordenadas por precio con datos oficiales del día.")
    written += page(os.path.join(root, "gasolineras.html"), "gasolineras.html", title, desc, body.replace(f"{len(st):,}", f"{len(st):,}".replace(",", ".")),
                    breadcrumb([("Gasolineras", "gasolineras.html")]))
    pages.insert(0, "gasolineras.html")
    print(f"Páginas de gasolineras: {len(pages)} ({written} cambiadas)")
    return pages


def breadcrumb(items):
    lst = [{"@type": "ListItem", "position": 1, "name": "Inicio", "item": SITE}]
    for i, (n, u) in enumerate(items):
        lst.append({"@type": "ListItem", "position": i + 2, "name": n, "item": SITE + u})
    return {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": lst}


def dist(a, b, c, d):
    x = math.radians(d - b) * math.cos(math.radians((a + c) / 2))
    y = math.radians(c - a)
    return 6371 * math.hypot(x, y)


if __name__ == "__main__":
    import sys
    write_all(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), ".."))

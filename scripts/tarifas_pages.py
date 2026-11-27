"""Kilovatio — «Mejores tarifas de luz de <mes>»: ranking mensual para tres hogares tipo.
Calcula con el mismo motor que el comparador (scripts/mejores_calc.js, Node) y escribe:
  mejores-tarifas-luz.html            la del mes en curso (se actualiza cada día con precios y ofertas)
  mejores-tarifas-luz-AAAA-MM.html    archivo de cada mes (queda fijo cuando acaba el mes)
  data/mejores_tarifas.json           foto del ranking de cada mes, para contar qué ha cambiado."""
import html
import json
import os
import re
import subprocess

import kvsite

SITE = "https://kilovatio-es.github.io/"
MAIN = "mejores-tarifas-luz.html"
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
TIPO = {"pvpc": "PVPC · precio por horas", "periodos": "Tres precios", "fija": "Precio único"}
ICON = {"piso": '<path d="M4 21V8l8-5 8 5v13"/><path d="M9 21v-6h6v6"/>',
        "familia": '<circle cx="8" cy="7" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M2.5 21a5.5 5.5 0 0 1 11 0M13 21a4 4 0 0 1 8 0"/>',
        "coche": '<path d="M4 16v-3l2-5h12l2 5v3M4 16h16M4 16v2h3v-2M17 16v2h3v-2"/><path d="m13 9-2 3h3l-2 3"/>'}
e = html.escape


def eur0(x):
    return f"{x:,.0f}".replace(",", ".") + " €"


def n4(x):
    return f"{x:.4f}".replace(".", ",")


def pct(x):
    return f"{round(x * 100)} %"


def fecha(k):
    y, m, d = k.split("-")
    return f"{int(d)} de {MESES[int(m) - 1]} de {y}"


def mes_txt(ym):
    y, m = ym.split("-")
    return f"{MESES[int(m) - 1]} de {y}"


def nombre(r):
    return "Tarifa regulada (PVPC)" if r["tipo"] == "pvpc" else f"{r['comercializadora']} · {r['nombre']}"


def precios(r):
    E = r["energia"]
    if r["tipo"] == "pvpc":
        return f"Precio de cada hora · te sale a {n4(E['media'])} €/kWh de media"
    if r["tipo"] == "periodos":
        return f"Punta {n4(E['p1'])} · Llano {n4(E['p2'])} · Valle {n4(E['p3'])} €/kWh"
    return f"{n4(E['unico'])} €/kWh a cualquier hora"


def badges(r):
    b = [f'<span class="b t-{r["tipo"]}">{TIPO[r["tipo"]]}</span>']
    c = r.get("condiciones", "")
    if re.search(r"primer año", c, re.I):
        b.append('<span class="b">Precio del 1.er año</span>')
    if re.search(r"promoci", c, re.I):
        b.append('<span class="b">Tiene promoción (no incluida)</span>')
    if re.search(r"nuevos clientes", c, re.I):
        b.append('<span class="b">Solo nuevos clientes</span>')
    if re.search(r"solo contrataci[oó]n online|exclusiva.*online", c, re.I):
        b.append('<span class="b">Solo online</span>')
    return "".join(b)


def li(i, r, best, mx):
    d = r["anual"] - best
    pot = r["potencia"]
    src = ""
    if r["tipo"] != "pvpc" and r.get("fuente"):
        src = (f' Precio comprobado el {fecha(r["revisado"])} en <a href="{e(r["fuente"])}" rel="noopener" target="_blank">'
               + ("la web de " + e(r["comercializadora"]) if r.get("fuente_tipo") == "oficial" else "una fuente pública") + "</a>.")
    P = r["partes"]
    tot = sum(max(v, 0) for v in P.values()) or 1
    return (f'<li class="{"first" if i == 1 else ""}"><span class="pos num">{i}</span>'
            f'<div class="who"><h3>{e(nombre(r))}</h3><div class="bs">{badges(r)}</div><p class="pr">{e(precios(r))}</p></div>'
            f'<div class="cost"><b class="num">{eur0(r["anual"])}</b><span>al año · {eur0(r["anual"] / 12)}/mes</span>'
            + (f'<span class="dif">+{eur0(d)}</span>' if d >= 1 else '<span class="dif best">La más barata</span>') + "</div>"
            f'<div class="bar"><i style="width:{max(r["anual"] / mx * 100, 4):.1f}%"></i></div>'
            f'<details><summary>Ver detalles</summary><div class="det">'
            f'<div class="stack" aria-hidden="true"><i style="width:{P["energia"] / tot * 100:.1f}%;background:var(--grid)"></i>'
            f'<i style="width:{P["potencia"] / tot * 100:.1f}%;background:var(--sun)"></i><i style="width:{P["impuestos"] / tot * 100:.1f}%;background:var(--bad)"></i>'
            f'<i style="width:{P["otros"] / tot * 100:.1f}%;background:var(--muted)"></i></div>'
            f'<p class="prices"><b>Al año:</b> energía {eur0(P["energia"])} · potencia {eur0(P["potencia"])} · impuestos {eur0(P["impuestos"])} · contador y bono social {eur0(P["otros"])}<br>'
            f'<b>Potencia:</b> punta {n4(pot["p1"])} · valle {n4(pot["p2"])} €/kW·día</p>'
            f'<p class="note">{e(r.get("condiciones", ""))}{src}</p></div></details></li>')


def cambios(pf, prev, prev_ym):
    """Qué ha cambiado frente a la foto del mes anterior."""
    if not prev or pf["id"] not in prev:
        return ""
    old = {i: a for i, a in prev[pf["id"]]}
    rk = pf["ranking"]
    best, oldbest = rk[0], prev[pf["id"]][0][0]
    out = []
    if best["id"] != oldbest:
        out.append(f"<b>Hay nueva tarifa más barata:</b> {e(nombre(best))}.")
    else:
        out.append(f"<b>Sigue en cabeza</b> {e(nombre(best))}.")
    new = [r for r in rk if r["id"] not in old]
    if new:
        out.append("Nuevas en el ranking: " + ", ".join(e(nombre(r)) for r in new[:4]) + ".")
    pv = next((r for r in rk if r["tipo"] == "pvpc"), None)
    if pv and "pvpc" in old:
        d = pv["anual"] - old["pvpc"]
        if abs(d) >= 5:
            out.append(f"El PVPC sale {eur0(abs(d))} al año más {'caro' if d > 0 else 'barato'} que hace un mes, por los precios de las últimas semanas.")
    return f'<div class="callout hook"><b>Novedades frente a {mes_txt(prev_ym)}:</b> ' + " ".join(out) + "</div>"


def body(D, ym, prev, prev_ym, archivo, archive_links):
    n = D["nOfertas"]
    tabs, panes = [], []
    for j, pf in enumerate(D["perfiles"]):
        rk = pf["ranking"]
        best, mx = rk[0], max(r["anual"] for r in rk)
        fija = next((r for r in rk if r["tipo"] == "fija"), None)
        tres = next((r for r in rk if r["tipo"] == "periodos"), None)
        pv_i, pv = next(((i + 1, r) for i, r in enumerate(rk) if r["tipo"] == "pvpc"), (None, None))
        tabs.append(f'<button type="button" class="choice" data-p="{pf["id"]}" aria-pressed="{str(j == 0).lower()}">'
                    f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">{ICON[pf["id"]]}</svg>'
                    f'<h3>{e(pf["nombre"])}</h3><p>{e(pf["quien"])}</p><span class="go num">{eur0(pf["kwh"])[:-2]} kWh/año · {str(pf["kw"]).replace(".", ",")} kW</span></button>')
        k = []
        if fija:
            k.append(f'<div class="ans mid"><small>Mejor precio único</small><b class="num">{eur0(fija["anual"])}</b><span>{e(nombre(fija))}</span></div>')
        if tres:
            k.append(f'<div class="ans mid"><small>Mejor con tres precios</small><b class="num">{eur0(tres["anual"])}</b><span>{e(nombre(tres))}</span></div>')
        if pv:
            k.append(f'<div class="ans mid"><small>Tarifa regulada (PVPC)</small><b class="num">{eur0(pv["anual"])}</b><span>puesto {pv_i} de {len(rk)} con los precios del último año</span></div>')
        rep = pf["reparto"]
        consejo = ("Como mucho de su consumo cae por la noche y el fin de semana, a este hogar le compensan las tarifas de tres precios."
                   if best["tipo"] == "periodos" else
                   "Con los precios reales del último año, el PVPC le sale más barato que cualquier oferta fija, aunque su precio sube y baja cada hora."
                   if best["tipo"] == "pvpc" else
                   "A este hogar le compensa un precio único: no consume tanto en horas valle como para aprovechar los tres precios.")
        panes.append(f'''<div class="tpane" data-p="{pf["id"]}"{"" if j == 0 else " hidden"}>
    <div class="win"><p class="eyebrow">La más barata · {e(pf["nombre"].lower())}</p><h3>{e(nombre(best))}</h3>
      <p class="big num">{eur0(best["anual"])} <small>al año</small></p>
      <p class="muted">Unos {eur0(best["anual"] / 12)} al mes con potencia, impuestos y todo lo que trae la factura · {TIPO[best["tipo"]]}. Frente a la más cara ahorra {eur0(mx - best["anual"])} al año.</p></div>
    <div class="kpis three-k">{"".join(k)}</div>
    <div class="callout good why"><p>{consejo} Reparto de su consumo: punta {pct(rep["p1"])}, llano {pct(rep["p2"])} y valle {pct(rep["p3"])}.</p></div>
    {cambios(pf, prev, prev_ym)}
    <h3 class="rk-h">Ranking completo: {len(rk)} tarifas, de la más barata a la más cara</h3>
    <ol class="rank">{"".join(li(i + 1, r, best["anual"], mx) for i, r in enumerate(rk))}</ol>
  </div>''')
    arch = ""
    if archive_links:
        arch = ('<h3>Meses anteriores</h3><ul class="glinks">' + "".join(f'<li><a href="{f}">{mes_txt(m)}</a></li>' for m, f in archive_links) + "</ul>")
    titulo_mes = mes_txt(ym)
    aviso = (f'<div class="callout sun">Este es el ranking que publicamos en {titulo_mes}. <a href="{MAIN}">Consulta el de este mes</a>.</div>'
             if archivo else "")
    return f'''<main class="wrap cmp tarifas">
  <div class="intro">
    <p class="crumbs"><a href="index.html">Inicio</a> › <a href="comparador-tarifas.html">Tu factura</a> › Mejores tarifas de luz</p>
    <p class="eyebrow">Actualizado el {fecha(D["hoy"])}</p>
    <h1>Mejores tarifas de luz de {titulo_mes}</h1>
    <p>Hemos calculado lo que pagaría en un año cada tipo de hogar con {n} ofertas de {D["nCompanias"]} compañías y con el PVPC, hora a hora y con todos los impuestos. Elige el hogar que más se parezca al tuyo.</p>
  </div>
  {aviso}
  <section aria-label="Tipo de hogar"><div class="modes tmodes" role="group" aria-label="Tipo de hogar">{"".join(tabs)}</div></section>
  <section class="tres">{"".join(panes)}</section>
  <section class="cta panel">
    <div><h2>¿Tu casa no es exactamente así?</h2><p class="muted">Con los datos de tu factura (o tu consumo hora a hora de Datadis) te decimos cuál es la más barata para ti y cuánto ahorras. En un minuto, gratis y sin registro.</p></div>
    <a class="btn primary big" href="comparador-tarifas.html">Calcular mi tarifa más barata</a>
  </section>
  <article class="explain">
    <h2>Cómo elegir tarifa de luz</h2>
    <ul>
      <li><strong>Precio único:</strong> pagas lo mismo a cualquier hora. Es lo más sencillo y suele ganar si consumes mucho por la tarde entre semana.</li>
      <li><strong>Tres precios:</strong> más caro de 10 a 14 y de 18 a 22 h los laborables, más barato por la noche, los fines de semana y los festivos. Compensa si puedes poner lavadora, lavavajillas o el coche en esas horas.</li>
      <li><strong>PVPC:</strong> la tarifa regulada; su precio cambia cada hora según el mercado. Sin margen comercial en la energía, pero con subidas en olas de frío o cuando el gas está caro. Es la única que da acceso al bono social.</li>
      <li>Mira siempre el <strong>total al año</strong> (energía + potencia + impuestos), no solo el precio del kWh: algunas ofertas bajan uno y suben el otro.</li>
    </ul>
    <h3>Cómo lo calculamos</h3>
    <p>Para cada hogar simulamos las 8.760 horas del año con un perfil de consumo real y calculamos la factura de cada tarifa como lo haría la comercializadora: energía, potencia, impuesto eléctrico ({str(round(D["iee"], 2)).replace(".", ",")} %), alquiler del contador, financiación del bono social e IVA ({D["iva"]} %). El PVPC usa el precio real de cada hora del {fecha(D["desde"])} al {fecha(D["hasta"])}. Las ofertas son para hogares sin permanencia, con su precio comprobado en la web de cada compañía (revisadas el {fecha(D["revisado"])}). Un robot comprueba cada día que el precio no ha cambiado; si cambia, la oferta sale del ranking hasta que la revisamos. Si una oferta tiene descuento el primer año, usamos ese precio y lo indicamos.</p>
    <p class="muted">No cobramos comisiones a ninguna comercializadora: el orden sale solo del cálculo.</p>
    {arch}
  </article>
</main>
<script>
document.querySelector(".tmodes").addEventListener("click", function (ev) {{
  var b = ev.target.closest("button"); if (!b) return;
  document.querySelectorAll(".tmodes button").forEach(function (x) {{ x.setAttribute("aria-pressed", String(x === b)); }});
  document.querySelectorAll(".tpane").forEach(function (p) {{ p.hidden = p.dataset.p !== b.dataset.p; }});
  try {{ localStorage.setItem("kv-hogar", b.dataset.p); }} catch (e) {{}}
}});
try {{ var h = localStorage.getItem("kv-hogar"); var hb = h && document.querySelector('.tmodes [data-p="' + h + '"]'); if (hb) hb.click(); }} catch (e) {{}}
</script>'''


HEAD = """<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
<meta name="description" content="{desc}">
<meta property="og:type" content="article">
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
</head>
<body>
"""


def render(D, ym, prev, prev_ym, archivo, links, page_name, canon):
    fam = next(p for p in D["perfiles"] if p["id"] == "familia")
    b = fam["ranking"][0]
    title = f"Mejores tarifas de luz de {mes_txt(ym)}: ranking por tipo de hogar · Kilovatio"
    desc = (f"La tarifa de luz más barata de {mes_txt(ym)} para una familia es {nombre(b)} ({eur0(b['anual'])} al año). "
            f"Ranking de {D['nOfertas']} ofertas y el PVPC para pisos, familias y casas con coche eléctrico, con impuestos.")
    return (HEAD.format(title=e(title), desc=e(desc), canon=SITE + canon) + kvsite.header(page_name) + "\n"
            + body(D, ym, prev, prev_ym, archivo, links) + "\n" + kvsite.FOOTER + "\n</body>\n</html>\n")


def write(path, txt):
    old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
    if old != txt:
        with open(path, "w", encoding="utf-8") as f:
            f.write(txt)
        return True
    return False


def write_all(root, today):
    try:
        res = subprocess.run(["node", os.path.join(root, "scripts", "mejores_calc.js"), root, today],
                             capture_output=True, text=True, timeout=300)
        D = json.loads(res.stdout)
    except Exception as ex:  # noqa: BLE001
        print(f"Mejores tarifas: no se pudo calcular ({ex}) {getattr(locals().get('res'), 'stderr', '')[:300]}")
        return []
    ym = today[:7]
    hist_path = os.path.join(root, "data", "mejores_tarifas.json")
    H = {"meses": {}}
    if os.path.exists(hist_path):
        with open(hist_path, encoding="utf-8") as f:
            H = json.load(f)
    if ym not in H["meses"]:   # foto del primer día del mes: con ella contamos qué cambia el mes siguiente
        H["meses"][ym] = {p["id"]: [[r["id"], round(r["anual"])] for r in p["ranking"]] for p in D["perfiles"]}
        with open(hist_path, "w", encoding="utf-8") as f:
            json.dump(H, f, ensure_ascii=False, separators=(",", ":"))
    past = sorted(m for m in H["meses"] if m < ym)
    prev_ym = past[-1] if past else None
    prev = H["meses"].get(prev_ym) if prev_ym else None
    # Archivos de meses anteriores: que apunten a sí mismos (ya no cambian)
    links = []
    for m in sorted((m for m in H["meses"] if m < ym), reverse=True):
        f = f"mejores-tarifas-luz-{m}.html"
        p = os.path.join(root, f)
        if os.path.exists(p):
            s = open(p, encoding="utf-8").read()
            s2 = s.replace(f'<link rel="canonical" href="{SITE}{MAIN}">', f'<link rel="canonical" href="{SITE}{f}">')
            if s2 != s:
                write(p, s2)
            links.append((m, f))
    arch = f"mejores-tarifas-luz-{ym}.html"
    write(os.path.join(root, MAIN), render(D, ym, prev, prev_ym, False, links, MAIN, MAIN))
    write(os.path.join(root, arch), render(D, ym, prev, prev_ym, True, links, MAIN, MAIN))
    print(f"Mejores tarifas de {mes_txt(ym)}: {len(D['perfiles'])} hogares, {D['nOfertas']} ofertas")
    return [MAIN] + [f for _, f in links]


if __name__ == "__main__":
    import sys
    from datetime import date
    write_all(os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..")),
              sys.argv[2] if len(sys.argv) > 2 else date.today().isoformat())

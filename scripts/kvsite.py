"""Cabecera (menú por categorías) y pie comunes. Reescribe <header class="site"> y <footer class="site"> en las páginas.
Uso: python3 scripts/kvsite.py <carpeta_web> pagina1.html pagina2.html ..."""
import os, re, sys

CATS = [
    # clave, etiqueta, enlace principal, subpáginas
    ("luz", "Precio de la luz", "index.html",
     [("index.html", "Hoy"), ("precio-luz-manana.html", "Mañana"), ("precio-luz-meses.html", "Por meses")]),
    ("mi", "Mi Kilovatio", "mi-kilovatio.html", []),
    ("factura", "Tu factura", "comparador-tarifas.html",
     [("comparador-tarifas.html", "Comparador de tarifas"), ("mejores-tarifas-luz.html", "Mejores tarifas del mes"), ("tarifa-pvpc-o-fija.html", "PVPC o precio fijo"), ("potencia-contratada.html", "Potencia contratada"),
      ("guia-factura-luz.html", "Guía de la factura")]),
    ("casa", "Tu casa", "consumo-electrodomesticos.html",
     [("consumo-electrodomesticos.html", "Electrodomésticos"), ("calefaccion.html", "Calefacción"),
      ("placas-solares.html", "Placas solares y batería")]),
    ("mov", "Movilidad", "gasolineras.html",
     [("gasolineras.html", "Gasolineras baratas"), ("mapa.html", "Mapa de gasolineras y recarga"), ("coche-electrico.html", "Coche eléctrico")]),
]


def cat_of(page):
    if page in ("index.html", "precio-luz-manana.html") or page.startswith("precio-luz-") or page.startswith("plantillas/"):
        return "luz"
    if page.startswith("gasolineras"):
        return "mov"
    if page.startswith("mejores-tarifas-luz"):
        return "factura"
    for key, _, main, subs in CATS:
        if page == main or page in [s[0] for s in subs]:
            return key
    return None


def header(page):
    cur = cat_of(page)
    top = []
    for key, label, main, _ in CATS:
        cls = ' class="mi"' if key == "mi" else ""
        ac = ' aria-current="page"' if key == cur else ""
        top.append(f'    <a href="{main}"{cls}{ac}>{label}</a>')
    sub = ""
    subs = next((s for k, _, _, s in CATS if k == cur), [])
    if subs:
        sub = ('  <nav class="sub" aria-label="En esta sección"><div class="wrap">\n'
               + "\n".join(f'    <a href="{f}"{" aria-current=\"page\"" if f == page else ""}>{l}</a>' for f, l in subs)
               + "\n  </div></nav>\n")
    return ('<header class="site">\n  <div class="wrap top">\n'
            '    <a class="logo" href="index.html"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="var(--sun)"/><path d="M13 4 7 13h5l-1 7 6-9h-5l1-7Z" fill="var(--surface)"/></svg>Kilovatio</a>\n'
            '    <span class="tagline">Tu energía, clara y en números</span>\n  </div>\n'
            '  <nav class="main" aria-label="Secciones"><div class="wrap">\n' + "\n".join(top) + "\n  </div></nav>\n"
            + sub + "</header>")


FOOTER = """<footer class="site"><div class="wrap cols">
  <div>
    <h4>Kilovatio</h4>
    <p>Precios de la energía y herramientas gratuitas para entender y reducir lo que gastas en casa. Los precios de la luz y de los carburantes se actualizan solos cada día con datos oficiales.</p>
    <p style="margin-top:.6rem">Los resultados son estimaciones orientativas y no sustituyen el presupuesto de un profesional ni el asesoramiento fiscal.</p>
  </div>
  <div><h4>Precio de la luz</h4><ul>
    <li><a href="index.html">Precio de la luz hoy</a></li><li><a href="precio-luz-manana.html">Precio de la luz mañana</a></li><li><a href="precio-luz-meses.html">Precio de la luz por meses</a></li>
    <li><a href="mi-kilovatio.html">Mi Kilovatio</a></li>
  </ul></div>
  <div><h4>Tu factura</h4><ul>
    <li><a href="comparador-tarifas.html">Comparador de tarifas</a></li><li><a href="mejores-tarifas-luz.html">Mejores tarifas del mes</a></li><li><a href="tarifa-pvpc-o-fija.html">PVPC o precio fijo</a></li><li><a href="potencia-contratada.html">Potencia contratada</a></li>
    <li><a href="guia-factura-luz.html">Guía de la factura</a></li>
  </ul></div>
  <div><h4>Tu casa</h4><ul>
    <li><a href="consumo-electrodomesticos.html">Electrodomésticos</a></li><li><a href="calefaccion.html">Calefacción</a></li>
    <li><a href="placas-solares.html">Placas solares y batería</a></li>
  </ul></div>
  <div><h4>Movilidad</h4><ul>
    <li><a href="gasolineras.html">Gasolineras más baratas</a></li><li><a href="mapa.html">Mapa de gasolineras y recarga</a></li><li><a href="coche-electrico.html">Coche eléctrico</a></li>
  </ul></div>
</div></footer>"""

HDR = re.compile(r'<header class="site">.*?</header>', re.S)
FTR = re.compile(r'<footer class="site">.*?</footer>', re.S)


def apply(path, page):
    s = open(path, encoding="utf-8").read()
    s2 = HDR.sub(lambda m: header(page), s, count=1)
    s2 = FTR.sub(lambda m: FOOTER, s2, count=1)
    if s2 != s:
        open(path, "w", encoding="utf-8").write(s2)
        return True
    return False


if __name__ == "__main__":
    root = sys.argv[1]
    pages = sys.argv[2:]
    for p in pages:
        print(p, apply(os.path.join(root, p), p))

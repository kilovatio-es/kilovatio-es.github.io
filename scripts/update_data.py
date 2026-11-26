"""
Actualiza data/energia.json con:
  - Precio PVPC (tarifa 2.0TD, península) hora a hora de hoy y de mañana, desde Red Eléctrica.
    Se guarda el histórico de los últimos 400 días para calcular medias mensuales y por periodos.
  - Precio medio nacional de la gasolina 95 y del gasóleo A, desde el Ministerio (Geoportal).
Y, para el mapa:
  - data/gasolineras.json: todas las gasolineras con sus precios (Ministerio), en cada ejecución.
  - data/recarga.json: todos los puntos de recarga públicos (DGT, Punto de Acceso Nacional), una vez al día.
Lo ejecuta GitHub Actions varias veces al día. Solo usa la biblioteca estándar de Python.
"""
import json, os, re, ssl, statistics, time, urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Madrid")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "energia.json")
KEEP_DAYS = 400
UA = {"User-Agent": "Kilovatio/1.0 (calculadoras de energia)", "Accept": "application/json"}


def get_json(url, timeout=60, context=None):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout, context=context) as r:
        return json.loads(r.read().decode("utf-8-sig"))


def legacy_ssl():
    """El servidor del Ministerio usa una configuración TLS antigua que OpenSSL 3 rechaza por defecto."""
    ctx = ssl.create_default_context()
    ctx.options |= getattr(ssl, "OP_LEGACY_SERVER_CONNECT", 0x4)
    try:
        ctx.set_ciphers("DEFAULT:@SECLEVEL=1")
    except ssl.SSLError:
        pass
    return ctx


def to_24(acc):
    """acc: {hora: [valores €/MWh]} -> lista de 24 precios en €/kWh (None si falta)."""
    out = []
    for h in range(24):
        v = acc.get(h)
        out.append(round(sum(v) / len(v) / 1000, 5) if v else None)
    return out


SPOT = {}   # precio del mercado diario por hora (€/kWh): con él se compensan los excedentes en el PVPC


def stash_spot(j):
    """Guarda en SPOT la serie del mercado diario que viene en la misma respuesta que el PVPC."""
    ser = [x for x in j.get("included", []) if "spot" in x.get("attributes", {}).get("title", "").lower()]
    if not ser:
        return
    acc = {}
    for v in ser[0]["attributes"]["values"]:
        dt = str(v["datetime"])
        acc.setdefault(dt[:10], {}).setdefault(int(dt[11:13]), []).append(float(v["value"]))
    for d, hh in acc.items():
        if len(hh) >= 23:
            SPOT[d] = to_24(hh)


def pvpc_redata(day):
    url = ("https://apidatos.ree.es/es/datos/mercados/precios-mercados-tiempo-real"
           f"?start_date={day}T00:00&end_date={day}T23:59&time_trunc=hour")
    j = get_json(url)
    stash_spot(j)
    series = [s for s in j.get("included", []) if "pvpc" in s.get("attributes", {}).get("title", "").lower()]
    if not series:
        return None
    acc = {}
    for v in series[0]["attributes"]["values"]:
        if not str(v["datetime"]).startswith(day):
            continue
        acc.setdefault(int(v["datetime"][11:13]), []).append(float(v["value"]))
    return to_24(acc) if len(acc) >= 23 else None


def pvpc_redata_range(start, end):
    """PVPC de varios días seguidos en una sola petición -> {día: [24 precios]}."""
    url = ("https://apidatos.ree.es/es/datos/mercados/precios-mercados-tiempo-real"
           f"?start_date={start}T00:00&end_date={end}T23:59&time_trunc=hour")
    j = get_json(url, timeout=90)
    stash_spot(j)
    series = [s for s in j.get("included", []) if "pvpc" in s.get("attributes", {}).get("title", "").lower()]
    if not series:
        return {}
    acc = {}
    for v in series[0]["attributes"]["values"]:
        dt = str(v["datetime"])
        acc.setdefault(dt[:10], {}).setdefault(int(dt[11:13]), []).append(float(v["value"]))
    return {d: to_24(h) for d, h in acc.items() if len(h) >= 23}


def backfill(data, now, days_back=395, chunk=7, max_requests=80):
    """Rellena los días que falten del último año, en bloques de `chunk` días."""
    today = now.date()
    missing = []
    for i in range(days_back, 1, -1):
        d = (today - timedelta(days=i)).strftime("%Y-%m-%d")
        if d not in data["days"] or d not in data.get("spot", {}):
            missing.append(d)
    if not missing:
        return
    print(f"Histórico: faltan {len(missing)} días; descargando…")
    blocks, cur = [], [missing[0]]
    for d in missing[1:]:
        prev = datetime.strptime(cur[-1], "%Y-%m-%d")
        if (datetime.strptime(d, "%Y-%m-%d") - prev).days == 1 and len(cur) < chunk:
            cur.append(d)
        else:
            blocks.append(cur)
            cur = [d]
    blocks.append(cur)
    added = 0
    for n, b in enumerate(blocks[:max_requests]):
        try:
            got = pvpc_redata_range(b[0], b[-1])
            for d, p in got.items():
                if d in b and sum(x is not None for x in p) >= 23:
                    data["days"][d] = p
                    added += 1
        except Exception as e:  # noqa: BLE001
            print(f"Histórico {b[0]}–{b[-1]}: fallo: {e}")
        time.sleep(1)
    print(f"Histórico: añadidos {added} días ({min(len(blocks), max_requests)} peticiones)")


def pvpc_esios_archive(day):
    """Alternativa: archivo público del PVPC de e·sios (no requiere token)."""
    j = get_json(f"https://api.esios.ree.es/archives/70/download_json?locale=es&date={day}")
    acc = {}
    for row in j.get("PVPC", []):
        h = int(str(row["Hora"])[:2])
        val = str(row.get("PCB", "")).replace(".", "").replace(",", ".")
        if val:
            acc.setdefault(h, []).append(float(val))
    return to_24(acc) if len(acc) >= 23 else None


def pvpc(day):
    for fn in (pvpc_redata, pvpc_esios_archive):
        try:
            r = fn(day)
            if r and sum(x is not None for x in r) >= 23:
                print(f"PVPC {day}: OK ({fn.__name__})")
                return r
        except Exception as e:  # noqa: BLE001
            print(f"PVPC {day}: fallo en {fn.__name__}: {e}")
    print(f"PVPC {day}: sin datos todavía")
    return None


def fuel_raw():
    """Todas las gasolineras de España con sus precios (Ministerio para la Transición Ecológica)."""
    url = "https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/"
    j, last_err = None, None
    for intento in range(3):
        for ctx in (legacy_ssl(), None):
            try:
                j = get_json(url, timeout=180, context=ctx)
                break
            except Exception as e:  # noqa: BLE001
                last_err = e
        if j:
            break
        time.sleep(10)
    if not j:
        raise RuntimeError(last_err)
    return j


def num(s):
    try:
        x = float(str(s).replace(",", "."))
        return x if x == x else None
    except ValueError:
        return None


def fuel(j):
    def avg(field):
        vals = [x for x in (num(e.get(field)) for e in j.get("ListaEESSPrecio", [])) if x and 0.5 < x < 4]
        return round(statistics.mean(vals), 3) if vals else None
    g, d = avg("Precio Gasolina 95 E5"), avg("Precio Gasoleo A")
    print(f"Carburantes: gasolina 95 {g} €/l, gasóleo A {d} €/l")
    return {"gasolina95": g, "diesel": d}


# Carburantes que se guardan para el mapa (clave corta, campo del Ministerio)
FUELS = [("g95", "Precio Gasolina 95 E5"), ("g98", "Precio Gasolina 98 E5"), ("dA", "Precio Gasoleo A"),
         ("dP", "Precio Gasoleo Premium"), ("glp", "Precio Gases licuados del petróleo"),
         ("gnc", "Precio Gas Natural Comprimido"), ("h2", "Precio Hidrogeno")]


def gasolineras(j, now):
    """data/gasolineras.json: una fila por gasolinera de venta al público. Precios en milésimas de euro."""
    rows = []
    for e in j.get("ListaEESSPrecio", []):
        if e.get("Tipo Venta") == "R":  # venta restringida a socios (cooperativas): no se muestra
            continue
        lat, lon = num(e.get("Latitud")), num(e.get("Longitud (WGS84)"))
        if not lat or not lon:
            continue
        prices = []
        for _, field in FUELS:
            x = num(e.get(field))
            prices.append(round(x * 1000) if x and 0.3 < x < 30 else 0)
        if not any(prices):
            continue
        rows.append([round(lat, 5), round(lon, 5), (e.get("Rótulo") or "").strip(), (e.get("Dirección") or "").strip(),
                     (e.get("Municipio") or "").strip(), (e.get("Provincia") or "").strip().title(),
                     (e.get("Horario") or "").strip(), (e.get("C.P.") or "").strip()] + prices)
    out = {"updated": now.isoformat(timespec="minutes"), "source": j.get("Fecha"),
           "cols": ["lat", "lon", "rotulo", "direccion", "municipio", "provincia", "horario", "cp"] + [k for k, _ in FUELS],
           "rows": rows}
    write_json(os.path.join(ROOT, "data", "gasolineras.json"), out)
    print(f"Mapa: {len(rows)} gasolineras")


# ---------- Puntos de recarga (DGT, Punto de Acceso Nacional, DATEX II, licencia CC-BY) ----------
NAP_RECARGA = "https://nap.dgt.es/datex2/v3/miterd/EnergyInfrastructureTablePublication/electrolineras.xml"
CONN = {"iec62196T2": 1, "iec62196T2COMBO": 2, "chademo": 4, "domesticF": 8, "domesticE": 8}  # resto: 16


def short_hours(label):
    label = " ".join((label or "").split())
    days = re.findall(r"(Lunes|Martes|Miercoles|Jueves|Viernes|Sabado|Domingo) \(([^)]*)\)", label)
    if days and all(h.replace(" ", "") in ("00:00-23:59", "00:00-24:00") for _, h in days) and len(days) == 7:
        return "24h"
    order = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado", "Domingo"]
    if len(days) == 7:
        d = dict(days)
        return " · ".join(f"{k[:2]} {d[k].replace(' ', '')}" for k in order)
    return label[:120]


PRICE_TAGS = set()   # etiquetas de precio en el archivo de la DGT (hoy no publica precios)


def parse_recarga(fileobj):
    import xml.etree.ElementTree as ET
    def local(tag):
        return tag.rsplit("}", 1)[-1]
    rows = []
    for ev, el in ET.iterparse(fileobj, events=("end",)):
        if local(el.tag) != "energyInfrastructureSite":
            continue
        name = operator = hours = cp = ""
        addr = {}
        lat = lon = None
        kw = 0.0
        mask = points = 0
        for ch in el.iter():
            t = local(ch.tag)
            if t == "latitude":
                lat = num(ch.text)
            elif t == "longitude":
                lon = num(ch.text)
            elif t == "postcode":
                cp = (ch.text or "").strip().zfill(5)
            elif t == "label" and not hours:
                hours = short_hours(ch.text)
            elif t == "refillPoint":
                points += 1
            elif t == "connectorType":
                mask |= CONN.get((ch.text or "").strip(), 16)
            elif t == "maxPowerAtSocket":
                kw = max(kw, (num(ch.text) or 0) / 1000)
            elif re.search(r"price|tarif|energyrate|ratepolicy", t, re.I):
                PRICE_TAGS.add(t)
        # nombre del sitio y del operador: primer <fac:name> directo de cada uno
        for ch in el:
            if local(ch.tag) == "name":
                name = " ".join("".join(ch.itertext()).split())
            elif local(ch.tag) == "operator":
                for n in ch:
                    if local(n.tag) == "name":
                        operator = " ".join("".join(n.itertext()).split())
        for v in el.iter():
            if local(v.tag) == "text":
                txt = " ".join("".join(v.itertext()).split())
                if ":" in txt:
                    k, val = txt.split(":", 1)
                    addr[k.strip()] = val.strip()
        el.clear()
        if not lat or not lon or not (27 < lat < 44.5) or not (-19 < lon < 5):
            continue
        rows.append([round(lat, 5), round(lon, 5), name, operator, addr.get("Dirección", ""), addr.get("Municipio", ""),
                     addr.get("Provincia", ""), cp, round(kw, 1), points, mask, hours])
    return rows


def recarga(now):
    path = os.path.join(ROOT, "data", "recarga.json")
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                old = json.load(f)
            age = now - datetime.fromisoformat(old["updated"])
            if age < timedelta(hours=20):
                print(f"Recarga: datos de hace {age}, no hace falta descargar")
                return
        except Exception:  # noqa: BLE001
            pass
    req = urllib.request.Request(NAP_RECARGA, headers={"User-Agent": UA["User-Agent"]})
    with urllib.request.urlopen(req, timeout=240) as r:
        rows = parse_recarga(r)
    if len(rows) < 1000:
        raise RuntimeError(f"solo {len(rows)} puntos; no se guarda")
    write_json(path, {"updated": now.isoformat(timespec="minutes"),
                      "cols": ["lat", "lon", "nombre", "operador", "direccion", "municipio", "provincia", "cp",
                               "kw", "puntos", "conectores", "horario"],
                      "conectores": {"1": "Tipo 2", "2": "CCS2", "4": "CHAdeMO", "8": "Schuko", "16": "Otros"},
                      "rows": rows})
    print(f"Mapa: {len(rows)} ubicaciones de recarga")
    if PRICE_TAGS:
        alert("dgt-precios", "La DGT ya publica precios de recarga",
              "El archivo de puntos de recarga de la DGT incluye ahora etiquetas de precio: " + ", ".join(sorted(PRICE_TAGS))
              + ". Hay que adaptar el mapa para mostrar el precio real de cada cargador en lugar del orientativo.", NAP_RECARGA)


# ---------- Avisos: cambios que hay que revisar (BOE, nuevas fuentes) ----------
ALERTS = os.path.join(ROOT, "data", "alertas.json")


def load_alerts():
    try:
        with open(ALERTS, encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return {"items": [], "boe_revisado": None}


def open_issue(title, body):
    """Abre una incidencia en GitHub: avisa por correo al dueño del repositorio y queda pendiente de revisar."""
    token, repo = os.environ.get("GITHUB_TOKEN"), os.environ.get("GITHUB_REPOSITORY")
    if not token or not repo:
        print(f"Aviso (sin GitHub): {title}")
        return
    req = urllib.request.Request(f"https://api.github.com/repos/{repo}/issues", method="POST",
                                 data=json.dumps({"title": title, "body": body}).encode(),
                                 headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                                          "User-Agent": UA["User-Agent"]})
    try:
        urllib.request.urlopen(req, timeout=30).read()
        print(f"Aviso abierto en GitHub: {title}")
    except Exception as e:  # noqa: BLE001
        print(f"Aviso: no se pudo abrir la incidencia ({e}): {title}")


def alert(key, title, body, url=None):
    A = load_alerts()
    if any(x["id"] == key for x in A["items"]):
        return
    A["items"].append({"id": key, "titulo": title, "url": url, "fecha": datetime.now(TZ).strftime("%Y-%m-%d"), "estado": "pendiente"})
    write_json(ALERTS, A)
    open_issue("Kilovatio · revisar: " + title[:120], body + (f"\n\nEnlace: {url}" if url else "")
               + "\n\nLa tarea de revisión de Kilovatio lo comprobará y actualizará la web si hace falta.")


BOE_RE = re.compile(r"impuesto especial sobre la electricidad|impuesto sobre el valor a[ñn]adido.{0,120}(electricidad|energ[ií]a el[ée]ctrica)"
                    r"|(electricidad|energ[ií]a el[ée]ctrica).{0,120}(impuesto|tipo impositivo|IVA)|precio voluntario para el peque[ñn]o consumidor"
                    r"|bono social|peajes de (acceso|transporte)|cargos del sistema el[ée]ctrico|real decreto-ley.{0,200}(energ|electricidad)", re.I)


def boe_watch(now):
    """Revisa una vez al día el sumario del BOE (datos abiertos) en busca de normas sobre impuestos o precios de la luz."""
    A = load_alerts()
    today = now.strftime("%Y-%m-%d")
    if A.get("boe_revisado") == today:
        return
    found = 0
    for back in (1, 0):
        d = (now - timedelta(days=back)).strftime("%Y%m%d")
        try:
            j = get_json(f"https://www.boe.es/datosabiertos/api/boe/sumario/{d}", timeout=60)
        except Exception as e:  # noqa: BLE001
            print(f"BOE {d}: sin sumario ({e})")
            continue
        items = []
        def walk(o):
            if isinstance(o, dict):
                if "titulo" in o and "identificador" in o:
                    items.append(o)
                for v in o.values():
                    walk(v)
            elif isinstance(o, list):
                for v in o:
                    walk(v)
        walk(j.get("data", {}))
        for it in items:
            if BOE_RE.search(it.get("titulo", "")):
                found += 1
                alert("boe-" + it["identificador"], it["titulo"], "Publicado en el BOE del " + d[6:] + "/" + d[4:6] + "/" + d[:4] + ":\n\n" + it["titulo"],
                      it.get("url_html"))
    A = load_alerts()
    A["boe_revisado"] = today
    write_json(ALERTS, A)
    print(f"BOE: revisado ({found} normas sobre la luz)")


def fetch_text(url, timeout=40):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; Kilovatio/1.0; +https://kilovatio-es.github.io)",
                                               "Accept": "text/html,application/xhtml+xml", "Accept-Language": "es-ES,es;q=0.9"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def vigilar_ofertas(now):
    """Una vez al día abre la web oficial de cada oferta y comprueba que siguen apareciendo sus precios.
    Si cambian, la marca en data/ofertas_estado.json (la web la señala) y abre un aviso para revisarla."""
    from urllib import robotparser
    from urllib.parse import urlsplit
    today = now.strftime("%Y-%m-%d")
    est_path = os.path.join(ROOT, "data", "ofertas_estado.json")
    est = {"revisado": None, "items": {}}
    if os.path.exists(est_path):
        with open(est_path, encoding="utf-8") as f:
            est = json.load(f)
    if est.get("revisado") == today:
        return
    with open(os.path.join(ROOT, "data", "ofertas.json"), encoding="utf-8") as f:
        of = json.load(f)
    robots, pages = {}, {}
    for o in of["ofertas"]:
        v = o.get("vigilar")
        if not v:
            continue
        url, st = v["url"], "sin_verificar"
        try:
            host = "{0.scheme}://{0.netloc}".format(urlsplit(url))
            if host not in robots:
                rp = robotparser.RobotFileParser()
                try:
                    rp.parse(fetch_text(host + "/robots.txt", 20).splitlines())
                except Exception:  # noqa: BLE001
                    rp = None
                robots[host] = rp
            rp = robots[host]
            if rp is not None and not rp.can_fetch("Kilovatio", url):
                st = "no_permitido"
            else:
                if url not in pages:
                    pages[url] = fetch_text(url)
                    time.sleep(2)
                html = pages[url]
                found = [t for t in v["textos"] if t in html]
                st = "ok" if len(found) == len(v["textos"]) else "cambiada" if found else "sin_verificar"
        except Exception as e:  # noqa: BLE001
            print(f"Oferta {o['id']}: no se pudo abrir ({e})")
        prev = est["items"].get(o["id"], {})
        item = {"estado": st, "comprobado": today, "ok": today if st == "ok" else prev.get("ok"),
                "dias_sin": prev.get("dias_sin", 0) + 1 if st == "sin_verificar" else 0}
        est["items"][o["id"]] = item
        print(f"Oferta {o['id']}: {st}")
        name = f"{o['comercializadora']} {o['nombre']}"
        if st == "cambiada":
            alert(f"oferta-{o['id']}-{today[:7]}", f"oferta {name}",
                  f"En {url} ya no aparecen todos los precios guardados ({', '.join(v['textos'])}). "
                  "Comprueba la oferta, actualiza data/ofertas.json (precios, revisado y vigilar.textos).", url)
        elif st == "sin_verificar" and item["dias_sin"] == 3:
            alert(f"oferta-sin-{o['id']}-{today[:7]}", f"oferta {name}",
                  f"Hace 3 días que no se pueden comprobar los precios en {url}. Revisa la oferta a mano.", url)
    est["revisado"] = today
    write_json(est_path, est)


def load_refs():
    with open(os.path.join(ROOT, "data", "referencias.json"), encoding="utf-8") as f:
        return json.load(f)


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))


def main():
    data = {"days": {}, "fuel": None}
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as f:
            data = json.load(f)
    now = datetime.now(TZ)
    for offset in (-1, 0, 1):
        day = (now + timedelta(days=offset)).strftime("%Y-%m-%d")
        if offset < 1 and day in data["days"] and None not in data["days"][day]:
            continue  # ya completo
        p = pvpc(day)
        if p:
            data["days"][day] = p
    backfill(data, now)
    data.setdefault("spot", {}).update(SPOT)
    keep =sorted(data["days"])[-KEEP_DAYS:]
    data["days"] = {k: data["days"][k] for k in keep}
    data["spot"] = {k: data["spot"][k] for k in keep if k in data["spot"]}
    print(f"Mercado diario: {len(data['spot'])} días")
    try:
        j = fuel_raw()
        f = fuel(j)
        if f["gasolina95"] and f["diesel"]:
            f["date"] = now.strftime("%Y-%m-%d")
            data["fuel"] = f
        gasolineras(j, now)
    except Exception as e:  # noqa: BLE001
        print(f"Carburantes: fallo: {e}")
    try:
        recarga(now)
    except Exception as e:  # noqa: BLE001
        print(f"Recarga: fallo: {e}")
    try:
        refs = load_refs()
        data["tax"] = refs["impuestos"]          # impuestos por fecha (los usa la web para cada día)
        data["recargaRef"] = refs.get("recarga")
        data["refsRevisado"] = refs.get("revisado")
    except Exception as e:  # noqa: BLE001
        print(f"Referencias: fallo: {e}")
    try:
        vigilar_ofertas(now)
    except Exception as e:  # noqa: BLE001
        print(f"Ofertas: fallo: {e}")
    try:
        boe_watch(now)
    except Exception as e:  # noqa: BLE001
        print(f"BOE: fallo: {e}")
    data["updated"] = now.isoformat(timespec="minutes")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"Guardado {OUT}: {len(data['days'])} días")
    try:
        import luz_pages  # páginas de hoy, mañana y cada día, con los números en el HTML
        luz_pages.write_all(data, ROOT, now.strftime("%Y-%m-%d"))
    except Exception as e:  # noqa: BLE001
        print(f"Páginas de la luz: fallo: {e}")


if __name__ == "__main__":
    main()

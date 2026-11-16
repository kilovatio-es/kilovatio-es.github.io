"""
Actualiza data/energia.json con:
  - Precio PVPC (tarifa 2.0TD, península) hora a hora de hoy y de mañana, desde Red Eléctrica.
    Se guarda el histórico de los últimos 400 días para calcular medias mensuales y por periodos.
  - Precio medio nacional de la gasolina 95 y del gasóleo A, desde el Ministerio (Geoportal).
Lo ejecuta GitHub Actions varias veces al día. Solo usa la biblioteca estándar de Python.
"""
import json, os, ssl, statistics, time, urllib.request
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


def pvpc_redata(day):
    url = ("https://apidatos.ree.es/es/datos/mercados/precios-mercados-tiempo-real"
           f"?start_date={day}T00:00&end_date={day}T23:59&time_trunc=hour")
    j = get_json(url)
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
        if d not in data["days"]:
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


def fuel():
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
    def avg(field):
        vals = []
        for e in j.get("ListaEESSPrecio", []):
            s = str(e.get(field, "")).replace(",", ".")
            try:
                x = float(s)
                if 0.5 < x < 4:
                    vals.append(x)
            except ValueError:
                pass
        return round(statistics.mean(vals), 3) if vals else None
    g, d = avg("Precio Gasolina 95 E5"), avg("Precio Gasoleo A")
    print(f"Carburantes: gasolina 95 {g} €/l, gasóleo A {d} €/l")
    return {"gasolina95": g, "diesel": d}


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
    keep = sorted(data["days"])[-KEEP_DAYS:]
    data["days"] = {k: data["days"][k] for k in keep}
    try:
        f = fuel()
        if f["gasolina95"] and f["diesel"]:
            f["date"] = now.strftime("%Y-%m-%d")
            data["fuel"] = f
    except Exception as e:  # noqa: BLE001
        print(f"Carburantes: fallo: {e}")
    data["updated"] = now.isoformat(timespec="minutes")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"Guardado {OUT}: {len(data['days'])} días")


if __name__ == "__main__":
    main()

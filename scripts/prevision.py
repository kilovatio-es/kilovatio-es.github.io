"""Kilovatio — estimación del precio de la luz (PVPC) para los próximos días.

Cómo funciona:
  1. Descarga de Open-Meteo (gratis, sin clave) la previsión del tiempo hora a hora en las zonas con más
     eólica y solar de España y en las grandes ciudades: viento a 100 m, radiación solar y temperatura.
     La misma llamada trae los últimos 92 días, con los que se entrena el modelo.
  2. Ajusta una regresión (mínimos cuadrados ponderados, con más peso a los días recientes) del precio del
     mercado diario de cada hora frente a: hora del día, viento, sol, temperatura, fin de semana/festivo y
     el nivel de precios de la semana anterior (que recoge el precio del gas y del CO2).
  3. PVPC estimado = mercado estimado + lo que el PVPC suma al mercado en esa hora (peajes, cargos y
     ajustes; mediana de las últimas 4 semanas).
  4. Guarda la estimación con una horquilla que crece con los días, y lleva la cuenta de cuánto se ha
     equivocado de verdad (data/prevision_hist.json) para enseñarlo en la web.
Escribe data/prevision.json. Si algo falla, no toca la estimación anterior."""
import json
import math
import os
import urllib.request
from datetime import date, datetime, timedelta

WIND = [(43.1, -7.9), (42.0, -4.6), (41.6, -1.2), (39.6, -2.4), (36.4, -5.8), (41.0, 0.5)]
SOLAR = [(39.0, -6.4), (37.6, -4.6), (39.2, -3.4), (38.1, -1.3), (41.5, -0.8)]
TEMP = [(40.4, -3.7), (41.4, 2.2), (37.4, -6.0), (39.5, -0.4), (43.3, -2.9)]
FESTIVOS = {"01-01", "01-06", "05-01", "08-15", "10-12", "11-01", "12-06", "12-08", "12-25"}
UA = {"User-Agent": "Kilovatio/1.0 (+https://kilovatio-es.github.io)"}


def weather():
    """{(día, hora): (viento_cf, sol_kW, temp_dev)} para los últimos 92 días y los próximos 8."""
    pts = WIND + SOLAR + TEMP
    url = ("https://api.open-meteo.com/v1/forecast?latitude=" + ",".join(str(a) for a, _ in pts)
           + "&longitude=" + ",".join(str(b) for _, b in pts)
           + "&hourly=wind_speed_100m,shortwave_radiation,temperature_2m&wind_speed_unit=ms"
           + "&timezone=Europe%2FMadrid&past_days=92&forecast_days=9")
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=90) as r:
        res = json.loads(r.read().decode("utf-8"))
    if isinstance(res, dict):
        res = [res]
    acc = {}
    for i, loc in enumerate(res):
        H = loc["hourly"]
        role = "w" if i < len(WIND) else "s" if i < len(WIND) + len(SOLAR) else "t"
        for t, ws, sr, tt in zip(H["time"], H["wind_speed_100m"], H["shortwave_radiation"], H["temperature_2m"]):
            key = (t[:10], int(t[11:13]))
            a = acc.setdefault(key, {"w": [], "s": [], "t": []})
            if role == "w" and ws is not None:
                a["w"].append(min(max((ws - 3.0) / 9.0, 0.0), 1.0))      # curva de potencia simplificada de un aerogenerador
            elif role == "s" and sr is not None:
                a["s"].append(sr / 1000.0)
            elif role == "t" and tt is not None:
                a["t"].append(abs(tt - 18.0) / 10.0)                     # demanda por frío o calor
    out = {}
    for key, a in acc.items():
        if a["w"] and a["s"] and a["t"]:
            out[key] = (sum(a["w"]) / len(a["w"]), sum(a["s"]) / len(a["s"]), sum(a["t"]) / len(a["t"]))
    return out


def finde(k):
    d = date.fromisoformat(k)
    return d.weekday() >= 5 or k[5:] in FESTIVOS


def feats(k, h, w, level):
    x = [0.0] * 24
    x[h] = 1.0
    return x + [w[0], w[1], w[2], 1.0 if finde(k) else 0.0, level, w[0] * level]


def solve(rows, lam=1e-3):
    """Mínimos cuadrados ponderados con un poco de regularización. rows: [(x, y, peso)]."""
    n = len(rows[0][0])
    A = [[0.0] * n for _ in range(n)]
    b = [0.0] * n
    for x, y, wt in rows:
        for i in range(n):
            if x[i] == 0:
                continue
            xi = x[i] * wt
            b[i] += xi * y
            Ai = A[i]
            for j in range(n):
                if x[j] != 0:
                    Ai[j] += xi * x[j]
    for i in range(n):
        A[i][i] += lam
    # Eliminación de Gauss con pivote parcial
    M = [A[i] + [b[i]] for i in range(n)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(M[r][c]))
        M[c], M[p] = M[p], M[c]
        if abs(M[c][c]) < 1e-12:
            continue
        for r in range(n):
            if r != c and M[r][c] != 0:
                f = M[r][c] / M[c][c]
                M[r] = [a - f * bb for a, bb in zip(M[r], M[c])]
    return [M[i][n] / M[i][i] if abs(M[i][i]) > 1e-12 else 0.0 for i in range(n)]


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def level_before(spot, k, n=7):
    d = date.fromisoformat(k)
    v = []
    for i in range(1, n + 1):
        kk = (d - timedelta(days=i)).isoformat()
        v += [x for x in spot.get(kk, []) if x is not None]
    return sum(v) / len(v) if v else None


def train(spot, W, days, ref_day):
    rows = []
    for k in days:
        lv = level_before(spot, k)
        if lv is None:
            continue
        age = (date.fromisoformat(ref_day) - date.fromisoformat(k)).days
        wt = 0.5 ** (age / 30.0)
        for h, y in enumerate(spot[k]):
            if y is None or (k, h) not in W:
                continue
            rows.append((feats(k, h, W[(k, h)], lv), y, wt))
    return solve(rows) if len(rows) > 24 * 20 else None


def adders(days_p, spot, upto, n=28):
    """Lo que el PVPC suma al mercado en cada hora (laborable / fin de semana): mediana de las últimas semanas."""
    acc = {}
    ks = sorted(k for k in days_p if k <= upto and k in spot)[-n:]
    for k in ks:
        for h in range(24):
            p, s = days_p[k][h], spot[k][h] if h < len(spot[k]) else None
            if p is not None and s is not None:
                acc.setdefault((finde(k), h), []).append(p - s)
    med = {}
    for key, v in acc.items():
        v.sort()
        med[key] = v[len(v) // 2]
    return med


def predict_day(coef, k, W, lv, add):
    hs = []
    for h in range(24):
        w = W.get((k, h))
        if w is None:
            return None
        s = max(dot(coef, feats(k, h, w, lv)), -0.005)
        hs.append(round(s + add.get((finde(k), h), 0.0), 5))
    return hs


def run(root, data, now):
    days_p, spot = data.get("days", {}), data.get("spot", {})
    today = now.strftime("%Y-%m-%d")
    pub = sorted(k for k, v in days_p.items() if sum(x is not None for x in v) >= 23)
    if len(pub) < 60 or len(spot) < 60:
        print("Previsión: faltan datos históricos")
        return
    last = pub[-1]
    W = weather()
    hist = sorted(k for k in spot if k <= last and k in days_p)
    train_days = hist[-90:]
    # Prueba con las 2 últimas semanas (entrena sin ellas y compara con lo que pasó, con el tiempo real)
    test = train_days[-14:]
    coef_t = train(spot, W, train_days[:-14], test[0])
    add_t = adders(days_p, spot, train_days[-15])
    errs = []
    if coef_t:
        for k in test:
            lv = level_before(spot, k)
            p = predict_day(coef_t, k, W, lv, add_t) if lv is not None else None
            if p:
                real = [x for x in days_p[k] if x is not None]
                errs.append(abs(sum(p) / 24 - sum(real) / len(real)))
    mae = sum(errs) / len(errs) if errs else 0.02
    coef = train(spot, W, train_days, last)
    if not coef:
        print("Previsión: no se pudo entrenar el modelo")
        return
    add = adders(days_p, spot, last)
    # Nivel de partida: la última semana publicada
    lv = level_before(spot, (date.fromisoformat(last) + timedelta(days=1)).isoformat())
    wind_d = {}
    sun_d = {}
    for (k, h), w in W.items():
        wind_d.setdefault(k, []).append(w[0])
        sun_d.setdefault(k, []).append(w[1])
    recent = set(train_days[-30:])   # «mucho/poco» viento o sol, comparado con el último mes
    ref_w = sorted(sum(v) / len(v) for k, v in wind_d.items() if k in recent)
    ref_s = sorted(sum(v) / len(v) for k, v in sun_d.items() if k in recent)
    q = lambda arr, f: arr[int(f * (len(arr) - 1))] if arr else 0
    out_days = []
    d0 = date.fromisoformat(last) + timedelta(days=1)
    for i in range(0, 8):
        k = (d0 + timedelta(days=i)).isoformat()
        if (date.fromisoformat(k) - date.fromisoformat(today)).days > 7:
            break
        p = predict_day(coef, k, W, lv, add)
        if not p:
            continue
        horizon = (date.fromisoformat(k) - date.fromisoformat(today)).days
        m = sum(p) / 24
        band = mae * (1.4 + 0.3 * max(horizon - 1, 0))
        wv, sv = sum(wind_d[k]) / len(wind_d[k]), sum(sun_d[k]) / len(sun_d[k])
        motivo = []
        if wv >= q(ref_w, 0.75):
            motivo.append("mucho viento")
        elif wv <= q(ref_w, 0.25):
            motivo.append("poco viento")
        if sv >= q(ref_s, 0.75):
            motivo.append("mucho sol")
        elif sv <= q(ref_s, 0.25):
            motivo.append("poco sol")
        if finde(k):
            motivo.append("fin de semana o festivo")
        out_days.append({"k": k, "h": p, "media": round(m, 5), "lo": round(max(m - band, 0), 5), "hi": round(m + band, 5),
                         "conf": "alta" if horizon <= 3 else "media" if horizon <= 5 else "baja", "motivo": motivo})
    if not out_days:
        print("Previsión: sin días que estimar")
        return
    # Histórico de aciertos: se guarda la estimación hecha con 2 o 3 días de antelación y se compara al publicarse el precio real
    hp = os.path.join(root, "data", "prevision_hist.json")
    H = {"pred": {}}
    if os.path.exists(hp):
        with open(hp, encoding="utf-8") as f:
            H = json.load(f)
    for d in out_days:
        hz = (date.fromisoformat(d["k"]) - date.fromisoformat(today)).days
        if hz in (2, 3) and d["k"] not in H["pred"]:
            H["pred"][d["k"]] = {"m": d["media"], "hz": hz, "g": today}
    real_err = []
    for k, v in sorted(H["pred"].items())[-60:]:
        if k in days_p and k in pub:
            real = [x for x in days_p[k] if x is not None]
            r = sum(real) / len(real)
            real_err.append({"k": k, "est": v["m"], "real": round(r, 5)})
    H["pred"] = dict(sorted(H["pred"].items())[-120:])
    with open(hp, "w", encoding="utf-8") as f:
        json.dump(H, f, ensure_ascii=False, separators=(",", ":"))
    last30 = real_err[-30:]
    acierto = None
    if len(last30) >= 5:
        acierto = {"n": len(last30), "error_medio": round(sum(abs(x["est"] - x["real"]) for x in last30) / len(last30), 5),
                   "error_pct": round(100 * sum(abs(x["est"] - x["real"]) / x["real"] for x in last30 if x["real"] > 0) / len(last30), 1),
                   "ultimos": last30[-7:]}
    out = {"generado": now.isoformat(timespec="minutes"), "ultimo_publicado": last, "dias": out_days,
           "error_prueba": round(mae, 5), "acierto": acierto,
           "metodo": "Regresión con la previsión de viento, sol y temperatura de Open-Meteo y los precios de los últimos 90 días"}
    with open(os.path.join(root, "data", "prevision.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Previsión: {len(out_days)} días; error de prueba {mae * 1000:.1f} €/MWh en la media diaria")

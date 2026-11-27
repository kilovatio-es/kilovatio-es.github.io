/* Kilovatio — perfil horario de un hogar: convierte un consumo anual y unas costumbres en kWh hora a hora.
   Lo usan el comparador (en el navegador, window.KVperfil) y el robot que genera «Mejores tarifas de luz» (Node). */
(function (root) {
  var period = (root.KVcomp || (typeof require !== "undefined" ? require("./comparador.js") : {})).period;
  /* ---------- Perfil horario de un hogar ---------- */
  // Reparto típico del consumo de un hogar español a lo largo del día (laborable y fin de semana)
  var LAB = [.030, .024, .021, .020, .020, .022, .028, .036, .040, .040, .040, .041, .043, .047, .050, .044, .040, .041, .046, .054, .062, .064, .058, .044];
  var FIN = [.034, .027, .023, .021, .020, .021, .023, .028, .036, .043, .047, .049, .050, .053, .052, .046, .041, .041, .044, .050, .056, .057, .052, .042];
  // Peso de cada mes (más en invierno por calefacción y luz, algo más en verano por el aire)
  var MES = [1.20, 1.10, 1.00, 0.88, 0.85, 0.92, 1.05, 1.05, 0.92, 0.88, 1.00, 1.15];
  // Producción solar: kWh por kWp y día (media peninsular) y medio arco solar en horas
  var SOL = [2.7, 3.4, 4.4, 5.1, 5.7, 6.2, 6.4, 5.8, 4.8, 3.7, 2.8, 2.4];
  var ARCO = [4.7, 5.2, 5.9, 6.6, 7.2, 7.5, 7.4, 6.9, 6.2, 5.5, 4.9, 4.6];

  function habitMul(habito, finde, h) {
    if (finde) return 1;
    if (habito === "fuera") return h >= 9 && h < 17 ? 0.45 : (h >= 19 && h < 23 ? 1.25 : 1);
    if (habito === "casa") return h >= 9 && h < 18 ? 1.45 : 1;
    if (habito === "noche") return h >= 18 && h < 23 ? 0.8 : 1;
    return 1;
  }
  function noche(habito, h) { return habito === "noche" && h >= 0 && h < 7 ? 1.9 : 1; }

  /* Construye { days, exp } con kWh de red cada hora.
     p: { anual (kWh de red al año), habito, cocheKm, kwp, per: {p1,p2,p3} cuota objetivo o null } */
  function synth(p, keys) {
    var car = 0;
    if (p.cocheKm > 0) car = Math.min(p.cocheKm * 0.17, p.anual * 0.7);
    var base = {}, sum = 0;
    keys.forEach(function (k) {
      var dt = new Date(k + "T12:00:00Z"), wd = dt.getUTCDay(), m = dt.getUTCMonth(), fin = wd === 0 || wd === 6;
      var sh = fin ? FIN : LAB, w = MES[m] * (fin ? 1.08 : 1);
      base[k] = sh.map(function (v, h) { var x = v * w * habitMul(p.habito, fin, h) * noche(p.habito, h); sum += x; return x; });
    });
    // Ajuste al reparto punta/llano/valle de la factura, si lo hay
    if (p.per) {
      var s = { p1: 0, p2: 0, p3: 0 };
      keys.forEach(function (k) { base[k].forEach(function (v, h) { s[period(k, h)] += v; }); });
      var f = {}; ["p1", "p2", "p3"].forEach(function (q) { f[q] = s[q] > 0 ? p.per[q] * sum / s[q] : 0; });
      keys.forEach(function (k) { base[k] = base[k].map(function (v, h) { return v * f[period(k, h)]; }); });
      car = 0;   // el reparto real ya incluye la recarga
    }
    // Producción solar por hora
    var prod = {};
    if (p.kwp > 0) keys.forEach(function (k) {
      var m = +k.slice(5, 7) - 1, c = m >= 3 && m <= 9 ? 14 : 13, W = ARCO[m], arr = new Array(24).fill(0), tot = 0;
      for (var h = 0; h < 24; h++) { var x = (h + 0.5 - c) / W; if (Math.abs(x) < 1) { arr[h] = Math.cos(x * Math.PI / 2); tot += arr[h]; } }
      var e = SOL[m] * p.kwp * 0.9;
      prod[k] = arr.map(function (v) { return tot ? v / tot * e : 0; });
    });
    var carH = car / 365 / 5;   // la recarga, repartida entre la 1 y las 6 de la madrugada
    function build(scale) {
      var days = {}, exp = p.kwp > 0 ? {} : null, grid = 0;
      keys.forEach(function (k) {
        var d = new Array(24), x = new Array(24);
        for (var h = 0; h < 24; h++) {
          var load = base[k][h] * scale + (car && h >= 1 && h < 6 ? carH : 0);
          var pr = prod[k] ? prod[k][h] : 0, self = Math.min(load, pr);
          d[h] = load - self; x[h] = pr - self; grid += d[h];
        }
        days[k] = d; if (exp) exp[k] = x;
      });
      return { days: days, exp: exp, grid: grid };
    }
    // Escala para que la energía de red del año coincida con la de la factura (con placas, por aproximaciones)
    var target = Math.max(p.anual - (car ? car : 0), 0) * keys.length / 365, carYear = car * keys.length / 365;
    var scale = sum ? target / sum : 0, r = build(scale);
    for (var i = 0; i < 6 && p.kwp > 0; i++) {
      var want = target + carYear, got = r.grid;
      if (got <= 0) { scale *= 2; } else scale *= want / got;
      r = build(scale);
    }
    return r;
  }

  function seasonFactor(mesIdx) { var m = MES.reduce(function (a, b) { return a + b; }, 0) / 12; return MES[mesIdx] / m; }

  var api = { synth: synth, seasonFactor: seasonFactor };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.KVperfil = api;
})(typeof window !== "undefined" ? window : this);

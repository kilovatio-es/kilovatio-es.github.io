/* Kilovatio — lector de archivos de consumo horario (Datadis, distribuidoras y comercializadoras).
   Lo usan Mi Kilovatio y el comparador de tarifas. */
(function () {
  function num(s) {
    s = String(s == null ? "" : s).trim().replace(/\s/g, "");
    if (!s) return NaN;
    if (/,\d+$/.test(s) && s.indexOf(".") >= 0) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(",", ".");
    return parseFloat(s);
  }
  function parseDate(s) {
    s = String(s).trim(); var m;
    if ((m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/))) return [+m[1], +m[2], +m[3], s.slice(m[0].length)];
    if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/))) return [+m[3], +m[2], +m[1], s.slice(m[0].length)];
    return null;
  }
  function key(y, mo, d) { return y + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0"); }
  function parseConsumo(text) {
    text = text.replace(/^﻿/, "");
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (lines.length < 5) throw new Error("El archivo está vacío o tiene muy pocas filas.");
    var sample = lines.slice(0, 5).join("\n");
    var delim = [";", "\t", ",", "|"].map(function (d) { return [d, sample.split(d).length]; }).sort(function (a, b) { return b[1] - a[1]; })[0][0];
    var hi = -1, H;
    for (var i = 0; i < Math.min(lines.length, 30); i++) {
      var cells = lines[i].split(delim).map(function (c) { return c.replace(/^"|"$/g, "").trim(); });
      if (cells.some(function (c) { return /fecha|date|d[ií]a/i.test(c); })) { hi = i; H = cells; break; }
    }
    if (hi < 0) throw new Error("No encuentro la fila de títulos (una columna «Fecha»). ¿Es el archivo de consumo horario en CSV?");
    var low = H.map(function (c) { return c.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); });
    var find = function (re, not) { for (var j = 0; j < low.length; j++) if (re.test(low[j]) && !(not && not.test(low[j]))) return j; return -1; };
    var cDate = find(/fecha|date|^dia/), cHour = find(/^hora|hour|periodo|^h$/, /fecha/);
    var EXP = /vert|export|exced|as_?kwh|inyect|salida|generad|^as$/;
    var cExp = find(EXP);
    var cImp = find(/consumo|ae_?kwh|^ae$|import|entrante|activa|kwh|energia|valor|lectura/, new RegExp(EXP.source + "|fecha|hora|cups|metodo|tipo|obten|real"));
    if (cImp < 0) throw new Error("No encuentro la columna de consumo (por ejemplo «Consumo_kWh» o «AE_kWh»).");
    var wh = /(^|[^k])wh/.test(low[cImp]) && !/kwh/.test(low[cImp]);
    var cups = (lines[hi + 1].split(delim)[find(/cups/)] || "").replace(/"/g, "");
    var acc = {}, hours = [], bad = 0, n = 0;
    for (var r = hi + 1; r < lines.length; r++) {
      var c = lines[r].split(delim).map(function (x) { return x.replace(/^"|"$/g, "").trim(); });
      var dt = parseDate(c[cDate] || ""); if (!dt) { bad++; continue; }
      var hs = cHour >= 0 ? c[cHour] : dt[3], hm = String(hs || "").match(/(\d{1,2})(?::(\d{2}))?/);
      if (!hm) { bad++; continue; }
      var imp = num(c[cImp]), exp = cExp >= 0 ? num(c[cExp]) : 0;
      if (!isFinite(imp)) { bad++; continue; }
      if (!isFinite(exp)) exp = 0;
      hours.push(+hm[1]);
      var k = key(dt[0], dt[1], dt[2]); (acc[k] = acc[k] || []).push([+hm[1], imp, exp]); n++;
    }
    if (n < 24) throw new Error("No he podido leer suficientes filas con fecha, hora y consumo.");
    var minH = Math.min.apply(null, hours), maxH = Math.max.apply(null, hours);
    var shift = (minH >= 1 && maxH >= 24) || (minH === 1 && maxH === 24) ? 1 : 0;   // formato 1–24 (hora que termina)
    var vals = []; Object.keys(acc).forEach(function (k) { acc[k].forEach(function (x) { vals.push(x[1]); }); });
    vals.sort(function (a, b) { return a - b; });
    var factor = wh || vals[Math.floor(vals.length / 2)] > 50 ? 1 / 1000 : 1;
    var days = {}, exps = {}, anyExp = false;
    Object.keys(acc).sort().forEach(function (k) {
      var d = new Array(24).fill(0), e = new Array(24).fill(0), seen = new Array(24).fill(0);
      acc[k].forEach(function (x) {
        var h = x[0] - shift; if (h > 23) h = 2; if (h < 0) h = 0;   // hora 25 del cambio de hora de octubre
        d[h] += x[1] * factor; e[h] += x[2] * factor; seen[h] = 1;
      });
      if (seen.reduce(function (s, x) { return s + x; }, 0) < 20) return;  // día incompleto
      days[k] = d.map(function (v) { return Math.round(v * 1000) / 1000; });
      if (e.some(function (v) { return v > 0; })) { anyExp = true; exps[k] = e.map(function (v) { return Math.round(v * 1000) / 1000; }); }
    });
    var nd = Object.keys(days).length;
    if (nd < 1) throw new Error("El archivo no tiene ningún día completo.");
    return { days: days, exp: anyExp ? exps : null, cups: cups, ndays: nd, skipped: bad, wh: factor !== 1 };
  }
  window.KVparseConsumo = parseConsumo;
})();

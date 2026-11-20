/* Kilovatio — utilidades comunes */
window.KV = (function () {
  var eur0 = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0, useGrouping: "always" });
  var eur2 = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" });
  var n0 = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0, useGrouping: "always" });
  var n1 = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: "always" });
  var n3 = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  function $(id) { return document.getElementById(id); }
  function val(id) { var x = parseFloat(($(id) || {}).value); return isFinite(x) && x >= 0 ? x : 0; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function kv(el, rows) {
    el.innerHTML = rows.map(function (r) {
      return '<div' + (r[2] ? ' class="tot"' : '') + '><span>' + r[0] + '</span><span>' + r[1] + '</span></div>';
    }).join("");
  }
  function bars(el, items, cls) {
    var max = Math.max.apply(null, items.map(function (i) { return i[1]; }).concat([1e-9]));
    el.innerHTML = items.map(function (it) {
      return '<div class="bar"><div class="lab"><span>' + esc(it[0]) + '</span><span>' + it[2] + '</span></div>' +
        '<div class="track"><div class="fill ' + (it[3] || cls || "") + '" style="width:' + Math.max(0, it[1] / max * 100) + '%"></div></div></div>';
    }).join("");
  }
  /* Gráfico de columnas en SVG. data: [{label, value, color}] */
  function columns(svg, data, opts) {
    opts = opts || {};
    var W = 640, H = opts.height || 240, L = opts.left || 44, R = 8, T = 12, B = 26;
    var vals = data.map(function (d) { return d.value; });
    var max = opts.max || Math.max.apply(null, vals.concat([1e-9]));
    var min = Math.min.apply(null, vals.concat([0]));
    var step = niceStep((max - min) / 4);
    var top = Math.ceil(max / step) * step || step;
    var bot = Math.floor(min / step) * step;
    var Y = function (v) { return T + (H - T - B) * (top - v) / (top - bot); };
    var cw = (W - L - R) / data.length;
    var out = [];
    for (var y = bot; y <= top + 1e-9; y += step) {
      var py = Y(y), zero = Math.abs(y) < 1e-9;
      out.push('<line class="axis" x1="' + L + '" x2="' + (W - R) + '" y1="' + py + '" y2="' + py + '" stroke-dasharray="' + (zero ? "0" : "2 3") + '"/>');
      out.push('<text x="' + (L - 6) + '" y="' + (py + 4) + '" text-anchor="end">' + (opts.yfmt ? opts.yfmt(y) : y) + '</text>');
    }
    data.forEach(function (d, i) {
      var y1 = Y(Math.max(d.value, 0)), y2 = Y(Math.min(d.value, 0));
      var x = L + i * cw + cw * 0.12, w = cw * 0.76;
      out.push('<rect x="' + x + '" y="' + y1 + '" width="' + w + '" height="' + Math.max(y2 - y1, 0) + '" rx="2" fill="' + (d.color || "var(--sun)") + '"' + (d.stroke ? ' stroke="var(--ink)" stroke-width="1.5"' : '') + '><title>' + esc(d.title || (d.label + ": " + d.value)) + '</title></rect>');
      if (!opts.labelEvery || i % opts.labelEvery === 0) {
        out.push('<text x="' + (L + i * cw + cw / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(d.label) + '</text>');
      }
    });
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.innerHTML = out.join("");
  }
  function niceStep(x) {
    if (!(x > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(x))), f = x / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function onInput(form, fn) {
    form.addEventListener("input", fn);
    form.addEventListener("change", fn);
    form.addEventListener("submit", function (e) { e.preventDefault(); });
    fn();
  }
  /* ---------- Datos reales (data/energia.json, actualizado por GitHub Actions) ---------- */
  var TZ = "Europe/Madrid";
  function dayKey(offset) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
      .format(new Date(Date.now() + (offset || 0) * 864e5));
  }
  function nowHour() {
    return parseInt(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(new Date()), 10);
  }
  function fmtDate(k) { var p = k.split("-"); return p[2] + "/" + p[1] + "/" + p[0]; }
  var MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  function monthName(ym) { var p = ym.split("-"); return MESES[+p[1] - 1] + " de " + p[0]; }
  function period(dayK, h) {
    var wd = new Date(dayK + "T12:00:00Z").getUTCDay();
    if (wd === 0 || wd === 6 || h < 8) return "valle";
    return (h >= 10 && h < 14) || (h >= 18 && h < 22) ? "punta" : "llano";
  }
  /* Impuestos de la luz por fecha (data/referencias.json → energia.json). Por defecto, tipos generales. */
  var SCHED = [];
  function taxInfo(k) {
    k = k || dayKey(0);
    for (var i = 0; i < SCHED.length; i++) {
      var t = SCHED[i];
      if (t.desde <= k && (t.hasta == null || k <= t.hasta)) return { iva: t.iva, iee: t.iee, norma: t.norma, resumen: t.resumen || "Tipo vigente hoy", factor: (1 + t.iee / 100) * (1 + t.iva / 100) };
    }
    return { iva: 21, iee: 5.11269632, norma: "Tipos generales", resumen: "Tipo general", factor: 1.0511269632 * 1.21 };
  }
  function pctTxt(x) { return String(Math.round(x * 100) / 100).replace(".", ",") + " %"; }
  function setTax() {
    var t = taxInfo();
    api.TAX = t.factor; api.IVA = t.iva / 100; api.IEE = t.iee / 100;
    document.querySelectorAll(".kv-iva").forEach(function (e) { e.textContent = pctTxt(t.iva); });
    document.querySelectorAll(".kv-iee").forEach(function (e) { e.textContent = pctTxt(t.iee); });
  }
  var dataP = null;
  function data() {
    if (!dataP) dataP = fetch("data/energia.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (d) { if (d && d.tax) { SCHED = d.tax; setTax(); } return d && d.days ? d : null; })
      .catch(function () { return null; });
    return dataP;
  }
  function stats(d) {
    var keys = Object.keys(d.days).sort(), today = dayKey(0);
    var past = keys.filter(function (k) { return k <= today; });
    function avg(list) {
      var s = 0, n = 0, per = { punta: [0, 0], llano: [0, 0], valle: [0, 0] }, hours = [];
      for (var i = 0; i < 24; i++) hours.push([0, 0]);
      list.forEach(function (k) { d.days[k].forEach(function (v, h) {
        if (v == null) return; s += v; n++; var p = per[period(k, h)]; p[0] += v; p[1]++; hours[h][0] += v; hours[h][1]++;
      }); });
      return { avg: n ? s / n : null, days: list.length,
        punta: per.punta[1] ? per.punta[0] / per.punta[1] : null, llano: per.llano[1] ? per.llano[0] / per.llano[1] : null,
        valle: per.valle[1] ? per.valle[0] / per.valle[1] : null,
        hours: hours.map(function (x) { return x[1] ? x[0] / x[1] : null; }) };
    }
    var ym = today.slice(0, 7);
    var prevD = new Date(today + "T12:00:00Z"); prevD.setUTCDate(1); prevD.setUTCMonth(prevD.getUTCMonth() - 1);
    var pym = prevD.toISOString().slice(0, 7);
    return {
      last: past[past.length - 1], last30: avg(past.slice(-30)),
      month: { ym: ym, s: avg(past.filter(function (k) { return k.slice(0, 7) === ym; })) },
      prev: { ym: pym, s: avg(keys.filter(function (k) { return k.slice(0, 7) === pym; })) },
      fuel: d.fuel, updated: d.updated, rec: d.recargaRef
    };
  }
  /* Pone valores por defecto con datos reales en los campos que la persona no ha tocado. */
  document.addEventListener("input", function (e) { if (e.target && e.target.dataset) e.target.dataset.touched = "1"; }, true);
  function applyLive(map, form, render, label) {
    data().then(function (d) {
      if (!d) return;
      var s = stats(d), changed = false;
      var values = map(s);
      Object.keys(values).forEach(function (id) {
        var el = $(id), v = values[id];
        if (el && v != null && isFinite(v) && !el.dataset.touched) { el.value = (Math.round(v * 1000) / 1000).toString(); changed = true; }
      });
      if (!changed) return;
      var note = document.createElement("div");
      note.className = "callout good";
      note.innerHTML = "<b>Precios reales.</b> " + label(s) + " Actualizado el " + fmtDate(s.last) + " con datos de Red Eléctrica" + (s.fuel ? " y del Ministerio para la Transición Ecológica" : "") + ".";
      form.insertBefore(note, form.firstChild);
      render();
    });
  }

  var api = { $: $, val: val, esc: esc, kv: kv, bars: bars, columns: columns, onInput: onInput, taxInfo: taxInfo, pctTxt: pctTxt,
    data: data, stats: stats, applyLive: applyLive, dayKey: dayKey, nowHour: nowHour, fmtDate: fmtDate, monthName: monthName, period: period,
    eur0: eur0.format, eur2: eur2.format, n0: n0.format, n1: n1.format, n3: n3.format,
    TAX: 1.0511269632 * 1.21, IVA: 0.21, IEE: 0.0511269632 };
  document.addEventListener("DOMContentLoaded", function () { if (document.querySelector(".kv-iva,.kv-iee")) data(); });
  return api;
})();

/* Cloudflare Web Analytics: cuenta visitas sin cookies. Solo en la web publicada. */
(function () {
  if (location.hostname.indexOf("kilovatio") === -1) return;
  var s = document.createElement("script");
  s.defer = true;
  s.src = "https://static.cloudflareinsights.com/beacon.min.js";
  s.setAttribute("data-cf-beacon", '{"token": "9e28635f1e6f4ffd9925cc7431e93425"}');
  document.head.appendChild(s);
})();

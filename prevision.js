/* Kilovatio — próximos días: precio oficial de hoy y mañana y estimación de los siguientes (data/prevision.json). */
(function () {
  var box = document.getElementById("prev"), L = window.LUZ;
  if (!box) return;
  if (!L || (L.kind !== "hoy" && L.kind !== "manana")) { box.remove(); return; }
  var DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"], DIASL = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  function n3(x) { return x.toFixed(3).replace(".", ","); }
  function hh(h) { return String(h % 24).padStart(2, "0") + ":00"; }
  function dd(k) { return new Date(k + "T12:00:00Z"); }
  function label(k, today) {
    var d = dd(k), diff = Math.round((d - dd(today)) / 864e5);
    return diff === 0 ? "Hoy" : diff === 1 ? "Mañana" : DIAS[d.getUTCDay()] + " " + d.getUTCDate();
  }
  function longName(k, today) {
    var d = dd(k), diff = Math.round((d - dd(today)) / 864e5);
    return (diff === 0 ? "hoy " : diff === 1 ? "mañana " : "el ") + DIASL[d.getUTCDay()] + " " + d.getUTCDate();
  }
  Promise.all([KV.data(), fetch("data/prevision.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })])
    .then(function (a) {
      var D = a[0], P = a[1]; if (!D) { box.remove(); return; }
      var today = KV.dayKey(0), ST = KV.stats(D), ref = ST && ST.last30 ? ST.last30.avg : null;
      var days = [];
      [0, 1].forEach(function (o) {
        var k = KV.dayKey(o), p = D.days[k];
        if (p && p.filter(function (x) { return x != null; }).length >= 23) {
          var f = KV.taxInfo(k).factor, v = p.filter(function (x) { return x != null; });
          days.push({ k: k, real: true, h: p.map(function (x) { return x == null ? null : x * f; }), m: v.reduce(function (s, x) { return s + x; }, 0) / v.length * f });
        }
      });
      if (P && P.dias) P.dias.forEach(function (d) {
        if (d.k < today || days.some(function (x) { return x.k === d.k; })) return;
        var f = KV.taxInfo(d.k).factor;
        days.push({ k: d.k, real: false, h: d.h.map(function (x) { return x * f; }), m: d.media * f, lo: d.lo * f, hi: d.hi * f, conf: d.conf, motivo: d.motivo || [] });
      });
      days.sort(function (x, y) { return x.k < y.k ? -1 : 1; });
      days = days.slice(0, 8);
      if (days.length < 3) { box.remove(); return; }
      var tomorrowPending = !days.some(function (d) { return d.k === KV.dayKey(1) && d.real; });
      var fut = days.filter(function (d) { return d.k > today; });
      var best = fut.reduce(function (b, d) { return !b || d.m < b.m ? d : b; }, null);
      var worst = fut.reduce(function (b, d) { return !b || d.m > b.m ? d : b; }, null);
      var mx = Math.max.apply(null, days.map(function (d) { return d.hi || d.m; }));
      function lvl(m) { return !ref ? "mid" : m < ref * 0.9 ? "good" : m > ref * 1.1 ? "bad" : "mid"; }
      function ico(d) {
        return (d.motivo || []).map(function (m) {
          return m.indexOf("viento") >= 0 ? '<span title="' + m + '">' + (m.indexOf("mucho") === 0 ? "💨" : "🍃") + "</span>" :
            m.indexOf("sol") >= 0 ? '<span title="' + m + '">' + (m.indexOf("mucho") === 0 ? "☀️" : "☁️") + "</span>" : "";
        }).join("");
      }
      var cards = days.map(function (d, i) {
        return '<button type="button" class="pd ' + lvl(d.m) + (d.real ? " real" : "") + '" data-i="' + i + '" aria-pressed="false">' +
          '<span class="pd-d">' + label(d.k, today) + "</span>" +
          '<b class="num">' + n3(d.m) + "</b>" +
          '<span class="pd-bar"><i style="height:' + Math.max(d.m / mx * 100, 6).toFixed(0) + '%"></i></span>' +
          '<span class="pd-t">' + (d.real ? "Oficial" : "Estimado") + "</span>" +
          (d.real ? "" : '<span class="pd-r num">' + n3(d.lo).slice(0, 4) + "–" + n3(d.hi).slice(0, 4) + "</span>") +
          '<span class="pd-i">' + ico(d) + "</span></button>";
      }).join("");
      var head = "";
      if (best && best !== worst) {
        var why = (best.motivo || []).filter(function (m) { return /mucho viento|mucho sol|fin de semana/.test(m); });
        head = "<p class=\"prev-lead\">El día más barato de los próximos días será probablemente <b>" + longName(best.k, today) + "</b> (" +
          (best.real ? "" : "unos ") + n3(best.m) + " €/kWh de media" + (why.length ? ", gracias a " + (function (w) { w = w.map(function (m) { return m === "mucho viento" ? "el viento" : m === "mucho sol" ? "el sol" : "ser fin de semana o festivo"; }); return w.length > 1 ? w.slice(0, -1).join(", ") + " y " + w[w.length - 1] : w[0]; })(why) : "") + "). " +
          "Si puedes, deja para ese día la lavadora, el lavavajillas o la carga del coche." +
          (worst && worst.m > best.m * 1.15 ? " El más caro, " + longName(worst.k, today) + "." : "") + "</p>";
      }
      var ac = P && P.acierto ? "Así acertamos: en los últimos " + P.acierto.n + " días, nuestra estimación hecha con 2 o 3 días de antelación se desvió de media un " +
        String(P.acierto.error_pct).replace(".", ",") + " % del precio real." : "Medimos cada día cuánto se desvían nuestras estimaciones del precio real; pronto verás aquí nuestro porcentaje de acierto.";
      box.innerHTML = '<section class="block prev" aria-labelledby="h-prev"><header><p class="eyebrow">Previsión de Kilovatio</p>' +
        '<h2 id="h-prev">El precio de la luz los próximos días</h2></header>' + head +
        '<div class="pdays" role="group" aria-label="Días">' + cards + "</div>" +
        '<div class="pdet" id="pdet"></div>' +
        '<p class="note"><b>Los días «Estimado» no son el precio oficial.</b> Son una estimación de Kilovatio a partir de la previsión de viento, sol y temperatura y de los precios de las últimas semanas, con su margen probable (de menos a más seguro cuanto más cerca está el día). ' +
        "Red Eléctrica publica el precio oficial de cada día la tarde anterior, hacia las 20:15" + (tomorrowPending ? "; el de mañana aparecerá aquí en cuanto salga" : "") + ". " + ac + " Actualizamos la estimación varias veces al día.</p></section>";
      function show(i) {
        var d = days[i];
        box.querySelectorAll(".pd").forEach(function (b) { b.setAttribute("aria-pressed", String(+b.dataset.i === i)); });
        var hs = d.h, best3 = null;
        for (var s = 0; s + 3 <= 24; s++) { var seg = hs.slice(s, s + 3); if (seg.some(function (x) { return x == null; })) continue; var av = (seg[0] + seg[1] + seg[2]) / 3; if (!best3 || av < best3[1]) best3 = [s, av]; }
        var pts = []; hs.forEach(function (p, h) { if (p != null) pts.push({ h: h, p: p }); });
        var vals = pts.map(function (x) { return x.p; }).sort(function (a, b) { return a - b; }), q1 = vals[Math.floor(vals.length / 3)], q2 = vals[Math.floor(vals.length * 2 / 3)];
        $det.innerHTML = '<div class="pdet-h"><h3>' + (d.real ? "Precio oficial de " : "Estimación para ") + longName(d.k, today) + "</h3>" +
          (d.real ? '<a href="precio-luz-' + d.k + '.html">Ver el día completo →</a>' : '<span class="badge">Estimación · confianza ' + d.conf + "</span>") + "</div>" +
          (best3 ? '<p>Mejores 3 horas' + (d.real ? "" : " previstas") + ": <b>" + hh(best3[0]) + "–" + hh(best3[0] + 3) + "</b> (" + n3(best3[1]) + " €/kWh)." +
            (d.real ? "" : " Margen probable de la media del día: " + n3(d.lo) + " a " + n3(d.hi) + " €/kWh.") + "</p>" : "") +
          '<svg class="chart" id="pchart" role="img" aria-label="Precio por horas"></svg>';
        KV.columns(document.getElementById("pchart"), pts.map(function (x) {
          return { label: String(x.h).padStart(2, "0"), value: x.p, title: hh(x.h) + " · " + (d.real ? "" : "≈ ") + n3(x.p) + " €/kWh",
            color: x.p < q1 ? "var(--good)" : x.p >= q2 ? "var(--bad)" : "var(--mid)" };
        }), { height: 200, labelEvery: 3, yfmt: function (v) { return v.toFixed(2).replace(".", ","); } });
        if (!d.real) document.getElementById("pchart").classList.add("est");
      }
      var $det = document.getElementById("pdet");
      box.querySelector(".pdays").addEventListener("click", function (e) { var b = e.target.closest(".pd"); if (b) show(+b.dataset.i); });
      show(days.indexOf(best && !best.real ? best : days[Math.min(days.length - 1, 2)]));
    });
})();

/* Kilovatio — «¿Lo pongo ahora o espero?»: para el aparato elegido compara ponerlo ya con la mejor franja
   de las próximas 24 horas (hoy y, si ya se ha publicado, mañana). En la página de mañana, la mejor franja de mañana. */
(function () {
  var L = window.LUZ, box = document.getElementById("ahora-res"), pick = document.querySelector(".apps-pick");
  if (!L || !box || !pick) return;
  var EMO = ["🧺", "🍽️", "🌀", "🔥", "🚿", "🚗", "♨️"];
  pick.querySelectorAll("button").forEach(function (b, i) { b.textContent = (EMO[i] || "") + " " + b.textContent; });
  // Horno y radiador se usan cuando estás en casa: no proponemos ponerlos de madrugada
  var AWAKE = { 3: [7, 23], 6: [6, 24] };
  function hh(h) { return String(h % 24).padStart(2, "0") + ":00"; }
  function e2(x) { return KV.eur2(x); }
  var nowH = KV.nowHour(), today = KV.dayKey(0), live = L.kind === "hoy" && L.date === today;
  var series = [];   // [{d: "hoy"|"mañana", h, p}]
  function build(tom) {
    series = [];
    var start = live ? nowH : 0;
    for (var h = start; h < 24; h++) if (L.p[h] != null) series.push({ d: L.kind === "manana" ? "mañana" : "hoy", h: h, p: L.p[h] });
    if (live && tom) for (var h2 = 0; h2 < 24 && series.length < 24; h2++) if (tom[h2] != null) series.push({ d: "mañana", h: h2, p: tom[h2] });
  }
  function render() {
    var b = pick.querySelector('[aria-pressed="true"]'), i = +b.dataset.i, n = +b.dataset.n, kwh = +b.dataset.kwh;
    var name = b.textContent.replace(/^\S+\s/, "").toLowerCase();
    var aw = AWAKE[i], best = null, worst = null, near = null, NEAR = 8;
    for (var s = 0; s + n <= series.length; s++) {
      var seg = series.slice(s, s + n);
      if (aw && (seg[0].h < aw[0] || seg[0].h + n > aw[1])) continue;
      var c = kwh * seg.reduce(function (t, x) { return t + x.p; }, 0) / n;
      if (!best || c < best.c - 1e-9) best = { s: s, c: c };
      if (s <= NEAR && (!near || c < near.c - 1e-9)) near = { s: s, c: c };
      if (!worst || c > worst.c) worst = { s: s, c: c };
    }
    if (!best) { box.innerHTML = '<p class="muted">No quedan horas suficientes hoy para este aparato. Mira el precio de <a href="precio-luz-manana.html">mañana</a>.</p>'; return; }
    function when(x) { var d = series[x.s]; return (d.d === "hoy" ? "" : "mañana ") + "a las " + hh(d.h); }
    function inh(x) { return x.s + (x.s === 1 ? " hora" : " horas"); }
    var now = live && n <= series.length ? kwh * series.slice(0, n).reduce(function (t, x) { return t + x.p; }, 0) / n : null;
    var verdict, cls, mark = best;
    if (now != null) {
      var ref = near || best, save = now - ref.c, okNow = ref.s === 0 || save < 0.05 || save / now < 0.1;
      if (okNow) {
        cls = "good"; mark = ref.s === 0 || !near ? { s: 0 } : ref;
        verdict = "<b>Buen momento: ponlo ahora.</b> Te cuesta " + e2(now) + " y en las próximas horas no baja mucho.";
      } else {
        cls = "wait"; mark = ref;
        verdict = "<b>Mejor espera y ponlo " + when(ref) + "</b> (dentro de " + inh(ref) + "): te costará " + e2(ref.c) + " en vez de " + e2(now) + ". <b>Ahorras " + e2(save) + "</b>" +
          (aw ? "." : ". Si tiene inicio diferido, prográmalo para dentro de " + ref.s + " h.");
      }
      var far = best !== ref && best.s > NEAR ? (okNow ? now : ref.c) - best.c : 0;
      if (far >= 0.1 && far / now >= 0.2) verdict += " Y si no tienes prisa, " + when(best).replace(/^a las/, "a las") + " te costará solo " + e2(best.c) + ".";
    } else {
      cls = "good";
      verdict = "<b>Mejor franja " + (L.kind === "manana" ? "mañana" : "") + ": de " + hh(series[best.s].h) + " a " + hh(series[best.s].h + n) + "</b>, te costará " + e2(best.c) +
        (worst && worst.c - best.c >= 0.01 ? " (en la peor franja, " + e2(worst.c) + ")." : ".");
    }
    best = mark;
    var vals = series.map(function (x) { return x.p; }), mx = Math.max.apply(null, vals), sorted = vals.slice().sort(function (a, c) { return a - c; });
    var q1 = sorted[Math.floor(sorted.length / 3)], q2 = sorted[Math.floor(sorted.length * 2 / 3)];
    var bars = series.map(function (x, j) {
      var inb = best.s != null && j >= best.s && j < best.s + n, lv = x.p < q1 ? "good" : x.p >= q2 ? "bad" : "mid";
      return '<li class="' + lv + (inb ? " best" : "") + (live && j === 0 ? " now" : "") + (x.h === 0 && j > 0 ? " midnight" : "") + '" title="' + (x.d === "hoy" ? "Hoy" : "Mañana") + " " + hh(x.h) + " · " + KV.n3(x.p) + ' €/kWh">' +
        '<i style="height:' + Math.max(x.p / mx * 100, 4).toFixed(0) + '%"></i><span>' + (j === 0 && live ? "Ahora" : x.h % 3 === 0 ? String(x.h).padStart(2, "0") : "") + "</span></li>";
    }).join("");
    box.className = "ahora-res " + cls;
    box.innerHTML = '<p class="verdict">' + verdict + "</p>" +
      '<ol class="tl" aria-label="Precio de las próximas horas">' + bars + "</ol>" +
      '<p class="note">' + name.charAt(0).toUpperCase() + name.slice(1) + ": " + KV.n1(kwh) + " kWh en " + n + (n === 1 ? " hora" : " horas") + " (" + (["ciclo de 40 °C", "programa eco", "ciclo completo", "1 hora", "calentar el depósito", "22 kWh a 7,4 kW", "2 kW durante 2 horas"][i] || "") + "). " +
      "Recuadro: la mejor franja. Precios PVPC con impuestos; con una tarifa de precio fijo pagas lo mismo a cualquier hora.</p>";
  }
  pick.addEventListener("click", function (ev) {
    var b = ev.target.closest("button"); if (!b) return;
    pick.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    try { localStorage.setItem("kv-aparato", b.dataset.i); } catch (e) { }
    render();
  });
  try { var sv = localStorage.getItem("kv-aparato"), sb = sv && pick.querySelector('[data-i="' + sv + '"]'); if (sb) pick.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === sb)); }); } catch (e) { }
  build(null); render();
  if (live) KV.data().then(function (D) {
    var k = KV.dayKey(1), t = D && D.days[k];
    if (t && t.filter(function (x) { return x != null; }).length >= 23) { var f = KV.taxInfo(k).factor; build(t.map(function (x) { return x == null ? null : x * f; })); render(); }
  });
})();

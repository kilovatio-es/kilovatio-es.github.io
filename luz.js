/* Kilovatio — páginas del precio de la luz. Los números ya vienen escritos en el HTML;
   esto solo añade lo que depende del momento: «ahora», horas pasadas, gráfico y selector de día. */
(function () {
  var L = window.LUZ, $ = KV.$;
  var pick = $("pick");
  if (pick) pick.addEventListener("change", function () {
    if (/^\d{4}-\d{2}-\d{2}$/.test(pick.value)) location.href = "precio-luz-" + pick.value + ".html";
  });
  if (!L) return;
  function hh(h) { return String(h % 24).padStart(2, "0") + ":00"; }
  var today = KV.dayKey(0), nowH = KV.nowHour();

  // Gráfico de barras (se dibuja al abrir «Ver gráfico»)
  var box = document.querySelector(".chartbox");
  function draw() {
    var pts = [];
    L.p.forEach(function (p, h) { if (p != null) pts.push({ h: h, p: p }); });
    KV.columns($("chart"), pts.map(function (x) {
      return { label: String(x.h).padStart(2, "0"), value: x.p, title: hh(x.h) + " · " + KV.n3(x.p) + " €/kWh",
        color: x.p < L.q[0] ? "var(--good)" : x.p >= L.q[1] ? "var(--bad)" : "var(--mid)", stroke: L.date === today && x.h === nowH };
    }), { height: 240, labelEvery: 2, yfmt: function (v) { return v.toFixed(2).replace(".", ","); } });
  }
  if (box) box.addEventListener("toggle", function () { if (box.open) draw(); });

  // Si la portada se quedó con el día anterior (el robot aún no ha pasado), se avisa.
  if (L.kind === "hoy" && L.date !== today) {
    var n = document.createElement("p");
    n.className = "callout sun";
    n.innerHTML = "Estás viendo los precios del " + KV.fmtDate(L.date) + ". Los de hoy se publican en unos minutos.";
    var a = document.querySelector(".answer"); a.parentNode.insertBefore(n, a);
    return;
  }
  if (L.date !== today) return;

  // Hoy: «ahora», horas pasadas y la mejor franja que queda
  var p = L.p[nowH];
  document.querySelectorAll("#sema li").forEach(function (li) {
    var h = +li.dataset.h;
    if (h < nowH) li.classList.add("past");
    if (h === nowH) { li.classList.add("now"); li.setAttribute("aria-current", "time"); }
  });
  if (p != null) {
    var lv = p < L.q[0] ? "good" : p >= L.q[1] ? "bad" : "mid";
    var card = $("nowcard");
    card.hidden = false; card.classList.add(lv);
    $("now-p").textContent = KV.n3(p);
    // próxima hora verde
    var next = null;
    for (var h = nowH + 1; h < 24; h++) if (L.p[h] != null && L.p[h] < L.q[0]) { next = h; break; }
    $("now-t").textContent = "€/kWh · " + hh(nowH) + "–" + hh(nowH + 1) + " · " + ({ good: "Barata", mid: "Media", bad: "Cara" })[lv] +
      (lv !== "good" && next != null ? " · próxima hora verde: " + hh(next) : "");
  }
  // Aparatos: mejor franja que todavía queda hoy y lo que cuesta ponerlo ahora
  document.querySelectorAll("table.apps tbody tr").forEach(function (tr) {
    var n = +tr.dataset.n, kwh = +tr.dataset.kwh, best = null;
    for (var s = nowH; s + n <= 24; s++) {
      var seg = L.p.slice(s, s + n);
      if (seg.some(function (x) { return x == null; })) continue;
      var a = seg.reduce(function (x, y) { return x + y; }, 0) / n;
      if (!best || a < best[1]) best = [s, a];
    }
    var nowSeg = L.p.slice(nowH, nowH + n);
    var td = tr.children[1];
    if (best && best[0] !== +td.textContent.slice(0, 2)) {
      td.innerHTML = hh(best[0]) + "–" + hh(best[0] + n) + "<small>la mejor que queda hoy</small>";
      tr.children[2].textContent = KV.eur2(kwh * best[1]);
      tr.children[4].textContent = KV.eur2(Math.max(+tr.dataset.worst - kwh * best[1], 0));
    }
    if (nowSeg.length === n && !nowSeg.some(function (x) { return x == null; })) {
      var nowCost = kwh * nowSeg.reduce(function (x, y) { return x + y; }, 0) / n;
      tr.children[1].insertAdjacentHTML("beforeend", "<small>Si lo pones ahora: " + KV.eur2(nowCost) + "</small>");
    }
  });
})();

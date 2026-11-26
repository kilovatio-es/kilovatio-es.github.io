/* Kilovatio — páginas de gasolineras: pestañas por carburante, «ver todas» y «las más baratas cerca de mí». */
(function () {
  var main = document.querySelector("main.gas"); if (!main) return;
  var NAMES = { g95: "Gasolina 95", dA: "Diésel", g98: "Gasolina 98", glp: "GLP" };
  var DATA = null;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function eur(m) { return (m / 1000).toFixed(3).replace(".", ",") + " €"; }
  function title(s) { return s && s === s.toUpperCase() && s.length > 4 ? s.toLowerCase().replace(/(^|\s|[-(])\S/g, function (x) { return x.toUpperCase(); }) : (s || ""); }
  function place(s) { s = (s || "").split("/")[0].trim(); var m = s.match(/^(.*)\s+\(([^)]+)\)$/); return m ? (m[2].slice(-1) === "'" ? m[2] + m[1] : m[2] + " " + m[1]) : s; }
  function load() {
    if (!DATA) DATA = fetch("data/gasolineras.json").then(function (r) { return r.json(); }).then(function (d) {
      var c = {}; d.cols.forEach(function (k, i) { c[k] = i; });
      return d.rows.map(function (r) { return { lat: r[c.lat], lon: r[c.lon], rot: title(r[c.rotulo]) || "Gasolinera", dir: title(r[c.direccion]), muni: r[c.municipio], prov: r[c.provincia], hor: r[c.horario], g95: r[c.g95], dA: r[c.dA], g98: r[c.g98], glp: r[c.glp] }; });
    });
    return DATA;
  }
  function li(i, s, k, extra) {
    var maps = "https://www.google.com/maps/dir/?api=1&destination=" + s.lat + "," + s.lon;
    return '<li><span class="gp num">' + i + '</span><div class="gw"><b>' + esc(s.rot) + "</b><span>" + esc(s.dir) + " · " + esc(place(s.muni)) + "</span>" +
      (/24\s*h/i.test(s.hor || "") ? '<span class="g24">24 h</span>' : "") + '</div><div class="gc"><b class="num">' + eur(s[k]) + "</b>" + (extra || "") +
      '<a href="' + maps + '" rel="noopener" target="_blank">Cómo llegar</a></div></li>';
  }

  // Pestañas por carburante
  document.querySelectorAll(".gtabs").forEach(function (tabs) {
    tabs.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      tabs.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      var sec = tabs.parentNode;
      sec.querySelectorAll(".gpane").forEach(function (p) { p.hidden = p.dataset.f !== b.dataset.f; });
    });
  });

  // Ver todas las gasolineras de la zona
  document.querySelectorAll(".gall").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var k = btn.dataset.f, P = main.dataset.prov, M = main.dataset.muni, ol = btn.previousElementSibling;
      btn.disabled = true; btn.textContent = "Cargando…";
      load().then(function (all) {
        var list = all.filter(function (s) { return s[k] && (!P || s.prov === P) && (!M || s.muni === M) && (P || ["Palmas (Las)", "Santa Cruz De Tenerife", "Ceuta", "Melilla"].indexOf(s.prov) < 0); })
          .sort(function (a, b) { return a[k] - b[k]; });
        var avg = list.reduce(function (t, s) { return t + s[k]; }, 0) / (list.length || 1);
        if (!P) list = list.slice(0, 200);
        ol.innerHTML = list.map(function (s, i) {
          var d = s[k] - avg, c = Math.abs(Math.round(d / 10 * 10) / 10).toString().replace(".", ",");
          return li(i + 1, s, k, Math.abs(d) < 5 ? '<span class="gd">en la media</span>' : '<span class="gd ' + (d < 0 ? "good" : "bad") + '">' + (d < 0 ? "−" : "+") + c + " céntimos</span>");
        }).join("");
        btn.remove();
      }).catch(function () { btn.disabled = false; btn.textContent = "No se pudo cargar. Inténtalo otra vez"; });
    });
  });

  // Las más baratas cerca de mí
  var near = document.getElementById("near"), out = document.getElementById("near-res"), POS = null, FUEL = "g95";
  function dist(a, b, c, d) { var x = (d - b) * Math.PI / 180 * Math.cos((a + c) / 2 * Math.PI / 180), y = (c - a) * Math.PI / 180; return 6371 * Math.hypot(x, y); }
  function renderNear() {
    load().then(function (all) {
      var la = POS.latitude, lo = POS.longitude, R = 5, list;
      for (; R <= 40; R *= 2) {
        list = all.filter(function (s) { return s[FUEL] && Math.abs(s.lat - la) < R / 100 && Math.abs(s.lon - lo) < R / 70; })
          .map(function (s) { s.km = dist(la, lo, s.lat, s.lon); return s; }).filter(function (s) { return s.km <= R; });
        if (list.length >= 5) break;
      }
      list.sort(function (a, b) { return a[FUEL] - b[FUEL] || a.km - b.km; });
      var nearest = list.slice().sort(function (a, b) { return a.km - b.km; })[0];
      var chips = '<div class="chips gfuel">' + Object.keys(NAMES).map(function (k) { return '<button type="button" data-f="' + k + '" aria-pressed="' + (k === FUEL) + '">' + NAMES[k] + "</button>"; }).join("") + "</div>";
      if (!list.length) { out.innerHTML = chips + '<p class="muted">No hay gasolineras con ' + NAMES[FUEL].toLowerCase() + " a menos de 40 km.</p>"; return; }
      var save = nearest && nearest[FUEL] > list[0][FUEL] ? " Llenando 50 litros en la más barata ahorras " + ((nearest[FUEL] - list[0][FUEL]) * 50 / 1000).toFixed(2).replace(".", ",") + " € frente a la más cercana." : "";
      out.innerHTML = chips + '<p class="muted">Las ' + Math.min(list.length, 10) + " más baratas a menos de " + Math.min(R, 40) + " km de ti." + save + "</p>" +
        '<ol class="grank">' + list.slice(0, 10).map(function (s, i) { return li(i + 1, s, FUEL, '<span class="gd">a ' + s.km.toFixed(1).replace(".", ",") + " km</span>"); }).join("") + "</ol>";
    });
  }
  if (near) {
    near.addEventListener("click", function () {
      if (!navigator.geolocation) { out.innerHTML = '<p class="muted">Tu navegador no permite saber tu ubicación.</p>'; return; }
      near.disabled = true; near.textContent = "Buscando…";
      navigator.geolocation.getCurrentPosition(function (p) {
        POS = p.coords; near.disabled = false; near.textContent = "📍 Actualizar con mi ubicación"; renderNear();
      }, function () { near.disabled = false; near.textContent = "📍 Las más baratas cerca de mí"; out.innerHTML = '<p class="muted">No hemos podido obtener tu ubicación. Revisa el permiso de ubicación del navegador.</p>'; },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
    });
    out.addEventListener("click", function (e) { var b = e.target.closest(".gfuel button"); if (b) { FUEL = b.dataset.f; renderNear(); } });
  }
})();

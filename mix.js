/* Kilovatio — de dónde viene la luz ahora mismo. Datos en directo de Red Eléctrica (seguimiento de la demanda
   peninsular, cada 5 minutos), pedidos desde el navegador; si fallan, la última foto que guardó el robot. */
(function () {
  var box = document.getElementById("mix"); if (!box) return;
  var G = [
    { k: "eol", n: "Eólica", c: "#5aa9e6", r: true, f: function (v) { return v.eol; } },
    { k: "sol", n: "Solar", c: "#f2b33d", r: true, f: function (v) { return (v.solFot || 0) + (v.solTer || 0); } },
    { k: "hid", n: "Hidráulica", c: "#2a6f97", r: true, f: function (v) { return v.hid; } },
    { k: "bio", n: "Otras renovables", c: "#6cc28f", r: true, f: function (v) { return v.bio || 0; } },
    { k: "nuc", n: "Nuclear", c: "#8e6bbf", f: function (v) { return v.nuc; } },
    { k: "cc", n: "Gas (ciclo combinado)", c: "#c4553a", f: function (v) { return (v.cc || 0) + (v.gf || 0); } },
    { k: "cog", n: "Cogeneración y residuos", c: "#a39684", f: function (v) { return v.cogenResto || 0; } },
    { k: "car", n: "Carbón", c: "#4a4a4a", f: function (v) { return v.car || 0; } }
  ];
  function pad(n) { return String(n).padStart(2, "0"); }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function share(v) {
    var parts = G.map(function (g) { return { g: g, mw: Math.max(g.f(v) || 0, 0) }; }), tot = parts.reduce(function (s, x) { return s + x.mw; }, 0);
    var ren = parts.filter(function (x) { return x.g.r; }).reduce(function (s, x) { return s + x.mw; }, 0);
    var co2 = ((v.cc || 0) * 370 + (v.gf || 0) * 700 + (v.car || 0) * 950 + (v.cogenResto || 0) * 380) / (tot || 1);
    return { parts: parts, tot: tot, ren: ren / (tot || 1), co2: co2 };
  }
  function donut(parts, tot) {
    var R = 70, C = 2 * Math.PI * R, off = 0;
    return '<svg viewBox="0 0 180 180" class="donut" aria-hidden="true"><g transform="rotate(-90 90 90)">' + parts.filter(function (x) { return x.mw > 0; }).map(function (x) {
      var len = x.mw / tot * C, s = '<circle cx="90" cy="90" r="' + R + '" fill="none" stroke="' + x.g.c + '" stroke-width="26" stroke-dasharray="' + len.toFixed(2) + " " + (C - len).toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '"><title>' + x.g.n + "</title></circle>";
      off += len; return s;
    }).join("") + "</g></svg>";
  }
  function render(list, live) {
    var v = list[list.length - 1], S = share(v), t = v.ts.slice(11, 16);
    var pct = function (x) { return Math.round(x * 100) + " %"; };
    var parts = S.parts.slice().sort(function (a, b) { return b.mw - a.mw; });
    var top = parts.filter(function (x) { return x.g.r && x.mw / S.tot >= 0.08; }).slice(0, 2);
    var inter = v.inter || 0;
    var lead = "Ahora mismo, el <b>" + pct(S.ren) + "</b> de la luz que se produce en la península viene de renovables" +
      (top.length ? ", sobre todo " + top.map(function (x) { return x.g.n.toLowerCase() + " (" + pct(x.mw / S.tot) + ")"; }).join(" e ") : "") + ". " +
      (Math.abs(inter) >= 300 ? "España está " + (inter < 0 ? "exportando" : "importando") + " " + KV.n0(Math.abs(inter)) + " MW " + (inter < 0 ? "a" : "de") + " Francia, Portugal y Marruecos." : "");
    // Evolución del % renovable a lo largo del día (cada hora)
    var hrs = {}, today = ymd(new Date());
    list.forEach(function (x) { if (x.ts.slice(0, 10) !== today || x.ts.slice(14, 16) !== "00") return; hrs[+x.ts.slice(11, 13)] = share(x).ren; });
    var hk = Object.keys(hrs).map(Number).sort(function (a, b) { return a - b; });
    var spark = "";
    if (hk.length >= 4) {
      var best = hk.reduce(function (a, h) { return hrs[h] > hrs[a] ? h : a; }, hk[0]);
      spark = '<div class="mix-day"><p class="mix-sub">Renovables hoy, hora a hora</p><ol class="tl ren">' + hk.map(function (h) {
        return '<li class="' + (h === best ? "best" : "") + '" title="' + pad(h) + ':00 · ' + pct(hrs[h]) + ' renovable"><i style="height:' + Math.max(hrs[h] * 100, 3).toFixed(0) + '%"></i><span>' + (h % 3 === 0 ? pad(h) : "") + "</span></li>";
      }).join("") + '</ol><p class="note">La hora más renovable de hoy ha sido las ' + pad(best) + ":00 (" + pct(hrs[best]) + "). Cuando sopla el viento y luce el sol, la luz suele salir más barata.</p></div>";
    }
    box.innerHTML = '<section class="block mix" aria-labelledby="h-mix"><header><p class="eyebrow">' + (live ? '<span class="live"></span>En directo · ' : "") + "Red Eléctrica · " + t + " h</p>" +
      '<h2 id="h-mix">¿De dónde viene la luz ahora mismo?</h2></header>' +
      '<p class="mix-lead">' + lead + "</p>" +
      '<div class="mix-grid"><div class="mix-donut">' + donut(S.parts, S.tot) + '<div class="mix-c"><b>' + pct(S.ren) + "</b><span>renovable</span></div></div>" +
      '<ul class="mix-list">' + parts.filter(function (x) { return x.mw > 0; }).map(function (x) {
        return '<li><i style="background:' + x.g.c + '"></i><span>' + x.g.n + '</span><b class="num">' + pct(x.mw / S.tot) + '</b><small class="num">' + KV.n0(x.mw) + " MW</small></li>";
      }).join("") + "</ul></div>" + spark +
      '<p class="note">Generación peninsular en este momento (' + KV.n0(S.tot) + " MW para una demanda de " + KV.n0(v.dem) + " MW). Emisiones aproximadas: " + KV.n0(S.co2) +
      " g de CO₂ por kWh. Fuente: seguimiento de la demanda de Red Eléctrica" + (live ? ", se actualiza sola cada 5 minutos" : "") + ".</p></section>";
  }
  var n = 0;
  function load() {
    var cb = "KVmix" + (++n), s = document.createElement("script"), done = false;
    window[cb] = function (j) {
      done = true; delete window[cb]; s.remove();
      var list = (j && j.valoresHorariosGeneracion || []).filter(function (x) { return x.dem > 0; });
      if (list.length) render(list, true); else fallback();
    };
    s.src = "https://demanda.ree.es/WSvisionaMovilesPeninsulaRest/resources/demandaGeneracionPeninsula?callback=" + cb + "&curva=DEMANDAAU&fecha=" + ymd(new Date());
    s.onerror = function () { if (!done) fallback(); };
    document.head.appendChild(s);
    setTimeout(function () { if (!done) fallback(); }, 8000);
  }
  function fallback() {
    if (box.innerHTML) return;
    fetch("data/mix.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (j && j.ultimos && j.ultimos.length) render(j.ultimos, false); else box.remove();
    }).catch(function () { box.remove(); });
  }
  load();
  setInterval(function () { if (!document.hidden) load(); }, 5 * 60 * 1000);
})();

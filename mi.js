/* Kilovatio — Mi Kilovatio. Todo se calcula y se guarda en el navegador (localStorage). */
(function () {
  var $ = KV.$, esc = KV.esc, TAX = KV.TAX;
  var POT_DAY = 0.084;      // €/kW·día PVPC (peajes, cargos y margen), sin impuestos
  var METER = 0.81;         // alquiler del contador, €/mes
  var SLOTS = { m: [8, 14], t: [14, 18], n: [18, 24], v: [0, 8] };
  var SLOT_TXT = { m: "por la mañana", t: "por la tarde", n: "por la noche", v: "de madrugada" };
  var CATS = { frio: "Frigorífico y congelador", lavado: "Lavar y secar", cocina: "Cocina", agua: "Agua caliente",
    clima: "Calefacción y aire", ocio: "Tele y ordenador", luz: "Iluminación", espera: "Consumo en espera", coche: "Coche eléctrico" };
  // Aparatos: unidad del uso, valor por defecto, kWh/año a partir del uso; flex = se puede mover de hora (use = kWh por uso, dur = horas)
  var APPS = [
    { id: "nevera", n: "Frigorífico", cat: "frio", u: "siempre", fixed: true, y: function () { return 300; }, on: function () { return true; } },
    { id: "congelador", n: "Congelador independiente", cat: "frio", u: "siempre", fixed: true, y: function () { return 250; }, on: function () { return false; } },
    { id: "lavadora", n: "Lavadora", cat: "lavado", u: "veces/semana", d: function (p) { return [0, 2, 3, 4, 5, 6][p.personas] || 3; }, y: function (v) { return v * 0.9 * 52; }, flex: true, use: 0.9, dur: 2, on: function () { return true; } },
    { id: "lavavajillas", n: "Lavavajillas", cat: "lavado", u: "veces/semana", d: function (p) { return [0, 2, 3, 4, 5, 6][p.personas] || 3; }, y: function (v) { return v * 1.0 * 52; }, flex: true, use: 1.0, dur: 2, on: function () { return true; } },
    { id: "secadora", n: "Secadora", cat: "lavado", u: "veces/semana", d: function () { return 2; }, y: function (v) { return v * 2.5 * 52; }, flex: true, use: 2.5, dur: 2, on: function (p) { return has(p, "secadora"); } },
    { id: "horno", n: "Horno", cat: "cocina", u: "veces/semana", d: function () { return 2; }, y: function (v) { return v * 1.2 * 52; }, on: function () { return true; } },
    { id: "induccion", n: "Placa de inducción o vitro", cat: "cocina", u: "horas/día", d: function () { return 1; }, y: function (v) { return v * 1.2 * 365; }, on: function (p) { return has(p, "induccion"); } },
    { id: "micro", n: "Microondas y pequeño electrodoméstico", cat: "cocina", u: "min/día", d: function () { return 15; }, y: function (v) { return v / 60 * 0.8 * 365; }, on: function () { return true; } },
    { id: "termo", n: "Termo eléctrico", cat: "agua", u: "personas", d: function (p) { return p.personas || 2; }, y: function (v) { return v * 1.2 * 365; }, flex: true, use: 0, dur: 3, on: function (p) { return has(p, "termo"); } },
    { id: "calef", n: "Radiadores o estufas eléctricas", cat: "clima", u: "h/día en invierno", d: function () { return 5; }, y: function (v) { return v * 1.5 * 120; }, on: function (p) { return p.calef === "electrica"; } },
    { id: "bomba", n: "Bomba de calor o aerotermia", cat: "clima", u: "h/día en invierno", d: function () { return 6; }, y: function (v) { return v * 0.6 * 120; }, on: function (p) { return p.calef === "bomba"; } },
    { id: "aire", n: "Aire acondicionado", cat: "clima", u: "h/día en verano", d: function () { return 4; }, y: function (v) { return v * 0.9 * 90; }, on: function (p) { return has(p, "aire"); } },
    { id: "tv", n: "Televisión", cat: "ocio", u: "horas/día", d: function () { return 4; }, y: function (v) { return v * 0.1 * 365; }, on: function () { return true; } },
    { id: "pc", n: "Ordenador o teletrabajo", cat: "ocio", u: "horas/día", d: function () { return 2; }, y: function (v) { return v * 0.08 * 365; }, on: function () { return true; } },
    { id: "luces", n: "Iluminación LED", cat: "luz", u: "horas/día", d: function () { return 5; }, y: function (v) { return v * 0.06 * 365; }, on: function () { return true; } },
    { id: "espera", n: "Aparatos en espera (router, cargadores…)", cat: "espera", u: "W", d: function () { return 12; }, y: function (v) { return v * 8.76; }, on: function () { return true; } },
    { id: "coche", n: "Coche eléctrico", cat: "coche", u: "km/año", d: function () { return 12000; }, y: function (v) { return v * 0.17; }, flex: true, use: 0, dur: 3, on: function (p) { return has(p, "coche"); } }
  ];
  function has(p, x) { return (p.extras || []).indexOf(x) >= 0; }

  /* ---------- Guardado ---------- */
  function load(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento: funciona igual en esta visita */ } }
  function drop(k) { try { localStorage.removeItem(k); } catch (e) { } }
  var S = load("kv-mi") || null;          // { p: perfil, a: { id: { on, v } } }
  var R = load("kv-real") || null;        // { name, days: { d: [24] }, exp: { d: [24] } }
  var D = null, ST = null;                // datos de precios y estadísticas

  /* ---------- Precios ---------- */
  function hourAvg(h) { var v = ST && ST.last30.hours[h]; return v != null ? v : (ST ? ST.last30.avg : 0.12); }
  function slotAvg(slot) { var r = SLOTS[slot] || SLOTS.n, s = 0; for (var h = r[0]; h < r[1]; h++) s += hourAvg(h); return s / (r[1] - r[0]); }
  function pvpc() { return !S || S.p.tarifa !== "fijo"; }
  function fixedPrice() { return S && S.p.precio > 0 ? S.p.precio : 0.13; }
  function eprice(app) {                       // €/kWh con impuestos para un aparato
    if (!pvpc()) return fixedPrice() * TAX;
    if (app && app.flex) return slotAvg(app.id === "coche" || app.id === "termo" ? (S.p.hora === "v" ? "v" : "n") : S.p.hora) * TAX;
    return (ST ? ST.last30.avg : 0.12) * TAX;
  }
  function valleAvg() { return slotAvg("v"); }
  function pot() { return S.p.pot > 0 ? S.p.pot : 4.6; }
  function kw(x) { return String(Math.round(x * 100) / 100).replace(".", ",") + " kW"; }

  /* ---------- Aparatos ---------- */
  function appState(a) {
    var st = (S.a || {})[a.id];
    var on = st && st.on != null ? st.on : a.on(S.p);
    var v = st && st.v != null ? st.v : (a.d ? a.d(S.p) : 1);
    return { on: on, v: v, y: on ? a.y(v) : 0 };
  }
  function totals() {
    var cats = {}, kwh = 0, eur = 0, flexK = 0, flexE = 0;
    APPS.forEach(function (a) {
      var s = appState(a); if (!s.on) return;
      var e = s.y * eprice(a);
      cats[a.cat] = (cats[a.cat] || 0) + e; kwh += s.y; eur += e;
      if (a.flex) { flexK += s.y; }
    });
    // Placas: parte del consumo la cubre el sol (estimación prudente)
    var solar = 0;
    if (S.p.kwp > 0) solar = Math.min(S.p.kwp * 1450 * 0.4, kwh * 0.4);
    var avgP = kwh ? eur / kwh : 0;
    return { cats: cats, kwh: kwh, eur: eur - solar * avgP, grid: kwh - solar, solar: solar, flexK: flexK, avgP: avgP };
  }

  /* ---------- Factura ---------- */
  function bill(kwhYear, eurEnergyYear) {
    var e = eurEnergyYear / 12 / TAX;              // energía sin impuestos, mes
    var p = pot() * POT_DAY * 30.42;
    var ie = (e + p) * KV.IEE;
    var iva = (e + p + ie + METER) * KV.IVA;
    return { e: e, p: p, ie: ie, m: METER, iva: iva, total: e + p + ie + METER + iva, kwh: kwhYear / 12 };
  }

  /* ---------- Hoy en tu casa ---------- */
  function todayBlock() {
    var grid = $("today-grid");
    var key = KV.dayKey(0), prices = D && D.days[key];
    var nowH = KV.nowHour(), dayLab = "hoy";
    if (prices && nowH >= 21 && D.days[KV.dayKey(1)]) { prices = D.days[KV.dayKey(1)]; key = KV.dayKey(1); nowH = 0; dayLab = "mañana"; }
    if (!prices) { grid.innerHTML = '<p class="muted">Los precios de hoy no están disponibles ahora mismo.</p>'; $("today-save").textContent = "—"; return; }
    $("today-eyebrow").textContent = (dayLab === "hoy" ? "Hoy" : "Mañana") + " en tu casa · " + KV.fmtDate(key);
    $("h-today").textContent = "Cuándo usar cada aparato " + dayLab;
    var flex = APPS.filter(function (a) { return a.flex && appState(a).on; });
    if (!flex.length) { grid.innerHTML = '<p class="muted">Activa la lavadora, el lavavajillas u otro aparato que puedas programar y te diremos su mejor hora cada día.</p>'; return; }
    var total = 0, cards = [];
    flex.forEach(function (a) {
      var s = appState(a), kwh = a.use, dur = a.dur;
      if (a.id === "termo") kwh = s.v * 1.2;
      if (a.id === "coche") kwh = s.v * 0.17 / 365 * 2;   // una carga cada dos días
      var best = null;
      for (var st = nowH; st + dur <= 24; st++) {
        var seg = prices.slice(st, st + dur); if (seg.some(function (x) { return x == null; })) continue;
        var av = seg.reduce(function (x, y) { return x + y; }, 0) / dur;
        if (!best || av < best[1]) best = [st, av];
      }
      if (!best) return;
      var slot = (a.id === "coche" || a.id === "termo") ? (S.p.hora === "v" ? "v" : "n") : (S.p.hora || "n");
      var r = SLOTS[slot], seg2 = prices.slice(r[0], r[1]).filter(function (x) { return x != null; });
      var usual = seg2.reduce(function (x, y) { return x + y; }, 0) / seg2.length;
      var cBest = kwh * best[1] * TAX, cUsual = kwh * usual * TAX;
      var sv = pvpc() ? Math.max(cUsual - cBest, 0) : 0;
      total += sv;
      cards.push('<div class="tcard"><b>' + esc(a.n) + '</b><span class="when">' + String(best[0]).padStart(2, "0") + ":00–" + String((best[0] + dur) % 24).padStart(2, "0") + ':00</span>' +
        '<span class="cost">' + (pvpc() ? KV.eur2(cBest) + " · " + SLOT_TXT[slot] + " " + KV.eur2(cUsual) : KV.eur2(kwh * fixedPrice() * TAX) + " a cualquier hora") + "</span>" +
        (sv >= 0.01 ? '<span class="save">Ahorras ' + KV.eur2(sv) + "</span>" : "") + "</div>");
    });
    grid.innerHTML = cards.join("");
    $("today-save").textContent = pvpc() ? KV.eur2(total) : "—";
    $("today-note").innerHTML = pvpc()
      ? "Con los precios PVPC reales de " + dayLab + ", comparado con usar cada aparato " + SLOT_TXT[S.p.hora || "n"] + ". Mira el <a href=\"index.html\">semáforo de la luz</a> para ver todas las horas."
      : "Tienes precio fijo: pagas lo mismo a cualquier hora. Con PVPC, " + dayLab + " ahorrarías eligiendo estas horas; mira qué tarifa te sale más barata en el <a href=\"comparador-tarifas.html\">comparador de tarifas</a>.";
  }

  /* ---------- Mi casa en números ---------- */
  function kpi(cls, small, big, sub) { return '<div class="ans ' + cls + '"><small>' + small + '</small><b class="num">' + big + "</b><span>" + sub + "</span></div>"; }
  function numbers() {
    var T = totals(), realY = R ? realYear() : null;
    var kwhY = realY ? realY.kwh : T.grid, eurY = realY ? realY.eur : T.eur;
    var B = bill(kwhY, eurY);
    $("src-badge").textContent = realY ? "Con tus datos reales (" + R.name + ")" : "Estimación con consumos típicos";
    $("src-badge").className = "badge" + (realY ? " real" : "");
    $("kpis").innerHTML =
      kpi("sun", "Factura al mes", KV.eur0(B.total), "con potencia e impuestos") +
      kpi("mid", "Consumo al año", KV.n0(kwhY) + " kWh", realY ? "según tu archivo" : "estimado") +
      kpi("mid", "Energía al año", KV.eur0(eurY), KV.n3(kwhY ? eurY / kwhY : 0) + " €/kWh de media") +
      kpi(T.flexK / T.kwh > 0.25 ? "good" : "mid", "Consumo que puedes mover", KV.n0(T.kwh ? T.flexK / T.kwh * 100 : 0) + " %", "a horas más baratas");
    var sc = realY && T.eur ? eurY / T.eur : 1, tot = 0;
    Object.keys(T.cats).forEach(function (c) { tot += T.cats[c]; });
    $("cat-h").textContent = realY ? "En qué se va tu dinero (reparto estimado)" : "En qué se va tu dinero";
    var items = Object.keys(T.cats).map(function (c) { return [CATS[c], T.cats[c], KV.eur0(T.cats[c] * sc) + "/año · " + KV.n0(T.cats[c] / tot * 100) + " %"]; })
      .sort(function (a, b) { return b[1] - a[1]; });
    KV.bars($("cat-bars"), items);
    KV.kv($("bill"), [
      ["Energía (" + KV.n0(B.kwh) + " kWh)", KV.eur2(B.e)],
      ["Potencia (" + kw(pot()) + (S.p.pot > 0 ? "" : ", supuesta") + ")", KV.eur2(B.p)],
      ["Impuesto eléctrico (" + KV.pctTxt(KV.IEE * 100) + ")", KV.eur2(B.ie)],
      ["Alquiler del contador", KV.eur2(B.m)],
      ["IVA (" + KV.pctTxt(KV.IVA * 100) + ")", KV.eur2(B.iva)],
      ["Total al mes", KV.eur2(B.total), true]]);
    var d = new Date(), dom = +KV.dayKey(0).slice(8, 10);
    $("bill-note").textContent = "Este mes llevas unos " + KV.eur0(B.total / 30.42 * dom) + " (" + dom + " días). " +
      (pvpc() ? "PVPC con el precio medio de los últimos 30 días." : "Precio fijo de " + KV.n3(fixedPrice()) + " €/kWh.") +
      (T.solar && !realY ? " Descontado lo que cubren tus placas (unos " + KV.n0(T.solar) + " kWh al año)." : "");
    return { T: T, B: B, kwhY: kwhY, realY: realY };
  }

  /* ---------- Diagnóstico ---------- */
  function insights(N) {
    var out = [], T = N.T, p = S.p;
    function add(type, title, text, save, link) { out.push({ type: type, title: title, text: text, save: save || 0, link: link }); }
    var flexLav = APPS.filter(function (a) { return ["lavadora", "lavavajillas", "secadora"].indexOf(a.id) >= 0; })
      .reduce(function (s, a) { return s + appState(a).y; }, 0);
    if (pvpc() && flexLav) {
      var diff = (slotAvg(p.hora || "n") - valleAvg()) * TAX;
      if (p.hora === "v") add("good", "Usas los aparatos en las horas más baratas", "Programar la lavadora y el lavavajillas de madrugada te ahorra unos " + KV.eur0(flexLav * (slotAvg("n") - valleAvg()) * TAX) + " al año frente a ponerlos por la noche.");
      else if (diff > 0.005) add("tip", "Programa la lavadora y el lavavajillas de madrugada", "Ahora los pones " + SLOT_TXT[p.hora || "n"] + ". Con el temporizador, a partir de las 00:00, cada ciclo sale más barato.", flexLav * diff, "index.html");
    }
    var esp = APPS.filter(function (a) { return a.id === "espera"; })[0], es = appState(esp);
    if (es.on && es.v >= 10) add("bad", "Consumo en espera: " + KV.n0(es.v) + " W siempre encendidos", "Router, cargadores y aparatos en espera suman " + KV.n0(es.y) + " kWh al año. Una regleta con interruptor para la tele y el ordenador puede quitar la mitad.", es.y * 0.5 * eprice(esp));
    else if (es.on) add("good", "Poco consumo en espera", "Tus aparatos en espera gastan poco: unos " + KV.eur0(es.y * eprice(esp)) + " al año.");
    // Potencia necesaria: base + los dos aparatos más potentes que pueden coincidir
    var heavy = [["horno", 2.2], ["induccion", 2.5], ["lavadora", 2], ["secadora", 2.5], ["lavavajillas", 2], ["termo", 1.5], ["calef", 2], ["aire", 1.2], ["coche", 3.7]]
      .filter(function (x) { return appState(APPS.filter(function (a) { return a.id === x[0]; })[0]).on; }).map(function (x) { return x[1]; }).sort(function (a, b) { return b - a; });
    var need = 0.6 + (heavy[0] || 0) + (heavy[1] || 0);
    var std = [3.45, 4.6, 5.75, 6.9, 8.05, 9.2], rec = std.filter(function (x) { return x >= need; })[0] || 9.2;
    if (p.pot > 0) {
      if (p.pot > rec + 0.01) add("tip", "Puede que te sobre potencia", "Tienes " + kw(p.pot) + " y, con tus aparatos, " + kw(rec) + " suelen bastar si no enciendes a la vez los que más gastan. Compruébalo antes de cambiarla.", (p.pot - rec) * POT_DAY * 365 * (1 + KV.IEE) * (1 + KV.IVA), "potencia-contratada.html");
      else if (p.pot >= need) add("good", "Potencia ajustada", "Tus " + kw(p.pot) + " encajan con los aparatos que tienes.");
    } else add("info", "¿Qué potencia tienes?", "Mira tu factura: si tienes más de " + kw(rec) + ", quizá puedas bajarla y ahorrar en el término fijo.", 0, "potencia-contratada.html");
    if (p.tarifa === "fijo" && p.precio > 0 && ST) {
      var dP = (p.precio - ST.last30.avg) * TAX * N.kwhY;
      if (dP > 15) add("tip", "Con los precios de este mes, el PVPC te saldría más barato", "Tu precio fijo (" + KV.n3(p.precio) + " €/kWh) está por encima de la media del PVPC de los últimos 30 días (" + KV.n3(ST.last30.avg) + "). El PVPC sube y baja: compáralo con calma.", dP, "comparador-tarifas.html");
      else if (dP < -15) add("good", "Tu precio fijo es bueno ahora mismo", "Pagas " + KV.n3(p.precio) + " €/kWh y el PVPC ha salido a " + KV.n3(ST.last30.avg) + " de media en los últimos 30 días.");
    } else if (pvpc()) add("good", "Tienes PVPC: las horas baratas cuentan", "Cada aparato que mueves a una hora verde se nota en la factura. Mira «Hoy en tu casa» cada día.");
    var calef = appState(APPS.filter(function (a) { return a.id === "calef"; })[0]);
    if (calef.on) add("tip", "La calefacción eléctrica directa es la más cara", "Una bomba de calor da el mismo calor gastando unas tres veces menos electricidad.", calef.y * (2 / 3) * eprice(), "calefaccion.html");
    var sec = appState(APPS.filter(function (a) { return a.id === "secadora"; })[0]);
    if (sec.on) add("tip", "Tiende la ropa una de cada dos veces", "La secadora es de lo que más gasta por uso: " + KV.n1(2.5) + " kWh por ciclo.", sec.y * 0.5 * eprice(APPS[4]));
    var car = APPS.filter(function (a) { return a.id === "coche"; })[0], cs = appState(car);
    if (cs.on && pvpc()) {
      if (p.hora === "v") add("good", "Cargas el coche en horas baratas", "Cargar de madrugada es la forma más barata de mover el coche.");
      else add("tip", "Carga el coche de madrugada", "Programa la carga a partir de las 00:00.", cs.y * (ST ? (ST.last30.avg - valleAvg()) * TAX : 0), "coche-electrico.html");
    }
    var termo = appState(APPS.filter(function (a) { return a.id === "termo"; })[0]);
    if (termo.on && pvpc() && p.hora !== "v") add("tip", "Programa el termo de madrugada", "Con un temporizador, el termo calienta el agua en las horas más baratas.", termo.y * (ST ? (ST.last30.avg - valleAvg()) * TAX : 0));
    if (!(p.kwp > 0) && N.kwhY > 2500) add("info", "Tu consumo da para placas solares", "Con " + KV.n0(N.kwhY) + " kWh al año, unas placas de " + KV.n1(Math.max(1.5, Math.round(N.kwhY / 1450 * 0.6 * 2) / 2)) + " kWp cubrirían buena parte del consumo de día. Calcula el ahorro y la amortización.", 0, "placas-solares.html");
    // Con datos reales
    if (R && R.an) {
      var A = R.an;
      if (A.baseW > 150) add("bad", "Tu casa nunca baja de " + KV.n0(A.baseW) + " W", "Ese consumo de fondo, de madrugada, son " + KV.n0(A.baseW * 8.76) + " kWh al año. Revisa aparatos en espera, un frigorífico antiguo o un termo siempre encendido.", (A.baseW - 100) * 8.76 * (ST ? ST.last30.avg : 0.12) * TAX);
      else add("good", "Consumo de fondo bajo: " + KV.n0(A.baseW) + " W", "De madrugada tu casa gasta poco: buena señal.");
      if (A.share.punta > 0.35) add("bad", "El " + KV.n0(A.share.punta * 100) + " % de tu consumo es en hora punta", "De 10 a 14 h y de 18 a 22 h los días laborables la luz es más cara. Mueve lo que puedas a valle.");
      else if (A.share.punta < 0.25) add("good", "Solo el " + KV.n0(A.share.punta * 100) + " % de tu consumo es en hora punta", "Concentras el consumo en las horas más baratas.");
      if (A.bestBat && A.bestBat.pay < 12) add("tip", "Ampliar la batería podría compensarte", "Añadiendo " + KV.n1(A.bestBat.c) + " kWh aprovecharías unos " + KV.n0(A.bestBat.used) + " kWh al año que ahora viertes. Se pagaría en unos " + KV.n0(A.bestBat.pay) + " años.", A.bestBat.sav);
    }
    var total = out.reduce(function (s, x) { return s + (x.type === "tip" || x.type === "bad" ? x.save : 0); }, 0);
    $("ins-total").textContent = KV.eur0(total);
    var order = { bad: 0, tip: 1, info: 2, good: 3 }, LAB = { good: "Lo haces bien", bad: "Punto débil", tip: "Mejora", info: "A tener en cuenta" };
    out.sort(function (a, b) { return order[a.type] - order[b.type] || b.save - a.save; });
    $("ins").innerHTML = out.map(function (x) {
      return '<div class="insight ' + x.type + '"><span class="kind">' + LAB[x.type] + "</span><b>" + esc(x.title) + "</b><p>" + esc(x.text) +
        (x.link ? ' <a href="' + x.link + '">Calcular →</a>' : "") + "</p>" + (x.save >= 1 ? '<span class="amount">' + KV.eur0(x.save) + " al año</span>" : "") + "</div>";
    }).join("");
  }

  /* ---------- Tabla de aparatos ---------- */
  function appsTable() {
    var rows = APPS.map(function (a) { return [a, appState(a)]; }).sort(function (x, y) { return (y[1].on - x[1].on) || (y[1].y - x[1].y); });
    $("apps").innerHTML = rows.map(function (r) {
      var a = r[0], s = r[1];
      return '<tr class="' + (s.on ? "" : "off") + '"><td><label class="check"><input type="checkbox" data-on="' + a.id + '"' + (s.on ? " checked" : "") + "> " + esc(a.n) + "</label></td>" +
        "<td>" + (a.fixed ? '<span class="muted">' + a.u + "</span>" : '<span class="usein"><input type="number" min="0" step="' + (a.u === "km/año" ? 500 : 1) + '" value="' + s.v + '" data-v="' + a.id + '"' + (s.on ? "" : " disabled") + "><small>" + a.u + "</small></span>") + "</td>" +
        '<td class="num">' + (s.on ? KV.n0(s.y) : "—") + '</td><td class="num">' + (s.on ? KV.eur0(s.y * eprice(a)) : "—") + "</td></tr>";
    }).join("");
  }
  $("apps").addEventListener("change", function (e) {
    var t = e.target, id = t.dataset.on || t.dataset.v; if (!id) return;
    S.a = S.a || {}; S.a[id] = S.a[id] || {};
    if (t.dataset.on) S.a[id].on = t.checked; else S.a[id].v = Math.max(0, parseFloat(t.value) || 0);
    save("kv-mi", S); renderDash();
  });

  /* ---------- Archivo de consumo: lectura ---------- */
  function num(s) {
    s = String(s == null ? "" : s).trim().replace(/\s/g, "");
    if (!s) return NaN;
    if (/,\d+$/.test(s) && s.indexOf(".") >= 0) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(",", ".");
    return parseFloat(s);
  }
  var parseConsumo = function (t) { return window.KVparseConsumo(t); };   // en consumo.js

  /* ---------- Archivo de consumo: análisis ---------- */
  function priceAt(d, h) { var day = D && D.days[d]; var v = day && day[h]; return v != null ? [v, true] : [hourAvg(h), false]; }
  function analyze() {
    var keys = Object.keys(R.days).sort(), nd = keys.length;
    var tot = 0, exp = 0, month = {}, prof = new Array(24).fill(0), per = { punta: 0, llano: 0, valle: 0 }, mins = [], peak = [0, "", 0];
    var cost = { pvpc: 0, fijo: 0, tres: 0 }, cov = 0, all = 0;
    var pf = num($("t-fijo").value) || 0, p3 = { punta: num($("t-p1").value) || 0, llano: num($("t-p2").value) || 0, valle: num($("t-p3").value) || 0 };
    keys.forEach(function (k) {
      var fk = KV.taxInfo(k).factor;   // impuestos vigentes ese día
      var d = R.days[k], m = k.slice(0, 7);
      month[m] = month[m] || [0, 0];
      var nightMin = Math.min(d[1], d[2], d[3], d[4], d[5]);
      mins.push(nightMin);
      d.forEach(function (v, h) {
        tot += v; month[m][0] += v; prof[h] += v;
        var pe = KV.period(k, h); per[pe] += v;
        if (v > peak[0]) peak = [v, k, h];
        var pr = priceAt(k, h); cost.pvpc += v * pr[0] * fk; if (pr[1]) cov++; all++;
        cost.fijo += v * pf * fk; cost.tres += v * p3[pe] * fk;
      });
      month[m][1]++;
      if (R.exp && R.exp[k]) R.exp[k].forEach(function (v) { exp += v; });
    });
    mins.sort(function (a, b) { return a - b; });
    var f = 365 / nd;
    var A = { nd: nd, from: keys[0], to: keys[nd - 1], tot: tot, year: tot * f, exp: exp * f, month: month,
      prof: prof.map(function (v) { return v / nd; }), share: { punta: per.punta / tot, llano: per.llano / tot, valle: per.valle / tot },
      baseW: mins[Math.floor(mins.length / 2)] * 1000, peak: peak, cov: all ? cov / all : 0,
      cost: { pvpc: cost.pvpc * f, fijo: cost.fijo * f, tres: cost.tres * f } };
    if (R.exp) A.bat = battery(keys);
    A.bestBat = A.bat ? A.bat.filter(function (b) { return b.pay > 0; }).sort(function (a, b) { return a.pay - b.pay; })[0] : null;
    return A;
  }
  function battery(keys) {
    var comp = (num($("b-comp").value) || 0) * TAX, cost = num($("b-cost").value) || 0, f = 365 / keys.length;
    return [2.5, 5, 7.5, 10, 15].map(function (C) {
      var soc = 0, used = 0, sav = 0;
      keys.forEach(function (k) {
        var imp = R.days[k], ex = R.exp[k] || [];
        for (var h = 0; h < 24; h++) {
          var e = ex[h] || 0, i = imp[h] || 0;
          if (e > 0) { var ch = Math.min(e, C - soc); soc += ch; sav -= ch * comp; }
          if (i > 0 && soc > 0) { var dis = Math.min(i, soc * 0.9); soc -= dis / 0.9; used += dis; sav += dis * priceAt(k, h)[0] * KV.taxInfo(k).factor; }
        }
      });
      sav *= f; used *= f;
      return { c: C, used: used, sav: sav, cost: C * cost, pay: sav > 0 ? C * cost / sav : 0 };
    });
  }
  function realYear() { if (!R || !R.an) return null; return { kwh: R.an.year, eur: R.an.cost[pvpc() ? "pvpc" : "fijo"] || R.an.cost.pvpc }; }
  function renderReal() {
    if (!R) { $("real-empty").hidden = false; $("real-body").hidden = true; return; }
    R.an = analyze();
    var A = R.an;
    $("real-empty").hidden = true; $("real-body").hidden = false;
    $("r-kpis").innerHTML =
      kpi("mid", "Periodo del archivo", A.nd + " días", KV.fmtDate(A.from) + " – " + KV.fmtDate(A.to)) +
      kpi("mid", "Consumo al año", KV.n0(A.year) + " kWh", KV.n1(A.tot / A.nd) + " kWh al día de media") +
      kpi(A.baseW > 150 ? "bad" : "good", "Consumo de fondo", KV.n0(A.baseW) + " W", "lo que tu casa gasta siempre") +
      kpi(A.share.punta > 0.35 ? "bad" : A.share.punta < 0.25 ? "good" : "mid", "En hora punta", KV.n0(A.share.punta * 100) + " %", "valle " + KV.n0(A.share.valle * 100) + " % · llano " + KV.n0(A.share.llano * 100) + " %");
    var ms = Object.keys(A.month).sort();
    KV.columns($("r-month"), ms.map(function (m) { return { label: KV.monthName(m).slice(0, 3), value: A.month[m][0], title: KV.monthName(m) + " · " + KV.n0(A.month[m][0]) + " kWh" + (A.month[m][1] < 28 ? " (" + A.month[m][1] + " días)" : ""), color: "var(--grid)" }; }),
      { height: 200, labelEvery: ms.length > 8 ? 2 : 1, yfmt: function (v) { return KV.n0(v); } });
    KV.columns($("r-hour"), A.prof.map(function (v, h) {
      var pe = h < 8 ? "valle" : (h >= 10 && h < 14) || (h >= 18 && h < 22) ? "punta" : "llano";
      return { label: String(h).padStart(2, "0"), value: v, title: String(h).padStart(2, "0") + ":00 · " + KV.n3(v) + " kWh", color: pe === "valle" ? "var(--good)" : pe === "punta" ? "var(--bad)" : "var(--mid)" };
    }), { height: 200, labelEvery: 3, yfmt: function (v) { return v.toFixed(2).replace(".", ","); } });
    var tar = [["PVPC (precio real de cada hora)", A.cost.pvpc], ["Precio fijo de " + KV.n3(num($("t-fijo").value) || 0) + " €/kWh", A.cost.fijo], ["Tres periodos", A.cost.tres]];
    var min = Math.min.apply(null, tar.map(function (t) { return t[1]; }));
    KV.bars($("r-tarifas"), tar.map(function (t) { return [t[0] + (t[1] === min ? " · la más barata" : ""), t[1], KV.eur0(t[1]) + "/año", t[1] === min ? "good" : "alt"]; }));
    $("r-tarifas-note").textContent = "Coste de la energía al año con impuestos, con tu consumo real" + (A.nd < 330 ? " (extrapolado de " + A.nd + " días)" : "") +
      ". El término de potencia es el mismo en las tres. PVPC con el precio real de cada hora en el " + KV.n0(A.cov * 100) + " % de tus horas" + (A.cov < 0.99 ? " y con la media de cada hora en el resto (fechas sin histórico)" : "") + ".";
    $("r-bat").hidden = !A.bat;
    if (A.bat) $("r-bat-t").innerHTML = '<tr><td colspan="5" class="muted">Viertes a la red unos ' + KV.n0(A.exp) + " kWh al año.</td></tr>" + A.bat.map(function (b) {
      return "<tr><td>" + KV.n1(b.c) + ' kWh</td><td class="num">' + KV.n0(b.used) + ' kWh/año</td><td class="num">' + KV.eur0(b.sav) + '</td><td class="num">' + KV.eur0(b.cost) + '</td><td class="num">' + (b.pay > 0 ? KV.n1(b.pay) + " años" : "No compensa") + "</td></tr>";
    }).join("");
  }
  ["t-fijo", "t-p1", "t-p2", "t-p3", "b-cost", "b-comp"].forEach(function (id) { $(id).addEventListener("input", function () { if (R) { renderReal(); numbers(); insights(numbers()); } }); });

  function readFile(f) {
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      var text = rd.result;
      if (/�/.test(text.slice(0, 2000))) { var r2 = new FileReader(); r2.onload = function () { handle(r2.result); }; r2.readAsText(f, "windows-1252"); return; }
      handle(text);
    };
    function handle(text) {
      try {
        var P = parseConsumo(text);
        R = { name: f.name, days: P.days, exp: P.exp };
        save("kv-real", { name: R.name, days: R.days, exp: R.exp });
        if (!S) { S = { p: { personas: 2, tarifa: "pvpc", pot: 0, calef: "gas", hora: "n", extras: P.exp ? ["placas"] : [] }, a: {} }; save("kv-mi", S); }
        show();
        toast("Leído: " + P.ndays + " días de consumo" + (P.exp ? " con energía vertida" : "") + (P.skipped ? " (" + P.skipped + " filas no válidas ignoradas)" : "") + ".", false);
        $("real").scrollIntoView({ behavior: "smooth" });
      } catch (e) { toast(e.message, true); }
    }
    rd.readAsText(f, "utf-8");
  }
  function toast(msg, err) {
    var t = $("mk-toast"); if (!t) { t = document.createElement("p"); t.id = "mk-toast"; document.querySelector(".mk .intro").appendChild(t); }
    t.className = "callout " + (err ? "sun" : "good"); t.textContent = msg;
  }
  $("file").addEventListener("change", function () { readFile(this.files[0]); this.value = ""; });
  ["b-file", "b-file2"].forEach(function (id) { $(id).addEventListener("click", function () { $("file").click(); }); });

  /* ---------- Alta ---------- */
  var form = $("setup"), draft = {};
  form.addEventListener("click", function (e) {
    var b = e.target.closest(".chips button"); if (!b) return;
    var g = b.parentNode, k = g.dataset.k;
    if (g.classList.contains("multi")) { b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true"); }
    else { g.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); }); draft[k] = b.dataset.v; }
    if (k === "tarifa") $("precio-f").hidden = draft.tarifa !== "fijo";
  });
  function fillForm(p) {
    draft = { personas: String(p.personas), tarifa: p.tarifa, pot: String(p.pot), calef: p.calef, hora: p.hora };
    form.querySelectorAll(".chips").forEach(function (g) {
      var k = g.dataset.k;
      g.querySelectorAll("button").forEach(function (b) {
        var on = g.classList.contains("multi") ? (p.extras || []).indexOf(b.dataset.v) >= 0 : String(p[k]) === b.dataset.v || (k === "personas" && +p[k] >= 5 && b.dataset.v === "5");
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    });
    $("precio-f").hidden = p.tarifa !== "fijo"; $("precio").value = p.precio || ""; $("kwp").value = p.kwp || ""; $("bat").value = p.bat || "";
  }
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var extras = [].map.call(form.querySelectorAll('.multi button[aria-pressed="true"]'), function (b) { return b.dataset.v; });
    var p = { personas: +(draft.personas || 2), tarifa: draft.tarifa === "fijo" ? "fijo" : "pvpc", tarifaNS: draft.tarifa === "nose",
      precio: num($("precio").value) || 0, pot: +(draft.pot || 0), calef: draft.calef || "gas", hora: draft.hora || "n", extras: extras,
      kwp: num($("kwp").value) || (extras.indexOf("placas") >= 0 ? 3 : 0), bat: num($("bat").value) || 0 };
    var keepA = S && S.a ? S.a : {};
    // si cambian los extras, los aparatos asociados vuelven a su valor por defecto
    ["secadora", "induccion", "termo", "calef", "bomba", "aire", "coche"].forEach(function (id) { if (keepA[id]) delete keepA[id].on; });
    S = { p: p, a: keepA }; save("kv-mi", S); show();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  $("go-manual").addEventListener("click", function () { $("start").hidden = true; form.hidden = false; fillForm({ personas: 2, tarifa: "pvpc", pot: 0, calef: "gas", hora: "n", extras: [] }); });
  $("b-edit").addEventListener("click", function () { $("dash").hidden = true; form.hidden = false; $("setup-cancel").hidden = false; fillForm(S.p); form.scrollIntoView(); });
  $("setup-cancel").addEventListener("click", function () { show(); });
  $("b-reset").addEventListener("click", function () {
    if (!confirm("¿Borrar los datos de tu casa y tu archivo de consumo de este navegador?")) return;
    drop("kv-mi"); drop("kv-real"); S = null; R = null; show();
  });

  /* ---------- Pintar ---------- */
  function renderDash() {
    todayBlock(); renderReal(); var N = numbers(); insights(N); appsTable();
    // Resumen para el comparador de tarifas
    save("kv-resumen", { kwh: Math.round(N.T.grid), pot: pot(), potSupuesta: !(S.p.pot > 0), hora: S.p.hora || "n",
      coche: has(S.p, "coche"), kwp: S.p.kwp || 0, tarifa: S.p.tarifa, precio: S.p.precio || 0, factura: Math.round(N.B.total * 100) / 100 });
  }
  function show() {
    var t = $("mk-toast"); if (t && !S) t.remove();
    $("start").hidden = !!S; form.hidden = true; $("dash").hidden = !S;
    if (S && S.p.tarifa === "fijo" && S.p.precio > 0 && !$("t-fijo").dataset.touched) $("t-fijo").value = S.p.precio;
    if (S) renderDash();
  }
  KV.data().then(function (d) { D = d; ST = d ? KV.stats(d) : null; TAX = KV.TAX; show(); });
})();

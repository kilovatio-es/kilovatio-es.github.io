/* Kilovatio — comparador de tarifas (interfaz).
   Construye un año de consumo hora a hora (desde la factura, el archivo horario o Mi Kilovatio),
   calcula la factura completa de cada oferta con KVcomp y muestra el ranking. Todo en el navegador. */
(function () {
  var $ = KV.$, esc = KV.esc;
  var OF = null, D = null, EST = null, MODE = null, FILE = null, LAST = null, FILTRO = "todas", TODAS = false, PREV = null;
  var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

  function load(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  function num(id) { var x = parseFloat(String(($(id) || {}).value || "").replace(",", ".")); return isFinite(x) && x >= 0 ? x : 0; }
  function n4(x) { return x.toLocaleString("es-ES", { minimumFractionDigits: 3, maximumFractionDigits: 4 }); }
  function pct(x) { return Math.round(x * 100) + " %"; }

  // Días del último año con precio PVPC publicado (hasta ayer)
  function lastYear() {
    var hoy = KV.dayKey(0);
    var ks = Object.keys(D.days).filter(function (k) { return k < hoy && D.days[k] && D.days[k].length === 24; }).sort();
    return ks.slice(-365);
  }

  function synth(p) { return KVperfil.synth(p, lastYear()); }

  /* ---------- Datos de cada forma de comparar ---------- */
  var seasonFactor = function (m) { return KVperfil.seasonFactor(m); };

  function fromFactura() {
    var kwh = num("kwh"), dias = num("dias") || 30, mi = +$("mes").value;
    var kP = num("kP"), kL = num("kL"), kV = num("kV"), per = null, anual = num("anual");
    if (kP + kL + kV > 0) { var t = kP + kL + kV; per = { p1: kP / t, p2: kL / t, p3: kV / t }; if (!kwh || Math.abs(kwh - t) > 1) kwh = t; }
    if (!anual) anual = kwh / dias * 365 / seasonFactor(mi);
    var habito = ($("habito").querySelector('[aria-pressed="true"]') || {}).dataset;
    return { anual: anual, habito: habito ? habito.v : "tipico", cocheKm: $("coche").checked ? num("km") : 0,
             kwp: $("solar").checked ? num("kwp") : 0, per: per, fuente: per ? "tu factura (con tu reparto por periodos)" : "tu factura" };
  }

  function miPerfil() {
    var real = load("kv-real"), res = load("kv-resumen");
    if (real && real.days && Object.keys(real.days).length >= 7) return { real: real, res: res };
    if (res && res.kwh > 0) return { res: res };
    return null;
  }

  function consumo() {
    if (MODE === "archivo") return FILE ? { days: FILE.days, exp: FILE.exp, fuente: "tu archivo horario", real: true } : null;
    if (MODE === "mi") {
      var M = miPerfil(); if (!M) return null;
      if (M.real) return { days: M.real.days, exp: M.real.exp || null, fuente: "tu archivo de Mi Kilovatio (" + M.real.name + ")", real: true };
      var hab = { m: "casa", t: "casa", n: "tipico", v: "noche" }[M.res.hora] || "tipico";
      var s = synth({ anual: M.res.kwh, habito: hab, cocheKm: M.res.coche ? 12000 : 0, kwp: M.res.kwp || 0, per: null });
      s.fuente = "tu perfil de Mi Kilovatio"; return s;
    }
    var p = fromFactura(); if (!(p.anual > 0)) return null;
    var r = synth(p); r.fuente = p.fuente; r.anualIn = p.anual; return r;
  }

  /* ---------- Tarifa actual ---------- */
  function otraTipo() { return ($("otra").querySelector(".seg [aria-pressed='true']") || {}).dataset.t || "fija"; }
  function actualOferta() {
    var v = $("actual").value;
    if (v === "otra") {
      var t = otraTipo();
      return { id: "actual", comercializadora: "Tu tarifa actual", nombre: "", tipo: t,
        energia: t === "fija" ? { unico: num("oE") } : { p1: num("oP"), p2: num("oL"), p3: num("oV") },
        potencia: { p1: num("oK1"), p2: num("oK2") }, excedentes: null, revisado: KV.dayKey(0), propia: true };
    }
    return null;
  }

  /* ---------- Cálculo ---------- */
  function opts() {
    var p1 = num("p1") || 3.45, p2 = $("p2on").checked ? (num("p2") || p1) : p1;
    var hours = new Array(24).fill(0), cnt = new Array(24).fill(0);
    lastYear().forEach(function (k) { D.days[k].forEach(function (v, h) { if (v != null) { hours[h] += v; cnt[h]++; } }); });
    var fb = hours.map(function (s, h) { return cnt[h] ? s / cnt[h] : 0.13; });
    var sp = D.spot || {}, sh = new Array(24).fill(0), sc = new Array(24).fill(0);
    Object.keys(sp).forEach(function (k) { (sp[k] || []).forEach(function (v, h) { if (v != null) { sh[h] += Math.max(v, 0); sc[h]++; } }); });
    var hasSpot = Object.keys(sp).length > 30;
    var t = KV.taxInfo(KV.dayKey(0));   // los impuestos de hoy, iguales para todas: es una comparación hacia el futuro
    return { p1kW: p1, p2kW: p2, regulado: OF.regulado, pvpc: D.days, pvpcFallback: fb, pvpcPotencia: OF.regulado.pvpc_potencia,
             spot: hasSpot ? sp : null, spotFallback: hasSpot ? sh.map(function (x, h) { return sc[h] ? x / sc[h] : 0; }) : null,
             taxInfo: function () { return { iva: t.iva, iee: t.iee }; } };
  }

  function run(scroll) {
    var C = consumo();
    if (!C) { $("go-note").textContent = MODE === "archivo" ? "Primero sube tu archivo de consumo." : "Revisa los datos: falta el consumo."; return; }
    $("go-note").textContent = "";
    var o = opts(), hoy = KV.dayKey(0);
    var ofs = OF.ofertas.filter(function (x) { return KVcomp.estado(x, hoy) !== "caducada" && !x.permanencia; });
    var cur = actualOferta(); if (cur) ofs = ofs.concat([cur]);
    var list = KVcomp.comparar(ofs, C, o);
    var curId = $("actual").value === "otra" ? "actual" : $("actual").value;
    LAST = { list: list, C: C, o: o, rep: KVcomp.reparto(C), curId: curId };
    if (!PREV) { var old = load("kv-comp-best"); PREV = old && old.d !== KV.dayKey(0) ? old : null; }
    render();
    persist();
    remember(list[0]);
    $("res").hidden = false;
    if (scroll) $("res").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------- Resultado ---------- */
  function tipoTxt(t) { return t === "pvpc" ? "PVPC · precio por horas" : t === "periodos" ? "Tres precios" : "Precio único"; }
  function aviso(of) {
    var e = EST && EST.items && EST.items[of.id];
    return !!e && (e.estado === "cambiada" || (e.estado === "sin_verificar" && e.dias_sin >= 3));
  }
  function nombre(of) { return of.propia ? "Tu tarifa actual" : esc(of.comercializadora) + (of.nombre ? " · " + esc(of.nombre) : ""); }
  function precios(of, r) {
    if (of.tipo === "pvpc") return "Cada hora a su precio · te sale a " + n4(r.energia / (r.kwh || 1)) + " €/kWh de media";
    if (of.tipo === "periodos") return "Punta " + n4(of.energia.p1) + " · Llano " + n4(of.energia.p2) + " · Valle " + n4(of.energia.p3) + " €/kWh";
    return n4(of.energia.unico) + " €/kWh a cualquier hora";
  }

  function why(best, list, rep, cur) {
    var b = best.oferta, out = [];
    var rp = "De lo que consumes, el <b>" + pct(rep.p1) + "</b> cae en punta (laborables de 10 a 14 y de 18 a 22 h), el <b>" + pct(rep.p2) + "</b> en llano y el <b>" + pct(rep.p3) + "</b> en valle (noches, fines de semana y festivos).";
    if (b.tipo === "pvpc") out.push("Con los precios reales del último año, <b>el PVPC te habría salido más barato</b> que cualquier oferta de precio fijo. Ojo: su precio cambia cada hora y en olas de frío o con el gas caro puede subir; a cambio, la energía no lleva margen comercial.");
    else if (b.tipo === "periodos") out.push("Como una buena parte de tu consumo cae en horas baratas, <b>te conviene pagar por tramos</b>: en valle pagarías " + n4(b.energia.p3) + " €/kWh.");
    else out.push("Con tu forma de consumir, <b>un precio único te sale mejor</b> que pagar por tramos: no tienes tanto consumo en valle como para compensar lo que cuesta la punta.");
    out.push(rp);
    var pv = list.filter(function (x) { return x.oferta.tipo === "pvpc"; })[0];
    if (pv && b.tipo !== "pvpc") {
      var d = pv.r.anual - best.r.anual;
      out.push("El PVPC, con los precios del último año, te habría costado <b>" + KV.eur0(d) + " más al año</b>.");
    }
    var potShare = best.r.potencia * KV.TAX / best.r.total;
    if (potShare > 0.3) out.push("La potencia es casi un " + pct(potShare) + " de tu factura. Si nunca te salta el automático, quizá puedas bajarla: <a href=\"potencia-contratada.html\">calcula la potencia que necesitas</a>.");
    return out.map(function (s) { return "<p>" + s + "</p>"; }).join("");
  }

  function stackBar(r) {
    var parts = [["Energía", r.energia - r.compensado, "var(--grid)"], ["Potencia", r.potencia, "var(--sun)"],
      ["Impuestos", r.iee + r.iva, "var(--bad)"], ["Contador y bono social", r.contador + r.bono, "var(--muted)"]];
    var t = parts.reduce(function (a, p) { return a + Math.max(p[1], 0); }, 0) || 1;
    return '<div class="stack" aria-hidden="true">' + parts.map(function (p) { return '<i style="width:' + (Math.max(p[1], 0) / t * 100).toFixed(1) + '%;background:' + p[2] + '"></i>'; }).join("") + "</div>" +
      '<ul class="stack-l">' + parts.map(function (p) { return '<li><i style="background:' + p[2] + '"></i>' + p[0] + " <b class=\"num\">" + pct(Math.max(p[1], 0) / t) + "</b></li>"; }).join("") + "</ul>";
  }

  function detalle(x) {
    var of = x.oferta, r = x.r, f = 365 / (r.dias || 365);
    var rows = [["Energía", r.energia], r.compensado > 0 ? ["Compensación de excedentes", -r.compensado] : null, ["Potencia", r.potencia],
      ["Impuesto eléctrico", r.iee], ["Alquiler del contador", r.contador], ["Financiación del bono social", r.bono], ["IVA", r.iva]].filter(Boolean);
    var pot = of.tipo === "pvpc" ? OF.regulado.pvpc_potencia : of.potencia;
    var src = of.propia ? "" : of.tipo === "pvpc"
      ? '<p class="note">Precios horarios oficiales de Red Eléctrica de los últimos 12 meses. Potencia: peajes, cargos y margen regulado.</p>'
      : '<p class="note">' + (of.condiciones ? esc(of.condiciones) + " " : "") + 'Precio comprobado el ' + KV.fmtDate(of.revisado) + ' en <a href="' + esc(of.fuente) + '" rel="noopener" target="_blank">' + (of.fuente_tipo === "oficial" ? "la web de " + esc(of.comercializadora) : "una fuente pública") + "</a>. Confírmalo al contratar.</p>";
    return '<div class="det">' + stackBar(r) +
      '<div class="tablewrap"><table><thead><tr><th>Al año, con impuestos</th><th class="num">Importe</th></tr></thead><tbody>' +
      rows.map(function (q) { return "<tr><td>" + q[0] + '</td><td class="num">' + KV.eur2(q[1] * f) + "</td></tr>"; }).join("") +
      '<tr class="tot"><td>Total</td><td class="num">' + KV.eur2(r.anual) + "</td></tr></tbody></table></div>" +
      '<p class="prices"><b>Energía:</b> ' + precios(of, r) + "<br><b>Potencia:</b> punta " + n4(pot.p1) + " · valle " + n4(pot.p2) + " €/kW·día" +
      (of.excedentes === "mercado" ? "<br><b>Excedentes:</b> se compensan al precio del mercado de cada hora" : of.excedentes ? "<br><b>Excedentes:</b> se compensan a " + n4(of.excedentes) + " €/kWh" : "") + "</p>" + src + "</div>";
  }

  function render() {
    if (!LAST) return;
    var L = LAST, list = L.list, best = list[0], worst = list[list.length - 1], hoy = KV.dayKey(0);
    var cur = list.filter(function (x) { return x.oferta.id === L.curId; })[0] || null;
    var kwhY = best.r.kwh * 365 / (best.r.dias || 365);

    $("win").innerHTML = '<p class="eyebrow">La más barata para ti</p><h3>' + nombre(best.oferta) + "</h3>" +
      '<p class="big num">' + KV.eur0(best.r.anual) + ' <small>al año</small></p><p class="muted">Unos ' + KV.eur0(best.r.anual / 12) + " al mes de media, con potencia, impuestos y todo lo que trae la factura · " + tipoTxt(best.oferta.tipo) + "</p>";

    var k2;
    if (cur && cur !== best) {
      var sav = cur.r.anual - best.r.anual, mesesG = sav / (best.r.anual / 12);
      k2 = ["good", "Ahorrarías al año", KV.eur0(sav), "frente a " + (cur.oferta.propia ? "tu tarifa actual" : nombre(cur.oferta)) + (mesesG >= 0.8 ? " · como " + (mesesG >= 1.5 ? KV.n0(mesesG) + " meses" : "un mes") + " de luz gratis" : "")];
    }
    else if (cur) k2 = ["good", "Tu tarifa", "Ya es la mejor", "no te compensa cambiar ahora"];
    else k2 = ["mid", "Entre la más barata y la más cara", KV.eur0(worst.r.anual - best.r.anual), "al año, con tu mismo consumo"];
    var rep = L.rep;
    $("kpis").innerHTML =
      '<div class="ans ' + k2[0] + '"><small>' + k2[1] + '</small><b class="num">' + k2[2] + "</b><span>" + k2[3] + "</span></div>" +
      '<div class="ans mid"><small>Tu consumo</small><b class="num">' + KV.n0(kwhY) + " kWh</b><span>al año · según " + esc(L.C.fuente) + "</span></div>" +
      '<div class="ans mid"><small>Cuándo consumes</small><div class="rp" aria-label="Reparto por periodos">' +
      '<i class="p1" style="width:' + (rep.p1 * 100).toFixed(1) + '%"></i><i class="p2" style="width:' + (rep.p2 * 100).toFixed(1) + '%"></i><i class="p3" style="width:' + (rep.p3 * 100).toFixed(1) + '%"></i></div>' +
      '<span>Punta ' + pct(rep.p1) + " · Llano " + pct(rep.p2) + " · Valle " + pct(rep.p3) + "</span></div>";

    $("why").innerHTML = why(best, list, rep, cur);

    var all = list.filter(function (x) { return FILTRO === "todas" || x.oferta.tipo === FILTRO || x.oferta.propia; });
    var LIM = 6, shown = TODAS ? all : all.filter(function (x, i) { return i < LIM || x === cur || x.oferta.tipo === "pvpc"; });
    var max = Math.max.apply(null, list.map(function (x) { return x.r.anual; })), min = best.r.anual;
    $("rank").innerHTML = shown.map(function (x) {
      var of = x.oferta, pos = list.indexOf(x) + 1, d = x.r.anual - min;
      var badges = '<span class="b t-' + of.tipo + '">' + tipoTxt(of.tipo) + "</span>" +
        (x === cur ? '<span class="b cur">Tu tarifa</span>' : "") +
        (of.propia || of.tipo === "pvpc" ? "" : (aviso(of) ? '<span class="b warn">Puede haber cambiado de precio</span>' : KVcomp.estado(of, hoy) === "pendiente" ? '<span class="b warn">Precio pendiente de revisar</span>' : "")) +
        (/primer año/i.test(of.condiciones || "") ? '<span class="b">Precio del 1.er año</span>' : "") +
        (of.excedentes && L.C.exp ? '<span class="b">Compensa excedentes</span>' : "") +
        (/promoci/i.test(of.condiciones || "") ? '<span class="b">Tiene promoción (no incluida)</span>' : "");
      return '<li class="' + (pos === 1 ? "first" : "") + (x === cur ? " is-cur" : "") + '">' +
        '<span class="pos num">' + pos + "</span>" +
        '<div class="who"><h3>' + nombre(of) + '</h3><div class="bs">' + badges + "</div>" +
        '<p class="pr">' + precios(of, x.r) + "</p></div>" +
        '<div class="cost"><b class="num">' + KV.eur0(x.r.anual) + '</b><span>al año · ' + KV.eur0(x.r.anual / 12) + "/mes</span>" +
        (d >= 1 ? '<span class="dif">+' + KV.eur0(d) + "</span>" : '<span class="dif best">La más barata</span>') + "</div>" +
        '<div class="bar"><i style="width:' + Math.max(x.r.anual / max * 100, 4).toFixed(1) + '%"></i></div>' +
        "<details><summary>Ver el desglose de la factura</summary>" + detalle(x) + "</details></li>";
    }).join("");
    $("rank-n").textContent = all.length + " tarifas comparadas";
    $("more").hidden = shown.length >= all.length && !TODAS;
    $("more").textContent = TODAS ? "Ver solo las mejores" : "Ver las " + (all.length - shown.length) + " tarifas restantes";
    chart(best, cur, list);
    hook(best);

    var sol = L.C.exp && Object.keys(L.C.exp).length;
    $("solar-note").hidden = !sol;
    if (sol) {
      var con = OF.ofertas.filter(function (o) { return o.excedentes; }).length;
      $("solar-note").innerHTML = "<b>Con placas solares:</b> en el PVPC tus excedentes se descuentan al precio del mercado de cada hora" + (L.o.spot ? "" : " (todavía sin datos: lo sumaremos en cuanto el robot los descargue)") +
        ". En el mercado libre solo lo sumamos en " + con + " " + (con === 1 ? "oferta" : "ofertas") + ", porque es el único precio de compensación que tenemos comprobado: en el resto tu factura real sería algo más baja de lo que ves aquí.";
    }
    var pvx = list.filter(function (x) { return x.oferta.tipo === "pvpc"; })[0], sp = pvx && pvx.r.kwh ? pvx.r.sinPrecio / pvx.r.kwh : 0;
    var kwTxt = function (x) { return x.toLocaleString("es-ES", { maximumFractionDigits: 2 }) + " kW"; };
    $("metodo").innerHTML = "Calculado hora a hora con " + esc(L.C.fuente) + ", " + (L.o.p1kW === L.o.p2kW ? kwTxt(L.o.p1kW) + " de potencia" : kwTxt(L.o.p1kW) + " en punta y " + kwTxt(L.o.p2kW) + " en valle") +
      " y los impuestos vigentes hoy. PVPC con los precios reales de Red Eléctrica de los últimos 12 meses" + (sp > 0.05 ? " (el " + pct(sp) + " de tu consumo cae en días sin precio PVPC en nuestro histórico; ahí usamos la media de esa hora)" : sp > 0.002 ? " (en las pocas horas sin precio publicado usamos la media de esa hora)" : "") +
      ". Ofertas revisadas el " + KV.fmtDate(OF.revisado) + ". Es una estimación orientativa: confirma las condiciones al contratar.";
  }

  /* Factura mes a mes: la mejor frente a tu tarifa (o el PVPC). Une los meses repetidos del año móvil. */
  function chart(best, cur, list) {
    var other = cur && cur !== best ? cur : list.filter(function (x) { return x.oferta.tipo === "pvpc" && x !== best; })[0] || list[1];
    if (!other) { $("chart").innerHTML = ""; return; }
    function byMonth(r) {
      var m = {}; r.meses.forEach(function (M) { var k = +M.mes.slice(5, 7) - 1; m[k] = (m[k] || 0) + M.total; }); return m;
    }
    var A = byMonth(best.r), B = byMonth(other.r), f = 365 / (best.r.dias || 365);
    var start = new Date().getMonth(), idx = []; for (var i = 0; i < 12; i++) idx.push((start + i) % 12);
    idx = idx.filter(function (m) { return A[m] != null; });
    var max = Math.max.apply(null, idx.map(function (m) { return Math.max(A[m], B[m] || 0) * f; }).concat([1]));
    var W = 640, H = 220, T = 14, Bt = 26, L = 8, step = (W - L) / idx.length, bw = Math.min(16, step / 3);
    var bars = idx.map(function (m, i) {
      var x = L + i * step + step / 2, a = A[m] * f, b = (B[m] || 0) * f, ya = T + (H - T - Bt) * (1 - a / max), yb = T + (H - T - Bt) * (1 - b / max);
      return '<rect x="' + (x - bw - 1).toFixed(1) + '" y="' + yb.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (H - Bt - yb).toFixed(1) + '" rx="3" fill="var(--line)"><title>' + MESES[m] + ": " + KV.eur0(b) + "</title></rect>" +
        '<rect x="' + (x + 1).toFixed(1) + '" y="' + ya.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (H - Bt - ya).toFixed(1) + '" rx="3" fill="var(--good)"><title>' + MESES[m] + ": " + KV.eur0(a) + "</title></rect>" +
        '<text x="' + x.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + MESES[m].slice(0, 3) + "</text>";
    }).join("");
    var nm = function (x) { return x.oferta.propia ? "Tu tarifa actual" : x.oferta.tipo === "pvpc" ? "PVPC" : esc(x.oferta.comercializadora + " · " + x.oferta.nombre); };
    var winM = idx.reduce(function (a, m) { return (B[m] || 0) - A[m] > (B[a] || 0) - A[a] ? m : a; }, idx[0]);
    $("chart").innerHTML = '<div class="ch-head"><h3>Tu factura mes a mes</h3><ul class="legend"><li><i style="background:var(--good)"></i>' + nm(best) + '</li><li><i style="background:var(--line)"></i>' + nm(other) + "</li></ul></div>" +
      '<svg viewBox="0 0 ' + W + " " + H + '" class="mchart" role="img" aria-label="Factura estimada de cada mes">' + bars + "</svg>" +
      '<p class="note">' + ((B[winM] || 0) > A[winM] ? "Donde más se nota la diferencia es en " + MESES[winM] + ": " + KV.eur0(((B[winM] || 0) - A[winM]) * f) + " menos ese mes. " : "") +
      "Los meses de invierno pesan más porque consumes más luz y, en el PVPC, el precio suele subir.</p>";
  }

  /* Al volver: qué ha cambiado desde la última comparación */
  function hook(best) {
    var el = $("hook"); if (!el) return;
    if (!PREV || PREV.d === KV.dayKey(0) || MODE === "archivo") { el.hidden = true; return; }
    var diff = PREV.anual - best.r.anual, same = PREV.id === best.oferta.id;
    el.hidden = false;
    el.innerHTML = "<b>Desde tu última visita (" + KV.fmtDate(PREV.d) + ")</b> " +
      (same ? "la mejor tarifa para ti sigue siendo la misma" : "hay una tarifa mejor para ti: <b>" + nombre(best.oferta) + "</b>") +
      (Math.abs(diff) >= 1 ? (diff > 0 ? ", y ahora te saldría " + KV.eur0(diff) + " más barata al año." : ", aunque ahora te saldría " + KV.eur0(-diff) + " más cara al año por los precios de este mes.") : ".");
  }
  function remember(best) {
    if (MODE === "archivo") return;
    var old = load("kv-comp-best");
    if (!PREV) PREV = old && old.d !== KV.dayKey(0) ? old : null;
    save("kv-comp-best", { id: best.oferta.id, anual: Math.round(best.r.anual), d: KV.dayKey(0) });
  }

  /* ---------- Guardar, recuperar y compartir ---------- */
  var FIELDS = ["kwh", "dias", "mes", "kP", "kL", "kV", "anual", "km", "kwp", "p1", "p2", "oE", "oP", "oL", "oV", "oK1", "oK2", "actual"];
  var CHECKS = ["coche", "solar", "p2on"];
  function state() {
    var s = { m: MODE, h: ($("habito").querySelector('[aria-pressed="true"]') || {}).dataset.v, t: otraTipo() };
    FIELDS.forEach(function (f) { if ($(f).value !== "") s[f] = $(f).value; });
    CHECKS.forEach(function (c) { if ($(c).checked) s[c] = 1; });
    return s;
  }
  function persist() { if (MODE !== "archivo") save("kv-comp", state()); }
  function restore(s) {
    if (!s) return;
    FIELDS.forEach(function (f) { if (s[f] != null && $(f)) $(f).value = s[f]; });
    CHECKS.forEach(function (c) { $(c).checked = !!s[c]; });
    if (s.h) press($("habito"), s.h, "v");
    if (s.t) press($("otra").querySelector(".seg"), s.t, "t");
    if ($("kP").value || $("anual").value) $("adv-per").open = true;
    sync();
  }
  function press(group, v, attr) { group.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset[attr] === v)); }); }
  function fromHash() {
    if (!/^#c=/.test(location.hash)) return null;
    try { return JSON.parse(decodeURIComponent(location.hash.slice(3))); } catch (e) { return null; }
  }

  /* ---------- Interfaz ---------- */
  function sync() {
    $("coche-f").hidden = !$("coche").checked;
    $("solar-f").hidden = !$("solar").checked;
    $("p2-f").hidden = !$("p2on").checked;
    $("otra").hidden = $("actual").value !== "otra";
    var t = otraTipo();
    $("otra").querySelectorAll(".field[data-t]").forEach(function (el) { el.hidden = el.dataset.t !== t; });
  }

  function setMode(m, scroll) {
    MODE = m;
    document.querySelectorAll(".modes .choice").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.mode === m)); });
    document.querySelectorAll(".mode-b").forEach(function (b) { b.hidden = b.dataset.for !== m; });
    $("paso2").hidden = false;
    if (m === "mi") miBox();
    if (scroll) $("paso2").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function miBox() {
    var M = miPerfil(), box = $("mi-box");
    if (!M && load("kv-mi")) {
      box.className = "callout sun";
      box.innerHTML = "<b>Tu perfil está guardado, pero hay que actualizarlo.</b> Abre <a href=\"mi-kilovatio.html\">Mi Kilovatio</a> un momento y vuelve: ya podremos comparar con tu casa.";
      return;
    }
    if (!M) {
      box.className = "callout sun";
      box.innerHTML = "<b>Todavía no tienes perfil en este navegador.</b> Date de alta en <a href=\"mi-kilovatio.html\">Mi Kilovatio</a> en un minuto (o sube allí tu archivo de consumo) y vuelve: compararemos con tu casa sin que escribas nada. Mientras, puedes comparar <a href=\"#\" data-go=\"factura\">con tu factura</a>.";
      return;
    }
    box.className = "callout good";
    if (M.real) {
      var n = Object.keys(M.real.days).length;
      box.innerHTML = "<b>Usaremos tu consumo real hora a hora</b> (" + esc(M.real.name || "archivo") + ", " + KV.n0(n) + " días) que subiste a Mi Kilovatio.";
    } else {
      box.innerHTML = "<b>Usaremos tu perfil de Mi Kilovatio:</b> unos " + KV.n0(M.res.kwh) + " kWh al año" + (M.res.coche ? ", con coche eléctrico" : "") + (M.res.kwp ? ", con " + KV.n1(M.res.kwp) + " kWp de placas" : "") +
        ". Es una estimación por aparatos; con tu archivo de Datadis el resultado sería exacto.";
    }
    if (M.res && M.res.pot > 0 && !$("p1").dataset.touched) $("p1").value = M.res.pot;
    if (M.res && !$("actual").dataset.touched) {
      if (M.res.tarifa === "pvpc") $("actual").value = "pvpc";
      else if (M.res.tarifa === "fijo" && M.res.precio > 0) { $("actual").value = "otra"; $("oE").value = M.res.precio; press($("otra").querySelector(".seg"), "fija", "t"); }
      sync();
    }
  }

  function fillSelects() {
    var now = new Date(), opts = "";
    for (var i = 1; i <= 12; i++) { var d = new Date(now.getFullYear(), now.getMonth() - i, 1); opts += '<option value="' + d.getMonth() + '">' + MESES[d.getMonth()] + " de " + d.getFullYear() + "</option>"; }
    $("mes").innerHTML = opts;
    var a = '<option value="">No lo sé</option><option value="pvpc">PVPC (tarifa regulada)</option>';
    var g = {};
    OF.ofertas.forEach(function (o) { (g[o.comercializadora] = g[o.comercializadora] || []).push(o); });
    Object.keys(g).sort().forEach(function (c) { a += '<optgroup label="' + esc(c) + '">' + g[c].map(function (o) { return '<option value="' + esc(o.id) + '">' + esc(o.comercializadora + " · " + o.nombre) + "</option>"; }).join("") + "</optgroup>"; });
    a += '<option value="otra">Otra (pongo sus precios)</option>';
    $("actual").innerHTML = a;
  }

  function onFile(f) {
    if (!f) return;
    var st = $("file-st");
    st.className = "status"; st.textContent = "Leyendo " + f.name + "…";
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var P = window.KVparseConsumo(String(rd.result));
        FILE = P;
        var ks = Object.keys(P.days).sort(), tot = 0; ks.forEach(function (k) { P.days[k].forEach(function (v) { tot += v; }); });
        st.className = "status ok";
        st.innerHTML = "✓ <b>" + esc(f.name) + "</b>: " + KV.n0(P.ndays) + " días, del " + KV.fmtDate(ks[0]) + " al " + KV.fmtDate(ks[ks.length - 1]) + ", " + KV.n0(tot) + " kWh" + (P.exp ? " y excedentes de tus placas" : "") + "." +
          (P.ndays < 300 ? " Al no cubrir un año entero, lo extrapolamos (el resultado puede variar según la estación)." : "");
        run(true);
      } catch (e) { FILE = null; st.className = "status err"; st.textContent = e.message; }
    };
    rd.readAsText(f);
  }

  function bind() {
    document.querySelectorAll(".modes .choice").forEach(function (b) { b.addEventListener("click", function () { setMode(b.dataset.mode, true); }); });
    $("mi-box").addEventListener("click", function (e) { var a = e.target.closest("[data-go]"); if (a) { e.preventDefault(); setMode(a.dataset.go, false); } });
    $("habito").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) { press($("habito"), b.dataset.v, "v"); live(); } });
    $("otra").querySelector(".seg").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) { press(this, b.dataset.t, "t"); sync(); live(); } });
    $("f").addEventListener("submit", function (e) { e.preventDefault(); run(true); });
    $("f").addEventListener("input", function () { sync(); live(); });
    $("f").addEventListener("change", function () { sync(); live(); });
    $("file").addEventListener("change", function () { onFile(this.files[0]); });
    var dz = $("drop");
    ["dragenter", "dragover"].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add("over"); }); });
    ["dragleave", "drop"].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove("over"); }); });
    dz.addEventListener("drop", function (e) { if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); });
    $("more").addEventListener("click", function () { TODAS = !TODAS; render(); if (!TODAS) $("rank").scrollIntoView({ behavior: "smooth", block: "start" }); });
    $("ftipo").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; FILTRO = b.dataset.f; press($("ftipo"), FILTRO, "f"); render(); });
    $("edit").addEventListener("click", function () { $("paso2").scrollIntoView({ behavior: "smooth", block: "start" }); });
    $("share").addEventListener("click", function () {
      var url = location.href.split("#")[0] + "#c=" + encodeURIComponent(JSON.stringify(state())), btn = this;
      var done = function () { btn.textContent = "Enlace copiado"; setTimeout(function () { btn.textContent = "Copiar enlace de esta comparación"; }, 2500); };
      if (MODE === "archivo") { btn.textContent = "Tu archivo no se comparte: el enlace no lleva tus datos"; }
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, function () { prompt("Copia este enlace:", url); });
      else prompt("Copia este enlace:", url);
    });
  }
  var tmr = null;
  function live() { if ($("res").hidden || MODE === "archivo" && !FILE) return; clearTimeout(tmr); tmr = setTimeout(function () { run(false); }, 250); }

  function init() {
    var M = miPerfil();
    if (M) {
      $("mi-tag").textContent = "Listo"; $("mi-tag").classList.add("good");
      $("mi-desc").textContent = M.real ? "Tienes tu consumo real guardado en Mi Kilovatio: comparamos con él al instante." : "Tienes tu casa guardada en Mi Kilovatio (unos " + KV.n0(M.res.kwh) + " kWh al año): comparamos sin que escribas nada.";
    } else { $("mi-go").textContent = "Crear mi perfil →"; }
    var n = OF.ofertas.length, cs = {}; OF.ofertas.forEach(function (o) { cs[o.comercializadora] = 1; });
    $("t-ofertas").textContent = n + " ofertas y el PVPC";
    $("t-rev").textContent = "de " + Object.keys(cs).length + " compañías, revisadas el " + KV.fmtDate(OF.revisado);
    fillSelects(); bind();
    var s = fromHash(), from = s ? "hash" : null;
    if (!s) { s = load("kv-comp"); from = s ? "saved" : null; }
    if (s) {
      restore(s);
      var m = s.m === "archivo" ? "factura" : (s.m || "factura");
      if (m === "mi" && !M) m = "factura";
      setMode(m, false); run(false);
      if (from === "saved") $("go-note").textContent = "Hemos recuperado tu última comparación con las ofertas de este mes.";
    } else sync();
  }

  Promise.all([fetch("data/ofertas.json", { cache: "no-cache" }).then(function (r) { return r.json(); }), KV.data(),
    fetch("data/ofertas_estado.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })]).then(function (a) {
    OF = a[0]; D = a[1]; EST = a[2];
    if (!OF || !D) throw 0;
    init();
  }).catch(function () {
    var m = document.querySelector(".modes"); if (m) m.insertAdjacentHTML("beforebegin", '<div class="callout sun"><b>No hemos podido cargar los precios.</b> Recarga la página en unos segundos.</div>');
  });
})();

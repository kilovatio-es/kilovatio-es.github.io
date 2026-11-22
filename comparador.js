/* Kilovatio — motor del comparador de tarifas.
   Calcula la factura completa de una oferta con un consumo hora a hora, como la calcularía la comercializadora:
   energía (fija, por periodos o PVPC hora a hora) − compensación de excedentes (con tope mensual)
   + potencia por días + impuesto eléctrico + alquiler del contador + financiación del bono social + IVA,
   con los impuestos vigentes cada día. Funciona en el navegador (window.KVcomp) y en Node (module.exports). */
(function (root) {
  // Festivos nacionales de fecha fija que la tarifa 2.0TD trata como valle todo el día
  var FESTIVOS = ["01-01", "01-06", "05-01", "08-15", "10-12", "11-01", "12-06", "12-08", "12-25"];

  function period(k, h) {
    var wd = new Date(k + "T12:00:00Z").getUTCDay();
    if (wd === 0 || wd === 6 || FESTIVOS.indexOf(k.slice(5)) >= 0 || h < 8) return "p3";
    return (h >= 10 && h < 14) || (h >= 18 && h < 22) ? "p1" : "p2";
  }

  function defaultTax() { return { iva: 21, iee: 5.11269632 }; }

  /* oferta: { tipo: "fija"|"periodos"|"pvpc", energia: {unico}|{p1,p2,p3}, potencia: {p1,p2}, excedentes: €/kWh|null }
     consumo: { days: { "AAAA-MM-DD": [24 kWh] }, exp: { día: [24 kWh] } | null }
     o: { p1kW, p2kW, regulado: {bono_social_anual, contador_mes}, pvpc: { días: [24 €/kWh sin impuestos] },
          pvpcFallback: [24 €/kWh], taxInfo: function(día) → {iva, iee} (en %) } */
  function factura(oferta, consumo, o) {
    var tax = o.taxInfo || defaultTax;
    var reg = o.regulado || { bono_social_anual: 9.011295, contador_mes: 0.81 };
    var keys = Object.keys(consumo.days).sort();
    var meses = {}, kwh = 0, sinPrecio = 0;
    keys.forEach(function (k) {
      var d = consumo.days[k], ex = consumo.exp && consumo.exp[k];
      var m = k.slice(0, 7), M = meses[m] = meses[m] || { dias: [], energia: 0, excedente: 0, valorExc: 0 };
      var eDia = 0, xDia = 0;
      for (var h = 0; h < 24; h++) {
        var v = d[h] || 0, p;
        if (oferta.tipo === "pvpc") {
          var day = o.pvpc && o.pvpc[k];
          p = day && day[h] != null ? day[h] : null;
          if (p == null) { p = o.pvpcFallback ? o.pvpcFallback[h] : 0.13; sinPrecio += v; }
        } else if (oferta.tipo === "periodos") p = oferta.energia[period(k, h)];
        else p = oferta.energia.unico;
        eDia += v * p; kwh += v;
        if (ex && ex[h] > 0) xDia += ex[h];
      }
      var pot = o.p1kW * oferta.potencia.p1 + o.p2kW * oferta.potencia.p2;
      M.dias.push({ k: k, energia: eDia, pot: pot });
      M.energia += eDia; M.excedente += xDia;
      M.valorExc += xDia * (oferta.excedentes || 0);
    });
    var T = { energia: 0, compensado: 0, potencia: 0, iee: 0, contador: 0, bono: 0, iva: 0, kwh: kwh, dias: keys.length, meses: [] };
    Object.keys(meses).sort().forEach(function (m) {
      var M = meses[m];
      // La compensación de excedentes no puede superar el coste de la energía del mes
      var comp = Math.min(M.valorExc, M.energia);
      var R = { mes: m, energia: 0, compensado: comp, potencia: 0, iee: 0, contador: 0, bono: 0, iva: 0 };
      M.dias.forEach(function (D) {
        var t = tax(D.k), share = M.energia > 0 ? D.energia / M.energia : 1 / M.dias.length;
        var neta = D.energia - comp * share;
        var iee = (neta + D.pot) * t.iee / 100;
        var cont = reg.contador_mes * 12 / 365, bono = reg.bono_social_anual / 365;
        var iva = (neta + D.pot + iee + cont + bono) * t.iva / 100;
        R.energia += D.energia; R.potencia += D.pot; R.iee += iee; R.contador += cont; R.bono += bono; R.iva += iva;
      });
      R.total = R.energia - R.compensado + R.potencia + R.iee + R.contador + R.bono + R.iva;
      ["energia", "compensado", "potencia", "iee", "contador", "bono", "iva"].forEach(function (f) { T[f] += R[f]; });
      T.meses.push(R);
    });
    T.total = T.energia - T.compensado + T.potencia + T.iee + T.contador + T.bono + T.iva;
    var f = keys.length ? 365 / keys.length : 0;
    T.anual = T.total * f;
    T.porKWh = kwh ? T.total / kwh : 0;
    T.sinPrecio = sinPrecio;         // kWh del PVPC sin precio real (se usó la media de esa hora)
    return T;
  }

  /* Clasifica las ofertas (más el PVPC) de más barata a más cara. */
  function comparar(ofertas, consumo, o) {
    var lista = ofertas.map(function (of) { return { oferta: of, r: factura(of, consumo, o) }; });
    if (o.pvpc) lista.push({ oferta: { id: "pvpc", comercializadora: "Tarifa regulada", nombre: "PVPC", tipo: "pvpc",
      potencia: o.pvpcPotencia || { p1: 0.082, p2: 0.002 }, excedentes: null }, r: null });
    lista.forEach(function (x) { if (!x.r) x.r = factura(x.oferta, consumo, o); });
    lista.sort(function (a, b) { return a.r.anual - b.r.anual; });
    return lista;
  }

  /* Reparto del consumo por periodos (para explicar el resultado). */
  function reparto(consumo) {
    var s = { p1: 0, p2: 0, p3: 0 }, t = 0;
    Object.keys(consumo.days).forEach(function (k) { consumo.days[k].forEach(function (v, h) { s[period(k, h)] += v || 0; t += v || 0; }); });
    return { p1: t ? s.p1 / t : 0, p2: t ? s.p2 / t : 0, p3: t ? s.p3 / t : 0, total: t };
  }

  /* Una oferta caduca si lleva más de 90 días sin revisar; a partir de 45 queda como pendiente. */
  function estado(oferta, hoy) {
    var dias = (new Date(hoy) - new Date(oferta.revisado)) / 864e5;
    return dias > 90 ? "caducada" : dias > 45 ? "pendiente" : "vigente";
  }

  var api = { factura: factura, comparar: comparar, reparto: reparto, period: period, estado: estado };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.KVcomp = api;
})(typeof window !== "undefined" ? window : this);

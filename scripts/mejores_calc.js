/* Kilovatio — calcula el ranking de «Mejores tarifas de luz» para tres hogares tipo con el mismo motor que el comparador.
   Uso: node scripts/mejores_calc.js <carpeta_web> <AAAA-MM-DD>  → JSON por la salida estándar. */
const fs = require("fs"), path = require("path");
const root = path.resolve(process.argv[2] || path.join(__dirname, "..")), hoy = process.argv[3] || new Date().toISOString().slice(0, 10);
const C = require(path.join(root, "comparador.js")), P = require(path.join(root, "perfil.js"));
const OF = JSON.parse(fs.readFileSync(path.join(root, "data", "ofertas.json"), "utf8"));
const D = JSON.parse(fs.readFileSync(path.join(root, "data", "energia.json"), "utf8"));
let EST = null; try { EST = JSON.parse(fs.readFileSync(path.join(root, "data", "ofertas_estado.json"), "utf8")); } catch (e) { }

const PERFILES = [
  { id: "piso", nombre: "Piso pequeño", quien: "1 o 2 personas, fuera de casa durante el día", kwh: 1800, kw: 3.45, habito: "fuera", cocheKm: 0 },
  { id: "familia", nombre: "Familia", quien: "3 o 4 personas, consumo repartido a lo largo del día", kwh: 3500, kw: 4.6, habito: "tipico", cocheKm: 0 },
  { id: "coche", nombre: "Casa con coche eléctrico", quien: "familia que carga el coche en casa por la noche (12.000 km al año)", kwh: 6000, kw: 5.75, habito: "tipico", cocheKm: 12000 }
];

const keys = Object.keys(D.days).filter(k => k < hoy && D.days[k] && D.days[k].length === 24).sort().slice(-365);
const tax = (D.tax || []).find(t => t.desde <= hoy && (t.hasta == null || hoy <= t.hasta)) || { iva: 21, iee: 5.11269632 };
const fb = Array.from({ length: 24 }, (_, h) => { let s = 0, n = 0; keys.forEach(k => { const v = D.days[k][h]; if (v != null) { s += v; n++; } }); return n ? s / n : 0.13; });
const estado = id => EST && EST.items && EST.items[id] ? EST.items[id].estado : null;
const ofertas = OF.ofertas.filter(o => C.estado(o, hoy) !== "caducada" && !o.permanencia && estado(o.id) !== "cambiada");

const out = { hoy, revisado: OF.revisado, dias: keys.length, desde: keys[0], hasta: keys[keys.length - 1], iva: tax.iva, iee: tax.iee, nOfertas: ofertas.length,
  nCompanias: new Set(ofertas.map(o => o.comercializadora)).size, perfiles: [] };
for (const pf of PERFILES) {
  const cons = P.synth({ anual: pf.kwh, habito: pf.habito, cocheKm: pf.cocheKm, kwp: 0, per: null }, keys);
  const o = { p1kW: pf.kw, p2kW: pf.kw, regulado: OF.regulado, pvpc: D.days, pvpcFallback: fb, pvpcPotencia: OF.regulado.pvpc_potencia,
    taxInfo: () => ({ iva: tax.iva, iee: tax.iee }) };
  const list = C.comparar(ofertas, cons, o), rep = C.reparto(cons);
  out.perfiles.push({ ...pf, reparto: { p1: rep.p1, p2: rep.p2, p3: rep.p3 },
    ranking: list.map(x => {
      const of = x.oferta, E = of.energia_alta && pf.kw > 5 ? of.energia_alta : of.energia;
      return { id: of.id, comercializadora: of.comercializadora, nombre: of.nombre, tipo: of.tipo, anual: x.r.anual, porKWh: x.r.porKWh,
        energia: of.tipo === "pvpc" ? { media: x.r.energia / x.r.kwh } : E, potencia: of.potencia, condiciones: of.condiciones || "",
        fuente: of.fuente || null, fuente_tipo: of.fuente_tipo || null, revisado: of.revisado || null,
        partes: { energia: x.r.energia * 365 / x.r.dias, potencia: x.r.potencia * 365 / x.r.dias, impuestos: (x.r.iee + x.r.iva) * 365 / x.r.dias,
                  otros: (x.r.contador + x.r.bono) * 365 / x.r.dias } };
    }) });
}
process.stdout.write(JSON.stringify(out));

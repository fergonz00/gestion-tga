// Smoke test del bloque de marketing del portal.
//
// Corre las funciones de render REALES del index contra los datos reales de la
// API y contra payloads vacios/null. Es lo que habria cachado el
// "fmt is not defined" que dejo todo el Resumen colgado en "Cargando...".
//
//   node tools/smoke-marketing.js
//
// Correrlo siempre antes de pushear: `node --check` no alcanza, porque una
// funcion inexistente recien falla cuando se ejecuta.
const fs = require('fs');
const path = __dirname + '/../index.html';
const html = fs.readFileSync(path, 'utf8');

// El slice arranca en el toggle de los desplegables: el bloque del Resumen los
// usa, y si no entran al sandbox el test pasa en falso.
const ini = html.indexOf('// Marketing: las tablas del Resumen arrancan plegadas.');
const fin = html.indexOf('async function loadResumen() {');
const iniBloque = html.indexOf('  // ----- MARKETING -----');
const finBloque = html.indexOf('  // ----- SALDOS -----');
if ([ini, fin, iniBloque, finBloque].some(i => i < 0)) {
  console.error('no encontre alguno de los bloques en index.html');
  process.exit(1);
}

// --- stubs del navegador y de los helpers del portal ---
const elementos = {};
global.document = {
  getElementById: (id) => elementos[id] || (elementos[id] = { value: 'mes', textContent: '', innerHTML: '', disabled: false }),
};
global.escapeHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
global.fmtPesos = (n) => '$' + Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });
global.fmtPct = (n) => (n == null ? '—' : Math.round(n) + '%');
global.kpi = (l, v, s, c) => `<div class="card">${l}=${v}</div>`;
global.GESTION_NEXT_URL = 'https://gestion-next-fergonz00s-projects.vercel.app';

// Todo en UN eval: los `const` del index no salen del eval, asi que armar el
// bloque en un eval aparte lo dejaria sin `_mkIso` y compania.
const sandbox = {};
eval(
  html.slice(ini, fin) +
  '\nsandbox.armarBloque = function () { let h = ""; ' + html.slice(iniBloque, finBloque) + ' return h; };' +
  '\nsandbox.tablaInv = _mkTablaInversiones; sandbox.tablaMeses = _mkTablaMeses;' +
  '\nsandbox.tablaMesesMeta = _mkTablaMesesMeta; sandbox.totales = _mkTotales;' +
  '\nsandbox.enAire = _mkEnAire; sandbox.mes = _mkMes;' +
  // marketingMes/marketingInvMes son `let` del index y viven dentro del eval:
  // asignarlos por `global` no los toca. Hay que setearlos desde adentro.
  '\nsandbox.setDatos = function (m, i) { marketingMes = m; marketingInvMes = i; };'
);

const B = global.GESTION_NEXT_URL + '/api';
const get = async (u) => {
  const r = await fetch(u);
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
};

(async () => {
  const mes = sandbox.mes();
  console.log('ventana del Resumen:', mes.desde, 'a', mes.hasta);

  const [meta, inv] = await Promise.all([
    get(`${B}/meta/analisis?desde=${mes.desde}&hasta=${mes.hasta}`),
    get(`${B}/marketing/inversiones?desde=${mes.desde}&hasta=${mes.hasta}`),
  ]);

  const vacioMeta = { total: {}, anuncios: [], meses: [] };
  const vacioInv = { canales: [], meses: [], total: {} };
  const casos = [
    ['datos reales del mes', meta, inv],
    ['sin inversiones por lead', meta, vacioInv],
    ['sin gasto de Meta', vacioMeta, inv],
    ['todo vacio', vacioMeta, vacioInv],
    ['payloads null', null, null],
  ];

  let fallos = 0;

  for (const [nombre, m, i] of casos) {
    try {
      const tt = sandbox.totales(m, i);
      const ref = tt.comercial ? Math.round(tt.gasto / tt.comercial) : 0;
      const salida = [
        sandbox.tablaInv(i, ref, true),
        sandbox.tablaInv(i, ref, false),
        sandbox.tablaMeses(i),
        sandbox.tablaMesesMeta(m),
        ((m && m.anuncios) || []).map(a => String(sandbox.enAire(a))).join(','),
      ].join('');
      if (/undefined|NaN|\[object Object\]/.test(salida)) throw new Error('la salida tiene undefined/NaN');
      console.log(`  ✓ tablas — ${nombre} (gasto ${tt.gasto}, ${salida.length} chars)`);
    } catch (e) {
      console.log(`  ✗ tablas — ${nombre}: ${e.message}`);
      fallos++;
    }
  }

  // El bloque del Resumen, con las mismas globales que usa renderResumen.
  for (const [nombre, m, i] of casos) {
    sandbox.setDatos(m, i);
    try {
      const salida = sandbox.armarBloque();
      // El bloque tiene su propio try/catch: un error NO explota, deja un cartel.
      // Sin buscarlo, el test pasa aunque el bloque este roto.
      const roto = salida.match(/No se pudo armar el bloque de marketing: ([^<]*)/);
      if (roto) throw new Error(roto[1]);
      if (m && m.total && Object.keys(m.total).length) {
        if (/Cargando pauta/.test(salida)) throw new Error('quedo en "Cargando pauta"');
        if (!/toggleResumenMkt/.test(salida)) throw new Error('no armo los desplegables');
        if (/<table/.test(salida)) throw new Error('las tablas tienen que arrancar PLEGADAS');
      }
      console.log(`  ✓ bloque del Resumen — ${nombre} (${salida.length} chars)`);
    } catch (e) {
      console.log(`  ✗ bloque del Resumen — ${nombre}: ${e.message}`);
      fallos++;
    }
  }

  console.log(fallos ? `\nFALLARON ${fallos}` : '\nTODO OK');
  process.exit(fallos ? 1 : 0);
})();

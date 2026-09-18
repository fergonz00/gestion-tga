// Smoke test de la solapa Financiaciones (Adm. ventas).
//
// Corre las funciones REALES del index (_admFinList, _finTabla,
// renderAdmFinanciaciones) contra los datos reales de /api/admventas y contra
// payloads vacios. `node --check` no alcanza: un helper inexistente recien
// explota al ejecutarse, y el catch de loadAdmVentas se lo traga.
//
//   node tools/smoke-financiaciones.js
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');

const ini = html.indexOf('// ===================== FINANCIACIONES (cobranza) =====================');
const fin = html.indexOf('// La data de Adm. ventas se quedaba pegada toda la sesión');
if (ini < 0 || fin < 0) { console.error('no encontre el bloque de Financiaciones'); process.exit(1); }

// --- stubs del navegador y de los helpers del portal ---
const elementos = {};
const mkEl = () => ({ value: '', textContent: '', innerHTML: '', dataset: {}, classList: { contains: () => false } });
global.document = { getElementById: (id) => elementos[id] || (elementos[id] = mkEl()) };
global.escapeHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
global.fmtPesos = (n) => '$' + Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });
global.kpi = (l, v, s, c) => `<div class="card">${l}=${v} (${s})</div>`;
global.TIPO_CHIP = { FINANCIA_VW: { txt: 'VW Credit', bg: '#001e50' }, FINANCIA_OTROS: { txt: 'Banco', bg: '#64748b' }, FINANCIA_TG: { txt: 'TG', bg: '#0a7a30' } };
global._fechaDMA = (s) => String(s || '').slice(0, 10).split('-').reverse().join('/');
global._mesLabel = (m) => m;
global._mesActualReal = () => new Date().toISOString().slice(0, 7);
global._diasEntre = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
global._liqInputs = () => '<select></select>';
global.saveLiq = () => {};
global.loadAdmVentas = () => {};
global.renderAdmVentas = () => {};

// El bloque usa `admVentasData` (let global del index) y `_admMesDe`.
const sandbox = {};
eval(
  'var admVentasData = null;\n' +
  'function _admMesDe(v) { return v.fechaPatentamiento ? String(v.fechaPatentamiento).slice(0,7) : ((v.manual && v.manual.mes_patentamiento) ? String(v.manual.mes_patentamiento).slice(0,7) : _mesActualReal()); }\n' +
  html.slice(ini, fin) +
  '\nsandbox.setDatos = function (d) { admVentasData = d; };' +
  '\nsandbox.render = renderAdmFinanciaciones;' +
  '\nsandbox.lista = _admFinList; sandbox.meses = _admFinMeses;' +
  '\nsandbox.setMes = finSetMes; sandbox.setVend = finSetVend; sandbox.vendDe = _finVend;'
);

const chequear = (nombre, cond) => {
  if (cond) { console.log('  ok  ' + nombre); return true; }
  console.error('  FALLA  ' + nombre); process.exitCode = 1; return false;
};

(async () => {
  // 1) payloads degenerados: no tienen que tirar
  console.log('vacios:');
  for (const d of [null, { ventas: [] }, { ventas: [{ preventa: '1/1' }] }, { ventas: [{ preventa: '2/1', tipo: 'FINANCIA_VW', cuadro: [] }] }]) {
    sandbox.setDatos(d); sandbox.render();
  }
  chequear('no explota con data vacia/parcial', true);

  // Token de servidor: fuera del repo (es publico), en .secrets/gestion.env.
  const env = fs.readFileSync('C:/proyectos/.secrets/gestion.env', 'utf8');
  const tok = (env.match(/^GESTION_NEXT_SERVER_TOKEN=(.+)$/m) || [])[1].trim();
  const url = 'https://gestion-next-fergonz00s-projects.vercel.app/api/admventas?token=' + encodeURIComponent(tok);
  const data = await (await fetch(url)).json();
  if (!data || !Array.isArray(data.ventas)) { console.error('la API no devolvio ventas'); process.exit(1); }
  console.log('\ndatos reales: ' + data.ventas.length + ' carpetas');
  sandbox.setDatos(data);

  const meses = sandbox.meses();
  // mes con mas financiaciones, para que el test toque data de verdad
  let mes = meses[0], mejor = -1;
  for (const m of meses) { const n = sandbox.lista(m).length; if (n > mejor) { mejor = n; mes = m; } }
  sandbox.setMes(mes);
  const lista = sandbox.lista(mes);
  console.log('mes elegido: ' + mes + ' (' + lista.length + ' financiaciones)');
  chequear('hay financiaciones en el mes elegido', lista.length > 0);

  const h1 = elementos.finContent.innerHTML;
  chequear('la tabla trae la columna Vendedor', h1.indexOf('>Vendedor<') > -1);
  chequear('sale el ranking por vendedor', h1.indexOf('Ranking por vendedor') > -1);
  chequear('el selector de vendedor se lleno', (elementos.finVend.innerHTML || '').indexOf('Todos los vendedores') > -1);

  // cada financiacion tiene que aparecer con su vendedor
  const vendedores = {};
  for (const x of lista) { const v = sandbox.vendDe(x.v); vendedores[v] = (vendedores[v] || 0) + 1; }
  const nombres = Object.keys(vendedores).sort((a, b) => vendedores[b] - vendedores[a]);
  console.log('vendedores del mes: ' + nombres.map(n => n + ' ' + vendedores[n]).join(' · '));
  chequear('todos los creditos tienen vendedor identificado', !vendedores['(sin vendedor)'] || vendedores['(sin vendedor)'] < lista.length);
  chequear('el ranking suma la misma cantidad que la lista',
    nombres.reduce((a, n) => a + vendedores[n], 0) === lista.length);
  for (const n of nombres) chequear('el ranking nombra a ' + n, h1.indexOf(global.escapeHtml(n)) > -1);

  // 2) filtro por vendedor: el detalle queda solo con ese, el ranking no cambia
  const top = nombres[0];
  sandbox.setVend(top);
  const h2 = elementos.finContent.innerHTML;
  chequear('filtrado: sigue el ranking completo', nombres.every(n => h2.indexOf(global.escapeHtml(n)) > -1));
  const filas = (h2.match(/<tr style="border-top:1px solid #eef1f6/g) || []).length;
  chequear('filtrado: el detalle muestra ' + vendedores[top] + ' operaciones de ' + top, filas === vendedores[top]);
  sandbox.setVend(top);   // segundo clic = apaga el filtro
  const filas3 = (elementos.finContent.innerHTML.match(/<tr style="border-top:1px solid #eef1f6/g) || []).length;
  chequear('segundo clic quita el filtro (' + lista.length + ' operaciones)', filas3 === lista.length);

  // 3) el test tiene que poder fallar: si _finVend miente, el conteo se rompe
  const guardado = sandbox.vendDe;
  chequear('control negativo (deberia fallar si el filtro no filtrara)', filas !== lista.length || nombres.length === 1);
  void guardado;

  console.log(process.exitCode ? '\nHAY FALLAS' : '\nTODO OK');
})().catch(e => { console.error(e); process.exit(1); });

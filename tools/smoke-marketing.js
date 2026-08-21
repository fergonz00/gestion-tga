// Smoke test del bloque de marketing del portal: corre las funciones de render
// reales contra los datos reales de la API. Es lo que habria cachado el
// "fmt is not defined" antes de publicarlo.
const fs = require('fs');
const path = 'C:/proyectos/gestion-tga/index.html';
const html = fs.readFileSync(path, 'utf8');

const ini = html.indexOf('let marketingData = null;');
const fin = html.indexOf('async function loadResumen() {');
if (ini < 0 || fin < 0) { console.error('no encontre el bloque'); process.exit(1); }
const codigo = html.slice(ini, fin);

// --- stubs del navegador y de los helpers del portal ---
const elementos = {};
global.document = {
  getElementById: (id) => elementos[id] || (elementos[id] = { value: 'mes', textContent: '', innerHTML: '', disabled: false }),
};
global.escapeHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
global.fmtPesos = (n) => '$' + Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });
global.fmtPct = (n) => (n == null ? '—' : Math.round(n) + '%');
global.kpi = (l, v, s, c) => `[kpi ${l}=${v}]`;
global.GESTION_NEXT_URL = 'https://gestion-next-fergonz00s-projects.vercel.app';

eval(codigo);

const B = global.GESTION_NEXT_URL + '/api';
const get = async (u) => {
  const r = await fetch(u);
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
};

(async () => {
  const mes = _mkMes();
  console.log('ventana del Resumen:', mes.desde, 'a', mes.hasta);

  const [meta, inv] = await Promise.all([
    get(`${B}/meta/analisis?desde=${mes.desde}&hasta=${mes.hasta}`),
    get(`${B}/marketing/inversiones?desde=${mes.desde}&hasta=${mes.hasta}`),
  ]);

  const casos = [
    ['datos reales del mes', meta, inv],
    ['sin inversiones por lead', meta, { canales: [], meses: [], total: {} }],
    ['sin gasto de Meta', { total: {}, anuncios: [], meses: [] }, inv],
    ['todo vacio', { total: {}, anuncios: [], meses: [] }, { canales: [], meses: [], total: {} }],
    ['payloads null', null, null],
  ];

  let fallos = 0;
  for (const [nombre, m, i] of casos) {
    try {
      const tt = _mkTotales(m, i);
      const ref = tt.comercial ? Math.round(tt.gasto / tt.comercial) : 0;
      const salida = [
        _mkTablaInversiones(i, ref, true),
        _mkTablaInversiones(i, ref, false),
        _mkTablaMeses(i),
        _mkTablaMesesMeta(m),
        ((m && m.anuncios) || []).map(a => String(_mkEnAire(a))).join(','),
      ].join('');
      if (/undefined|NaN|\[object Object\]/.test(salida)) {
        console.log(`  ✗ ${nombre}: la salida tiene undefined/NaN`);
        fallos++;
      } else {
        console.log(`  ✓ ${nombre} (gasto ${tt.gasto}, ${salida.length} chars)`);
      }
    } catch (e) {
      console.log(`  ✗ ${nombre}: ${e.message}`);
      fallos++;
    }
  }

  // El bloque del Resumen tal cual lo arma renderResumen, con las mismas globales.
  global.marketingMes = meta;
  global.marketingInvMes = inv;
  try {
    const trozo = html.slice(html.indexOf('  // ----- MARKETING -----'), html.indexOf('  // ----- SALDOS -----'));
    let h = '';
    eval('(function(){ ' + trozo.replace(/^\s*h \+=/gm, 'h +=') + ' return h; })()');
    console.log('  ✓ bloque del Resumen arma sin romper');
  } catch (e) {
    console.log('  ✗ bloque del Resumen:', e.message);
    fallos++;
  }

  console.log(fallos ? `\nFALLARON ${fallos}` : '\nTODO OK');
  process.exit(fallos ? 1 : 0);
})();

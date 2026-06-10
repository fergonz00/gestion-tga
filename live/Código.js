/**
 * gestion-tga · Apps Script de la planilla ESPEJO
 * Spreadsheet: https://docs.google.com/spreadsheets/d/1M7NedFVQU4aGdN6JU5-QgxEYJTEm-iRjN9eOkIrifPQ/edit
 *
 * Hoja: la primera de la planilla (donde está pegado el IMPORTRANGE de "stock"
 * de la planilla madre 1KvuRZzH...). Si el día de mañana hay varias hojas y la
 * de stock no es la primera, se busca por nombre 'stock'.
 *
 * Mapa de columnas (A..P) — espejo de la hoja "stock" de la planilla madre:
 *   A  serie
 *   B  fecha fc
 *   C  unidad (modelo + versión)
 *   D  color
 *   E  monto fc
 *   F  pago unidad (PAGA / fecha / vacío)
 *   G  vendido (modelo o NA / #N/A)
 *   H  Oferta actual
 *   I  rdo actual (%)
 *   J  lista
 *   K  dto actual (%)
 *   L  dto pedido (%)
 *   M  rdo con dto pedido (%)
 *   N  precio pedido
 *   O  rdo con precio pedido (%)  [el header en la planilla dice "rdo con dto pedido" — Fer dijo que es typo]
 *   P  EXPOSICION (ENTRE RIOS / INDEPENDENCIA / vacío)
 *
 * Publicación: Deploy → Web app · Execute as: Me · Who: Anyone (con token)
 */

const TOKEN = 'tga-gestion-R7nQ4xK8jL';

// Flete y Formularios: total fijo que la oferta del portal trae incluido.
// Para comparar contra factura+accesorios hay que descontárselo a la oferta.
const FYF = 1110000;

// Tolerancia en pesos para considerar "vendió al baratito" (igual). Fuera de
// este margen cae a 'mejor' (cliente pagó más) o 'peor' (cliente pagó menos).
const BARATITO_TOLERANCIA = 10000;

// Mes mínimo desde el cual mostramos ventas (los anteriores no se incluyen
// porque los números no estaban alineados todavía).
const VENTAS_MES_MINIMO = '2026-03';

// Mes mínimo de patentamientos (Fer pidió desde abril).
const PATENTAMIENTOS_MES_MINIMO = '2026-04';

// Vendedores oficiales — siempre aparecen en el ranking del mes aunque
// tengan 0 ventas. El orden acá no importa (el ranking se ordena por
// cantidad descendente en el frontend).
const VENDEDORES_OFICIALES = [
  'Jorge Fazzini', 'Jose Castro', 'Marta Castro', 'Antonio Loisi',
  'Ines Alonso', 'Gisela Buena', 'Tomas Bandiera', 'Julian Naddeo', 'TG',
];

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (String(params.token || '').trim() !== TOKEN) {
    return jsonResponse({ error: 'forbidden' });
  }

  const tipo  = String(params.tipo  || 'stock').toLowerCase();
  const fresh = String(params.fresh || '') === '1';
  try {
    if (tipo === 'stock')           return jsonResponse(_cached('stock',          CACHE_TTL_SEC, fresh, getStock));
    if (tipo === 'ventas')          return jsonResponse(_cached('ventas',         CACHE_TTL_SEC, fresh, getVentas));
    if (tipo === 'patentamientos')  return jsonResponse(_cached('patentamientos', CACHE_TTL_SEC, fresh, getPatentamientos));
    if (tipo === 'incentivos')      return jsonResponse(_cached('incentivos_' + (params.mes || ''), CACHE_TTL_SEC, fresh, () => getIncentivos(params)));
    if (tipo === 'pagosvw')         return jsonResponse(getPagosVW(params));      // sin cache
    if (tipo === 'objetivos')         return jsonResponse(getObjetivosPat());       // sin cache (es chico)
    if (tipo === 'objetivoscompras')  return jsonResponse(getObjetivosCompras());   // sin cache (es chico)
    if (tipo === 'industria')         return jsonResponse(getIndustria());          // sin cache (es chico)
    if (tipo === 'ventasdebug')     return jsonResponse(getVentasDebug(params));  // sin cache
    if (tipo === 'oversoft')        return jsonResponse(getOversoft(params));     // proxy a la réplica Supabase
    if (tipo === 'saldoscompras')   return jsonResponse(_cached('saldoscompras', CACHE_TTL_SEC, fresh, getSaldosCompras)); // proxy a saldos-tga (paga/impaga + vencimiento)
    if (tipo === 'madre')           return jsonResponse(getMadreSheet(params));   // lectura cruda de una pestaña de la planilla madre
    if (tipo === 'precios')         return jsonResponse(_cached('precios', CACHE_TTL_SEC, fresh, getPreciosActualBT)); // espejo de precios/ganancia de "Actual BT"
    return jsonResponse({ error: 'tipo desconocido: ' + tipo });
  } catch (err) {
    return jsonResponse({ error: String(err && err.message || err) });
  }
}

// Lectura cruda de una pestaña de la planilla MADRE (1Kvu...). La espejo tiene
// acceso de lectura a la madre (por los IMPORTRANGE), así que openById funciona
// corriendo "as Me". Sirve para auditar/migrar pestañas que no están espejadas
// (ej. "cc", "Actual BT"). Uso: ?tipo=madre&sheet=cc[&max=200]
const MADRE_ID = '1KvuRZzHuVpWSppZqT8xDf8WSrplR-vYzeY0gQPftlpQ';
// Whitelist: SOLO pestañas de incentivos/BT. El token va en el frontend público,
// así que NO exponemos haberes, clientes, financiaciones, etc.
const MADRE_SHEETS_OK = [
  'cc', 'Actual BT', 'BT anteriores', 'Mayo 2026 BT', 'Marzo 26 BT',
  'Febrero 26 BT', 'chequeo incentivos', 'cupos', 'listas de precios', 'aumentos vw',
];
function getMadreSheet(params) {
  const nombre = String(params.sheet || '').trim();
  if (!nombre) return { hojasPermitidas: MADRE_SHEETS_OK };  // sin sheet → lista la whitelist
  if (MADRE_SHEETS_OK.indexOf(nombre) === -1) {
    return { error: 'pestaña no permitida', hojasPermitidas: MADRE_SHEETS_OK };
  }
  const ss = SpreadsheetApp.openById(MADRE_ID);
  const sh = ss.getSheetByName(nombre);
  if (!sh) return { error: 'no existe la pestaña "' + nombre + '"', hojas: ss.getSheets().map(s => s.getName()) };
  const desde = Math.max(1, Number(params.from) || 1);          // fila inicial (1-based)
  const cuantas = Math.min(Number(params.max) || 300, 2000);     // cantidad de filas
  const totalRows = sh.getLastRow();
  if (desde > totalRows) return { sheet: nombre, totalFilas: totalRows, from: desde, filas: 0, valores: [] };
  const lastCol = sh.getLastColumn();
  const nFilas = Math.min(cuantas, totalRows - desde + 1);
  if (nFilas < 1 || lastCol < 1) return { sheet: nombre, totalFilas: totalRows, filas: 0, valores: [] };
  const rng = sh.getRange(desde, 1, nFilas, lastCol);
  // formulas=1 → devuelve las fórmulas (celda vacía = constante, no fórmula)
  if (String(params.formulas || '') === '1') {
    return { sheet: nombre, totalFilas: totalRows, from: desde, filas: nFilas, cols: lastCol, formulas: rng.getFormulas() };
  }
  return { sheet: nombre, totalFilas: totalRows, from: desde, filas: nFilas, cols: lastCol, valores: rng.getValues() };
}

// Espejo de los precios calculados en "Actual BT" de la madre. Devuelve, por
// modelo, el precio de oferta (AH) y la ganancia (AO) tal cual los calcula Fer,
// más TODO el desglose para la solapa "Baratito": dto vw, stock, vendidos,
// prom gcia, incentivos, costos (IIBB/comisión/cheque) y los insumos del
// SIMULADOR de dto TG. NO recalcula la salida (la espejo no puede diferir);
// los costos/simulador se derivan replicando las fórmulas exactas del Sheet
// (verificadas: reproducen AO al peso). Cols 0-based de "Actual BT":
//   B=1 modelo · C=2 lista · D=3 dtoTG · E=4 dto vw · F=5 stock ini · G=6 vendidos
//   H=7 stock · M=12 vendidos 60d · N=13 prom gcia · U=20 cc90 · V=21 cc_c/iva
//   X=23 cupo · Y=24 táctico · Z=25 whosale · AA=26 adic1 · AB=27 adic2
//   AC=28 "otros" (ratio de incentivos s/lista, lo usa AM) · AL=37 costoRep
//   AH=33 precioOferta(con fyf) · AM=38 gcia s/lista · AN=39 gcia neta $ · AO=40 gcia/lista
//
// Fórmulas del Sheet (ventaNeta = lista*(1-dtoTG)):
//   AH = ventaNeta + FYF(1.110.000)
//   AM = (ventaNeta - costoRep + cc90Iva + otros*lista) / lista
//   AN = AM*lista - 0,0135*(ventaNeta/1,21) - 0,014*(ventaNeta/1,21) - 0,0085*ventaNeta
//   AO = AN / lista        (IIBB 1,35% y comisión 1,40% sobre neto de IVA; cheque 0,85% s/ventaNeta)
const PRECIOS_FYF      = 1110000;   // flete y formularios, sumado en AH
const PRECIOS_IIBB     = 0.0135;    // 1,35% sobre ventaNeta/1,21
const PRECIOS_COMISION = 0.014;     // 1,40% sobre ventaNeta/1,21
const PRECIOS_CHEQUE   = 0.0085;    // 0,85% sobre ventaNeta (con IVA)
function getPreciosActualBT() {
  const ss = SpreadsheetApp.openById(MADRE_ID);
  const sh = ss.getSheetByName('Actual BT');
  if (!sh) return { error: 'no existe "Actual BT"' };
  const lastRow = sh.getLastRow();
  if (lastRow < 3) return { modelos: [] };
  const v = sh.getRange(1, 1, lastRow, 41).getValues();   // hasta col AO
  const n = x => Number(x) || 0;
  const out = [];
  for (let r = 2; r < v.length; r++) {           // datos desde fila 3
    const modelo = String(v[r][1] || '').trim();
    if (!/^VW\s/i.test(modelo)) continue;        // solo modelos VW (descarta filas basura)
    const lista = n(v[r][2]);
    if (lista <= 0) continue;
    const dtoTG    = n(v[r][3]);
    const costoRep = n(v[r][37]);
    const cc90Iva  = n(v[r][21]);
    const otros    = n(v[r][28]);                // AC — ratio de incentivos s/lista
    const ventaNeta = lista * (1 - dtoTG);
    // Costos que descuenta AN (en $), para mostrarlos desglosados
    const iibb     = PRECIOS_IIBB    * (ventaNeta / 1.21);
    const comision = PRECIOS_COMISION * (ventaNeta / 1.21);
    const cheque   = PRECIOS_CHEQUE  * ventaNeta;
    out.push({
      modelo:        modelo,
      lista:         lista,
      dtoTG:         dtoTG,                       // % (ej 0.33)
      dtoVw:         n(v[r][4]),                  // E — descuento VW
      precioOferta:  n(v[r][33]),                // AH — con fyf, lo que pasa Fer
      costoRep:      costoRep,                    // AL
      gananciaPct:   n(v[r][40]),                // AO — gcia / precio de lista
      gananciaPesos: n(v[r][39]),                // AN
      stock:         n(v[r][7]),                 // H — stock actual
      stockInicial:  n(v[r][5]),                 // F
      vendidos:      n(v[r][6]),                 // G — vendidos (ventana del mes)
      vendidos60:    n(v[r][12]),                // M — vendidos 60 días
      promGcia:      n(v[r][13]),                // N — prom gcia/lista por venta (ratio real PVs)
      costos: {                                  // lo que descuenta AN (gcia neta)
        iibb:     iibb,
        comision: comision,
        cheque:   cheque,
        fyf:      PRECIOS_FYF,
      },
      incentivos: {
        cc90:       n(v[r][20]),
        cc90Iva:    cc90Iva,
        tactico:    n(v[r][24]),
        whosale:    n(v[r][25]),
        adicional1: n(v[r][26]),
        adicional2: n(v[r][27]),
        cupo:       n(v[r][23]),
      },
      // Insumos del simulador de dto TG (constantes al variar el dto):
      sim: { lista: lista, costoRep: costoRep, cc90Iva: cc90Iva, otros: otros },
    });
  }
  return {
    modelos: out, total: out.length, fuente: 'Actual BT (madre)',
    constantes: { fyf: PRECIOS_FYF, iibb: PRECIOS_IIBB, comision: PRECIOS_COMISION, cheque: PRECIOS_CHEQUE, iva: 1.21 },
    updatedAt: new Date().toISOString(),
  };
}

// POST endpoint para guardar pagos parseados de los PDFs de VW.
// Acepta dos formatos para evitar el problema de redirect POST→GET en browsers:
//   1. FormData con field 'payload' (preferido desde el frontend)
//   2. Body crudo JSON (compat con curl/PowerShell)
function doPost(e) {
  try {
    let body = {};
    // Formato 1: FormData con 'payload'
    if (e && e.parameter && e.parameter.payload) {
      body = JSON.parse(e.parameter.payload);
    } else if (e && e.postData && e.postData.contents) {
      // Formato 2: body crudo JSON
      try { body = JSON.parse(e.postData.contents); } catch (_) { body = {}; }
    }
    if (String(body.token || '').trim() !== TOKEN) {
      return jsonResponse({ error: 'forbidden' });
    }
    const accion = String(body.accion || 'guardar').toLowerCase();
    if (accion === 'guardar')              return jsonResponse(savePagosVW(body.pagos || []));
    if (accion === 'eliminar')             return jsonResponse(deletePagoVW(body.ncNum));
    if (accion === 'setobjetivo')          return jsonResponse(setObjetivoPat(body));
    if (accion === 'setobjetivocompra')    return jsonResponse(setObjetivoCompra(body));
    if (accion === 'setindustria')         return jsonResponse(setIndustria(body));
    if (accion === 'setbaratitosnapshot')  return jsonResponse(saveBaratitoSnapshots(body.snapshots || []));
    if (accion === 'resetbaratito')        return jsonResponse(resetBaratitoBaseline());
    if (accion === 'initbaratitobaseline') return jsonResponse(initBaratitoBaselineIfEmpty());
    return jsonResponse({ error: 'accion desconocida: ' + accion });
  } catch (err) {
    return jsonResponse({ error: String(err && err.message || err) });
  }
}

// TTL del cache server-side. La primera request del minuto paga ~3-5s leyendo
// IMPORTRANGE; las siguientes vuelven en ~200ms. Con auto-refresh cada 10 min
// y el botón "Actualizar" que pasa &fresh=1, 90s es invisible para el usuario.
const CACHE_TTL_SEC = 90;

// Cache del response completo por tipo. Si el valor supera 100KB (límite de
// CacheService) el put tira excepción, lo ignoramos y devolvemos fresco igual.
function _cached(key, ttlSec, fresh, fn) {
  const cache = CacheService.getScriptCache();
  if (!fresh) {
    const hit = cache.get(key);
    if (hit) {
      try {
        const parsed = JSON.parse(hit);
        parsed._cached = true;  // útil para debug en frontend
        return parsed;
      } catch (e) { /* cache corrupto, refetch */ }
    }
  }
  const data = fn();
  try {
    cache.put(key, JSON.stringify(data), ttlSec);
  } catch (e) { /* >100KB o cuota, no cacheable */ }
  return data;
}

// Devuelve TODAS las filas de la hoja ventas sin filtrar (excepto vacías
// totales), con las columnas crudas que más nos importan + el mesKey calculado.
// Para diagnosticar conteos. Opcional: ?desde=N&hasta=M filtra por # venta.
function getVentasDebug(params) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('ventas') || ss.getSheets()[0];
  if (!sh) throw new Error('No hay hoja ventas');

  const lastRow = sh.getLastRow();
  const range   = sh.getRange(1, 1, lastRow, 26);
  const display = range.getDisplayValues();
  const raw     = range.getValues();

  const desde = params.desde ? parseInt(params.desde, 10) : null;
  const hasta = params.hasta ? parseInt(params.hasta, 10) : null;

  const filas = [];
  for (let i = 0; i < display.length; i++) {
    const drow = display[i];
    const rrow = raw[i];
    const num    = drow[0];
    const fechaS = drow[1];
    const serie  = drow[7];
    if (!num && !fechaS && !serie) continue; // fila vacía total

    const fecha = _parseFecha(rrow[1], drow[1]);
    const numN = toNumber(rrow[0]);
    if (desde !== null && numN < desde) continue;
    if (hasta !== null && numN > hasta) continue;

    filas.push({
      sheetRow: i + 1,                          // fila real en la planilla (1-based)
      A:        String(num || ''),
      B:        String(fechaS || ''),
      H:        String(serie || ''),
      parsedFecha: fecha ? _isoDate(fecha) : null,
      mesKey:      fecha ? _yyyyMm(fecha) : null,
    });
  }

  return { filas: filas, total: filas.length };
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// =======================================================================
// OVERSOFT — proxy server-side a la réplica de SOLO LECTURA de Tito González
// (Supabase project "Oversoft"). La anon key vive acá en el backend; el
// navegador nunca la ve (recomendación de seguridad del doc ACCESO-GESTION).
//
// Uso desde el front (ver helper oversoft() en index.html):
//   ?tipo=oversoft&tabla=detcash&qs=<querystring PostgREST URL-encoded>[&count=1]
//
//   - tabla: solo las de la whitelist (OVERSOFT_TABLAS).
//   - qs:    todo lo que va después del "?" de PostgREST, ej:
//              select=fecha,importe,motivo,referencia&order=fecha.desc&limit=10
//            El front debe %-encodear los valores con espacios/caracteres raros
//            (ej. referencia=eq.PV%2008015/1) y mandar el qs entero como param.
//   - count=1: pide el total (header Prefer: count=exact) y devuelve
//              { count: <total>, rows: [...] } en vez del array pelado.
//
// Devuelve el array de filas tal cual PostgREST (o {count, rows} si count=1).
// =======================================================================
const OVERSOFT_URL = 'https://lezxwesdsqgracawcwcy.supabase.co/rest/v1';
const OVERSOFT_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxlenh3ZXNkc3FncmFjYXdjd2N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2MDE3ODcsImV4cCI6MjA5NjE3Nzc4N30.RU9P3pFpJSamsXQrinwWQpvmktBdYarUC3ksaqgw-JQ';
// Whitelist de tablas que el proxy deja consultar (sumá acá cuando agreguen más).
const OVERSOFT_TABLAS = ['detcash', 'servicios_ordenes', 'unidades', 'modelos'];

function getOversoft(params) {
  const tabla = String(params.tabla || '').trim().toLowerCase();
  if (OVERSOFT_TABLAS.indexOf(tabla) === -1) {
    return { error: 'tabla no permitida: ' + tabla, permitidas: OVERSOFT_TABLAS };
  }

  const qs        = String(params.qs || '').trim();
  const wantCount = String(params.count || '') === '1';
  const url = OVERSOFT_URL + '/' + tabla + (qs ? '?' + qs : '');

  const headers = { apikey: OVERSOFT_KEY, Authorization: 'Bearer ' + OVERSOFT_KEY };
  if (wantCount) headers.Prefer = 'count=exact';

  const res  = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
  const code = res.getResponseCode();
  const text = res.getContentText();

  if (code < 200 || code >= 300) {
    return { error: 'oversoft ' + code, detalle: text, url: url };
  }

  const rows = JSON.parse(text);
  if (!wantCount) return rows;

  // Content-Range viene como "0-9/123" → total = lo de después de la barra.
  const cr    = res.getAllHeaders()['Content-Range'] || '';
  const total = cr.indexOf('/') > -1 ? Number(cr.split('/')[1]) : rows.length;
  return { count: total, rows: rows };
}

// Corré esta función UNA vez desde el editor (selector de función → Ejecutar)
// para autorizar el permiso de red (script.external_request). Mirá el resultado
// en el Registro de ejecución. No hace falta redeployar después.
function _testOversoft() {
  Logger.log(getOversoft({ tabla: 'detcash', qs: 'select=fecha,importe&order=fecha.desc&limit=3' }));
}

// =======================================================================
// SALDOS — proxy a saldos-tga (tipo=compras) para el cruce paga/impaga + venc.
// =======================================================================
// La solapa "Stock Oversoft" cruza por serie las unidades con la planilla de
// compras de saldos-tga, que es la única fuente que tiene el VENCIMIENTO del
// pago a VW. Pasa por acá (server-side) para evitar CORS y cachear el response.
// Devolvemos solo lo necesario (response chico para que entre en el cache).
const SALDOS_URL   = 'https://script.google.com/macros/s/AKfycbyRTqqpQMjKDL82Z5Cjd9IJWPQnINF0LAEvji8FizfXMBO8Cz0IVbTSnQnNmH_rRxz9yg/exec';
const SALDOS_TOKEN = 'tga-saldos-K9Mx2P7vQ';

function getSaldosCompras() {
  const url = SALDOS_URL + '?token=' + encodeURIComponent(SALDOS_TOKEN) + '&tipo=compras';
  const res  = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    return { error: 'saldos ' + code, unidades: [] };
  }
  let data;
  try { data = JSON.parse(res.getContentText()); }
  catch (e) { return { error: 'saldos json invalido', unidades: [] }; }
  if (data && data.error) return { error: 'saldos: ' + data.error, unidades: [] };

  const slim = (data.unidades || []).map(function (u) {
    return {
      serie:     String(u.serie || '').trim(),
      modelo:    String(u.modelo || '').trim(),
      fechaFc:   String(u.fechaFc || '').trim(),
      vence:     String(u.vence || '').trim(),
      fechaPago: String(u.fechaPago || '').trim(),
      total:     Number(u.total || 0),
      importe:   Number(u.importe || 0),
      impaga:    !!u.impaga,
    };
  });
  return { unidades: slim, updatedAt: data.updatedAt || new Date().toISOString() };
}

function _testSaldosCompras() {
  const r = getSaldosCompras();
  Logger.log('unidades: ' + (r.unidades || []).length + ' · impagas: ' + (r.unidades || []).filter(function (u) { return u.impaga; }).length);
}

// =======================================================================
// STOCK
// =======================================================================
function getStock() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('stock') || ss.getSheets()[0];
  if (!sh) throw new Error('No hay hojas en la planilla');

  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    return { unidades: [], updatedAt: new Date().toISOString() };
  }

  // A..P = 16 columnas
  const range   = sh.getRange(1, 1, lastRow, 16);
  const display = range.getDisplayValues();
  const raw     = range.getValues();

  // El IMPORTRANGE arranca el espejo en la fila 1 — la primera fila es el header.
  // Por las dudas, busco la fila cuyo A diga "serie" en las primeras 5 filas.
  let headerRow = -1;
  for (let i = 0; i < Math.min(5, display.length); i++) {
    if (String(display[i][0] || '').toLowerCase().trim() === 'serie') {
      headerRow = i;
      break;
    }
  }
  if (headerRow < 0) headerRow = 0;

  const unidades = [];
  const hoy = new Date();

  for (let i = headerRow + 1; i < display.length; i++) {
    const drow = display[i];
    const rrow = raw[i];
    const serie = String(drow[0] || '').trim();
    if (!serie) continue;

    // --- B: fecha factura → ISO + antigüedad en días
    const fechaFc = _parseFecha(rrow[1], drow[1]);
    const antigDias = fechaFc ? Math.floor((hoy - fechaFc) / 86400000) : null;
    const fechaFcIso = fechaFc ? _isoDate(fechaFc) : '';

    // --- F: pago unidad → estado + fecha (si la hay)
    const pago = _parsePago(rrow[5], drow[5]);

    // --- G: vendido → bool + modelo del vendido
    const vendidoStr = String(drow[6] || '').trim();
    const esVendido = !!vendidoStr && !/^(NA|N\/A|#N\/A|#REF!|#ERROR!|#VALUE!)$/i.test(vendidoStr);

    // --- P: exposición (normalizo a UPPER y solo dejo las dos válidas)
    const expRaw = String(drow[15] || '').trim().toUpperCase().replace('Í', 'I');
    const exposicion = (expRaw === 'ENTRE RIOS' || expRaw === 'INDEPENDENCIA') ? expRaw : '';

    unidades.push({
      serie:         serie,                                       // A
      fechaFcIso:    fechaFcIso,                                  // B → ISO yyyy-mm-dd
      fechaFcStr:    String(drow[1] || '').trim(),                // B → display
      antigDias:     antigDias,                                   // calculada
      unidad:        String(drow[2] || '').trim(),                // C
      color:         String(drow[3] || '').trim(),                // D
      montoFc:       toNumber(rrow[4]),                           // E
      pagoEstado:    pago.estado,                                 // F → 'pagada' | 'impaga' | 'otro'
      pagoFechaIso:  pago.fechaIso,                               // F (si pagada con fecha)
      pagoStr:       String(drow[5] || '').trim(),                // F → display
      vendido:       esVendido,                                   // G
      vendidoModelo: esVendido ? vendidoStr : '',                 // G
      ofertaActual:  toNumber(rrow[7]),                           // H
      rdoActualPct:  _pctFromDisplay(drow[8], rrow[8]),           // I (en puntos %, ej 18.5)
      lista:         toNumber(rrow[9]),                           // J
      dtoActualPct:  _pctFromDisplay(drow[10], rrow[10]),         // K
      dtoPedidoPct:  _pctFromDisplay(drow[11], rrow[11]),         // L
      rdoConDtoPct:  _pctFromDisplay(drow[12], rrow[12]),         // M
      precioPedido:  toNumber(rrow[13]),                          // N
      rdoConPrecioPct: _pctFromDisplay(drow[14], rrow[14]),       // O
      exposicion:    exposicion,                                  // P
    });
  }

  return {
    unidades:  unidades,
    updatedAt: new Date().toISOString(),
  };
}

// =======================================================================
// VENTAS
// =======================================================================
// Hoja "ventas" = espejo (IMPORTRANGE) de "PVs" de la planilla madre.
// Columnas que importan al front (A..J + X..Z):
//   A # venta del mes      H # serie
//   B fecha preventa       I modelo vendido
//   C # preventa           J color vendido
//   D monto fc venta       X gcia x venta $
//   E IVA %                Y gcia x venta %
//   F acc                  Z gcia neta acumulada $
//   G costo histórico
//
// Filtro: solo desde VENTAS_MES_MINIMO (2026-03) en adelante.
// Orden: igual que la planilla (no reordenamos).
function getVentas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('ventas') || ss.getSheets().find(s =>
    /^pvs?$/i.test(s.getName()) || /^ventas/i.test(s.getName())
  );
  if (!sh) throw new Error('No encontré la hoja "ventas"');

  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    return { ventas: [], meses: [], updatedAt: new Date().toISOString() };
  }

  // Leemos A..AM (39 cols). Necesitamos hasta AG (vendedor, col 33),
  // pero leo el rango entero por las dudas que Fer sume más adelante.
  const range   = sh.getRange(1, 1, lastRow, 39);
  const display = range.getDisplayValues();
  const raw     = range.getValues();

  // Header detection: primera fila cuyo A diga algo tipo "n" / "nro" / "venta"
  // y cuyo B diga "fecha". Fallback: fila 1.
  let headerRow = -1;
  for (let i = 0; i < Math.min(5, display.length); i++) {
    const a = String(display[i][0] || '').toLowerCase().trim();
    const b = String(display[i][1] || '').toLowerCase().trim();
    if (/(nro|n\b|venta|#)/.test(a) && /fecha/.test(b)) { headerRow = i; break; }
  }
  if (headerRow < 0) headerRow = 0;

  const ventas = [];
  const cuentaPorMes = {};   // 'yyyy-mm' → cuántas

  for (let i = headerRow + 1; i < display.length; i++) {
    const drow = display[i];
    const rrow = raw[i];

    // Fecha preventa (col B)
    const fechaPv = _parseFecha(rrow[1], drow[1]);
    if (!fechaPv) continue;                              // sin fecha → saltea
    const mesKey = _yyyyMm(fechaPv);
    if (mesKey < VENTAS_MES_MINIMO) continue;            // pre-marzo: ignorar

    // Número de venta (col A) — saltea filas vacías sin número y sin serie
    const ventaNum = toNumber(rrow[0]);
    const serie    = String(drow[7] || '').trim();
    if (!ventaNum && !serie) continue;

    cuentaPorMes[mesKey] = (cuentaPorMes[mesKey] || 0) + 1;

    // AG = col 33, index 32 → vendedor (texto libre, mapeamos a oficial)
    const vendedorRaw = String(drow[32] || '').trim();
    const vendedor    = _matchVendedor(vendedorRaw);   // string oficial o null

    ventas.push({
      ventaNum:        ventaNum,                                // A
      fechaPvIso:      _isoDate(fechaPv),                       // B → ISO
      fechaPvStr:      String(drow[1] || '').trim(),            // B → display
      mesKey:          mesKey,                                  // 'yyyy-mm'
      preventaNum:     String(drow[2] || '').trim(),            // C
      montoFc:         toNumber(rrow[3]),                       // D
      iva:             _pctFromDisplay(drow[4], rrow[4]),       // E (puntos %)
      acc:             toNumber(rrow[5]),                       // F (asumimos monto)
      accStr:          String(drow[5] || '').trim(),            // F display por las dudas
      costoHist:       toNumber(rrow[6]),                       // G
      serie:           serie,                                   // H
      modelo:          String(drow[8] || '').trim(),            // I
      color:           String(drow[9] || '').trim(),            // J
      gciaVtaPesos:    toNumber(rrow[23]),                      // X
      gciaVtaPct:      _pctFromDisplay(drow[24], rrow[24]),     // Y
      gciaNetaAcum:    toNumber(rrow[25]),                      // Z
      vendedor:        vendedor,                                // AG → oficial
      vendedorRaw:     vendedorRaw,                             // AG → tal cual
    });
  }

  // Lista de meses presentes, ordenados desc (mes más reciente primero)
  const meses = Object.keys(cuentaPorMes).sort().reverse().map(k => ({
    mesKey: k,
    label:  _mesLabel(k),
    cuenta: cuentaPorMes[k],
  }));

  // Snapshots de comparación contra baratito (key = # preventa).
  // El frontend los cruza por preventaNum y dispara el cálculo solo para las
  // ventas que todavía no tienen snapshot.
  const baratitoSnapshots = _readBaratitoSnapshots();

  return {
    ventas:    ventas,
    meses:     meses,
    mesActual: _yyyyMm(new Date()),
    vendedoresOficiales: VENDEDORES_OFICIALES,
    baratitoSnapshots: baratitoSnapshots,
    fyf:       FYF,
    baratitoTolerancia: BARATITO_TOLERANCIA,
    updatedAt: new Date().toISOString(),
  };
}

// Mapea un texto libre del campo "vendedor" a uno de los 9 oficiales,
// o devuelve null si no reconoce.
// Reglas:
//   - case + acento-insensitive
//   - "TG", "TG-PATRI", "TG ALGO", "Maximiliano..." → 'TG'
//   - Apellidos únicos: Fazzini, Loisi, Alonso, Buena, Bandiera, Naddeo
//   - Castro: si menciona "marta" → Marta; sino → Jose
function _matchVendedor(raw) {
  const n = _norm(raw);
  if (!n) return null;

  // TG (gerencia): la palabra "tg" como token (separadores: espacio, guion,
  // punto, coma), o "Maximiliano", o "Cata" (alias de gerencia).
  if (/(^|[\s\-.,])tg($|[\s\-.,])/.test(n)) return 'TG';
  if (n.indexOf('maximiliano') >= 0)         return 'TG';
  if (n.indexOf('cata') >= 0)                return 'TG';

  if (n.indexOf('fazzini')  >= 0) return 'Jorge Fazzini';
  if (n.indexOf('loisi')    >= 0) return 'Antonio Loisi';
  if (n.indexOf('alonso')   >= 0) return 'Ines Alonso';
  if (n.indexOf('buena')    >= 0) return 'Gisela Buena';
  if (n.indexOf('bandiera') >= 0) return 'Tomas Bandiera';
  // Naddeo: tolero typo "Nadeo" (con una D) — es frecuente en la planilla
  if (n.indexOf('naddeo') >= 0 || n.indexOf('nadeo') >= 0) return 'Julian Naddeo';

  // Castro: dos personas (Jose y Marta) — desambiguar por primer nombre
  if (n.indexOf('castro') >= 0 || n.indexOf('marta') >= 0 || /\bjose\b/.test(n)) {
    if (n.indexOf('marta') >= 0) return 'Marta Castro';
    return 'Jose Castro';
  }

  return null;  // No matchea ningún oficial → se reporta como "no reconocido"
}

function _norm(s) {
  // Lowercase, sin acentos, trim. Uso \u escape para que el regex sea claro
  // y no dependa de encoding del archivo.
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim();
}

// =======================================================================
// PATENTAMIENTOS
// =======================================================================
// Hoja "patentamientos" = espejo (IMPORTRANGE) de "adm de ventas".
// Mapeo real (confirmado por Fer 2026-05-14, headers de la madre):
//   A num                  L reventa o particular
//   B # PV                 M vendedor
//   C fecha PV             N usado SI/NO
//   D serie                O cliente
//   E chasis               P modelo
//   F mes patentamiento    Q localidad
//     (texto "ABRIL")      R fecha patentamiento (real)
//   G patenta TG/CL/RE     S dominio
//   H admin                T fecha pago VW (no usado)
//   I AA (tipo carpeta: TRAD / PLAN AHORRO / FINANCIA FRANCES)
//   J monto financiado (no usado)
//   K fecha liquidación crédito (no usado)
//
// Filtro: solo desde PATENTAMIENTOS_MES_MINIMO (2026-04).
// El mes se determina por la FECHA REAL de patentamiento (col R) cuando existe;
// si la carpeta todavía no está patentada, cae al texto de col F ("ABRIL"/etc).
// Esto matchea con cómo Fer cuenta (por fecha de patentamiento).
const _MES_TXT_A_NUM = {
  'enero':'01','febrero':'02','marzo':'03','abril':'04','mayo':'05',
  'junio':'06','julio':'07','agosto':'08','septiembre':'09','sept':'09',
  'octubre':'10','noviembre':'11','diciembre':'12'
};

// Tipo de carpeta canónico (col I "AA, Contado o financiado"). La planilla
// tiene variaciones libres por admin: "TRAD", "FINANCIADO VW", "FINANCIA VW",
// "FINANCIA NACION ROCIO", "FIANCIA GALICIA" (typo), etc. Lo agrupamos en 4
// buckets para que los desgloses no se vean fragmentados.
// Etiquetas cortas a propósito: los desgloses tienen ~90px para el label.
// Variantes largas se truncaban con ellipsis en las cards más angostas.
const TIPO_CARPETA_CANON = {
  TRAD:    'Contado',
  VW:      'VW',
  PLAN:    'Plan ahorro',
  EXTERNO: 'Banco externo',
};

function _normTipoCarpeta(raw) {
  const s0 = String(raw || '').trim();
  if (!s0) return '';
  const s = s0.toUpperCase()
    .replace(/[ÁÄÀÂ]/g,'A').replace(/[ÉËÈÊ]/g,'E').replace(/[ÍÏÌÎ]/g,'I')
    .replace(/[ÓÖÒÔ]/g,'O').replace(/[ÚÜÙÛ]/g,'U');
  if (/\bTRAD/.test(s) || /\bCONTAD/.test(s))                                                    return TIPO_CARPETA_CANON.TRAD;
  if (/PLAN.*AHORR|AHORR.*PLAN/.test(s))                                                         return TIPO_CARPETA_CANON.PLAN;
  // "Financia Francés" lo opera el banco Francés pero la financiación es VW
  // (cobramos como Financiado VW, no como banco externo).
  if (/FRANC[EÉ]S/.test(s))                                                                       return TIPO_CARPETA_CANON.VW;
  // Bancos externos reales: variantes y typos comunes
  if (/GALI?CI|GALICA|NACION|HSBC|SUPERVIELLE|MACRO|SANTANDER|BBVA|ICBC|PATAGONIA/.test(s))      return TIPO_CARPETA_CANON.EXTERNO;
  if (/\bVW\b|VOLKSWAGEN/.test(s))                                                               return TIPO_CARPETA_CANON.VW;
  // "FINANCIADO" / "FINANCIA" / "FIANCIA" / "FIANANCIA" sin marca → asumo VW (lo más común)
  if (/FI(N|A)A?NA?CI?[AO]/.test(s))                                                             return TIPO_CARPETA_CANON.VW;
  return s0;  // sin clasificar → devuelvo el raw
}

function getPatentamientos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('patentamientos')
    || ss.getSheets().find(s => /^pat/i.test(s.getName()) || /adm.*venta/i.test(s.getName()));
  if (!sh) throw new Error('No encontré la hoja "patentamientos"');

  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    return { carpetas: [], meses: [], updatedAt: new Date().toISOString() };
  }

  const range   = sh.getRange(1, 1, lastRow, 26);
  const display = range.getDisplayValues();
  const raw     = range.getValues();

  // Header detection — fila con "num" / "#" en A y "pv" en B
  let headerRow = -1;
  for (let i = 0; i < Math.min(5, display.length); i++) {
    const a = String(display[i][0] || '').toLowerCase().trim();
    const b = String(display[i][1] || '').toLowerCase().trim();
    if (/(num|nro|#)/.test(a) && /(pv|preventa)/.test(b)) { headerRow = i; break; }
  }
  if (headerRow < 0) headerRow = 0;

  const carpetas = [];
  const cuentaPorMes = {};

  for (let i = headerRow + 1; i < display.length; i++) {
    const drow = display[i];
    const rrow = raw[i];

    const num   = toNumber(rrow[0]);
    const pv    = String(drow[1] || '').trim();
    const serie = String(drow[3] || '').trim();
    if (!num && !pv && !serie) continue;

    // C = fecha PV (cuándo se vendió). Es la referencia de "qué año" cuando
    // sólo tenemos texto en col F. Sin fecha PV, no podemos garantizar que la
    // carpeta sea reciente → la descartamos (evita filas viejas con col F
    // "MAYO" que se contaban como mayo del año actual).
    const fechaPv  = _parseFecha(rrow[2], drow[2]);
    // R = fecha patentamiento real (puede determinar el mes)
    const fechaPat = _parseFecha(rrow[17], drow[17]);

    let mesKey;
    let mesKeyOrigen;
    if (fechaPat) {
      mesKey = _yyyyMm(fechaPat);
      mesKeyOrigen = 'fechaR';
    } else {
      const mesTxt = _norm(drow[5]);
      const mesNum = _MES_TXT_A_NUM[mesTxt];
      if (!mesNum) continue;
      if (!fechaPv) continue;
      // Si col F dice un mes anterior al de la PV asumimos que es el año
      // siguiente (ej. PV en diciembre y col F "ENERO").
      let anio = fechaPv.getFullYear();
      const mesPvNum = fechaPv.getMonth() + 1;
      if (parseInt(mesNum, 10) < mesPvNum) anio += 1;
      mesKey = anio + '-' + mesNum;
      mesKeyOrigen = 'colF';
    }
    if (mesKey < PATENTAMIENTOS_MES_MINIMO) continue;

    // M = vendedor → mapeo a oficial
    const vendedorRaw = String(drow[12] || '').trim();
    const vendedor    = _matchVendedor(vendedorRaw);

    cuentaPorMes[mesKey] = (cuentaPorMes[mesKey] || 0) + 1;

    carpetas.push({
      num:                num,                                      // A
      pv:                 pv,                                       // B
      serie:              serie,                                    // D
      mesPatente:         String(drow[5] || '').trim().toUpperCase(), // F (texto)
      mesKey:             mesKey,                                   // 'yyyy-mm'
      patentaA:           String(drow[6] || '').trim().toUpperCase(), // G (TG/CLIENTE/REVENTA)
      admin:              String(drow[7] || '').trim(),             // H
      tipoCarpeta:        String(drow[8] || '').trim().toUpperCase(), // I (AA) — raw
      tipoCarpetaCanon:   _normTipoCarpeta(drow[8]),                  // I → canónico (4 buckets)
      reventaOParticular: String(drow[11] || '').trim().toUpperCase(), // L
      vendedor:           vendedor,                                 // M → oficial
      vendedorRaw:        vendedorRaw,                              // M → tal cual
      cliente:            String(drow[14] || '').trim(),            // O
      modelo:             String(drow[15] || '').trim(),            // P
      fechaPvIso:         fechaPv ? _isoDate(fechaPv) : '',         // C → ISO
      fechaPvStr:         String(drow[2] || '').trim(),             // C → display
      fechaPatIso:        fechaPat ? _isoDate(fechaPat) : '',       // R → ISO
      fechaPatStr:        String(drow[17] || '').trim(),            // R → display
      patentada:          !!fechaPat,                                // R → bool
      mesKeyOrigen:       mesKeyOrigen,                              // 'fechaR' | 'colF'
      dominio:            String(drow[18] || '').trim(),            // S
    });
  }

  const meses = Object.keys(cuentaPorMes).sort().reverse().map(k => ({
    mesKey: k, label: _mesLabel(k), cuenta: cuentaPorMes[k],
  }));

  return {
    carpetas:            carpetas,
    meses:               meses,
    mesActual:           _yyyyMm(new Date()),
    vendedoresOficiales: VENDEDORES_OFICIALES,
    updatedAt:           new Date().toISOString(),
  };
}

function _yyyyMm(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function _mesLabel(yyyyMm) {
  const nombres = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const [y, m] = yyyyMm.split('-');
  return nombres[parseInt(m, 10) - 1] + ' ' + y;
}

// =======================================================================
// HELPERS
// =======================================================================

// Meses cortos en español (Sheets formatea las fechas así por defecto en es_AR
// cuando la columna no tiene formato custom: "27-feb", "4-may", etc).
const _MESES_CORTOS = {
  'ene':0, 'enero':0,
  'feb':1, 'febrero':1,
  'mar':2, 'marzo':2,
  'abr':3, 'abril':3,
  'may':4, 'mayo':4,
  'jun':5, 'junio':5,
  'jul':6, 'julio':6,
  'ago':7, 'agosto':7,
  'sep':8, 'sept':8, 'septiembre':8, 'set':8, 'setiembre':8,
  'oct':9, 'octubre':9,
  'nov':10, 'noviembre':10,
  'dic':11, 'diciembre':11
};

// Convierte un valor (raw o string) a Date. Soporta:
//   - Date nativo (cuando IMPORTRANGE preserva tipo)
//   - "dd/mm/yyyy" / "dd/mm/yy"
//   - "yyyy-mm-dd"
//   - "dd/mm" (sin año) → asume año actual
//   - "dd-mmm" o "dd-mmm-yy" (ej "27-feb", "4-may", "15-mar-26") → asume año actual si falta
function _parseFecha(raw, display) {
  if (raw instanceof Date && !isNaN(raw)) return raw;
  const s = String(display || raw || '').trim();
  if (!s) return null;

  // dd/mm/yyyy o dd/mm/yy
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
    const d = new Date(y, parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    return isNaN(d) ? null : d;
  }

  // dd/mm (sin año) → asume año actual
  m = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    const y = new Date().getFullYear();
    const d = new Date(y, parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    return isNaN(d) ? null : d;
  }

  // yyyy-mm-dd
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    return isNaN(d) ? null : d;
  }

  // dd-mmm (sin año) o dd-mmm-yy (ej "27-feb", "4-may", "15-mar-26")
  m = s.match(/^(\d{1,2})[-\/]([a-záéíóú]{3,12})(?:[-\/](\d{2,4}))?$/i);
  if (m) {
    const mesIdx = _MESES_CORTOS[m[2].toLowerCase()];
    if (typeof mesIdx === 'number') {
      const y = m[3]
        ? (m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10))
        : new Date().getFullYear();
      const d = new Date(y, mesIdx, parseInt(m[1], 10));
      return isNaN(d) ? null : d;
    }
  }

  return null;
}

function _isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

// Col F: variantes detectadas en la planilla real:
//   - vacío                       → impaga
//   - Date nativo                 → pagada (con fecha)
//   - "PAGA" / "paga" / "pagado"  → pagada (sin fecha)
//   - "SI" / "si" / "sí"          → pagada (sin fecha)
//   - "27-feb" / "4-may" / "24/04" → pagada (con fecha, año actual)
//   - "dd/mm/yyyy"                → pagada (con fecha exacta)
//   - cualquier otra cosa         → 'otro' (cae a un badge gris)
function _parsePago(raw, display) {
  if (raw instanceof Date && !isNaN(raw)) {
    return { estado: 'pagada', fechaIso: _isoDate(raw) };
  }
  const s = String(display || '').trim();
  if (!s) return { estado: 'impaga', fechaIso: '' };
  if (/^pag(a|o|ad[oa]?)$/i.test(s) || /^s[ií]$/i.test(s)) {
    return { estado: 'pagada', fechaIso: '' };
  }
  const f = _parseFecha(raw, s);
  if (f) return { estado: 'pagada', fechaIso: _isoDate(f) };
  return { estado: 'otro', fechaIso: '' };
}

// Sheets, cuando la celda tiene formato %, devuelve raw=0.185 y display="18,50%".
// Sin formato %, raw=18.5 y display="18,5". Normalizamos siempre a "puntos %"
// (18.5, no 0.185) para que el frontend trabaje cómodo.
function _pctFromDisplay(displayStr, rawVal) {
  const s = String(displayStr || '').trim();
  if (s.indexOf('%') >= 0) {
    return toNumber(s);            // "18,50%" → 18.5
  }
  if (typeof rawVal === 'number') {
    return Math.abs(rawVal) <= 1.5 ? rawVal * 100 : rawVal;
  }
  return toNumber(s);
}

function toNumber(v) {
  if (v === '' || v == null) return 0;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return 0;
  const s = String(v).replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  const hasComma = s.indexOf(',') > -1;
  const hasDot   = s.indexOf('.') > -1;
  let n;
  if (hasComma && hasDot) {
    n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
  } else if (hasComma) {
    n = parseFloat(s.replace(',', '.'));
  } else {
    n = parseFloat(s);
  }
  return isNaN(n) ? 0 : n;
}

// =======================================================================
// INCENTIVOS — condiciones comerciales VW por unidad
// =======================================================================
// Cruza BT del mes × patentamientos × stock (compras) para calcular cuánto
// debería cobrar TGA a fábrica. La regla del "100%" (CC 90 / 0.9) se aplica
// en el frontend (server siempre devuelve la base 90).
//
// Hojas en la espejo (las crea Fer manualmente con IMPORTRANGE):
//   actual_bt      → IMPORTRANGE de "Actual BT"     (mes vigente)
//   bt_anteriores  → IMPORTRANGE de "BT anteriores" (todos los meses cerrados,
//                    apilados, con col A = mes (fecha tipo 1/4/2026 = abril 26)
//
// Layout (madre y espejo idem):
//   bt_anteriores: A=mes(fecha) · B=modelo · U=CC 90 · Y=táctico · Z=whosale · AA=adic 1 · AB=adic 2
//   actual_bt:                    B=modelo · U=CC 90 · Y=táctico · Z=whosale · AA=adic 1 · AB=adic 2
//                                 (no tiene col A "mes" porque toda la hoja es del mes vigente)

function getIncentivos(params) {
  const mesKey = String(params.mes || _yyyyMm(new Date()));

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const bt = _readBT(ss, mesKey);
  if (!bt.encontrado) {
    return {
      mesKey,
      error: 'No encontré la hoja BT del mes. Esperaba "' + bt.nombreBuscado + '" o "actual_bt" en la espejo.',
    };
  }

  // 0) Pagos VW del mes (mapa serie → { tipo: monto sumado })
  const pagosPorSerie = _pagosPorSerieDelMes(ss, mesKey);

  // 1) Unidades patentadas del mes (no plan ahorro). Para el modelo usamos
  //    ventas (canónico por PV) y caemos a patentamientos si no matchea —
  //    el modelo en patentamientos a veces tiene typos por escritura manual.
  const pat = getPatentamientos();
  const vent = getVentas();
  const modeloPorPv = {};
  for (const v of (vent.ventas || [])) {
    if (v.preventaNum) modeloPorPv[String(v.preventaNum).trim()] = String(v.modelo || '').trim();
  }

  const patDelMes = (pat.carpetas || []).filter(c =>
    c.mesKey === mesKey && c.tipoCarpetaCanon !== 'Plan ahorro'
  );
  const porUnidadPat = patDelMes.map(c => {
    const modeloVentas = c.pv ? (modeloPorPv[String(c.pv).trim()] || '') : '';
    const modelo = modeloVentas || c.modelo || '';
    const cc = bt.porModelo[_normModeloKey(modelo)] || null;
    const paid = pagosPorSerie[c.serie] || {};
    return {
      num:       c.num,
      pv:        c.pv,
      serie:     c.serie,
      modelo:    modelo,                  // ← canónico desde ventas si existe
      modeloPat: c.modelo,                // patentamientos original (debug)
      dominio:   c.dominio,
      admin:     c.admin,
      vendedor:  c.vendedor,
      fechaPat:  c.fechaPatStr || c.fechaPatIso,
      // valores BASE (90%). El frontend aplica /0.9 al cc90 cuando toggle 100%.
      // cc90Base = SIN iva (col U); cc90ConIva = CON iva (col V). La conciliación
      // se hace en c/IVA porque las NC de VW liquidan con IVA (ratio 1,21 autos /
      // 1,105 pickups), igual que táctico y whosale.
      cc90Base:    cc ? cc.cc90 : 0,
      cc90ConIva:  cc ? (cc.cc90Iva || 0) : 0,
      tactico:     cc ? cc.tactico : 0,
      adicional1:  cc ? cc.adicional1 : 0,
      adicional2:  cc ? cc.adicional2 : 0,
      sinCC:       !cc,
      pagado: {
        cc90:       paid.cc90       || 0,
        tactico:    paid.tactico    || 0,
        adicional1: paid.adicional1 || 0,
        adicional2: paid.adicional2 || 0,
        whosale:    paid.whosale    || 0,
      },
    };
  });

  // 2) Unidades compradas en el mes (col B "fecha fc"). Aplica a todas, sin
  //    importar plan ahorro.
  const compras = _readComprasDelMes(ss, mesKey);
  const porUnidadCompra = compras.map(u => {
    const cc = bt.porModelo[_normModeloKey(u.modelo)] || null;
    const paid = pagosPorSerie[u.serie] || {};
    return {
      serie:      u.serie,
      modelo:     u.modelo,
      fechaFc:    u.fechaFcStr,
      fechaFcIso: u.fechaFcIso,
      whosale:    cc ? cc.whosale : 0,
      sinCC:      !cc,
      pagado: {
        whosale: paid.whosale || 0,
      },
    };
  });

  // 3) Lista de modelos en BT que no encontraron unidades, y modelos en
  //    patentamientos/stock que no matchearon BT — útil para Fer afinar nombres.
  const modelosSinCCPat = Array.from(new Set(porUnidadPat.filter(x => x.sinCC).map(x => x.modelo)));
  const modelosSinCCCom = Array.from(new Set(porUnidadCompra.filter(x => x.sinCC).map(x => x.modelo)));

  return {
    mesKey,
    btHojaUsada: bt.nombreUsado,
    porUnidadPatentada: porUnidadPat,
    porUnidadComprada:  porUnidadCompra,
    modelosSinCC: { patentadas: modelosSinCCPat, compradas: modelosSinCCCom },
    modelosBT:    bt.porModelo,  // dict normKey → { modelo, cc90, tactico, whosale, adicional1, adicional2 }
    mesesDisponibles: _mesesConciliables(ss, pat),  // BT cargada ∪ meses con patentamientos
    updatedAt:    new Date().toISOString(),
  };
}

// Devuelve la lista de meses (YYYY-MM) que tienen BT cargada Y son posteriores
// o iguales al mes mínimo de patentamientos (no tiene sentido mostrar marzo
// si no tenemos patent/ventas de marzo para conciliar).
function _readMesesBT(ss) {
  const meses = new Set();
  const ahora = new Date();
  if (ss.getSheetByName('actual_bt')) meses.add(_yyyyMm(ahora));
  const sa = ss.getSheetByName('bt_anteriores');
  if (sa) {
    const lastRow = sa.getLastRow();
    if (lastRow >= 1) {
      const colA = sa.getRange(1, 1, lastRow, 1).getValues();
      for (const r of colA) {
        const d = _parseFecha(r[0], '');
        if (d) meses.add(_yyyyMm(d));
      }
    }
  }
  return Array.from(meses)
    .filter(m => m >= PATENTAMIENTOS_MES_MINIMO)
    .sort().reverse();
}

// Meses conciliables = (meses con BT cargada) ∪ (meses con patentamientos), todo
// desde PATENTAMIENTOS_MES_MINIMO en adelante y sin pasarse del mes vigente. Así
// un mes con patentadas pero cuya BT vive solo en su pestaña madre (ej. mayo,
// que no se apiló en "BT anteriores") igual aparece en el selector — el _readBT
// ya sabe ir a buscar esa BT a la madre.
function _mesesConciliables(ss, pat) {
  const meses = new Set(_readMesesBT(ss));
  const mesVigente = _yyyyMm(new Date());
  const carpetas = (pat && pat.carpetas) || [];
  for (const c of carpetas) {
    if (c.mesKey && c.mesKey >= PATENTAMIENTOS_MES_MINIMO && c.mesKey <= mesVigente) {
      meses.add(c.mesKey);
    }
  }
  return Array.from(meses).sort().reverse();
}

function _readBT(ss, mesKey) {
  // 1) Primero probamos bt_anteriores filtrado por col A = mes.
  const sa = ss.getSheetByName('bt_anteriores');
  if (sa) {
    const r = _readBTAnteriores(sa, mesKey);
    if (Object.keys(r.porModelo).length > 0) {
      return { encontrado: true, nombreUsado: 'bt_anteriores (' + mesKey + ')', porModelo: r.porModelo };
    }
  }

  // 2) Si NO es el mes vigente y bt_anteriores no lo tenía, buscamos la pestaña
  //    propia del mes en la planilla MADRE (ej. "Mayo 2026 BT"). Esto cubre el
  //    caso en que Fer todavía no apiló el mes en "BT anteriores": antes caía a
  //    actual_bt (mes vigente) y conciliaba el mes pasado con los CC de hoy.
  const mesVigente = _yyyyMm(new Date());
  if (mesKey !== mesVigente) {
    const m = _readBTMadre(mesKey);
    if (m && Object.keys(m.porModelo).length > 0) {
      return { encontrado: true, nombreUsado: m.nombreUsado, porModelo: m.porModelo };
    }
  }

  // 3) Fallback: actual_bt (mes vigente).
  const sh = ss.getSheetByName('actual_bt');
  if (!sh) return { encontrado: false, nombreBuscado: 'actual_bt o bt_anteriores con fila para ' + mesKey };

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { encontrado: true, nombreUsado: 'actual_bt', porModelo: {} };

  // IMPORTRANGE A2:AB60 → fila 1 espejo = header "modelos"; data desde fila 2.
  const data = sh.getRange(2, 1, lastRow - 1, 28).getValues();
  const porModelo = {};
  for (const r of data) {
    const modelo = String(r[1] || '').trim();  // B
    if (!modelo) continue;
    porModelo[_normModeloKey(modelo)] = {
      modelo:      modelo,
      cc90:        toNumber(r[20]),  // U  (CC 90% SIN iva)
      cc90Iva:     toNumber(r[21]),  // V  (CC 90% CON iva, ya con el % correcto: autos 21% / pickups 10,5%)
      tactico:     toNumber(r[24]),  // Y
      whosale:     toNumber(r[25]),  // Z
      adicional1:  toNumber(r[26]),  // AA
      adicional2:  toNumber(r[27]),  // AB
    };
  }
  return { encontrado: true, nombreUsado: 'actual_bt', porModelo };
}

// Lee la hoja consolidada bt_anteriores filtrando por col A = fecha cuyo mes
// matchea mesKey ('2026-04'). El usuario carga col A como "abril2026" y Sheets
// lo guarda como Date 1/4/2026.
function _readBTAnteriores(sh, mesKey) {
  const lastRow = sh.getLastRow();
  if (lastRow < 1) return { porModelo: {} };
  const data = sh.getRange(1, 1, lastRow, 28).getValues();
  const porModelo = {};
  for (const r of data) {
    const mesCelda = _parseFecha(r[0], '');
    if (!mesCelda) continue;
    if (_yyyyMm(mesCelda) !== mesKey) continue;
    const modelo = String(r[1] || '').trim();  // B
    if (!modelo) continue;
    porModelo[_normModeloKey(modelo)] = {
      modelo:      modelo,
      cc90:        toNumber(r[20]),  // U  (CC 90% SIN iva)
      cc90Iva:     toNumber(r[21]),  // V  (CC 90% CON iva, ya con el % correcto: autos 21% / pickups 10,5%)
      tactico:     toNumber(r[24]),  // Y
      whosale:     toNumber(r[25]),  // Z
      adicional1:  toNumber(r[26]),  // AA
      adicional2:  toNumber(r[27]),  // AB
    };
  }
  return { porModelo };
}

// Lee la BT de un mes NO vigente desde su pestaña propia en la planilla madre
// (ej. "Mayo 2026 BT"). La espejo puede openById la madre porque ya tiene acceso
// por los IMPORTRANGE. En la madre la pestaña tiene fila 1 = título, fila 2 =
// header ("Modelos"), datos desde fila 3. Columnas idénticas a Actual BT:
//   B=1 modelo · U=20 cc90 · Y=24 táctico · Z=25 whosale · AA=26 adic1 · AB=27 adic2
function _readBTMadre(mesKey) {
  const [y, m] = mesKey.split('-');
  const nombres = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const mesNom = nombres[parseInt(m, 10) - 1];
  if (!mesNom) return null;
  const yy = String(y).slice(-2);
  // Probamos varios formatos de nombre porque Fer no es consistente
  // ("Mayo 2026 BT" vs "Marzo 26 BT" vs "Febrero 26 BT").
  const candidatos = [
    mesNom + ' ' + y + ' BT',
    mesNom + ' ' + yy + ' BT',
    mesNom + ' BT',
    mesNom + ' ' + y,
    mesNom + ' ' + yy,
  ];
  let ss;
  try { ss = SpreadsheetApp.openById(MADRE_ID); } catch (e) { return null; }
  let sh = null, usado = '';
  for (const nom of candidatos) {
    sh = ss.getSheetByName(nom);
    if (sh) { usado = nom; break; }
  }
  if (!sh) return null;
  const lastRow = sh.getLastRow();
  if (lastRow < 3) return { nombreUsado: 'madre:' + usado, porModelo: {} };
  // Desde fila 3 (1 título + 1 header), hasta col AB (28 cols).
  const data = sh.getRange(3, 1, lastRow - 2, 28).getValues();
  const porModelo = {};
  for (const r of data) {
    const modelo = String(r[1] || '').trim();  // B
    if (!modelo) continue;
    porModelo[_normModeloKey(modelo)] = {
      modelo:      modelo,
      cc90:        toNumber(r[20]),  // U  (CC 90% SIN iva)
      cc90Iva:     toNumber(r[21]),  // V  (CC 90% CON iva, ya con el % correcto: autos 21% / pickups 10,5%)
      tactico:     toNumber(r[24]),  // Y
      whosale:     toNumber(r[25]),  // Z
      adicional1:  toNumber(r[26]),  // AA
      adicional2:  toNumber(r[27]),  // AB
    };
  }
  return { nombreUsado: 'madre:' + usado, porModelo };
}

function _readComprasDelMes(ss, mesKey) {
  const sh = ss.getSheetByName('stock') || ss.getSheets()[0];
  if (!sh) return [];
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  const range   = sh.getRange(1, 1, lastRow, 16);
  const display = range.getDisplayValues();
  const raw     = range.getValues();

  const compras = [];
  for (let i = 0; i < raw.length; i++) {
    const drow = display[i];
    const rrow = raw[i];
    const serie = String(drow[0] || '').trim();
    if (!serie || /^serie$/i.test(serie)) continue;  // header o vacía
    const fechaFc = _parseFecha(rrow[1], drow[1]);
    if (!fechaFc) continue;
    if (_yyyyMm(fechaFc) !== mesKey) continue;
    compras.push({
      serie:      serie,
      fechaFcStr: String(drow[1] || '').trim(),
      fechaFcIso: _isoDate(fechaFc),
      modelo:     String(drow[2] || '').trim(),  // C "unidad" (modelo + versión)
    });
  }
  return compras;
}

// Normaliza el nombre del modelo para matching difuso entre BT/patent/stock.
// Quita acentos, espacios múltiples, lo lleva a UPPER. Si Fer escribe "Taos
// Comfortline" en BT y "TAOS comfortline" en patent, igual matchea.
function _normModeloKey(s) {
  return String(s || '').trim().toUpperCase()
    .replace(/[ÁÄÀÂ]/g,'A').replace(/[ÉËÈÊ]/g,'E').replace(/[ÍÏÌÎ]/g,'I')
    .replace(/[ÓÖÒÔ]/g,'O').replace(/[ÚÜÙÛ]/g,'U')
    .replace(/\s+/g, ' ');
}

// =======================================================================
// PAGOS VW — persistencia de las NCs parseadas desde los PDFs
// =======================================================================
// Guardamos en hoja "pagos_vw" de la espejo. Layout:
//   A nc_num · B fecha_nc · C serie · D vin · E modelo · F tipo_detectado
//   G monto_neto · H monto_total · I mes_incentivo · J texto_tipo · K importado_at
// Dedup por nc_num: si la NC ya está, se ignora (a menos que `forzar=true`).

const PAGOS_VW_HEADERS = [
  'nc_num', 'fecha_nc', 'serie', 'vin', 'modelo', 'tipo_detectado',
  'monto_neto', 'monto_total', 'mes_incentivo', 'texto_tipo', 'importado_at',
];

function _getPagosVWSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('pagos_vw');
  if (!sh) {
    sh = ss.insertSheet('pagos_vw');
    sh.getRange(1, 1, 1, PAGOS_VW_HEADERS.length).setValues([PAGOS_VW_HEADERS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function getPagosVW(params) {
  const sh = _getPagosVWSheet();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { pagos: [], total: 0 };
  const data = sh.getRange(2, 1, lastRow - 1, PAGOS_VW_HEADERS.length).getValues();
  const pagos = data.map(r => {
    const o = {};
    for (let i = 0; i < PAGOS_VW_HEADERS.length; i++) o[PAGOS_VW_HEADERS[i]] = r[i];
    return o;
  }).filter(p => p.nc_num);
  // Filtro opcional por mes
  const mes = String(params.mes || '');
  const filtrados = mes ? pagos.filter(p => p.mes_incentivo === mes) : pagos;
  return { pagos: filtrados, total: filtrados.length };
}

function savePagosVW(pagos) {
  if (!Array.isArray(pagos) || !pagos.length) return { guardados: 0, duplicados: 0 };
  const sh = _getPagosVWSheet();
  const lastRow = sh.getLastRow();
  const existentes = new Set();
  if (lastRow >= 2) {
    const nums = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    for (const r of nums) if (r[0]) existentes.add(String(r[0]).trim());
  }
  const ahora = new Date().toISOString();
  const filasNuevas = [];
  let duplicados = 0;
  for (const p of pagos) {
    const ncNum = String(p.ncNum || '').trim();
    if (!ncNum) continue;
    if (existentes.has(ncNum)) { duplicados++; continue; }
    existentes.add(ncNum);
    filasNuevas.push([
      "'" + ncNum,                                    // ' fuerza texto, evita autoformato científico
      p.fechaNc || '',
      "'" + (p.serie || ''),                          // texto, las series suelen tener ceros adelante
      "'" + (p.vin || ''),
      p.modelo || '',
      p.tipoDetectado || 'desconocido',
      Number(p.montoNeto) || 0,
      Number(p.montoTotal) || 0,
      "'" + (p.mesIncentivo || ''),                   // '2026-04' como texto, no como fecha
      p.textoTipo || '',
      ahora,
    ]);
  }
  if (filasNuevas.length) {
    sh.getRange(sh.getLastRow() + 1, 1, filasNuevas.length, PAGOS_VW_HEADERS.length).setValues(filasNuevas);
  }
  // Invalidar cache de incentivos así la próxima request muestra los nuevos
  try { CacheService.getScriptCache().removeAll(['incentivos_', 'incentivos__']); } catch (e) {}
  return { guardados: filasNuevas.length, duplicados, total: existentes.size };
}

function deletePagoVW(ncNum) {
  const sh = _getPagosVWSheet();
  const lastRow = sh.getLastRow();
  if (lastRow < 2 || !ncNum) return { eliminado: 0 };
  const nums = sh.getRange(2, 1, lastRow - 1, 1).getValues();
  let eliminado = 0;
  for (let i = nums.length - 1; i >= 0; i--) {
    if (String(nums[i][0] || '').trim() === String(ncNum).trim()) {
      sh.deleteRow(i + 2);
      eliminado++;
    }
  }
  return { eliminado };
}

// Devuelve { serie → { cc90, tactico, adicional1, adicional2, whosale } }
// con la suma de los pagos de cada tipo para esa serie en el mes_incentivo.
// Si una unidad cobra el mismo tipo en 2 NCs distintos, se suma.
function _pagosPorSerieDelMes(ss, mesKey) {
  const out = {};
  const sh = ss.getSheetByName('pagos_vw');
  if (!sh) return out;
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return out;
  const data = sh.getRange(2, 1, lastRow - 1, PAGOS_VW_HEADERS.length).getValues();
  // Index col por header
  const idxSerie = PAGOS_VW_HEADERS.indexOf('serie');
  const idxTipo  = PAGOS_VW_HEADERS.indexOf('tipo_detectado');
  const idxTotal = PAGOS_VW_HEADERS.indexOf('monto_total');   // con IVA, lo que matchea BT
  const idxMes   = PAGOS_VW_HEADERS.indexOf('mes_incentivo');
  for (const r of data) {
    // mes_incentivo puede venir como string '2026-04' o como Date si Sheets lo
    // auto-convirtió. Normalizamos a YYYY-MM en ambos casos.
    let mesCelda = '';
    if (r[idxMes] instanceof Date) {
      mesCelda = r[idxMes].getFullYear() + '-' + String(r[idxMes].getMonth() + 1).padStart(2, '0');
    } else {
      mesCelda = String(r[idxMes] || '').trim().substring(0, 7);  // recorta si venía con día/hora
    }
    if (mesCelda !== mesKey) continue;
    const serie = String(r[idxSerie] || '').trim();
    const tipo  = String(r[idxTipo] || '').trim();
    if (!serie || !tipo) continue;
    if (!out[serie]) out[serie] = {};
    out[serie][tipo] = (out[serie][tipo] || 0) + (Number(r[idxTotal]) || 0);
  }
  return out;
}

// =======================================================================
// OBJETIVOS DE PATENTAMIENTOS — clave/valor mesKey → objetivo
// =======================================================================
// VW reasigna objetivos periódicamente, por eso vivían en localStorage del
// browser. Mover a Sheets así editar desde la plataforma persiste para todos
// los usuarios y dispositivos (y resiste limpiar cache).
//
// Hoja "objetivos_pat" (autocreada). Columnas:
//   A mesKey ('YYYY-MM')   B objetivo (int)   C actualizado_at (ISO)
// Upsert por mesKey.

const OBJETIVOS_PAT_HEADERS = ['mesKey', 'objetivo', 'actualizado_at'];

function _getObjetivosPatSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('objetivos_pat');
  if (!sh) {
    sh = ss.insertSheet('objetivos_pat');
    sh.getRange(1, 1, 1, OBJETIVOS_PAT_HEADERS.length).setValues([OBJETIVOS_PAT_HEADERS]);
    sh.setFrozenRows(1);
    // Forzar formato texto en col A así "2026-04" no se interpreta como resta.
    sh.getRange('A:A').setNumberFormat('@');
  }
  return sh;
}

function getObjetivosPat() {
  const sh = _getObjetivosPatSheet();
  const lastRow = sh.getLastRow();
  const objetivos = {};
  if (lastRow >= 2) {
    const data = sh.getRange(2, 1, lastRow - 1, OBJETIVOS_PAT_HEADERS.length).getValues();
    for (const r of data) {
      const mesKey = String(r[0] || '').trim();
      const valor = Number(r[1]);
      if (!/^\d{4}-\d{2}$/.test(mesKey)) continue;
      if (isNaN(valor) || valor < 0) continue;
      objetivos[mesKey] = valor;
    }
  }
  return { objetivos: objetivos, updatedAt: new Date().toISOString() };
}

function setObjetivoPat(body) {
  const mesKey = String(body.mesKey || '').trim();
  const valor = Number(body.valor);
  if (!/^\d{4}-\d{2}$/.test(mesKey)) return { error: 'mesKey inválido: ' + mesKey };
  if (isNaN(valor) || valor < 0) return { error: 'valor inválido: ' + body.valor };

  const sh = _getObjetivosPatSheet();
  const lastRow = sh.getLastRow();
  const ahora = new Date().toISOString();

  if (lastRow >= 2) {
    const keys = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < keys.length; i++) {
      if (String(keys[i][0] || '').trim() === mesKey) {
        sh.getRange(i + 2, 1, 1, OBJETIVOS_PAT_HEADERS.length).setValues([[mesKey, valor, ahora]]);
        return { ok: true, mesKey: mesKey, valor: valor, accion: 'update' };
      }
    }
  }
  sh.appendRow(["'" + mesKey, valor, ahora]);  // ' fuerza texto en col A
  return { ok: true, mesKey: mesKey, valor: valor, accion: 'insert' };
}

// =======================================================================
// OBJETIVOS DE COMPRAS — clave/valor mesKey → cantidad de unidades a comprar
// =======================================================================
// Mismo patrón que objetivos_pat. Antes vivía solo en localStorage del browser
// (gestion_objetivos_compras) → se perdía al cambiar de equipo/sesión.
//
// Hoja "objetivos_compras" (autocreada). Columnas:
//   A mesKey ('YYYY-MM')   B objetivo (int)   C actualizado_at (ISO)
// Upsert por mesKey.

const OBJETIVOS_COMPRAS_HEADERS = ['mesKey', 'objetivo', 'actualizado_at'];

function _getObjetivosComprasSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('objetivos_compras');
  if (!sh) {
    sh = ss.insertSheet('objetivos_compras');
    sh.getRange(1, 1, 1, OBJETIVOS_COMPRAS_HEADERS.length).setValues([OBJETIVOS_COMPRAS_HEADERS]);
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@');  // '2026-04' como texto
  }
  return sh;
}

function getObjetivosCompras() {
  const sh = _getObjetivosComprasSheet();
  const lastRow = sh.getLastRow();
  const objetivos = {};
  if (lastRow >= 2) {
    const data = sh.getRange(2, 1, lastRow - 1, OBJETIVOS_COMPRAS_HEADERS.length).getValues();
    for (const r of data) {
      const mesKey = String(r[0] || '').trim();
      const valor = Number(r[1]);
      if (!/^\d{4}-\d{2}$/.test(mesKey)) continue;
      if (isNaN(valor) || valor < 0) continue;
      objetivos[mesKey] = valor;
    }
  }
  return { objetivos: objetivos, updatedAt: new Date().toISOString() };
}

function setObjetivoCompra(body) {
  const mesKey = String(body.mesKey || '').trim();
  const valor = Number(body.valor);
  if (!/^\d{4}-\d{2}$/.test(mesKey)) return { error: 'mesKey inválido: ' + mesKey };
  if (isNaN(valor) || valor < 0) return { error: 'valor inválido: ' + body.valor };

  const sh = _getObjetivosComprasSheet();
  const lastRow = sh.getLastRow();
  const ahora = new Date().toISOString();

  if (lastRow >= 2) {
    const keys = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < keys.length; i++) {
      if (String(keys[i][0] || '').trim() === mesKey) {
        sh.getRange(i + 2, 1, 1, OBJETIVOS_COMPRAS_HEADERS.length).setValues([[mesKey, valor, ahora]]);
        return { ok: true, mesKey: mesKey, valor: valor, accion: 'update' };
      }
    }
  }
  sh.appendRow(["'" + mesKey, valor, ahora]);  // ' fuerza texto en col A
  return { ok: true, mesKey: mesKey, valor: valor, accion: 'insert' };
}

// =======================================================================
// INDUSTRIA — comparación patentamientos TGA vs total industria y total VW
// =======================================================================
// Cada mes guarda los totales del mercado para poder calcular share TGA.
// TGA patentadas viene del lado del frontend (cuenta carpetas patentadas del
// mes en la hoja `patentamientos`). Acá solo guardamos lo que el usuario
// carga: total industria y total VW.
//
// Hoja "industria" (autocreada). Columnas:
//   A mesKey ('YYYY-MM')   B industria_total (int)   C vw_total (int)   D tga_total (int)   E actualizado_at (ISO)
// Upsert por mesKey. Si setIndustria recibe solo uno de los campos, los otros
// se preservan (no se pisan a null).
//
// tga_total es opcional: cuando se carga manualmente, queda como "override"
// de la cuenta automática del front (que cuenta carpetas patentada=true de
// patentData). Sirve para meses cerrados sin carpetas vivas (ene/feb/mar).
//
// Migración: si la hoja existe con el header viejo (B/C/D = ind/vw/actualizado),
// _getIndustriaSheet detecta y corrige insertando tga_total como col D y
// moviendo actualizado_at a col E.

const INDUSTRIA_HEADERS = ['mesKey', 'industria_total', 'vw_total', 'tga_total', 'actualizado_at'];

// Google Sheets a veces auto-convierte "2026-01" a un Date (1 de enero de 2026)
// aún cuando se intenta forzar texto con apóstrofe inicial. Este helper
// normaliza: si la celda es Date, devuelve "YYYY-MM"; si es string, lo trimea.
function _industriaMesKeyDeCelda(v) {
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    return y + '-' + m;
  }
  return String(v || '').trim();
}

function _getIndustriaSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('industria');
  if (!sh) {
    sh = ss.insertSheet('industria');
    sh.getRange(1, 1, 1, INDUSTRIA_HEADERS.length).setValues([INDUSTRIA_HEADERS]);
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@');  // '2026-04' como texto
    return sh;
  }
  // Migración: si la hoja existía con el header viejo de 4 columnas, insertar
  // tga_total entre vw_total y actualizado_at. Idempotente.
  const headerRange = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1));
  const header = headerRange.getValues()[0].map(v => String(v || '').trim());
  const dCol = header[3];
  if (dCol === 'actualizado_at' || dCol === '') {
    // Falta tga_total: insertar columna D vacía y reescribir headers
    sh.insertColumnAfter(3);
    sh.getRange(1, 1, 1, INDUSTRIA_HEADERS.length).setValues([INDUSTRIA_HEADERS]);
  } else if (dCol !== 'tga_total') {
    // Header inesperado, lo reescribimos por las dudas
    sh.getRange(1, 1, 1, INDUSTRIA_HEADERS.length).setValues([INDUSTRIA_HEADERS]);
  }
  return sh;
}

function getIndustria() {
  const sh = _getIndustriaSheet();
  const lastRow = sh.getLastRow();
  const datos = {};
  if (lastRow >= 2) {
    const data = sh.getRange(2, 1, lastRow - 1, INDUSTRIA_HEADERS.length).getValues();
    for (const r of data) {
      const mesKey = _industriaMesKeyDeCelda(r[0]);
      if (!/^\d{4}-\d{2}$/.test(mesKey)) continue;
      const ind = Number(r[1]);
      const vw  = Number(r[2]);
      const tga = Number(r[3]);
      datos[mesKey] = {
        industria_total: (isNaN(ind) || ind < 0) ? null : ind,
        vw_total:        (isNaN(vw)  || vw  < 0) ? null : vw,
        tga_total:       (isNaN(tga) || tga < 0) ? null : tga,
      };
    }
  }
  return { datos: datos, updatedAt: new Date().toISOString() };
}

function setIndustria(body) {
  const mesKey = String(body.mesKey || '').trim();
  if (!/^\d{4}-\d{2}$/.test(mesKey)) return { error: 'mesKey inválido: ' + mesKey };

  // Si el campo no viene en el body, lo dejamos como undefined → se preserva el valor previo
  const hasInd = Object.prototype.hasOwnProperty.call(body, 'industria_total');
  const hasVw  = Object.prototype.hasOwnProperty.call(body, 'vw_total');
  const hasTga = Object.prototype.hasOwnProperty.call(body, 'tga_total');
  let ind = hasInd ? body.industria_total : undefined;
  let vw  = hasVw  ? body.vw_total        : undefined;
  let tga = hasTga ? body.tga_total       : undefined;

  function _parseNum(v) {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    if (isNaN(n) || n < 0) return undefined; // inválido
    return n;
  }
  if (hasInd) { ind = _parseNum(ind); if (ind === undefined) return { error: 'industria_total inválido: ' + body.industria_total }; }
  if (hasVw)  { vw  = _parseNum(vw);  if (vw  === undefined) return { error: 'vw_total inválido: '        + body.vw_total }; }
  if (hasTga) { tga = _parseNum(tga); if (tga === undefined) return { error: 'tga_total inválido: '       + body.tga_total }; }

  const sh = _getIndustriaSheet();
  const lastRow = sh.getLastRow();
  const ahora = new Date().toISOString();

  // Aseguramos col A formato texto antes de cualquier escritura, así Sheets no
  // re-interpreta el mesKey "YYYY-MM" como Date (bug confirmado 2026-05-28).
  sh.getRange('A:A').setNumberFormat('@');

  if (lastRow >= 2) {
    const keys = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < keys.length; i++) {
      if (_industriaMesKeyDeCelda(keys[i][0]) === mesKey) {
        const row = i + 2;
        const cur = sh.getRange(row, 1, 1, INDUSTRIA_HEADERS.length).getValues()[0];
        const curInd = (isNaN(Number(cur[1])) ? null : Number(cur[1]));
        const curVw  = (isNaN(Number(cur[2])) ? null : Number(cur[2]));
        const curTga = (isNaN(Number(cur[3])) ? null : Number(cur[3]));
        const newInd = hasInd ? ind : curInd;
        const newVw  = hasVw  ? vw  : curVw;
        const newTga = hasTga ? tga : curTga;
        // Re-escribimos el mesKey como texto puro (sin apóstrofe ni Date) para limpiar legacy.
        sh.getRange(row, 1, 1, INDUSTRIA_HEADERS.length).setValues([[mesKey, newInd, newVw, newTga, ahora]]);
        return { ok: true, mesKey: mesKey, industria_total: newInd, vw_total: newVw, tga_total: newTga, accion: 'update' };
      }
    }
  }
  sh.appendRow([mesKey, hasInd ? ind : null, hasVw ? vw : null, hasTga ? tga : null, ahora]);
  return { ok: true, mesKey: mesKey, industria_total: (hasInd ? ind : null), vw_total: (hasVw ? vw : null), tga_total: (hasTga ? tga : null), accion: 'insert' };
}

// =======================================================================
// BARATITO SNAPSHOTS — comparación venta vs oferta vigente del portal
// =======================================================================
// Cada venta tiene un snapshot del precio "baratito" al momento que aparece
// por primera vez. Permite que el indicador no cambie después aunque la
// oferta del portal varíe — refleja lo que el vendedor podía ofrecer en ese
// momento. Snapshot por # preventa (col C de la planilla "PVs").
//
// Hoja "ventas_baratito" (autocreada). Una fila por preventa:
//   A pv_key            (# preventa, texto)
//   B modelo
//   C baratito_fyf      (con flete y formulario)
//   D baratito_sin_fyf  (= baratito_fyf - FYF; 0 si sin_oferta)
//   E monto_fc          (factura cliente)
//   F acc               (accesorios)
//   G cliente_pago      (= monto_fc + acc)
//   H diff              (= cliente_pago - baratito_sin_fyf; 0 si sin_oferta)
//   I status            ('mejor' | 'baratito' | 'peor' | 'sin_oferta')
//   J snapshot_at       (ISO)

const VENTAS_BARATITO_HEADERS = [
  'pv_key', 'modelo', 'baratito_fyf', 'baratito_sin_fyf',
  'monto_fc', 'acc', 'cliente_pago', 'diff', 'status', 'snapshot_at',
];

function _getVentasBaratitoSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('ventas_baratito');
  if (!sh) {
    sh = ss.insertSheet('ventas_baratito');
    sh.getRange(1, 1, 1, VENTAS_BARATITO_HEADERS.length).setValues([VENTAS_BARATITO_HEADERS]);
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@');  // pv_key como texto (puede tener ceros)
  }
  return sh;
}

function _readBaratitoSnapshots() {
  const sh = _getVentasBaratitoSheet();
  const lastRow = sh.getLastRow();
  const out = {};
  if (lastRow < 2) return out;
  const data = sh.getRange(2, 1, lastRow - 1, VENTAS_BARATITO_HEADERS.length).getValues();
  for (const r of data) {
    const pvKey = String(r[0] || '').trim();
    if (!pvKey) continue;
    out[pvKey] = {
      pvKey:          pvKey,
      modelo:         String(r[1] || ''),
      baratitoFyf:    Number(r[2]) || 0,
      baratitoSinFyf: Number(r[3]) || 0,
      montoFc:        Number(r[4]) || 0,
      acc:            Number(r[5]) || 0,
      clientePago:    Number(r[6]) || 0,
      diff:           Number(r[7]) || 0,
      status:         String(r[8] || ''),
      snapshotAt:     r[9] instanceof Date ? r[9].toISOString() : String(r[9] || ''),
    };
  }
  return out;
}

// Recibe un array de snapshots desde el frontend, los persiste:
//   - si no existe pv_key → append
//   - si existe con status 'sin_oferta' → update (puede haber mejorado el match)
//   - si existe con cualquier otro status → NO se pisa (snapshot inmutable)
function saveBaratitoSnapshots(snapshots) {
  if (!Array.isArray(snapshots) || !snapshots.length) {
    return { guardados: 0, actualizados: 0, duplicados: 0 };
  }
  const sh = _getVentasBaratitoSheet();
  const lastRow = sh.getLastRow();
  // Map pvKey → { fila (1-based), status }
  const existentes = {};
  if (lastRow >= 2) {
    const data = sh.getRange(2, 1, lastRow - 1, VENTAS_BARATITO_HEADERS.length).getValues();
    for (let i = 0; i < data.length; i++) {
      const k = String(data[i][0] || '').trim();
      if (k) existentes[k] = { fila: i + 2, status: String(data[i][8] || '').trim() };
    }
  }
  const ahora = new Date().toISOString();
  const filasNuevas = [];
  let actualizados = 0, duplicados = 0;
  for (const s of snapshots) {
    const pvKey = String(s.pvKey || '').trim();
    if (!pvKey) continue;
    const status = String(s.status || '').trim();
    if (!/^(mejor|baratito|peor|sin_oferta)$/.test(status)) continue;

    const fila = [
      "'" + pvKey,                       // texto, pv_key
      String(s.modelo || ''),
      Number(s.baratitoFyf) || 0,
      Number(s.baratitoSinFyf) || 0,
      Number(s.montoFc) || 0,
      Number(s.acc) || 0,
      Number(s.clientePago) || 0,
      Number(s.diff) || 0,
      status,
      ahora,
    ];

    const prev = existentes[pvKey];
    if (!prev) {
      existentes[pvKey] = { fila: lastRow + 1 + filasNuevas.length, status: status };
      filasNuevas.push(fila);
    } else if (prev.status === 'pre_feature') {
      // PV histórica del baseline → NO se snapshotea (la oferta de hoy no
      // refleja la del momento de la venta). Cuenta como duplicado.
      duplicados++;
    } else if (prev.status === 'sin_oferta' && status !== 'sin_oferta') {
      sh.getRange(prev.fila, 1, 1, VENTAS_BARATITO_HEADERS.length).setValues([fila]);
      actualizados++;
    } else {
      duplicados++;
    }
  }
  if (filasNuevas.length) {
    sh.getRange(sh.getLastRow() + 1, 1, filasNuevas.length, VENTAS_BARATITO_HEADERS.length)
      .setValues(filasNuevas);
  }
  // Invalidar cache de ventas así la próxima request trae los snapshots nuevos
  try { CacheService.getScriptCache().remove('ventas'); } catch (e) {}
  return { guardados: filasNuevas.length, actualizados: actualizados, duplicados: duplicados };
}

// Lee de la hoja "ventas" todos los # preventa actuales (filtrados desde el
// VENTAS_MES_MINIMO). Sirve para armar el baseline "pre_feature".
function _readAllPvKeysFromVentas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('ventas') || ss.getSheets().find(s =>
    /^pvs?$/i.test(s.getName()) || /^ventas/i.test(s.getName())
  );
  if (!sh) return [];
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  // Col A=# venta · B=fecha PV · C=# preventa
  const range   = sh.getRange(1, 1, lastRow, 3);
  const display = range.getDisplayValues();
  const raw     = range.getValues();

  let headerRow = -1;
  for (let i = 0; i < Math.min(5, display.length); i++) {
    const a = String(display[i][0] || '').toLowerCase().trim();
    const b = String(display[i][1] || '').toLowerCase().trim();
    if (/(nro|n\b|venta|#)/.test(a) && /fecha/.test(b)) { headerRow = i; break; }
  }
  if (headerRow < 0) headerRow = 0;

  const out = [];
  for (let i = headerRow + 1; i < display.length; i++) {
    const fechaPv = _parseFecha(raw[i][1], display[i][1]);
    if (!fechaPv) continue;
    if (_yyyyMm(fechaPv) < VENTAS_MES_MINIMO) continue;
    const pvKey = String(display[i][2] || '').trim();
    if (pvKey) out.push(pvKey);
  }
  return out;
}

// Wipea TODOS los snapshots existentes y marca todas las PVs actuales como
// 'pre_feature' (baseline histórico, no se comparan). De acá en adelante,
// solo las PVs que aparezcan después de este punto van a generar snapshot
// real al cargarse la tab por primera vez.
//
// Acción destructiva: invalida los snapshots reales que existieran. Se llama
// una sola vez para limpiar la corrida retroactiva accidental, o cuando se
// quiere resetear el baseline a propósito.
function resetBaratitoBaseline() {
  const sh = _getVentasBaratitoSheet();
  const lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    sh.getRange(2, 1, lastRow - 1, VENTAS_BARATITO_HEADERS.length).clearContent();
  }
  const pvKeys = _readAllPvKeysFromVentas();
  const ahora = new Date().toISOString();
  const filas = pvKeys.map(k => [
    "'" + k, '', 0, 0, 0, 0, 0, 0, 'pre_feature', ahora
  ]);
  if (filas.length) {
    sh.getRange(2, 1, filas.length, VENTAS_BARATITO_HEADERS.length).setValues(filas);
  }
  try { CacheService.getScriptCache().remove('ventas'); } catch (e) {}
  return { ok: true, pre_feature: filas.length };
}

// Si la hoja ventas_baratito está vacía (sin filas de data), inicializa el
// baseline. Si ya hay filas (sea baseline o snapshots reales), no toca nada.
// Idempotente — el frontend lo llama una vez por primera carga, defensivo.
function initBaratitoBaselineIfEmpty() {
  const sh = _getVentasBaratitoSheet();
  if (sh.getLastRow() >= 2) {
    return { ok: true, accion: 'noop', motivo: 'baseline ya existe' };
  }
  return resetBaratitoBaseline();
}
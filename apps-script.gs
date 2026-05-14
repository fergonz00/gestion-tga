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
    if (tipo === 'ventasdebug')     return jsonResponse(getVentasDebug(params));  // sin cache
    return jsonResponse({ error: 'tipo desconocido: ' + tipo });
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

  return {
    ventas:    ventas,
    meses:     meses,
    mesActual: _yyyyMm(new Date()),
    vendedoresOficiales: VENDEDORES_OFICIALES,
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
  // Bancos externos: variantes y typos comunes
  if (/GALI?CI|GALICA|NACION|FRANC[EÉ]S|HSBC|SUPERVIELLE|MACRO|SANTANDER|BBVA|ICBC|PATAGONIA/.test(s)) return TIPO_CARPETA_CANON.EXTERNO;
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
  const anioActual = new Date().getFullYear();

  for (let i = headerRow + 1; i < display.length; i++) {
    const drow = display[i];
    const rrow = raw[i];

    const num   = toNumber(rrow[0]);
    const pv    = String(drow[1] || '').trim();
    const serie = String(drow[3] || '').trim();
    if (!num && !pv && !serie) continue;

    // R = fecha patentamiento real (puede determinar el mes)
    const fechaPat = _parseFecha(rrow[17], drow[17]);

    // mesKey: si ya está patentada usamos la fecha REAL (lo que Fer cuenta),
    // si no, caemos al texto de col F (mes esperado escrito por la admin).
    // Sin alguno de los dos, salteamos.
    let mesKey;
    if (fechaPat) {
      mesKey = _yyyyMm(fechaPat);
    } else {
      const mesTxt = _norm(drow[5]);
      const mesNum = _MES_TXT_A_NUM[mesTxt];
      if (!mesNum) continue;
      mesKey = anioActual + '-' + mesNum;
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
      fechaPatIso:        fechaPat ? _isoDate(fechaPat) : '',       // R → ISO
      fechaPatStr:        String(drow[17] || '').trim(),            // R → display
      patentada:          !!fechaPat,                                // R → bool
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
//   actual_bt        → IMPORTRANGE de "Actual BT"   (mes vigente)
//   bt_2026_04       → IMPORTRANGE de "Abril 26 BT" (cerrado)
//   bt_2026_05       → cuando cierre mayo se crea esta
//
// Layout madre (BT):
//   B  modelo · U  CC 90 · Y  táctico · Z  whosale · AA adic 1 · AB adic 2

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

  // 1) Unidades patentadas del mes (no plan ahorro)
  const pat = getPatentamientos();
  const patDelMes = (pat.carpetas || []).filter(c =>
    c.mesKey === mesKey && c.tipoCarpetaCanon !== 'Plan ahorro'
  );
  const porUnidadPat = patDelMes.map(c => {
    const cc = bt.porModelo[_normModeloKey(c.modelo)] || null;
    return {
      num:       c.num,
      pv:        c.pv,
      serie:     c.serie,
      modelo:    c.modelo,
      dominio:   c.dominio,
      admin:     c.admin,
      vendedor:  c.vendedor,
      fechaPat:  c.fechaPatStr || c.fechaPatIso,
      // valores BASE (90%). El frontend aplica /0.9 al cc90 cuando toggle 100%.
      cc90Base:    cc ? cc.cc90 : 0,
      tactico:     cc ? cc.tactico : 0,
      adicional1:  cc ? cc.adicional1 : 0,
      adicional2:  cc ? cc.adicional2 : 0,
      sinCC:       !cc,
    };
  });

  // 2) Unidades compradas en el mes (col B "fecha fc"). Aplica a todas, sin
  //    importar plan ahorro.
  const compras = _readComprasDelMes(ss, mesKey);
  const porUnidadCompra = compras.map(u => {
    const cc = bt.porModelo[_normModeloKey(u.modelo)] || null;
    return {
      serie:      u.serie,
      modelo:     u.modelo,
      fechaFc:    u.fechaFcStr,
      fechaFcIso: u.fechaFcIso,
      whosale:    cc ? cc.whosale : 0,
      sinCC:      !cc,
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
    modelosBT:    Object.values(bt.porModelo).map(m => m.modelo),
    updatedAt:    new Date().toISOString(),
  };
}

function _readBT(ss, mesKey) {
  const [y, m] = mesKey.split('-');
  const nombreEspecifico = 'bt_' + y + '_' + m;
  let sh = ss.getSheetByName(nombreEspecifico);
  let nombreUsado = nombreEspecifico;
  if (!sh) {
    sh = ss.getSheetByName('actual_bt');
    nombreUsado = 'actual_bt';
  }
  if (!sh) return { encontrado: false, nombreBuscado: nombreEspecifico };

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { encontrado: true, nombreUsado, porModelo: {} };

  // IMPORTRANGE A2:AB60 → fila 1 espejo = header "modelos"; data desde fila 2.
  const numRows = lastRow - 1;
  const data = sh.getRange(2, 1, numRows, 28).getValues();
  const porModelo = {};
  for (const r of data) {
    const modelo = String(r[1] || '').trim();  // B
    if (!modelo) continue;
    porModelo[_normModeloKey(modelo)] = {
      modelo:      modelo,
      cc90:        toNumber(r[20]),  // U
      tactico:     toNumber(r[24]),  // Y
      whosale:     toNumber(r[25]),  // Z
      adicional1:  toNumber(r[26]),  // AA
      adicional2:  toNumber(r[27]),  // AB
    };
  }
  return { encontrado: true, nombreUsado, porModelo };
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

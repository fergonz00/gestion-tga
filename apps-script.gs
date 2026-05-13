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

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (String(params.token || '').trim() !== TOKEN) {
    return jsonResponse({ error: 'forbidden' });
  }

  const tipo = String(params.tipo || 'stock').toLowerCase();
  try {
    if (tipo === 'stock') return jsonResponse(getStock());
    return jsonResponse({ error: 'tipo desconocido: ' + tipo });
  } catch (err) {
    return jsonResponse({ error: String(err && err.message || err) });
  }
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

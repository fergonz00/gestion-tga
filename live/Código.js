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
    if (tipo === 'stock')           return jsonResponse(_cachedBig('stock',       CACHE_TTL_WARM, fresh, getStock));  // >100KB → cache chunked + precalentado
    if (tipo === 'stockhist')       return jsonResponse(getStockHist());          // monto/fecha/color/nombre históricos congelados (para Stock Oversoft)
    if (tipo === 'ventas')          return jsonResponse(_cachedBig('ventas',      CACHE_TTL_WARM, fresh, getVentas));  // >100KB → cache chunked + precalentado
    if (tipo === 'ventasv2')        return jsonResponse(getVentasV2());           // ventas: mes actual por fórmula (Oversoft+BT) + meses cerrados congelados (ventas_hist)
    if (tipo === 'importarventashist') return jsonResponse(importarVentasHist());  // una-vez/re-ejecutable: congela los resultados de la hoja PVs (meses cerrados)
    if (tipo === 'congelarmes')     return jsonResponse(congelarMes(String(params.mes || ''))); // congela (guarda) el resultado de la fórmula de un mes
    if (tipo === 'instalartriggercongelar') return jsonResponse(instalarTriggerCongelar()); // trigger mensual: congela el mes que cierra
    if (tipo === 'patentamientos')  return jsonResponse(_cached('patentamientos', CACHE_TTL_SEC, fresh, getPatentamientos));
    if (tipo === 'incentivos')      return jsonResponse(_cached('incentivos_' + (params.mes || ''), CACHE_TTL_SEC, fresh, () => getIncentivos(params)));
    if (tipo === 'pagosvw')         return jsonResponse(getPagosVW(params));      // sin cache
    if (tipo === 'objetivos')         return jsonResponse(getObjetivosPat());       // sin cache (es chico)
    if (tipo === 'objetivoscompras')  return jsonResponse(getObjetivosCompras());   // sin cache (es chico)
    if (tipo === 'repartocomprado')   return jsonResponse(getRepartoComprado());     // sin cache (en vivo): reparto de precios no facturado aún
    if (tipo === 'reparto')           return jsonResponse(getReparto());             // sin cache (en vivo): panel operativo de reparto VW
    if (tipo === 'industria')         return jsonResponse(getIndustria());          // sin cache (es chico)
    if (tipo === 'ventasdebug')     return jsonResponse(getVentasDebug(params));  // sin cache
    if (tipo === 'oversoft')        return jsonResponse(getOversoft(params));     // proxy a la réplica Supabase
    if (tipo === 'oversoftsync')    return jsonResponse(getOversoftSync() || { iso: null, ok: false }); // sello de última sincronización de la réplica (indicador global)
    if (tipo === 'saldoscompras')   return jsonResponse(_cached('saldoscompras', CACHE_TTL_SEC, fresh, getSaldosCompras)); // proxy a saldos-tga (paga/impaga + vencimiento)
    if (tipo === 'madre')           return jsonResponse(getMadreSheet(params));   // lectura cruda de una pestaña de la planilla madre
    if (tipo === 'precios')         return jsonResponse(_cached('precios', CACHE_TTL_SEC, fresh, getPreciosActualBT)); // espejo de precios/ganancia de "Actual BT"
    if (tipo === 'precioslista')    return jsonResponse(getPreciosLista(String(params.mes || ''))); // precios_lista (lista+costo) editable en el portal — reemplaza "Actual BT"
    if (tipo === 'motor')           return jsonResponse(_cached('motor', CACHE_TTL_SEC, fresh, getBaratitoMotor));     // MOTOR: calcula desde Supabase (no la planilla)
    if (tipo === 'snapshotbt')      return jsonResponse(snapshotBTMensual(String(params.mes || '') || null, String(params.hoja || '') || null, String(params.dry || '') === '1', true)); // sync MANUAL de la BT a Supabase (force=true; el automático está apagado)
    if (tipo === 'admventas')       return jsonResponse(_cached('admventas', CACHE_TTL_SEC, fresh, getAdmVentas)); // adm de ventas: Oversoft + campos manuales
    if (tipo === 'conciliagastos')  return jsonResponse(_cached('conciliagastos_' + (params.mes || ''), CACHE_TTL_SEC, fresh, () => getConciliacionGastos(params))); // gastos reales por PV + conciliación (sellado/quebranto/faltantes)
    if (tipo === 'migraradmventas') return jsonResponse(migrarAdmVentasDesdeHoja()); // una-vez: vuelca lo ya cargado en la hoja a adm_ventas
    if (tipo === 'comprasvw')       return jsonResponse(_cachedBig('comprasvw', CACHE_TTL_WARM, fresh, getComprasVW)); // compras a VW (>100KB) → cache chunked + precalentado
    if (tipo === 'migrarcomprasvw') return jsonResponse(migrarComprasVW()); // una-vez: vuelca lo de saldos (>=2026) a compras_vw, conciliado con Oversoft
    if (tipo === 'flujo')           return jsonResponse(_cached('flujo', CACHE_TTL_SEC, fresh, getFlujoFinanciero)); // flujo de caja: cobros pendientes (ingresos) vs pagos a VW (egresos)
    if (tipo === 'exposicion')      return jsonResponse(getExposicion());          // stock en exposición por salón (tabla exposicion_unidades, wjfgl)
    if (tipo === 'reponer')         return jsonResponse(reponerExposicion(params)); // repone una unidad de exposición vendida y avisa por WhatsApp
    return jsonResponse({ error: 'tipo desconocido: ' + tipo });
  } catch (err) {
    return jsonResponse({ error: String(err && err.message || err) });
  }
}

// Stock en exposición por salón (tabla exposicion_unidades en wjfgl). Solo lectura.
// La marca de "vendida" la mantiene fresca el cron del portal (cada 15 min) que cruza Oversoft.
function getExposicion() {
  const rows = _supaGet('/exposicion_unidades?select=serie,salon,unidad,color,fecha_fc,vendida,fecha_venta,avisada_venta,activa,reemplaza_a,reemplazada_por&activa=eq.true&order=salon.asc,vendida.desc,serie.asc');
  return { unidades: rows, updatedAt: new Date().toISOString() };
}

// Secret compartido para invocar las Edge Functions de aviso (server-side, no se expone al browser).
const EXPO_NOTIF_SECRET = 'expo_c56bc3bcc9ea657f34cf6c6ccc3b18a62e18e2d1';

// Repone una unidad de exposición vendida por otra del stock libre: da de baja la vieja,
// alta la nueva (mismo salón) y dispara el WhatsApp de reemplazo (template exposicion_reemplazo).
// Params: serie_vieja, serie_nueva, unidad_nueva, color_nueva.
function reponerExposicion(params) {
  const serieVieja  = String(params.serie_vieja  || '').trim();
  const serieNueva  = String(params.serie_nueva  || '').trim();
  const unidadNueva = String(params.unidad_nueva || '').trim();
  const colorNueva  = String(params.color_nueva  || '').trim();
  if (!serieVieja || !serieNueva || !unidadNueva) return { error: 'faltan datos (serie_vieja, serie_nueva, unidad_nueva)' };
  if (serieVieja === serieNueva) return { error: 'la serie nueva no puede ser igual a la vieja' };

  const svc = PropertiesService.getScriptProperties().getProperty('SUPA_SERVICE');
  if (!svc) return { error: 'SUPA_SERVICE no configurado' };
  const hW = { apikey: svc, Authorization: 'Bearer ' + svc, 'Content-Type': 'application/json' };

  // 1) leer la vieja (activa)
  const viejas = _supaGet('/exposicion_unidades?select=salon,unidad,color&serie=eq.' + encodeURIComponent(serieVieja) + '&activa=eq.true&limit=1');
  if (!viejas || !viejas.length) return { error: 'no se encontró la unidad a reponer (serie ' + serieVieja + ')' };
  const vieja = viejas[0];

  // 2) baja de la vieja
  const r1 = UrlFetchApp.fetch(SUPA_URL + '/exposicion_unidades?serie=eq.' + encodeURIComponent(serieVieja) + '&activa=eq.true', {
    method: 'patch', headers: hW, muteHttpExceptions: true,
    payload: JSON.stringify({ activa: false, reemplazada_por: serieNueva })
  });
  if (r1.getResponseCode() >= 300) return { error: 'error dando de baja la vieja: ' + r1.getContentText().slice(0, 200) };

  // 3) alta de la nueva (mismo salón)
  const r2 = UrlFetchApp.fetch(SUPA_URL + '/exposicion_unidades', {
    method: 'post', headers: Object.assign({}, hW, { Prefer: 'return=minimal' }), muteHttpExceptions: true,
    payload: JSON.stringify([{ serie: serieNueva, salon: vieja.salon, unidad: unidadNueva, color: colorNueva, vendida: false, avisada_venta: false, activa: true, reemplaza_a: serieVieja }])
  });
  if (r2.getResponseCode() >= 300) return { error: 'error dando de alta la nueva: ' + r2.getContentText().slice(0, 200) };

  // 4) WhatsApp de reemplazo
  let avisado = false, aviso = null;
  try {
    const unidadVendida = (vieja.unidad || '') + (vieja.color ? ' ' + vieja.color : '');
    const unidadNuevaTxt = unidadNueva + (colorNueva ? ' ' + colorNueva : '');
    const resp = UrlFetchApp.fetch('https://wjfglsafgaltusmbnccl.supabase.co/functions/v1/notify-exposicion-reemplazo', {
      method: 'post', muteHttpExceptions: true,
      headers: { 'Content-Type': 'application/json', 'x-stock-secret': EXPO_NOTIF_SECRET },
      payload: JSON.stringify({ salon: vieja.salon, unidadVendida: unidadVendida, unidadNueva: unidadNuevaTxt, serieNueva: serieNueva })
    });
    aviso = JSON.parse(resp.getContentText() || '{}');
    avisado = (aviso.enviados || 0) > 0;
  } catch (e) { aviso = String(e); }

  return { ok: true, serieVieja: serieVieja, serieNueva: serieNueva, salon: vieja.salon, avisado: avisado, aviso: aviso };
}

// Lectura cruda de una pestaña de la planilla MADRE (1Kvu...). La espejo tiene
// acceso de lectura a la madre (por los IMPORTRANGE), así que openById funciona
// corriendo "as Me". Sirve para auditar/migrar pestañas que no están espejadas
// (ej. "cc", "Actual BT"). Uso: ?tipo=madre&sheet=cc[&max=200]
const MADRE_ID = '1KvuRZzHuVpWSppZqT8xDf8WSrplR-vYzeY0gQPftlpQ';
// Whitelist: SOLO pestañas de incentivos/BT. El token va en el frontend público,
// así que NO exponemos haberes, clientes, financiaciones, etc.
const MADRE_SHEETS_OK = [
  'cc', 'Actual BT', 'BT anteriores', 'Mayo 2026 BT', 'Abril 2026 BT', 'Marzo 26 BT',
  'Febrero 26 BT', 'Enero 26 BT', 'Enero 2026 BT', 'Resumen Competencia 2',
  'chequeo incentivos', 'cupos', 'listas de precios', 'aumentos vw',
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

  // Ventas por mes por modelo (para el selector "ventas últimos N meses" del front).
  // Cuenta las ventas (mismo criterio canónico × mesKey) pero desde OVERSOFT+BT
  // (getVentasV2: mes actual por fórmula + meses cerrados congelados), NO del Sheet.
  const ventasModeloMes = {};
  try {
    const vt = getVentasV2();
    for (const venta of (vt.ventas || [])) {
      const k = _normModeloKey(venta.modelo);
      if (!k || !venta.mesKey) continue;
      if (!ventasModeloMes[k]) ventasModeloMes[k] = {};
      ventasModeloMes[k][venta.mesKey] = (ventasModeloMes[k][venta.mesKey] || 0) + 1;
    }
  } catch (e) { /* si falla ventas, seguimos sin el desglose mensual */ }

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
      // Ventas por mes (dict 'yyyy-mm' → cantidad) para el selector de N meses.
      ventasPorMes: ventasModeloMes[_normModeloKey(modelo)] || {},
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

// =======================================================================
// MOTOR TGA — precio/ganancia calculados desde Supabase (NO la planilla)
// =======================================================================
// Misma salida que getPreciosActualBT pero computando todo desde las tablas
// propias en Supabase (base wjfgl): precios_lista + catalogo_modelos +
// incentivos + dto_tg, y el stock real desde Oversoft. Fórmulas verificadas:
// reproducen el "Actual BT" al peso (47/47). La anon key es de SOLO LECTURA
// (RLS read-only en esas 4 tablas), así el endpoint público no puede escribir.
const SUPA_URL  = 'https://wjfglsafgaltusmbnccl.supabase.co/rest/v1';
const SUPA_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqZmdsc2FmZ2FsdHVzbWJuY2NsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MzM2OTksImV4cCI6MjA4OTAwOTY5OX0.OOwgyKDNQsbBaGDaL0OhJfc8eOsCClvvAPW0VFBKrOA';

function _supaGet(path) {
  const res = UrlFetchApp.fetch(SUPA_URL + path, {
    headers: { apikey: SUPA_ANON, Authorization: 'Bearer ' + SUPA_ANON },
    muteHttpExceptions: true });
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('supa ' + code + ': ' + res.getContentText().slice(0, 160));
  return JSON.parse(res.getContentText());
}

// Normaliza un nombre de modelo para matchear la descripción de Oversoft contra
// el catálogo (saca VW/Nuevo, MY, generación, packs; bi-tono→bitono).
function _ntrim(s) {
  s = String(s || '').toLowerCase();
  s = s.replace(/bi[\s-]*tono/g, 'bitono');
  s = s.replace(/\b(vw|nuevo)\b/g, '');
  s = s.replace(/\bmtg([123])\b/g, 'mt');   // Oversoft a veces pega la generación al cambio: "MTG3" = "MT G3"
  s = s.replace(/\bmy2[0-9]\b/g, '').replace(/\b20[0-9][0-9]\b/g, '').replace(/\bg[123]\b/g, '');
  // OJO: NO borrar pack/safe/i/ii — "Tera Trend MSI MT" y "... + Pack Safe I"
  // son productos DISTINTOS (precio/dto distintos) y Oversoft describe sin pack.
  // "se" sí se borra: los nombres "SE G2" de Amarok son el mismo producto.
  s = s.replace(/\bph[ag]\b/g, '').replace(/\b(se|cd|l)\b/g, '');
  return s.replace(/[^a-z0-9]/g, '');
}

// Stock Y VENTAS por TRIM EXACTO desde Oversoft (todo genuino, sin la planilla).
// Clave: los 6 dígitos del código NO distinguen High/Outfit, Highline/Bitono,
// Extreme/Hero/Black Style (comparten código, distinto precio). La descripción
// de Oversoft (por código COMPLETO, ej "CH24K3 PAR MY26" → Nivus Outfit) sí los
// distingue → contamos por descripción y matcheamos al catálogo por nombre.
//   STOCK  = disponible para vender: físico libre + a recibir, SIN PV, SIN asignar.
//   VENTAS = preventas por FECHA de creación, no anuladas, 0km (tipopv 'O', sin
//            usados). Verificado: coincide al palo con la hoja PVs.
// Devuelve { stockPorTrim:{nc:n}, stockTotal, ventasPorTrim:{nc:{mes:n}},
//            ventasDet:{nc:[{mes,monto,iva}]} (para gcia real por venta),
//            sinCatalogo:[{desc,stock,ventas}] } (lo que no matcheó el catálogo).
function _oversoftMotorData(catByNorm) {
  const h = { headers: { apikey: OVERSOFT_KEY, Authorization: 'Bearer ' + OVERSOFT_KEY }, muteHttpExceptions: true };
  // 1) descripción por código completo (paginado)
  const desc = {};
  let off = 0;
  for (let i = 0; i < 12; i++) {
    const res = UrlFetchApp.fetch(OVERSOFT_URL + '/modelos?select=codigodecompra,descripcionoperativa&order=modeloid&limit=1000&offset=' + off, h);
    if (res.getResponseCode() >= 300) break;
    const ch = JSON.parse(res.getContentText());
    for (const m of ch) if (m.codigodecompra) desc[String(m.codigodecompra).trim()] = m.descripcionoperativa;
    if (ch.length < 1000) break;
    off += 1000;
  }
  const ncDe = (codFull) => { const d = desc[String(codFull || '').trim()]; return d ? (catByNorm[_ntrim(d)] || null) : null; };
  // Registro de lo que NO matchea, para que el front pueda mostrar cuáles son.
  const sinCat = {};
  const anotarSinCat = (codFull, campo) => {
    const d = desc[String(codFull || '').trim()] || ('código ' + String(codFull || '?').trim());
    if (!sinCat[d]) sinCat[d] = { desc: d, stock: 0, ventas: 0 };
    sinCat[d][campo]++;
  };

  // 2) STOCK (con color: tabla colores = colorid → descripción)
  const colorDe = {};
  try {
    const resC = UrlFetchApp.fetch(OVERSOFT_URL + '/colores?select=colorid,descripcion&limit=2000', h);
    if (resC.getResponseCode() < 300) for (const c of JSON.parse(resC.getContentText())) colorDe[String(c.colorid)] = String(c.descripcion || '').trim();
  } catch (e) {}
  const res2 = UrlFetchApp.fetch(OVERSOFT_URL + '/unidades?select=modelo,color&entregada=eq.false&asignada=eq.false&preventa=eq.&limit=3000', h);
  const us = (res2.getResponseCode() < 300) ? JSON.parse(res2.getContentText()) : [];
  const stockPorTrim = {}; const stockColorPorTrim = {}; let stockTotal = 0;
  for (const u of us) {
    stockTotal++;
    const nc = ncDe(u.modelo);
    if (!nc) { anotarSinCat(u.modelo, 'stock'); continue; }
    stockPorTrim[nc] = (stockPorTrim[nc] || 0) + 1;
    const col = colorDe[String(u.color)] || ('color ' + u.color);
    if (!stockColorPorTrim[nc]) stockColorPorTrim[nc] = {};
    stockColorPorTrim[nc][col] = (stockColorPorTrim[nc][col] || 0) + 1;
  }

  // 3) VENTAS (preventas no anuladas, 0km, por fecha) — últimos ~6 meses
  const hoy = new Date();
  const d6 = new Date(hoy.getFullYear(), hoy.getMonth() - 5, 1);
  const desdeStr = d6.getFullYear() + '-' + String(d6.getMonth() + 1).padStart(2, '0') + '-01';
  const res3 = UrlFetchApp.fetch(OVERSOFT_URL + '/preventas?select=modelo,fecha,precioventa,tasadeivaid&anulada=not.is.true&tipopv=eq.O&fecha=gte.' + desdeStr + '&limit=5000', h);
  const pvs = (res3.getResponseCode() < 300) ? JSON.parse(res3.getContentText()) : [];
  const ventasPorTrim = {};
  const ventasDet = {};   // nc → [{mes, monto, iva}] para la gcia real por venta
  for (const pv of pvs) {
    const nc = ncDe(pv.modelo);
    if (!nc) { anotarSinCat(pv.modelo, 'ventas'); continue; }
    if (!pv.fecha) continue;
    const mk = String(pv.fecha).slice(0, 7);
    if (!ventasPorTrim[nc]) ventasPorTrim[nc] = {};
    ventasPorTrim[nc][mk] = (ventasPorTrim[nc][mk] || 0) + 1;
    const monto = Number(pv.precioventa) || 0;
    if (monto > 0) {
      if (!ventasDet[nc]) ventasDet[nc] = [];
      // IVA por tasadeivaid de Oversoft: 3 = 10,5% (pickups), resto 21%.
      ventasDet[nc].push({ mes: mk, monto: monto, iva: (Number(pv.tasadeivaid) === 3 ? 0.105 : 0.21) });
    }
  }
  return { stockPorTrim: stockPorTrim, stockColorPorTrim: stockColorPorTrim, stockTotal: stockTotal,
           ventasPorTrim: ventasPorTrim, ventasDet: ventasDet, sinCatalogo: Object.values(sinCat) };
}

// Gcia real de UNA venta, % sobre lista — réplica EXACTA de la fórmula de la
// hoja PVs (filas vivas, leída de la madre 2026-06-11), valuada con la BT del
// mes que se le pase. Convenciones de la hoja: neto = bruto·(1−IVA); comisión
// 1,5% (neta si dto>5%, s/precio si no); IIBB = max(1,4% venta neta, 10% dif
// venta vs costo neta). Diferencias documentadas vs la hoja: costo histórico ≈
// costo rep del mes (Oversoft tiene costounidad=0) — solo pesa cuando se vende
// arriba del costo (4/201 casos); accesorios y "ahorro compra" no disponibles.
function _gciaVentaPct(monto, iva, lista, costoRep, ccIva, otros) {
  if (!(lista > 0) || !(monto > 0)) return null;
  const U = costoRep - ccIva - otros;                 // costo rep tomando incentivos
  const dto = 1 - monto / lista;
  const com = (dto > 0.05) ? (monto / (1 + iva)) * 0.015 : 0.015 * monto;
  const iibb = Math.max(0.014 * monto * (1 - iva), 0.1 * (monto - costoRep) * (1 - iva));
  const gcia = monto * (1 - iva) - U * (1 - iva) - com - iibb;
  return gcia / (lista * (1 - iva));
}

// =======================================================================
// ADM DE VENTAS — lo que sale de Oversoft, automático; el resto lo completa
// la administrativa en el portal (tabla adm_ventas en Supabase, key = # PV).
// Espejo moderno de la hoja "adm de ventas" de la madre; alimentará
// Patentamientos cuando esté validado.
// =======================================================================
const ADM_VENTAS_DESDE = '2026-01-01';

// 'PV 08032/1' (Oversoft) → '8032/1' (como la hoja). Misma normalización que
// usa el front de ventas para matchear contra la hoja PVs.
function _normPv(s) {
  s = String(s || '').toUpperCase().replace('PV', '').trim();
  const p = s.split('/');
  return (p[0].replace(/^0+/, '') || '0') + (p[1] ? '/' + p[1] : '');
}

// ---- Cuadro financiero (formas de pago + recibos, desde detcash) ----------
// detcash es el libro mayor por PV: filas origen VTOKM/VTPDA = lo PLANIFICADO
// (importe>0, con vencimiento) y origen RC = los RECIBOS hechos (importe<0, con
// cobranzanro = nro de recibo y fecha = cuándo se cobró). Una PV financia con
// UNA sola entidad (es prendario). Mapeo motivo→financiador verificado 1:1
// contra el texto del recibo en datos 2026.
var FIN_MAP = {
  'FIN0KMBBVA': { grupo: 'VW',    nombre: 'VW Credit' },
  'FIN0KMFG':   { grupo: 'TG',    nombre: 'TG (propio)' },
  'FIN0KM':     { grupo: 'OTROS', nombre: 'Galicia' },
  'FIN0KMNAC':  { grupo: 'OTROS', nombre: 'Banco Nacion' },
  'FIN0KMBIND': { grupo: 'OTROS', nombre: 'BIND' },
  'FINOKMRIO':  { grupo: 'OTROS', nombre: 'Santander' },
  'FIN0KMRIO':  { grupo: 'OTROS', nombre: 'Santander' },
};
function _finInfo(motivo) {
  var m = FIN_MAP[motivo];
  if (m) return m;
  if (/^FIN/.test(String(motivo))) return { grupo: 'OTROS', nombre: String(motivo).replace(/^FIN0?KM/, '') || 'Otro' };
  return null;
}
function _concNombre(motivo) {
  var fi = _finInfo(motivo);
  if (fi) return 'Financia ' + fi.nombre;
  var k = String(motivo || '').replace(/Ñ/g, 'N').toUpperCase().trim();
  var M = { 'SENA': 'Sena', 'SENASIMP': 'Sena', 'REFUESENA': 'Refuerzo sena',
    'CANCOKM': 'Cancela unidad', 'GASTADM': 'Gastos adm.', 'ALTAPLANES': 'Cuota plan' };
  return M[k] || String(motivo || '');
}
// Agrupa las filas detcash de UNA pv por concepto y calcula plan vs cobrado,
// totales, tipo de operación y financiador.
function _cuadroDePv(rows) {
  var g = {}, hasVTPDA = false;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i], mot = String(r.motivo || '').trim(), imp = Number(r.importe) || 0;
    var origen = String(r.origen || '');
    if (origen === 'VTPDA') hasVTPDA = true;
    if (!g[mot]) g[mot] = { motivo: mot, concepto: _concNombre(mot), plan: 0, cobrado: 0, nc: 0, nd: 0, vto: '', fechaCobro: '', recibos: [] };
    if (origen === 'RC') {
      // recibo / pago real del cliente
      g[mot].cobrado += -imp;
      var nro = String(r.cobranzanro || '').replace(/;/g, ' ').trim().split(/\s+/).pop();
      if (nro) g[mot].recibos.push(nro);
      var f = String(r.fecha || '').slice(0, 10);
      if (f > g[mot].fechaCobro) g[mot].fechaCobro = f;
    } else if (imp < 0) {
      // NOTA DE CRÉDITO (VTGTS neg, o reverso de un cargo): es un haber de la cta
      // cte → anula deuda igual que un pago. Acá vive el caso "cancela unidad
      // corregido por NC".
      g[mot].cobrado += -imp;
      g[mot].nc += -imp;
    } else {
      // cargo planificado (VTOKM/VTPDA) o NOTA DE DÉBITO (VTGTS pos = algo a pagar
      // de más que no se facturó) → suma a la deuda.
      g[mot].plan += imp;
      if (origen === 'VTGTS') g[mot].nd += imp;
      var v = String(r.vencimiento || '').slice(0, 10);
      if (v && (!g[mot].vto || v < g[mot].vto)) g[mot].vto = v;
    }
  }
  var lineas = [];
  for (var k in g) {
    var c = g[k];
    if (Math.abs(c.plan) < 0.01 && Math.abs(c.cobrado) < 0.01) continue;
    c.saldo = Math.round((c.plan - c.cobrado) * 100) / 100;
    lineas.push(c);
  }
  lineas.sort(function (a, b) { return (a.vto || '9999').localeCompare(b.vto || '9999'); });
  var totalPlan = 0, totalCobrado = 0, totalNc = 0, totalNd = 0, finLine = null;
  for (var j = 0; j < lineas.length; j++) {
    totalPlan += lineas[j].plan; totalCobrado += lineas[j].cobrado;
    totalNc += lineas[j].nc; totalNd += lineas[j].nd;
    if (!finLine && _finInfo(lineas[j].motivo)) finLine = lineas[j];
  }
  var tipo = 'CONTADO', financia = '';
  if (finLine) { var fi = _finInfo(finLine.motivo); tipo = 'FINANCIA_' + fi.grupo; financia = fi.nombre; }
  return {
    cuadro: lineas, hasVTPDA: hasVTPDA,
    totalPlan: Math.round(totalPlan * 100) / 100,
    totalCobrado: Math.round(totalCobrado * 100) / 100,
    falta: Math.round((totalPlan - totalCobrado) * 100) / 100,
    totalNc: Math.round(totalNc * 100) / 100,   // total notas de crédito aplicadas
    totalNd: Math.round(totalNd * 100) / 100,   // total notas de débito (cargos extra)
    tipo: tipo, financia: financia,
    creditoCobrado: finLine ? { ok: (finLine.saldo <= 1), fecha: finLine.fechaCobro } : null,
  };
}
// Meses transcurridos desde una fecha ISO hasta hoy (null si fecha inválida).
function _mesesDesde(iso) {
  const s = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return (Date.now() - new Date(s).getTime()) / (86400000 * 30.4);
}
// pagoVW: si está en saldos uso ese dato; si NO está pero la unidad tiene +3
// meses (recepción, o la venta si falta), la doy por paga por antigüedad.
function _pagoVWdeVenta(sld, fechaRecepcion, fechaVenta) {
  if (sld) return { fecha: String(sld.fechaPago || '').trim(), impaga: !!sld.impaga, vence: String(sld.vence || '').trim() };
  const ref = (String(fechaRecepcion || '').slice(0, 10)) || (String(fechaVenta || '').slice(0, 10));
  const meses = _mesesDesde(ref);
  if (meses !== null && meses >= 3) return { fecha: '', impaga: false, vence: '', porAntiguedad: true };
  return null;
}

function getAdmVentas() {
  const h = { headers: { apikey: OVERSOFT_KEY, Authorization: 'Bearer ' + OVERSOFT_KEY }, muteHttpExceptions: true };
  const get = (path) => {
    const res = UrlFetchApp.fetch(OVERSOFT_URL + path, h);
    return (res.getResponseCode() < 300) ? JSON.parse(res.getContentText()) : [];
  };

  // 1) ventas 0km (no anuladas) desde ADM_VENTAS_DESDE. Orden por prevtaid
  // desc = orden REAL de creación, lo más nuevo arriba (preventas.fecha viene
  // sin hora; el id secuencial sí refleja fecha+hora de carga).
  const pvs = get('/preventas?select=prevtaid,numero,fecha,cliente,vendedorid,unidadid,usadoid,financiacion_importe,patentacliente,modelo,comentario,comentarioaux&anulada=not.is.true&tipopv=eq.O&fecha=gte.' + ADM_VENTAS_DESDE + '&order=prevtaid.desc&limit=2000');

  // 2) unidades (serie, chasis, dominio, fecha patentamiento) en lotes
  const uidSet = {};
  for (const p of pvs) if (p.unidadid) uidSet[p.unidadid] = true;
  const uids = Object.keys(uidSet);
  const unis = {};
  for (let i = 0; i < uids.length; i += 100) {
    for (const u of get('/unidades?select=unidadid,serie,vin,patente,fechapatentamiento,fechaderecepcion,fechaprogramada,horaprogramada,entregada&unidadid=in.(' + uids.slice(i, i + 100).join(',') + ')')) unis[u.unidadid] = u;
  }

  // 3) vendedores y clientes (nombre + localidad, por CUIT)
  const vend = {};
  for (const v of get('/vendedores?select=vendedorid,nombre&limit=2000')) vend[v.vendedorid] = String(v.nombre || '').trim();
  const cuitSet = {};
  for (const p of pvs) { const c = String(p.cliente || '').trim(); if (c) cuitSet[c] = true; }
  const cuits = Object.keys(cuitSet);
  const clis = {};
  for (let i = 0; i < cuits.length; i += 80) {
    const lote = cuits.slice(i, i + 80).map(c => '"' + c + '"').join(',');
    for (const c of get('/clientes?select=cuit_cuil,nombre,localidad&cuit_cuil=in.(' + encodeURIComponent(lote) + ')')) {
      clis[String(c.cuit_cuil).trim()] = c;
    }
  }
  // Fallback por DNI: algunas preventas guardan el cliente como DNI suelto
  // (sin formato CUIT "XX-DDDDDDDD-X") y no matchean arriba. Para esos, busco
  // en clientes por el campo dni. (Si tampoco está, la ficha no existe en Oversoft.)
  const dniPend = cuits.filter(c => !clis[c] && /^\d{6,9}$/.test(c));
  for (let i = 0; i < dniPend.length; i += 80) {
    const lote = dniPend.slice(i, i + 80).map(c => '"' + c + '"').join(',');
    for (const c of get('/clientes?select=dni,nombre,localidad&dni=in.(' + encodeURIComponent(lote) + ')')) {
      const d = String(c.dni || '').trim();
      if (d && !clis[d]) clis[d] = c;
    }
  }
  // Fallback por CODIGO interno de Oversoft: clientes viejos referencian la PV
  // por su 'codigo' (un nº legado, p.ej. 7697619) que no es ni el CUIT ni el DNI.
  // Sin esto la PV queda sin nombre aunque la ficha exista (ej. PV 08035/1).
  const codPend = cuits.filter(c => !clis[c]);
  for (let i = 0; i < codPend.length; i += 80) {
    const lote = codPend.slice(i, i + 80).map(c => '"' + c + '"').join(',');
    for (const c of get('/clientes?select=codigo,nombre,localidad&codigo=in.(' + encodeURIComponent(lote) + ')')) {
      const cod = String(c.codigo || '').trim();
      if (cod && !clis[cod]) clis[cod] = c;
    }
  }

  // 4) descripción de modelo por código completo (igual que el motor)
  const desc = {};
  let off = 0;
  for (let i = 0; i < 12; i++) {
    const ch = get('/modelos?select=codigodecompra,descripcionoperativa&order=modeloid&limit=1000&offset=' + off);
    for (const m of ch) if (m.codigodecompra) desc[String(m.codigodecompra).trim()] = m.descripcionoperativa;
    if (ch.length < 1000) break;
    off += 1000;
  }

  // 5) campos manuales de la administrativa (Supabase)
  const man = {};
  try {
    for (const m of _supaGet('/adm_ventas?select=*')) man[m.preventa] = m;
  } catch (e) {}

  // 6) detcash (formas de pago + recibos) y usados en parte de pago, por nº PV.
  // OJO: la réplica capea respuestas en 1000 filas → lotes chicos (50 PVs).
  const dcByPv = {};
  const usByPv = {};
  const nums = pvs.map(p => p.numero).filter(Boolean);
  for (let i = 0; i < nums.length; i += 50) {
    const lote = nums.slice(i, i + 50).map(n => '"' + n + '"').join(',');
    // VTGTS = notas de la cta cte del cliente (negativo = nota de crédito que
    // anula deuda; positivo = nota de débito = cargo extra a pagar). Sin esto, una
    // deuda ya anulada por NC (ej. CANCOKM corregido) quedaba como falta fantasma.
    const dc = get('/detcash?select=referencia,fecha,vencimiento,importe,motivo,origen,cobranzanro&origen=in.(VTOKM,VTPDA,RC,VTGTS)&referencia=in.(' + encodeURIComponent(lote) + ')&limit=1000');
    for (const r of dc) (dcByPv[r.referencia] = dcByPv[r.referencia] || []).push(r);
    const us = get('/usados?select=preventaorigen,marca,modelo,patente,anio,km,color,vin,combustible,preciodetoma&preventaorigen=in.(' + encodeURIComponent(lote) + ')&limit=1000');
    for (const x of us) (usByPv[x.preventaorigen] = usByPv[x.preventaorigen] || []).push(x);
  }

  // 7) saldos de compras a VW (paga/impaga + fecha de pago) por serie — de saldos-tga
  const saldoBySerie = {};
  try {
    const sc = getSaldosCompras();
    for (const x of (sc.unidades || [])) if (x.serie) saldoBySerie[String(x.serie).trim()] = x;
  } catch (e) {}

  const ventas = pvs.map(p => {
    const u = unis[p.unidadid] || {};
    const cli = clis[String(p.cliente || '').trim()] || {};
    const key = _normPv(p.numero);
    const m = man[key] || {};
    const fin = _cuadroDePv(dcByPv[p.numero] || []);
    const esAA = (String(p.numero).split('/')[1] === '8') || fin.hasVTPDA;
    const us = (usByPv[p.numero] || [])[0];
    const sld = saldoBySerie[String(u.serie || '').trim()];
    return {
      preventa: key,
      pvId: Number(p.prevtaid) || 0,   // orden de creación (id secuencial Oversoft)
      fechaPv: String(p.fecha || '').slice(0, 10),
      modelo: desc[String(p.modelo || '').trim()] || p.modelo,
      cliente: String(cli.nombre || '').trim() || String(p.cliente || ''),
      localidad: String(cli.localidad || '').trim(),
      vendedor: vend[p.vendedorid] || '',
      serie: String(u.serie || '').trim(),
      chasis: String(u.vin || '').trim(),
      dominio: String(u.patente || '').trim(),
      fechaPatentamiento: u.fechapatentamiento ? String(u.fechapatentamiento).slice(0, 10) : '',
      // Entrega programada y si ya retiró → directo de Oversoft (unidades), no se carga a mano.
      entregaFecha: u.fechaprogramada ? String(u.fechaprogramada).slice(0, 10) : '',
      entregaHora: String(u.horaprogramada || '').slice(0, 5),
      entregada: !!u.entregada,
      usado: (Number(p.usadoid) || 0) > 0,
      montoFinanciado: Number(p.financiacion_importe) || 0,
      patentaCliente: !!p.patentacliente,
      // --- cuadro financiero (detcash) ---
      tipo: esAA ? 'AA' : fin.tipo,           // AA | CONTADO | FINANCIA_VW | FINANCIA_TG | FINANCIA_OTROS
      financia: fin.financia,                  // nombre del financiador (si aplica)
      cuadro: fin.cuadro,                      // líneas: concepto/plan/cobrado/saldo/vto/fechaCobro/recibos
      totalPlan: fin.totalPlan,
      totalCobrado: fin.totalCobrado,
      falta: fin.falta,
      totalNc: fin.totalNc,                    // notas de crédito aplicadas (anulan deuda)
      totalNd: fin.totalNd,                    // notas de débito (cargos extra a pagar)
      creditoCobrado: fin.creditoCobrado,      // {ok, fecha} si hay financiación
      // usadoParte: ficha del usado tomado en parte de pago (de la tabla usados,
      // por preventaorigen = nº PV). La "versión" viene dentro de modelo (Oversoft
      // no la separa). toma = preciodetoma = lo que se le reconoce al cliente.
      usadoParte: us ? {
        marca: String(us.marca || '').trim(), modelo: String(us.modelo || '').trim(),
        patente: String(us.patente || '').trim(), anio: us.anio || '',
        km: Number(us.km) || 0, color: String(us.color || '').trim(),
        vin: String(us.vin || '').trim(), combustible: String(us.combustible || '').trim(),
        toma: Number(us.preciodetoma) || 0,
      } : null,
      // pago de la unidad a VW (de saldos-tga, por serie): fecha + paga/impaga.
      // Si saldos NO la detecta pero la unidad tiene +3 meses (por fecha de
      // recepción, o la venta si falta) → por defecto PAGA (obvio que ya se pagó).
      pagoVW: _pagoVWdeVenta(sld, u.fechaderecepcion, p.fecha),
      comentario: [String(p.comentario || '').trim(), String(p.comentarioaux || '').trim()].filter(Boolean).join('\n'),
      manual: {
        mes_patentamiento:  m.mes_patentamiento || '',
        patenta:            m.patenta || '',
        admin:              m.admin || '',
        tipo_carpeta:       m.tipo_carpeta || '',
        credito_liquidado:  m.credito_liquidado || '',   // SI/NO que pone la adm (fecha sale del recibo)
        fecha_liquidacion:  m.fecha_liquidacion || '',
        reventa_particular: m.reventa_particular || '',
        fecha_pago_vw:      m.fecha_pago_vw || '',
        notas:              m.notas || '',
      },
    };
  });
  return { ventas: ventas, total: ventas.length, desde: ADM_VENTAS_DESDE, updatedAt: new Date().toISOString() };
}

// ===================== CONCILIACIÓN DE GASTOS por PV =====================
// Lee el gasto REAL que cargó el sistema: el comprobante ServiciosA/B con la
// MISMA referencia ('PV 0XXXX/1') que el AutomovilesA/B de la venta, y su detalle
// por concepto (comprobantesdetallesgastos). Lo concilia contra:
//  · la tasa de sellado de la provincia (SELLO_INSC, base = arancel ÷ su %),
//  · el quebranto del plan VWFS (portal_campanas) sobre el monto financiado real
//    (detcash, renglón FIN*),
//  · gastos faltantes (informe inhibido $65.000 cuando financian — solo PVs nuevas).
// Solo sucursal 1 (VW). Control vigente desde GASTOS_DESDE.
const GASTOS_DESDE     = '2026-06-01';
const INHIBIDO_DESDE   = '2026-06-19';  // el informe inhibido se exige en PVs nuevas (>= esta fecha)
const INFORME_INHIBIDO = 65000;
const SELLO_INSC = {
  'CAPITAL FEDERAL': 0.03, 'BUENOS AIRES': 0.025, 'CATAMARCA': 0.01, 'CHACO': 0.01,
  'CHUBUT': 0.02, 'CORDOBA': 0.015, 'CORRIENTES': 0.01, 'ENTRE RIOS': 0.0225,
  'FORMOSA': 0.03, 'JUJUY': 0.02, 'LA PAMPA': 0.03, 'LA RIOJA': 0.0075,
  'MENDOZA': 0.03, 'MISIONES': 0.03, 'NEUQUEN': 0.014, 'RIO NEGRO': 0.02,
  'SALTA': 0.025, 'SAN JUAN': 0, 'SAN LUIS': 0.015, 'SANTA CRUZ': 0.03,
  'SANTA FE': 0.012, 'SANTIAGO DEL ESTERO': 0, 'TIERRA DEL FUEGO': 0.01, 'TUCUMAN': 0,
};
function _gIva(l)  { return (Number(l.montogravado) || 0) * 1.21 + (Number(l.montoexento) || 0); }
function _gNeto(l) { return (Number(l.montogravado) || 0) + (Number(l.montoexento) || 0); }
function _gCod(c)  { const m = String(c || '').match(/^(\d{2})/); return m ? Number(m[1]) : 0; }
function _gRate(c) { const m = String(c || '').match(/([0-9][0-9.,]*)\s*%/); return m ? Number(m[1].replace(',', '.')) / 100 : null; }

function getConciliacionGastos(params) {
  const mes = String((params && params.mes) || '').match(/^\d{4}-\d{2}$/) ? params.mes : _yyyyMm(new Date());
  const desde = (mes + '-01') < GASTOS_DESDE ? GASTOS_DESDE : mes + '-01';
  const y = Number(mes.slice(0, 4)), mo = Number(mes.slice(5, 7));
  const nm = (mo === 12) ? (y + 1) + '-01-01' : y + '-' + ('0' + (mo + 1)).slice(-2) + '-01';
  const ovs = (path) => {
    const res = UrlFetchApp.fetch(OVERSOFT_URL + path, { headers: { apikey: OVERSOFT_KEY, Authorization: 'Bearer ' + OVERSOFT_KEY }, muteHttpExceptions: true });
    return res.getResponseCode() < 300 ? JSON.parse(res.getContentText()) : [];
  };
  const esSuc1 = (ref) => ref.indexOf('PV ') === 0 && /\/1$/.test(ref);

  // 1) comprobante de la venta (auto) -> provincia + fecha por PV (sucursal 1)
  const autos = ovs('/comprobantes?tipo=ilike.Automoviles*&fecha=gte.' + desde + '&fecha=lt.' + nm + '&select=referencia,provincia,fecha,preciolistaneto&limit=3000');
  const meta = {};
  autos.forEach((r) => {
    const ref = String(r.referencia || ''); if (!esSuc1(ref)) return;
    const pv = ref.replace('PV ', '');
    if (!meta[pv]) meta[pv] = { prov: String(r.provincia || ''), fecha: String(r.fecha || '').slice(0, 10), lista: Number(r.preciolistaneto) || 0 };
  });
  // 2) comprobante de gastos (Servicios) -> dedup por PV (mayor total, no anulado)
  const serv = ovs('/comprobantes?tipo=ilike.Servicios*&fecha=gte.' + desde + '&fecha=lt.' + nm + '&anulada=eq.false&select=comprobanteid,referencia,total&limit=4000');
  const gComp = {};
  serv.forEach((r) => {
    const ref = String(r.referencia || ''); if (!esSuc1(ref)) return;
    const pv = ref.replace('PV ', ''), t = Number(r.total) || 0;
    if (!gComp[pv] || t > gComp[pv].total) gComp[pv] = { id: r.comprobanteid, total: t };
  });
  // 3) tasas de quebranto válidas (planes VWFS). portal_campanas tiene RLS: el anon
  // no lo lee, así que va con la service key (la misma de las escrituras).
  let qbRates = [];
  try {
    const svc = PropertiesService.getScriptProperties().getProperty('SUPA_SERVICE');
    if (svc) {
      const res = UrlFetchApp.fetch(SUPA_URL + '/portal_campanas?select=quebranto_pct', { headers: { apikey: svc, Authorization: 'Bearer ' + svc }, muteHttpExceptions: true });
      if (res.getResponseCode() < 300) qbRates = JSON.parse(res.getContentText()).map((c) => Number(c.quebranto_pct) || 0);
    }
  } catch (e) {}

  const filas = [];
  let totDeMas = 0, totFaltan = 0;
  Object.keys(gComp).forEach((pv) => {
    const m = meta[pv] || { prov: '', fecha: '', lista: 0 };
    const det = ovs('/comprobantesdetallesgastos?comprobanteid=eq.' + gComp[pv].id + '&select=concepto,montogravado,montoexento');
    let base = 0, patent = 0, prenda = 0, financ = 0;
    let arMonto = 0, arRate = null, seMonto = 0, q21Neto = 0, tieneInsPrenda = false, tieneSelloPrenda = false, tieneInhib = false;
    const lineas = [];
    det.forEach((l) => {
      const cod = _gCod(l.concepto), iva = _gIva(l), neto = _gNeto(l);
      if (cod === 12 || cod === 13) { arMonto = neto; arRate = _gRate(l.concepto); }
      if (cod >= 14 && cod <= 16) seMonto = neto;
      if (cod === 18) tieneInsPrenda = true;
      if (cod === 20) tieneSelloPrenda = true;
      if (cod === 21) q21Neto += neto;
      if (/inhib/i.test(String(l.concepto))) tieneInhib = true;
      if (cod >= 9 && cod <= 16) patent += iva;
      else if (cod >= 17 && cod <= 20) prenda += iva;
      else if (cod === 21) financ += iva;
      else base += iva;
      lineas.push({ cod: cod, concepto: String(l.concepto || ''), cobrado: Math.round(iva), correcto: null, dif: 0, estado: 'ok' });
    });
    const prov = m.prov.toUpperCase();
    const patenta = patent > 1 ? 'TG' : 'CLIENTE';
    const expRate = SELLO_INSC.hasOwnProperty(prov) ? SELLO_INSC[prov] : null;
    const baseImp = arRate ? arMonto / arRate : 0;
    const alertas = [];

    // PUNTO 4 — sellado vs tasa de la provincia
    if (patenta === 'TG' && seMonto > 0 && baseImp > 0) {
      const ln = lineas.filter((x) => x.cod >= 14 && x.cod <= 16)[0];
      if (expRate === null) { if (ln) ln.estado = 'revisar'; alertas.push('Provincia ' + m.prov + ' sin tasa de referencia'); }
      else {
        const correcto = Math.round(baseImp * expRate);
        const dif = Math.round(seMonto - correcto);   // + = cobró de más
        if (ln) { ln.correcto = correcto; ln.dif = dif; ln.estado = (Math.abs(dif) < Math.max(1000, baseImp * 0.0005)) ? 'ok' : 'mal'; }
        if (ln && ln.estado === 'mal') { alertas.push('Sellado ' + (Math.round((seMonto / baseImp) * 1000) / 10) + '% vs ' + (expRate * 100) + '% (' + (dif > 0 ? 'cobró de más' : 'cobró de menos') + ' ' + Math.abs(dif).toLocaleString('es-AR') + ')'); if (dif > 0) totDeMas += dif; else totFaltan += -dif; }
      }
    }
    // PUNTO 8 — quebranto vs plan VWFS (sobre monto financiado real de detcash)
    let fin = null;
    if (financ > 0) {
      let montoFin = 0, financiador = '';
      const dc = ovs('/detcash?referencia=eq.' + encodeURIComponent('PV ' + pv) + '&motivo=ilike.FIN*&select=importe,motivo');
      dc.forEach((r) => { const imp = Number(r.importe) || 0; if (imp > 0) { montoFin += imp; const fi = _finInfo(r.motivo); if (fi) financiador = fi.nombre; } });
      const impliedQb = montoFin > 0 ? q21Neto / montoFin : 0;
      const planOk = qbRates.some((q) => Math.abs(q / 100 - impliedQb) < 0.003);
      const esFijoSinQb = q21Neto <= 120000;
      const ok = planOk || esFijoSinQb;
      fin = { montoFin: Math.round(montoFin), financiador: financiador, quebrantoNeto: Math.round(q21Neto), pct: Math.round(impliedQb * 1000) / 10, ok: ok };
      const lnq = lineas.filter((x) => x.cod === 21)[0];
      if (lnq && !ok) { lnq.estado = 'revisar'; alertas.push('Quebranto ' + fin.pct + '% no coincide con ningún plan VWFS'); }
    }
    // PUNTO 5 — prenda incompleta (sellado de prenda sin inscripción)
    if (tieneSelloPrenda && !tieneInsPrenda) alertas.push('Sellado de prenda sin inscripción de prenda');
    // PUNTO 7 — informe inhibido (solo PVs nuevas que financian)
    if (financ > 0 && m.fecha >= INHIBIDO_DESDE && !tieneInhib) {
      lineas.push({ cod: 99, concepto: 'Informe inhibido (falta)', cobrado: 0, correcto: INFORME_INHIBIDO, dif: -INFORME_INHIBIDO, estado: 'falta' });
      alertas.push('Falta informe inhibido $' + INFORME_INHIBIDO.toLocaleString('es-AR'));
      totFaltan += INFORME_INHIBIDO;
    }

    const difFavor = lineas.reduce((a, x) => a + (Number(x.dif) || 0), 0);
    filas.push({
      pv: pv, prov: m.prov, fecha: m.fecha, patenta: patenta,
      total: Math.round(base + patent + prenda + financ),
      desglose: { base: Math.round(base), patent: Math.round(patent), prenda: Math.round(prenda), financ: Math.round(financ) },
      fin: fin, lineas: lineas, alertas: alertas, difFavor: Math.round(difFavor),
      estado: alertas.length ? 'alerta' : 'ok',
    });
  });
  filas.sort((a, b) => a.pv.localeCompare(b.pv));
  return {
    mes: mes, filas: filas, total: filas.length,
    conAlerta: filas.filter((f) => f.estado === 'alerta').length,
    sumGastos: filas.reduce((a, f) => a + f.total, 0),
    cobradoDeMas: Math.round(totDeMas), faltaCobrar: Math.round(totFaltan),
    updatedAt: new Date().toISOString(),
  };
}

// ====== VENTAS desde Oversoft + margen desde la BT (reemplazo de getVentas) ======
// Arma la lista de ventas como Adm.ventas (Oversoft) y calcula la ganancia por
// venta con la BT del mes de cada venta (igual que el motor), SIN leer la hoja.
// Endpoint paralelo tipo=ventasv2 para validar contra la hoja antes de cortar.
// Sin argumento: mes actual por fórmula + meses cerrados de ventas_hist.
// Con targetMes ('yyyy-mm'): calcula SOLO ese mes por fórmula (para congelarlo).
function getVentasV2(targetMes) {
  const h = { headers: { apikey: OVERSOFT_KEY, Authorization: 'Bearer ' + OVERSOFT_KEY }, muteHttpExceptions: true };
  const get = (path) => { const res = UrlFetchApp.fetch(OVERSOFT_URL + path, h); return res.getResponseCode() < 300 ? JSON.parse(res.getContentText()) : []; };

  const desdeStr = VENTAS_MES_MINIMO + '-01';
  const pvs = get('/preventas?select=prevtaid,numero,fecha,vendedorid,unidadid,modelo,precioventa,tasadeivaid,comentario,comentarioaux&anulada=not.is.true&tipopv=eq.O&fecha=gte.' + desdeStr + '&order=prevtaid.desc&limit=3000');

  // unidades (serie + color) en lotes de 100
  const uidSet = {}; for (const p of pvs) if (p.unidadid) uidSet[p.unidadid] = true;
  const uids = Object.keys(uidSet); const unis = {};
  for (let i = 0; i < uids.length; i += 100) for (const u of get('/unidades?select=unidadid,serie,color&unidadid=in.(' + uids.slice(i, i + 100).join(',') + ')')) unis[u.unidadid] = u;
  const colorDe = {};
  for (const c of get('/colores?select=colorid,descripcion&limit=2000')) colorDe[String(c.colorid)] = String(c.descripcion || '').trim();

  const vend = {};
  for (const v of get('/vendedores?select=vendedorid,nombre&limit=2000')) vend[v.vendedorid] = String(v.nombre || '').trim();

  // desc modelo (codigodecompra → descripcion operativa)
  const desc = {}; let off = 0;
  for (let i = 0; i < 12; i++) { const ch = get('/modelos?select=codigodecompra,descripcionoperativa&order=modeloid&limit=1000&offset=' + off); for (const m of ch) if (m.codigodecompra) desc[String(m.codigodecompra).trim()] = m.descripcionoperativa; if (ch.length < 1000) break; off += 1000; }

  // catálogo + BT por mes + incentivos por mes (Supabase) — para el margen
  const catByNorm = {};
  for (const c of _supaGet('/catalogo_modelos?select=codigo,nombre_corto,nombre_bt&activo=eq.true')) {
    if (c.nombre_corto) catByNorm[_ntrim(c.nombre_corto)] = c;
    if (c.nombre_bt) catByNorm[_ntrim(c.nombre_bt)] = c;
  }
  const btPorMes = {};
  for (const p of _supaGet('/precios_lista?select=mes,modelo,precio_lista,costo_concesionario')) {
    if (!btPorMes[p.mes]) btPorMes[p.mes] = {};
    btPorMes[p.mes][p.modelo] = p;
  }
  const incPorMes = {};
  for (const r of _supaGet('/incentivos?select=mes,nombre_corto,tipo,monto_civa')) {
    if (!incPorMes[r.mes]) incPorMes[r.mes] = {};
    if (!incPorMes[r.mes][r.nombre_corto]) incPorMes[r.mes][r.nombre_corto] = {};
    incPorMes[r.mes][r.nombre_corto][r.tipo] = Number(r.monto_civa) || 0;
  }
  const ncDe = (codFull) => { const d = desc[String(codFull || '').trim()]; return d ? (catByNorm[_ntrim(d)] || null) : null; };

  // Accesorios manuales (tabla ventas_manual, key = preventa normalizada).
  const manV = {};
  try { for (const m of _supaGet('/ventas_manual?select=preventa,accesorios')) manV[m.preventa] = Number(m.accesorios) || 0; } catch (e) {}

  const cuentaPorMes = {}, acumPorMes = {};
  const filas = [];
  // Meses CERRADOS (< mes actual) = resultados congelados de la hoja (ventas_hist).
  // El mes ACTUAL se calcula con la fórmula (Oversoft+BT) acá abajo.
  const mesActualV = _yyyyMm(new Date());
  const mesObjetivo = targetMes || mesActualV;   // qué mes calcular por fórmula
  // proceso cronológico (asc) para la gcia neta acumulada por mes
  for (const p of pvs.slice().reverse()) {
    if (!p.fecha) continue;
    const mesKey = String(p.fecha).slice(0, 7);
    if (mesKey < VENTAS_MES_MINIMO) continue;
    if (mesKey !== mesObjetivo) continue;   // solo el mes objetivo se calcula por fórmula
    cuentaPorMes[mesKey] = (cuentaPorMes[mesKey] || 0) + 1;

    const monto = Number(p.precioventa) || 0;
    const ivaFrac = Number(p.tasadeivaid) === 3 ? 0.105 : 0.21;
    const u = unis[p.unidadid] || {};
    const nc = ncDe(p.modelo);
    const btMes = nc && btPorMes[mesKey] ? btPorMes[mesKey][nc.nombre_corto] : null;

    // Autoahorro: NO cobra condiciones comerciales → sin incentivos. Para estar
    // SEGUROS de que es AA exigimos DOS cosas: (1) PV terminada en "/8" Y (2) el
    // comentario menciona "G-O" / "GO" / "grupo y orden" (referencia del plan).
    // Una /8 que en realidad es venta normal (sin G-O) SÍ cobra incentivos.
    const _comAA = String(p.comentario || '') + ' ' + String(p.comentarioaux || '');
    const esAA = String(p.numero || '').split('/').pop().trim() === '8'
      && (/\bG\s*-?\s*O\b/i.test(_comAA) || /grupo\s*y\s*orden/i.test(_comAA));

    let gciaPct = null, gciaPesos = null, listaM = 0;
    if (btMes && monto > 0) {
      listaM = Number(btMes.precio_lista) || 0;
      const im = (incPorMes[mesKey] || {})[nc.nombre_corto] || {};
      const ccM = esAA ? 0 : (Number(im.performance) || 0);
      const otrosM = esAA ? 0 : ((Number(im.tactico) || 0) + (Number(im.whosale) || 0) + (Number(im.adicional1) || 0) + (Number(im.adicional2) || 0) + (Number(im.cupo) || 0));
      gciaPct = _gciaVentaPct(monto, ivaFrac, listaM, Number(btMes.costo_concesionario) || 0, ccM, otrosM);
      // _gciaVentaPct devuelve gcia/(lista·(1−IVA)). La GANANCIA en $ (= col X de
      // la hoja) es gcia = pct · lista · (1−IVA). (Antes faltaba el (1−IVA) → las
      // pérdidas/ganancias salían infladas ~27%.)
      if (gciaPct !== null) gciaPesos = Math.round(gciaPct * listaM * (1 - ivaFrac));
    }
    const acc = manV[_normPv(p.numero)] || 0;   // accesorios manuales: la fórmula los SUMA
    if (gciaPesos !== null) {
      gciaPesos += acc;
      // % gcia neta (= col Y) = ganancia / (lista · (1−IVA)), ya con accesorios.
      if (listaM > 0) gciaPct = gciaPesos / (listaM * (1 - ivaFrac));
      acumPorMes[mesKey] = (acumPorMes[mesKey] || 0) + gciaPesos;
    }
    const comentario = [String(p.comentario || '').trim(), String(p.comentarioaux || '').trim()].filter(Boolean).join('\n');
    const mencionaAcc = /\bacc/i.test(comentario);

    const vendNombre = vend[p.vendedorid] || '';
    filas.push({
      ventaNum: Number(p.prevtaid) || 0,
      fechaPvIso: String(p.fecha).slice(0, 10),
      fechaPvStr: String(p.fecha).slice(0, 10),
      mesKey: mesKey,
      preventaNum: String(p.numero || '').trim(),
      montoFc: monto,
      iva: ivaFrac * 100,
      serie: String(u.serie || '').trim(),
      modelo: desc[String(p.modelo || '').trim()] || String(p.modelo || ''),
      color: colorDe[String(u.color)] || '',
      gciaVtaPesos: gciaPesos,
      gciaVtaPct: gciaPct,
      gciaNetaAcum: gciaPesos !== null ? acumPorMes[mesKey] : null,
      vendedor: _matchVendedor(vendNombre) || vendNombre,
      vendedorRaw: vendNombre,
      accesorios: acc,
      comentario: comentario,
      mencionaAcc: mencionaAcc,
      sinBt: !btMes,
      _dbg: btMes ? { nc: nc.nombre_corto, lista: Number(btMes.precio_lista)||0, costo: Number(btMes.costo_concesionario)||0,
        cc: Number(((incPorMes[mesKey]||{})[nc.nombre_corto]||{}).performance)||0,
        otros: (function(im){return (Number(im.tactico)||0)+(Number(im.whosale)||0)+(Number(im.adicional1)||0)+(Number(im.adicional2)||0)+(Number(im.cupo)||0);})((incPorMes[mesKey]||{})[nc.nombre_corto]||{}) } : null,
    });
  }
  filas.reverse(); // lo más nuevo arriba (mes actual, calculado)

  // Meses CERRADOS: traer los resultados congelados (ventas_hist). Solo en el
  // modo normal (sin targetMes) y solo meses ANTERIORES al actual (el actual
  // siempre sale de la fórmula, aunque ya esté congelado).
  if (!targetMes) try {
    const hist = _supaGet('/ventas_hist?select=*&mes=lt.' + mesActualV + '&order=mes.desc,preventa.desc');
    for (const h of hist) {
      cuentaPorMes[h.mes] = (cuentaPorMes[h.mes] || 0) + 1;
      filas.push({
        ventaNum: 0, fechaPvIso: h.fecha || '', fechaPvStr: h.fecha || '',
        mesKey: h.mes, preventaNum: h.preventa, montoFc: Number(h.monto) || 0, iva: null,
        serie: h.serie || '', modelo: h.modelo || '', color: h.color || '',
        gciaVtaPesos: h.gcia_pesos != null ? Number(h.gcia_pesos) : null,
        gciaVtaPct: h.gcia_pct != null ? Number(h.gcia_pct) : null,
        gciaNetaAcum: null, vendedor: h.vendedor || '', vendedorRaw: h.vendedor || '',
        accesorios: 0, comentario: '', mencionaAcc: false, sinBt: false, hist: true,
      });
    }
  } catch (e) {}

  const meses = Object.keys(cuentaPorMes).sort().reverse().map(k => ({ mesKey: k, label: _mesLabel(k), cuenta: cuentaPorMes[k] }));
  const sinBt = filas.filter(f => f.sinBt).length;
  const _incDbg = {
    meses: Object.keys(incPorMes),
    teraJun: (incPorMes['2026-06'] || {})['Tera Trend MSI MT'] || null,
    btMeses: Object.keys(btPorMes),
    btTeraJun: (btPorMes['2026-06'] || {})['Tera Trend MSI MT'] || null,
    catTera: catByNorm[_ntrim('Tera Trend MSI MT')] || null,
  };
  return { ventas: filas, meses: meses, mesActual: _yyyyMm(new Date()), sinBt: sinBt, fuente: 'oversoft+bt', _incDbg: _incDbg, updatedAt: new Date().toISOString() };
}

// Congela los RESULTADOS de la hoja "PVs" (la ganancia que Fer ya calculó, con
// sus criterios de cupos/costos) en ventas_hist, para los meses CERRADOS
// (< mes actual). El mes actual lo calcula la fórmula. Re-ejecutable (upsert);
// pisa los meses cerrados con lo último de la hoja. % = gcia/monto (consistente).
function importarVentasHist() {
  const vt = getVentas();
  const mesActual = _yyyyMm(new Date());
  const rows = [];
  for (const v of (vt.ventas || [])) {
    if (!v.mesKey || v.mesKey >= mesActual) continue;   // solo meses cerrados
    const pv = _normPv(v.preventaNum);
    if (!pv) continue;
    const monto = Math.round(Number(v.montoFc) || 0);
    const gcia = Math.round(Number(v.gciaVtaPesos) || 0);
    rows.push({
      preventa: pv, mes: v.mesKey, fecha: v.fechaPvIso || null,
      modelo: v.modelo || '', color: v.color || '', serie: v.serie || '',
      vendedor: v.vendedor || v.vendedorRaw || '', monto: monto, gcia_pesos: gcia,
      gcia_pct: monto > 0 ? gcia / monto : null, updated_at: new Date().toISOString(),
    });
  }
  const hh = { apikey: SUPA_ANON, Authorization: 'Bearer ' + SUPA_ANON, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' };
  let ok = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const lote = rows.slice(i, i + 200);
    const res = UrlFetchApp.fetch(SUPA_URL + '/ventas_hist?on_conflict=preventa', { method: 'post', headers: hh, payload: JSON.stringify(lote), muteHttpExceptions: true });
    if (res.getResponseCode() >= 300) return { error: 'insert ventas_hist falló: ' + res.getContentText().slice(0, 200), ok: ok };
    ok += lote.length;
  }
  return { ok: true, importadas: ok, mesActual: mesActual };
}

// Congela (guarda fijo) los resultados de la FÓRMULA de un mes en ventas_hist,
// para que no se recalcule más. Re-ejecutable (upsert).
function congelarMes(mes) {
  if (!/^\d{4}-\d{2}$/.test(String(mes || ''))) return { error: 'mes inválido (yyyy-mm)' };
  const r = getVentasV2(mes);   // calcula ESE mes por fórmula
  const rows = [];
  for (const v of (r.ventas || [])) {
    if (v.mesKey !== mes || typeof v.gciaVtaPesos !== 'number') continue;
    const pv = _normPv(v.preventaNum);
    if (!pv) continue;
    const monto = Math.round(Number(v.montoFc) || 0);
    rows.push({
      preventa: pv, mes: mes, fecha: v.fechaPvIso || null,
      modelo: v.modelo || '', color: v.color || '', serie: v.serie || '',
      vendedor: v.vendedor || '', monto: monto, gcia_pesos: Math.round(v.gciaVtaPesos),
      gcia_pct: monto > 0 ? v.gciaVtaPesos / monto : null, updated_at: new Date().toISOString(),
    });
  }
  if (!rows.length) return { ok: true, congeladas: 0, mes: mes, nota: 'sin ventas para ese mes' };
  const hh = { apikey: SUPA_ANON, Authorization: 'Bearer ' + SUPA_ANON, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' };
  let ok = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const lote = rows.slice(i, i + 200);
    const res = UrlFetchApp.fetch(SUPA_URL + '/ventas_hist?on_conflict=preventa', { method: 'post', headers: hh, payload: JSON.stringify(lote), muteHttpExceptions: true });
    if (res.getResponseCode() >= 300) return { error: 'congelar falló: ' + res.getContentText().slice(0, 200), ok: ok };
    ok += lote.length;
  }
  return { ok: true, congeladas: ok, mes: mes };
}

// Trigger: día 1 de cada mes congela el mes que recién cerró (el anterior).
function congelarMesAnteriorAuto() {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  console.log('congelarMesAnteriorAuto:', JSON.stringify(congelarMes(_yyyyMm(prev))));
}
function instalarTriggerCongelar() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'congelarMesAnteriorAuto') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('congelarMesAnteriorAuto').timeBased().onMonthDay(1).atHour(3).create();
  return { ok: true, instalado: 'congelarMesAnteriorAuto día 1 ~03:00' };
}

// ===================== PRECIOS (lista + costo) en Supabase =====================
// Reemplazo de "Actual BT": el esqueleto de precios vive en precios_lista
// (Supabase). modelo = nombre_corto del catálogo (la clave con la que el MOTOR y
// la fórmula de VENTAS buscan precio/costo). Escritura con SUPA_SERVICE (igual
// que el snapshot). Tras guardar se invalidan los cachés de motor/precios/ventas.

function getPreciosLista(mes) {
  const m = /^\d{4}-\d{2}$/.test(String(mes || '')) ? mes : _yyyyMm(new Date());
  const cat = _supaGet('/catalogo_modelos?select=codigo,nombre_corto,nombre_bt,orden&activo=eq.true&order=orden.asc.nullslast,nombre_corto.asc');
  const pl = _supaGet('/precios_lista?select=codigo,modelo,precio_lista,costo_concesionario,lista_num,cargado_at&mes=eq.' + m);
  const porModelo = {};
  let listaNum = null;
  for (const p of pl) { porModelo[p.modelo] = p; if (listaNum === null && p.lista_num) listaNum = p.lista_num; }
  const filas = cat.map(function (c) {
    const p = porModelo[c.nombre_corto] || null;
    return {
      codigo: p ? p.codigo : c.codigo, modelo: c.nombre_corto, nombreBt: c.nombre_bt || '',
      precioLista: p ? Number(p.precio_lista) : null,
      costo: (p && p.costo_concesionario != null) ? Number(p.costo_concesionario) : null,
      cargado: !!p, cargadoAt: p ? p.cargado_at : null,
    };
  });
  const mesesSet = {};
  for (const r of _supaGet('/precios_lista?select=mes')) mesesSet[r.mes] = 1;
  return {
    mes: m, listaNum: listaNum, filas: filas, meses: Object.keys(mesesSet).sort().reverse(),
    cargados: pl.length, faltan: filas.filter(function (f) { return !f.cargado; }).length,
    totalCatalogo: cat.length, updatedAt: new Date().toISOString(),
  };
}

function _svcHeadersPrecios() {
  const svc = PropertiesService.getScriptProperties().getProperty('SUPA_SERVICE');
  if (!svc) return null;
  return { apikey: svc, Authorization: 'Bearer ' + svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' };
}
function _listaNumDelMes(mes) {
  const ex = _supaGet('/precios_lista?select=lista_num&mes=eq.' + mes + '&limit=1');
  return (ex.length && ex[0].lista_num) ? ex[0].lista_num : parseInt(mes.replace('-', ''), 10);
}
function _invalidarCachePrecios() {
  try { const c = CacheService.getScriptCache(); c.remove('motor'); c.remove('precios'); } catch (e) {}
  try { _cacheDrop('ventas'); } catch (e) {}
}

// Guarda UNA fila (precio lista y/o costo) de un modelo en un mes.
function savePrecioLista(body) {
  const mes = String(body.mes || '');
  if (!/^\d{4}-\d{2}$/.test(mes)) return { error: 'mes inválido (yyyy-mm)' };
  const modelo = String(body.modelo || '').trim();
  if (!modelo) return { error: 'falta modelo (nombre_corto)' };
  const precio = Number(body.precioLista) || 0;
  if (precio <= 0) return { error: 'el precio de lista debe ser > 0' };
  const costo = (body.costo === '' || body.costo == null) ? null : (Number(body.costo) || 0);
  if (costo != null && costo < 0) return { error: 'costo inválido' };
  const h = _svcHeadersPrecios();
  if (!h) return { error: 'falta SUPA_SERVICE en Script Properties' };
  const row = {
    lista_num: Number(body.listaNum) || _listaNumDelMes(mes),
    mes: mes, codigo: String(body.codigo || '').trim() || modelo, modelo: modelo,
    precio_lista: precio, costo_concesionario: costo, cargado_at: new Date().toISOString(),
  };
  const res = UrlFetchApp.fetch(SUPA_URL + '/precios_lista?on_conflict=lista_num,modelo', { method: 'post', headers: h, payload: JSON.stringify([row]), muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) return { error: 'guardar falló: ' + res.getContentText().slice(0, 200) };
  _invalidarCachePrecios();
  return { ok: true };
}

// Carga MASIVA de una lista nueva. body: { mes, listaNum?, filas:[{modelo,codigo?,precioLista,costo?}] }
// modelo DEBE ser el nombre_corto del catálogo (si no, el motor/ventas no lo encuentran).
function guardarPreciosListaBulk(body) {
  const mes = String(body.mes || '');
  if (!/^\d{4}-\d{2}$/.test(mes)) return { error: 'mes inválido (yyyy-mm)' };
  const filasIn = body.filas || [];
  if (!filasIn.length) return { error: 'sin filas' };
  const h = _svcHeadersPrecios();
  if (!h) return { error: 'falta SUPA_SERVICE' };
  // Validar nombres contra el catálogo (evita escribir un modelo que nadie lee).
  const validos = {};
  for (const c of _supaGet('/catalogo_modelos?select=nombre_corto&activo=eq.true')) validos[c.nombre_corto] = 1;
  const listaNum = Number(body.listaNum) || _listaNumDelMes(mes);
  const rows = [], errores = [], desconocidos = [];
  for (const f of filasIn) {
    const modelo = String(f.modelo || '').trim();
    const precio = Number(f.precioLista) || 0;
    if (!modelo || precio <= 0) { errores.push(modelo || '(sin modelo)'); continue; }
    if (!validos[modelo]) { desconocidos.push(modelo); continue; }   // no está en el catálogo
    rows.push({
      lista_num: listaNum, mes: mes, codigo: String(f.codigo || '').trim() || modelo, modelo: modelo,
      precio_lista: precio, costo_concesionario: (f.costo === '' || f.costo == null) ? null : (Number(f.costo) || 0),
      cargado_at: new Date().toISOString(),
    });
  }
  if (!rows.length) return { error: 'ninguna fila válida', errores: errores, desconocidos: desconocidos };
  let ok = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const lote = rows.slice(i, i + 200);
    const res = UrlFetchApp.fetch(SUPA_URL + '/precios_lista?on_conflict=lista_num,modelo', { method: 'post', headers: h, payload: JSON.stringify(lote), muteHttpExceptions: true });
    if (res.getResponseCode() >= 300) return { error: 'guardar falló: ' + res.getContentText().slice(0, 200), ok: ok };
    ok += lote.length;
  }
  _invalidarCachePrecios();
  return { ok: true, guardadas: ok, errores: errores, desconocidos: desconocidos };
}

// MIGRACIÓN una-vez (re-ejecutable): lo que la administrativa YA cargó en la
// hoja "adm de ventas" (espejo "patentamientos") se vuelca a la tabla
// adm_ventas. Solo inserta PVs que NO existan en la tabla (lo cargado en el
// portal nunca se pisa). Cols hoja (0-based): 1=PV · 2=fecha PV · 5=mes pat
// (texto "ABRIL") · 6=patenta · 7=admin · 8=AA carpeta · 10=fecha liq ·
// 11=reventa/particular · 19=fecha pago VW.
function migrarAdmVentasDesdeHoja() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('patentamientos');
  if (!sh) return { error: 'no encontré la hoja patentamientos' };
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { migradas: 0 };
  const raw = sh.getRange(1, 1, lastRow, 20).getValues();
  const display = sh.getRange(1, 1, lastRow, 20).getDisplayValues();

  const existentes = {};
  try { for (const m of _supaGet('/adm_ventas?select=preventa')) existentes[m.preventa] = true; } catch (e) {}

  const isoDate = (v, d) => {
    const f = _parseFecha(v, d);
    return f ? Utilities.formatDate(f, 'America/Argentina/Buenos_Aires', 'yyyy-MM-dd') : null;
  };

  const rows = [];
  let saltadas = 0;
  for (let i = 1; i < raw.length; i++) {
    const pv = _normPv(display[i][1]);
    if (!pv || pv === '0' || !/\d/.test(pv)) continue;
    if (existentes[pv]) { saltadas++; continue; }
    existentes[pv] = true;   // dedup dentro de la propia hoja (filas repetidas)
    const fechaPv = _parseFecha(raw[i][2], display[i][2]);
    // mes pat: texto "ABRIL" → 'yyyy-mm' (año de la fecha PV; +1 si el mes es anterior)
    let mesPat = null;
    const mesNum = _MES_TXT_A_NUM[_norm(display[i][5])];
    if (mesNum && fechaPv) {
      let anio = fechaPv.getFullYear();
      if (parseInt(mesNum, 10) < fechaPv.getMonth() + 1) anio += 1;
      mesPat = anio + '-' + mesNum;
    }
    const limpio = (x) => { const s = String(x || '').trim(); return s || null; };
    const fila = {
      preventa: pv,
      mes_patentamiento:  mesPat,
      patenta:            limpio(display[i][6]),
      admin:              limpio(display[i][7]),
      tipo_carpeta:       limpio(display[i][8]),
      fecha_liquidacion:  isoDate(raw[i][10], display[i][10]),
      reventa_particular: limpio(display[i][11]),
      fecha_pago_vw:      isoDate(raw[i][19], display[i][19]),
      updated_by:         'migracion hoja',
    };
    // solo migrar filas que tengan ALGO cargado por la adm
    if (fila.mes_patentamiento || fila.patenta || fila.admin || fila.tipo_carpeta ||
        fila.fecha_liquidacion || fila.reventa_particular || fila.fecha_pago_vw) {
      rows.push(fila);
    }
  }
  if (rows.length) {
    const hh = { apikey: SUPA_ANON, Authorization: 'Bearer ' + SUPA_ANON, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates' };
    const res = UrlFetchApp.fetch(SUPA_URL + '/adm_ventas?on_conflict=preventa', { method: 'post', headers: hh, payload: JSON.stringify(rows), muteHttpExceptions: true });
    if (res.getResponseCode() >= 300) return { error: 'insert falló: ' + res.getContentText().slice(0, 300) };
  }
  try { CacheService.getScriptCache().removeAll(['admventas', 'patentamientos']); } catch (e) {}
  return { migradas: rows.length, yaExistian: saltadas };
}

// Upsert de los campos manuales de una carpeta (key = # preventa normalizado).
// Guarda los accesorios (manual) de una venta en ventas_manual (key=preventa norm).
function saveVentaManual(body) {
  const pv = _normPv(body.preventa || '');
  if (!pv) return { error: 'falta preventa' };
  const acc = (body.accesorios === '' || body.accesorios == null) ? 0 : Math.round(Number(body.accesorios) || 0);
  const row = { preventa: pv, accesorios: acc, updated_at: new Date().toISOString(), updated_by: String(body.usuario || '') };
  const hh = { apikey: SUPA_ANON, Authorization: 'Bearer ' + SUPA_ANON, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' };
  const res = UrlFetchApp.fetch(SUPA_URL + '/ventas_manual?on_conflict=preventa', { method: 'post', headers: hh, payload: JSON.stringify(row), muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) return { error: 'guardar falló: ' + res.getContentText().slice(0, 200) };
  return { ok: true, preventa: pv, accesorios: acc };
}

function saveAdmVenta(body) {
  const pv = String(body.preventa || '').trim();
  if (!pv) return { error: 'falta preventa' };
  const permitidos = ['mes_patentamiento', 'patenta', 'admin', 'tipo_carpeta', 'credito_liquidado', 'fecha_liquidacion', 'reventa_particular', 'fecha_pago_vw', 'notas'];
  const row = { preventa: pv, updated_at: new Date().toISOString(), updated_by: String(body.usuario || '') };
  const campos = body.campos || {};
  for (const k of permitidos) if (campos[k] !== undefined) row[k] = (campos[k] === '' ? null : campos[k]);
  const hh = { apikey: SUPA_ANON, Authorization: 'Bearer ' + SUPA_ANON, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' };
  const res = UrlFetchApp.fetch(SUPA_URL + '/adm_ventas?on_conflict=preventa', { method: 'post', headers: hh, payload: JSON.stringify(row), muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) return { error: 'guardar falló: ' + res.getContentText().slice(0, 200) };
  // patentamientos se arma desde adm_ventas → invalidar ambos caches
  try { CacheService.getScriptCache().removeAll(['admventas', 'patentamientos']); } catch (e) {}
  return { ok: true, preventa: pv };
}

// =======================================================================
// COMPRAS VW — reemplazo del Sheet de Valeria.
// Flujo: Valeria carga primero (serie/modelo/color/fc/neto/...). La unidad
// aparece en Oversoft 1-2 días después → detectamos por serie y mostramos el
// modelo de Oversoft para conciliar. Al tildar "conciliado", el nombre oficial
// pasa a ser el de Oversoft. Impuestos calculados (IVA por modelo + percep.).
// =======================================================================
function _ivaRateCompra(modelo) {
  const m = String(modelo || '').toUpperCase();
  // utilitarios → IVA 10,5%; autos → 21%
  return (m.indexOf('AMAROK') >= 0 || m.indexOf('SAVEIRO') >= 0) ? 0.105 : 0.21;
}
function _impuestosCompra(neto, modelo, row) {
  neto = Number(neto) || 0;
  const rate = (row && row.iva_rate != null && row.iva_rate !== '') ? Number(row.iva_rate) : _ivaRateCompra(modelo);
  const iva = neto * rate;
  const iibb = neto * 0.0005;       // Percepción IIBB 0,05%
  const iibbBsAs = neto * 0.0002;   // Percepción IIBB Bs As 0,02%
  const pIva = Number(row && row.percep_iva) || 0;
  const pEr = Number(row && row.percep_iibb_er) || 0;
  const impInt = Number(row && row.imp_internos) || 0;
  const r2 = function (n) { return Math.round(n * 100) / 100; };
  return {
    iva: r2(iva), ivaRate: rate, iibb: r2(iibb), iibbBsAs: r2(iibbBsAs),
    control: r2(neto + iva + iibb + iibbBsAs + pIva + pEr + impInt),
  };
}
function getComprasVW() {
  let rows = [];
  try { rows = _supaGet('/compras_vw?select=*&order=created_at.desc') || []; } catch (e) {}
  const h = { headers: { apikey: OVERSOFT_KEY, Authorization: 'Bearer ' + OVERSOFT_KEY }, muteHttpExceptions: true };
  const get = (path) => { const res = UrlFetchApp.fetch(OVERSOFT_URL + path, h); return (res.getResponseCode() < 300) ? JSON.parse(res.getContentText()) : []; };
  // Oversoft: unidades por serie (para detectar presencia + modelo/color/preventa)
  const series = rows.map(r => String(r.serie || '').trim()).filter(Boolean);
  const uni = {};
  for (let i = 0; i < series.length; i += 60) {
    const lote = series.slice(i, i + 60).map(s => '"' + s + '"').join(',');
    for (const u of get('/unidades?select=serie,modelo,color,fechaderecepcion,certificado,preventa&serie=in.(' + encodeURIComponent(lote) + ')')) uni[String(u.serie).trim()] = u;
  }
  // mapa de modelo (código → descripción) y color (id → descripción)
  const desc = {}; let off = 0;
  if (series.length) for (let i = 0; i < 12; i++) {
    const ch = get('/modelos?select=codigodecompra,descripcionoperativa&order=modeloid&limit=1000&offset=' + off);
    for (const m of ch) if (m.codigodecompra) desc[String(m.codigodecompra).trim()] = m.descripcionoperativa;
    if (ch.length < 1000) break; off += 1000;
  }
  const col = {};
  if (series.length) for (const c of get('/colores?select=colorid,descripcion&limit=2000')) col[c.colorid] = String(c.descripcion || '').trim();

  // Datos de la venta (Adm. ventas) por preventa: cliente, localidad, mes a
  // patentar y el cuadro financiero (qué se cobró / qué falta). Reusa getAdmVentas.
  const admByPv = {};
  try { const adm = getAdmVentas(); for (const v of (adm.ventas || [])) admByPv[v.preventa] = v; } catch (e) {}

  const out = rows.map(r => {
    const u = uni[String(r.serie || '').trim()];
    const enOversoft = !!u;
    const modeloOversoft = u ? (desc[String(u.modelo || '').trim()] || String(u.modelo || '')) : '';
    const conc = (r.conciliado === true);
    const modeloOficial = (conc && modeloOversoft) ? modeloOversoft : String(r.modelo_valeria || '');
    const imp = _impuestosCompra(r.neto, modeloOficial, r);
    let estado = 'cargada';
    if (enOversoft && conc) estado = 'conciliada';
    else if (enOversoft) estado = 'sin_conciliar';
    const pvNum = u ? String(u.preventa || '').trim() : '';
    const av = pvNum ? admByPv[_normPv(pvNum)] : null;
    const pv = av ? {
      numero: pvNum,
      cliente: av.cliente || '', localidad: av.localidad || '', vendedor: av.vendedor || '',
      mesPat: (av.manual && av.manual.mes_patentamiento) || '', fechaPat: av.fechaPatentamiento || '',
      tipo: av.tipo || '', financia: av.financia || '',
      cuadro: av.cuadro || [], totalPlan: av.totalPlan || 0, totalCobrado: av.totalCobrado || 0,
      falta: av.falta || 0, creditoCobrado: av.creditoCobrado || null,
    } : null;
    const colorOversoft = u ? (col[u.color] || '') : '';
    return Object.assign({}, r, {
      enOversoft: enOversoft,
      modeloOversoft: modeloOversoft,
      colorOversoft: colorOversoft,
      // color oficial: el de Oversoft cuando está conciliada; si no, el de VW.
      color: (conc && colorOversoft) ? colorOversoft : String(r.color || ''),
      preventaOversoft: pvNum,
      modeloOficial: modeloOficial,
      estado: estado,
      impaga: !String(r.fecha_pago_vw || '').trim(),   // sin fecha de pago a VW = impaga
      iva: imp.iva, ivaRate: imp.ivaRate, iibb: imp.iibb, iibbBsAs: imp.iibbBsAs, control: imp.control,
      pv: pv,
    });
  });
  return { compras: out, total: out.length, updatedAt: new Date().toISOString() };
}

// MIGRACIÓN una-vez (re-ejecutable, ignore-duplicates → no pisa lo que cargó
// Valeria): vuelca lo de la planilla de saldos (hoja "compras" del espejo) a
// compras_vw, SOLO desde 2026, con modelo+color de Oversoft por serie y
// conciliado=true (como si Valeria ya lo hubiese cargado y chequeado).
function migrarComprasVW() {
  const ss = SpreadsheetApp.openById('19hKf6VaOsjGlk9s-biZtql5AW0oIV8oBlfqYGEfMH8I');
  const sh = ss.getSheetByName('compras');
  if (!sh) return { error: 'no existe la hoja compras del espejo' };
  const range = sh.getRange(1, 1, sh.getLastRow(), Math.max(sh.getLastColumn(), 26));
  const display = range.getDisplayValues();
  const raw = range.getValues();
  let headerRow = -1;
  for (let i = 0; i < display.length; i++) { if (String(display[i][2] || '').toLowerCase().trim() === 'preventa') { headerRow = i; break; } }
  if (headerRow < 0) return { error: 'no encontré header (col C=preventa)' };
  const ESP = ['linea de credito floor plan', 'deuda floor plan', 'disponible floor plan', 'total disp real para pagar'];
  const items = [], seriesSet = {};
  for (let i = headerRow + 1; i < display.length; i++) {
    const d = display[i], r = raw[i];
    const modeloSheet = String(d[8] || '').trim();
    if (ESP.indexOf(modeloSheet.toLowerCase()) >= 0) continue;
    const serie = String(d[7] || '').trim().toUpperCase();
    if (!serie) continue;
    const mes = String(d[1] || '').trim();
    const mm = mes.match(/-(\d{2})\s*$/);
    if (!mm || Number(mm[1]) < 26) continue;           // solo 2026 en adelante
    items.push({
      serie: serie, mes: mes, modelo_sheet: modeloSheet, color_sheet: String(d[11] || '').trim(),
      fc_numero: String(d[9] || '').trim(), fecha_fc: String(d[12] || '').trim(),
      vence: String(d[13] || '').trim(), fecha_pago_vw: String(d[14] || '').trim(),
      fecha_certif: String(d[16] || '').trim(), importe_saldo: Number(r[10]) || 0, neto: Number(r[19]) || 0,
    });
    seriesSet[serie] = true;
  }
  // Oversoft: modelo (desc) + color (desc) por serie
  const h = { headers: { apikey: OVERSOFT_KEY, Authorization: 'Bearer ' + OVERSOFT_KEY }, muteHttpExceptions: true };
  const get = (path) => { const res = UrlFetchApp.fetch(OVERSOFT_URL + path, h); return (res.getResponseCode() < 300) ? JSON.parse(res.getContentText()) : []; };
  const series = Object.keys(seriesSet);
  const uni = {};
  for (let i = 0; i < series.length; i += 60) {
    const lote = series.slice(i, i + 60).map(s => '"' + s + '"').join(',');
    for (const u of get('/unidades?select=serie,modelo,color&serie=in.(' + encodeURIComponent(lote) + ')')) uni[String(u.serie).trim()] = u;
  }
  const desc = {}; let off = 0;
  for (let i = 0; i < 12; i++) { const ch = get('/modelos?select=codigodecompra,descripcionoperativa&order=modeloid&limit=1000&offset=' + off); for (const m of ch) if (m.codigodecompra) desc[String(m.codigodecompra).trim()] = m.descripcionoperativa; if (ch.length < 1000) break; off += 1000; }
  const col = {};
  for (const c of get('/colores?select=colorid,descripcion&limit=2000')) col[c.colorid] = String(c.descripcion || '').trim();
  const now = new Date().toISOString();
  const rows = items.map(it => {
    const u = uni[it.serie];
    const modeloOvs = u ? (desc[String(u.modelo || '').trim()] || '') : '';
    const colorOvs = u ? (col[u.color] || '') : '';
    return {
      serie: it.serie, mes: it.mes,
      modelo_valeria: modeloOvs || it.modelo_sheet, color: colorOvs || it.color_sheet,
      conciliado: !!u,
      fc_numero: it.fc_numero || null, fecha_fc: it.fecha_fc || null, vence: it.vence || null,
      fecha_pago_vw: it.fecha_pago_vw || null, fecha_certif: it.fecha_certif || null,
      importe_saldo: it.importe_saldo || null, neto: it.neto || null,
      updated_at: now, updated_by: 'migracion',
    };
  });
  const hh = { apikey: SUPA_ANON, Authorization: 'Bearer ' + SUPA_ANON, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates' };
  let insertados = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const lote = rows.slice(i, i + 100);
    const res = UrlFetchApp.fetch(SUPA_URL + '/compras_vw?on_conflict=serie', { method: 'post', headers: hh, payload: JSON.stringify(lote), muteHttpExceptions: true });
    if (res.getResponseCode() >= 300) return { error: 'insert falló: ' + res.getContentText().slice(0, 300), insertados: insertados };
    insertados += lote.length;
  }
  try { _cacheDrop('comprasvw'); } catch (e) {}
  return { ok: true, candidatos: rows.length, conciliados: rows.filter(r => r.conciliado).length };
}
function saveCompraVW(body) {
  const serie = String(body.serie || '').trim().toUpperCase();
  if (!serie) return { error: 'falta serie' };
  const permitidos = ['mes', 'modelo_valeria', 'color', 'fc_numero', 'fecha_fc', 'vence', 'fecha_pago_vw', 'neto', 'percep_iva', 'percep_iibb_er', 'imp_internos', 'importe_saldo', 'fecha_certif', 'notas', 'conciliado', 'iva_rate', 'iva_monto', 'iibb_er', 'iibb_caba', 'iibb_bsas'];
  const numericos = ['neto', 'percep_iva', 'percep_iibb_er', 'imp_internos', 'importe_saldo', 'iva_rate', 'iva_monto', 'iibb_er', 'iibb_caba', 'iibb_bsas'];
  const row = { serie: serie, updated_at: new Date().toISOString(), updated_by: String(body.usuario || '') };
  const campos = body.campos || {};
  for (const k of permitidos) if (campos[k] !== undefined) {
    let v = campos[k];
    if (numericos.indexOf(k) >= 0) v = (v === '' || v === null) ? null : Number(v);
    else if (k === 'conciliado') v = (v === true || v === 'true' || v === 1);
    else v = (v === '' ? null : v);
    row[k] = v;
  }
  const hh = { apikey: SUPA_ANON, Authorization: 'Bearer ' + SUPA_ANON, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' };
  const res = UrlFetchApp.fetch(SUPA_URL + '/compras_vw?on_conflict=serie', { method: 'post', headers: hh, payload: JSON.stringify(row), muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) return { error: 'guardar falló: ' + res.getContentText().slice(0, 200) };
  try { _cacheDrop('comprasvw'); } catch (e) {}
  return { ok: true, serie: serie };
}
// FLUJO FINANCIERO: junta los cobros pendientes de las ventas vigentes
// (ingresos esperados, de getAdmVentas: cada concepto no cobrado con su vto) y
// los pagos pendientes a VW (egresos, de compras_vw impagas con su vence).
// El front agrupa por semana y arma la línea de tiempo.
function getFlujoFinanciero() {
  const ingresos = [];
  try {
    const adm = getAdmVentas();
    for (const v of (adm.ventas || [])) {
      for (const c of (v.cuadro || [])) {
        const saldo = Math.round(((c.plan || 0) - (c.cobrado || 0)));
        if (saldo > 1) ingresos.push({ fecha: c.vto || '', monto: saldo, pv: v.preventa, cliente: v.cliente || '', localidad: v.localidad || '', concepto: c.concepto || '', modelo: v.modelo || '' });
      }
    }
  } catch (e) {}
  const egresos = [];
  try {
    const rows = _supaGet('/compras_vw?select=serie,vence,fecha_pago_vw,importe_saldo,modelo_valeria,mes') || [];
    for (const r of rows) {
      const impaga = !String(r.fecha_pago_vw || '').trim();
      const monto = Number(r.importe_saldo) || 0;
      if (impaga && monto > 0) egresos.push({ vence: String(r.vence || ''), monto: monto, serie: r.serie, modelo: r.modelo_valeria || '', mes: r.mes || '' });
    }
  } catch (e) {}
  return { ingresos: ingresos, egresos: egresos, updatedAt: new Date().toISOString() };
}

function delCompraVW(body) {
  const serie = String(body.serie || '').trim().toUpperCase();
  if (!serie) return { error: 'falta serie' };
  const hh = { apikey: SUPA_ANON, Authorization: 'Bearer ' + SUPA_ANON };
  const res = UrlFetchApp.fetch(SUPA_URL + '/compras_vw?serie=eq.' + encodeURIComponent(serie), { method: 'delete', headers: hh, muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) return { error: 'borrar falló: ' + res.getContentText().slice(0, 200) };
  try { _cacheDrop('comprasvw'); } catch (e) {}
  return { ok: true, serie: serie };
}

// =======================================================================
// SNAPSHOT MENSUAL DE LA BT → Supabase (precios_lista + incentivos)
// =======================================================================
// Para que nunca más se pierda la economía de un mes cuando "Actual BT" se
// pisa con la lista nueva (como pasó con mayo). Corre a diario por trigger
// (snapshotBTDiario): si el mes corriente ya tiene BT en Supabase no hace
// nada; si falta, copia la "Actual BT" vigente. Escribe con la service key
// guardada en Script Properties (SUPA_SERVICE — NO está en el repo público;
// se setea una vez vía doPost acción setsecret).
// SYNC idempotente del mes: inserta lo que falta y ACTUALIZA lo que cambió,
// pero solo filas de origen snapshot — lo cargado curado desde circulares no
// se toca nunca (si difiere, se reporta en difCurados). Así, si "Actual BT"
// se actualiza a mitad de mes (lista nueva, fe de erratas), el histórico se
// corrige solo en la próxima corrida.
const SNAPSHOT_ORIGEN = 'snapshot Actual BT';
function snapshotBTMensual(mesOverride, hojaOverride, dryRun, force) {
  // APAGADO (19-jun): el esqueleto de precios se carga/edita en el PORTAL
  // (solapa Precios → precios_lista). El sync automático desde "Actual BT" queda
  // neutralizado para que el Sheet NUNCA pise lo cargado en el portal. Las
  // llamadas automáticas (trigger diario + hook del motor) NO pasan `force` y
  // salen acá. Para correrlo a mano (carga puntual / preview dry) está
  // tipo=snapshotbt, que pasa force=true.
  if (!force) return { ok: true, apagado: true, nota: 'Sync BT->Supabase apagado: los precios se cargan en el portal (solapa Precios).' };
  const mes = mesOverride || _yyyyMm(new Date());
  const svc = PropertiesService.getScriptProperties().getProperty('SUPA_SERVICE');
  if (!svc) return { error: 'falta SUPA_SERVICE en Script Properties (doPost setsecret)' };
  const hW = { apikey: svc, Authorization: 'Bearer ' + svc, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
  const dif = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) > 0.5;

  const cat = _supaGet('/catalogo_modelos?select=codigo,nombre_corto,nombre_bt&activo=eq.true');
  const byNorm = {};
  for (const c of cat) {
    if (c.nombre_corto) byNorm[_ntrim(c.nombre_corto)] = c;
    if (c.nombre_bt)    byNorm[_ntrim(c.nombre_bt)]    = c;
  }

  // Estado actual del mes en Supabase
  const precExist = {};   // nombre_corto → {lista, costo}
  for (const p of _supaGet('/precios_lista?select=modelo,precio_lista,costo_concesionario&mes=eq.' + mes)) {
    precExist[p.modelo] = p;
  }
  // lista_num es NOT NULL y único por (lista_num, modelo). Para un mes nuevo el
  // snapshot no conoce el número de lista VW real, así que usa uno sintético
  // derivado del mes (202607 = julio 2026): nunca colisiona con las listas
  // reales (~890) y se distingue que vino del snapshot. Si después se quiere
  // el número oficial, es un UPDATE de esa columna.
  const listaNum = parseInt(mes.replace('-', ''), 10);
  const incExist = {};    // nombre_corto|tipo → {civa, esSnapshot}
  for (const r of _supaGet('/incentivos?select=nombre_corto,tipo,monto_civa,circular&mes=eq.' + mes)) {
    incExist[r.nombre_corto + '|' + r.tipo] = { civa: Number(r.monto_civa) || 0, esSnapshot: String(r.circular || '').indexOf('snapshot') === 0 };
  }

  // "Actual BT": fila 2 header, datos desde 3. Cols (0-based, validadas contra
  // Supabase junio): 1 modelo · 2 lista · 20 cc s/iva · 21 cc c/iva · 23 cupo ·
  // 24 táctico · 25 whosale · 26 adic1 · 27 adic2 · 37 costo rep (AL).
  const hojaBT = (typeof hojaOverride === 'string' && hojaOverride) ? hojaOverride : 'Actual BT';
  const sh = SpreadsheetApp.openById(MADRE_ID).getSheetByName(hojaBT);
  if (!sh) return { error: 'no encontré la pestaña ' + hojaBT + ' en la madre' };
  const data = sh.getRange(3, 1, sh.getLastRow() - 2, 38).getValues();
  const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;

  const precNuevos = [], incNuevos = [], sinMatch = [], difCurados = [];
  let precPatch = 0, incPatch = 0;
  const patch = (path, body) => {
    if (dryRun) return true;   // dry-run: no escribe
    const res = UrlFetchApp.fetch(SUPA_URL + path, { method: 'patch', headers: hW, payload: JSON.stringify(body), muteHttpExceptions: true });
    return res.getResponseCode() < 300;
  };

  for (const r of data) {
    const modelo = String(r[1] || '').trim();
    if (!modelo) continue;
    const c = byNorm[_ntrim(modelo)];
    if (!c) { sinMatch.push(modelo); continue; }
    const lista = Number(r[2]) || 0;
    if (lista <= 0) continue;

    // --- precios_lista: insertar faltante / actualizar si cambió ---
    const costo = r2(r[37]);
    const pe = precExist[c.nombre_corto];
    if (!pe) {
      precNuevos.push({ mes: mes, codigo: c.codigo, modelo: c.nombre_corto, precio_lista: lista, costo_concesionario: costo, lista_num: listaNum });
    } else if (dif(pe.precio_lista, lista) || dif(pe.costo_concesionario, costo)) {
      if (patch('/precios_lista?mes=eq.' + mes + '&modelo=eq.' + encodeURIComponent(c.nombre_corto),
                { precio_lista: lista, costo_concesionario: costo })) precPatch++;
    }

    // --- incentivos: insertar faltante / actualizar solo origen snapshot ---
    // performance lleva su s/iva real (col U); el resto sigue la convención de
    // la tabla (siva = civa/1,21, igual que las cargas de circulares).
    const tipos = { performance: [r[21], r[20]], cupo: [r[23], null], tactico: [r[24], null], whosale: [r[25], null], adicional1: [r[26], null], adicional2: [r[27], null] };
    for (const t in tipos) {
      const civa = r2(tipos[t][0]);
      if (civa <= 0) continue;
      const ex = incExist[c.nombre_corto + '|' + t];
      if (!ex) {
        incNuevos.push({ mes: mes, codigo: c.codigo, nombre_corto: c.nombre_corto, tipo: t,
                         monto_civa: civa, monto_siva: tipos[t][1] !== null ? r2(tipos[t][1]) : r2(civa / 1.21),
                         condicion: null, circular: SNAPSHOT_ORIGEN });
      } else if (dif(ex.civa, civa)) {
        if (ex.esSnapshot) {
          if (patch('/incentivos?mes=eq.' + mes + '&nombre_corto=eq.' + encodeURIComponent(c.nombre_corto) + '&tipo=eq.' + t,
                    { monto_civa: civa, monto_siva: tipos[t][1] !== null ? r2(tipos[t][1]) : r2(civa / 1.21) })) incPatch++;
        } else {
          difCurados.push(c.nombre_corto + ' ' + t + ': BT=' + civa + ' vs cargado=' + ex.civa);
        }
      }
    }
  }

  const out = { mes: mes, hoja: hojaBT, dryRun: !!dryRun, preciosNuevos: precNuevos.length, preciosActualizados: precPatch,
                incNuevos: incNuevos.length, incActualizados: incPatch,
                difCurados: difCurados, sinMatch: sinMatch,
                incNuevosDetalle: incNuevos.map(x => x.nombre_corto + ' | ' + x.tipo + ' = ' + x.monto_civa) };
  if (dryRun) return out;   // preview: no escribe nada
  if (precNuevos.length) {
    const res = UrlFetchApp.fetch(SUPA_URL + '/precios_lista', { method: 'post', headers: hW, payload: JSON.stringify(precNuevos), muteHttpExceptions: true });
    if (res.getResponseCode() >= 300) return { error: 'insert precios_lista falló: ' + res.getContentText().slice(0, 300), parcial: out };
  }
  if (incNuevos.length) {
    const res = UrlFetchApp.fetch(SUPA_URL + '/incentivos', { method: 'post', headers: hW, payload: JSON.stringify(incNuevos), muteHttpExceptions: true });
    if (res.getResponseCode() >= 300) return { error: 'insert incentivos falló: ' + res.getContentText().slice(0, 300), parcial: out };
  }
  return out;
}

// Handler del trigger diario (instalado vía doPost acción instalartriggersnapshot).
function snapshotBTDiario() {
  const r = snapshotBTMensual(null, false);
  console.log('snapshotBTDiario:', JSON.stringify(r));
}

function _instalarTriggerSnapshot() {
  const ya = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'snapshotBTDiario');
  if (ya) return { ok: true, yaExistia: true };
  ScriptApp.newTrigger('snapshotBTDiario').timeBased().everyDays(1).atHour(7).create();
  return { ok: true, creado: true };
}

// Guarda un secreto en Script Properties (escritura solamente — no hay forma de
// leerlos por la API pública). Solo nombres whitelisteados.
function _setSecret(body) {
  const nombre = String(body.nombre || '').trim();
  if (['SUPA_SERVICE'].indexOf(nombre) === -1) return { error: 'nombre no permitido' };
  const valor = String(body.valor || '').trim();
  if (!valor) return { error: 'falta valor' };
  PropertiesService.getScriptProperties().setProperty(nombre, valor);
  return { ok: true, nombre: nombre };
}

// Precios de la competencia desde SUPABASE (tabla competencia_precios, que llena
// el scraper de portal-precios: ElCeroKm + Espasa). Reemplaza la lectura de la
// hoja "Resumen Competencia 2" (verificado 19-jun: 47/47 modelos matchean y los
// valores de ElCeroKm son idénticos). Clave por _ntrim(modelo_tga); el motor
// busca por _ntrim(nombre_bt)/_ntrim(nombre_corto).
function _readCompetencia() {
  const out = { porModelo: {}, actualizado: null };
  try {
    for (const r of _supaGet('/competencia_precios?select=modelo_tga,fuente,precio,updated_at')) {
      const k = _ntrim(r.modelo_tga);
      if (!k) continue;
      if (!out.porModelo[k]) out.porModelo[k] = { el0km: 0, espasaFyf: 0 };
      const p = Number(r.precio) || 0;
      if (r.fuente === 'elcerokm') out.porModelo[k].el0km = p;
      else if (r.fuente === 'espasa') out.porModelo[k].espasaFyf = p;
      if (r.updated_at && (!out.actualizado || r.updated_at > out.actualizado)) out.actualizado = r.updated_at;
    }
  } catch (e) {}
  for (const k in out.porModelo) {
    if (!out.porModelo[k].el0km && !out.porModelo[k].espasaFyf) delete out.porModelo[k];
  }
  return out;
}

function getBaratitoMotor() {
  // Red de seguridad del histórico de BT: una vez cada ~6 h (con que alguien
  // abra Baratito alcanza) sincroniza la "Actual BT" del mes a Supabase.
  // No necesita trigger instalado (el web app no tiene permiso para crearlos).
  try {
    const c6 = CacheService.getScriptCache();
    if (!c6.get('snapbt_check')) {
      c6.put('snapbt_check', '1', 21600);
      snapshotBTMensual(null);
    }
  } catch (e) {}

  const mesActual = _yyyyMm(new Date());
  // 1) precios de TODOS los meses cargados (tabla chica) → BT por mes para
  //    valuar cada venta con la BT de su mes; el mes vigente alimenta la tabla.
  const btPorMes = {};   // mes → nc → {lista, costo}
  for (const p of _supaGet('/precios_lista?select=mes,codigo,modelo,precio_lista,costo_concesionario')) {
    if (!btPorMes[p.mes]) btPorMes[p.mes] = {};
    btPorMes[p.mes][p.modelo] = p;
  }
  const mesesBt = Object.keys(btPorMes).sort();
  if (!mesesBt.length) return { error: 'sin precios_lista cargados' };
  const mesUsado = btPorMes[mesActual] ? mesActual : mesesBt[mesesBt.length - 1];
  const precByNc = btPorMes[mesUsado];

  // 2) catálogo, 3) incentivos de TODOS los meses, 4) dto
  const cat = _supaGet('/catalogo_modelos?select=codigo,nombre_corto,nombre_bt,familia&activo=eq.true&order=orden.asc.nullslast,nombre_corto.asc');
  const incPorMes = {};  // mes → nc → {tipo: civa}
  const incDetPorMes = {};  // mes → nc → [ {tipo, montoCiva, montoSiva, condicion, circular} ]  (para mostrar de qué circular viene cada incentivo)
  for (const r of _supaGet('/incentivos?select=mes,nombre_corto,tipo,monto_civa,monto_siva,condicion,circular')) {
    if (!incPorMes[r.mes]) incPorMes[r.mes] = {};
    if (!incPorMes[r.mes][r.nombre_corto]) incPorMes[r.mes][r.nombre_corto] = {};
    incPorMes[r.mes][r.nombre_corto][r.tipo] = Number(r.monto_civa) || 0;
    if (!incDetPorMes[r.mes]) incDetPorMes[r.mes] = {};
    if (!incDetPorMes[r.mes][r.nombre_corto]) incDetPorMes[r.mes][r.nombre_corto] = [];
    incDetPorMes[r.mes][r.nombre_corto].push({
      tipo: r.tipo, montoCiva: Number(r.monto_civa) || 0, montoSiva: Number(r.monto_siva) || 0,
      condicion: r.condicion || '', circular: r.circular || '',
    });
  }
  const incByNc = incPorMes[mesUsado] || {};
  const incDetByNc = incDetPorMes[mesUsado] || {};
  const dtoByNc = {};
  for (const d of _supaGet('/dto_tg?select=nombre_corto,dto')) dtoByNc[d.nombre_corto] = Number(d.dto) || 0;

  // 5) stock desde Oversoft POR TRIM EXACTO (vía descripción, distingue High/Outfit,
  //    Highline/Bitono, Extreme/Hero/Black Style aunque compartan código).
  const catByNorm = {};
  for (const c of cat) {
    if (c.nombre_corto) catByNorm[_ntrim(c.nombre_corto)] = c.nombre_corto;
    if (c.nombre_bt)    catByNorm[_ntrim(c.nombre_bt)]    = c.nombre_corto;
  }
  // Stock Y ventas, ambos genuinos desde Oversoft (por trim exacto).
  let stockPorTrim = {}, stockColorPorTrim = {}, stockTotalOversoft = 0, ventasNc = {}, ventasDet = {}, sinCatalogo = [];
  try {
    const od = _oversoftMotorData(catByNorm);
    stockPorTrim = od.stockPorTrim;
    stockColorPorTrim = od.stockColorPorTrim || {};
    stockTotalOversoft = od.stockTotal;
    ventasNc = od.ventasPorTrim;
    ventasDet = od.ventasDet || {};
    sinCatalogo = od.sinCatalogo || [];
  } catch (e) {}

  // Competencia (elcerokm + espasa, ambos comparables c/FYF)
  const comp = _readCompetencia();

  // Ajustes de precio por color (tabla baratito_ajustes_color; color '*' = todos)
  const ajustesByNc = {};
  try {
    for (const a of _supaGet('/baratito_ajustes_color?select=nombre_corto,color,ajuste')) {
      if (!ajustesByNc[a.nombre_corto]) ajustesByNc[a.nombre_corto] = {};
      ajustesByNc[a.nombre_corto][a.color] = Number(a.ajuste) || 0;
    }
  } catch (e) {}

  const out = [];
  for (const c of cat) {
    const p = precByNc[c.nombre_corto];
    if (!p) continue;
    const lista = Number(p.precio_lista) || 0;
    if (lista <= 0) continue;
    const costo = Number(p.costo_concesionario) || 0;
    const stk = stockPorTrim[c.nombre_corto] || 0;   // stock del TRIM exacto (no del código)
    const ii = incByNc[c.nombre_corto] || {};
    const cc90Iva = Number(ii.performance) || 0;
    const otros = (Number(ii.tactico)||0) + (Number(ii.whosale)||0) + (Number(ii.adicional1)||0) + (Number(ii.adicional2)||0) + (Number(ii.cupo)||0);
    const dto = dtoByNc[c.nombre_corto] || 0;
    const vn = lista * (1 - dto);
    const iibb = PRECIOS_IIBB * (vn / 1.21), comision = PRECIOS_COMISION * (vn / 1.21), cheque = PRECIOS_CHEQUE * vn;
    const an = ((vn - costo + cc90Iva + otros) / lista) * lista - iibb - comision - cheque;

    // Prom. gcia/venta REAL: cada venta de Oversoft valuada con la BT de SU mes.
    // Ventas de meses sin BT cargada (ej. marzo) quedan afuera y se cuentan aparte.
    let gciaSum = 0, gciaN = 0, gciaSinBt = 0;
    for (const vd of (ventasDet[c.nombre_corto] || [])) {
      const btMes = btPorMes[vd.mes] && btPorMes[vd.mes][c.nombre_corto];
      const im = (incPorMes[vd.mes] || {})[c.nombre_corto] || {};
      const listaM = btMes ? Number(btMes.precio_lista) || 0 : 0;
      if (listaM <= 0) { gciaSinBt++; continue; }
      const ccM = Number(im.performance) || 0;
      const otrosM = (Number(im.tactico)||0) + (Number(im.whosale)||0) + (Number(im.adicional1)||0) + (Number(im.adicional2)||0) + (Number(im.cupo)||0);
      const y = _gciaVentaPct(vd.monto, vd.iva, listaM, Number(btMes.costo_concesionario) || 0, ccM, otrosM);
      if (y === null) { gciaSinBt++; continue; }
      gciaSum += y; gciaN++;
    }
    out.push({
      modelo:        c.nombre_bt || c.nombre_corto,
      lista:         lista,
      dtoTG:         dto,
      dtoVw:         costo > 0 ? (cc90Iva + otros) / costo : 0,
      precioOferta:  vn + PRECIOS_FYF,
      costoRep:      costo,
      gananciaPct:   an / lista,
      gananciaPesos: an,
      stock:         stk,
      vendidos:      0, vendidos60: 0,
      promGcia:      gciaN ? gciaSum / gciaN : 0,
      promGciaN:     gciaN,          // sobre cuántas ventas se promedió
      promGciaSinBt: gciaSinBt,      // ventas sin BT de su mes (quedan afuera)
      costos:        { iibb: iibb, comision: comision, cheque: cheque, fyf: PRECIOS_FYF },
      incentivos:    { cc90: 0, cc90Iva: cc90Iva, tactico: Number(ii.tactico)||0, whosale: Number(ii.whosale)||0, adicional1: Number(ii.adicional1)||0, adicional2: Number(ii.adicional2)||0, cupo: Number(ii.cupo)||0 },
      // detalle por incentivo (monto c/IVA y s/IVA, condición y CIRCULAR de origen) para el desglose del Baratito
      incentivosDet: incDetByNc[c.nombre_corto] || [],
      mesIncentivos: mesUsado,
      ventasPorMes:  ventasNc[c.nombre_corto] || {},
      // stock por color (Oversoft) + ajustes de precio por color ('*' = todos)
      colores:       Object.entries(stockColorPorTrim[c.nombre_corto] || {})
                       .map(([col, n]) => ({ color: col, stock: n }))
                       .sort((a, b) => b.stock - a.stock || a.color.localeCompare(b.color)),
      ajustes:       ajustesByNc[c.nombre_corto] || {},
      nombreCorto:   c.nombre_corto,    // clave para guardar ajustes
      competencia:   comp.porModelo[_ntrim(c.nombre_bt || c.nombre_corto)] || comp.porModelo[_ntrim(c.nombre_corto)] || null,
      sim:           { lista: lista, costoRep: costo, cc90Iva: cc90Iva, otros: lista > 0 ? otros / lista : 0 },
      codigo:        c.codigo, familia: c.familia,
    });
  }
  // Orden: ya viene del catálogo (catalogo_modelos.orden, congelado en Supabase
  // desde el orden de Baratito). `out` se arma iterando `cat` ya ordenado, así
  // que no hace falta leer "Actual BT" (antes se leía la madre para esto).

  let stockCatalogado = 0;
  for (const m of out) stockCatalogado += (Number(m.stock) || 0);
  return {
    modelos: out, total: out.length, fuente: 'Motor TGA · Supabase (lista ' + mesUsado + ' + incentivos + Oversoft)',
    stockTotalOversoft: stockTotalOversoft,   // todas las unidades NO entregadas en Oversoft
    stockCatalogado: stockCatalogado,         // las que caen en un modelo del catálogo
    sinCatalogo: sinCatalogo,                 // descripciones de Oversoft que no matchean el catálogo
    competenciaActualizado: comp.actualizado, // sello de la última corrida del scraper de competencia
    constantes: { fyf: PRECIOS_FYF, iibb: PRECIOS_IIBB, comision: PRECIOS_COMISION, cheque: PRECIOS_CHEQUE, iva: 1.21 },
    updatedAt: new Date().toISOString(),
  };
}

// Guarda/borra un ajuste de precio por color del Baratito (tabla
// baratito_ajustes_color en Supabase). body: { modelo: nombre_corto,
// color: '*'|descripción, ajuste: pesos sobre el precio base }.
// ajuste 0 o vacío = borrar (vuelve al precio base).
function saveAjusteColor(body) {
  const nc = String(body.modelo || '').trim();
  const color = String(body.color || '*').trim() || '*';
  const ajuste = Number(body.ajuste) || 0;
  if (!nc) return { error: 'falta modelo' };
  const h = { apikey: SUPA_ANON, Authorization: 'Bearer ' + SUPA_ANON, 'Content-Type': 'application/json' };
  let res;
  if (!ajuste) {
    const filtro = '?nombre_corto=eq.' + encodeURIComponent(nc) + '&color=eq.' + encodeURIComponent(color);
    res = UrlFetchApp.fetch(SUPA_URL + '/baratito_ajustes_color' + filtro, { method: 'delete', headers: h, muteHttpExceptions: true });
  } else {
    res = UrlFetchApp.fetch(SUPA_URL + '/baratito_ajustes_color?on_conflict=nombre_corto,color', {
      method: 'post',
      headers: Object.assign({ Prefer: 'resolution=merge-duplicates' }, h),
      payload: JSON.stringify({ nombre_corto: nc, color: color, ajuste: ajuste, updated_at: new Date().toISOString() }),
      muteHttpExceptions: true,
    });
  }
  if (res.getResponseCode() >= 300) return { error: 'guardar ajuste falló: ' + res.getContentText().slice(0, 200) };
  try { CacheService.getScriptCache().remove('motor'); } catch (e) {}   // que el próximo load lo traiga
  return { ok: true, modelo: nc, color: color, ajuste: ajuste };
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
    if (accion === 'cargarreparto')        return jsonResponse(cargarReparto(body));
    if (accion === 'comprarreparto')       return jsonResponse(marcarComprado(body));
    if (accion === 'deshacerreparto')      return jsonResponse(desmarcarComprado(body));
    if (accion === 'okreparto')            return jsonResponse(darOkReparto(body));
    if (accion === 'reabrirreparto')       return jsonResponse(reabrirReparto(body));
    if (accion === 'guardarcoloresreparto') return jsonResponse(guardarColoresReparto(body));
    if (accion === 'setindustria')         return jsonResponse(setIndustria(body));
    if (accion === 'setbaratitosnapshot')  return jsonResponse(saveBaratitoSnapshots(body.snapshots || []));
    if (accion === 'resetbaratito')        return jsonResponse(resetBaratitoBaseline());
    if (accion === 'initbaratitobaseline') return jsonResponse(initBaratitoBaselineIfEmpty());
    if (accion === 'setajustecolor')       return jsonResponse(saveAjusteColor(body));
    if (accion === 'setsecret')            return jsonResponse(_setSecret(body));
    if (accion === 'setadmventa')          return jsonResponse(saveAdmVenta(body));
    if (accion === 'setventamanual')       return jsonResponse(saveVentaManual(body));
    if (accion === 'setpreciolista')       return jsonResponse(savePrecioLista(body));        // editar 1 fila de precios_lista
    if (accion === 'setprecioslista')      return jsonResponse(guardarPreciosListaBulk(body)); // carga masiva de una lista nueva
    if (accion === 'setcompravw')          return jsonResponse(saveCompraVW(body));
    if (accion === 'delcompravw')          return jsonResponse(delCompraVW(body));
    if (accion === 'instalartriggersnapshot') return jsonResponse(_instalarTriggerSnapshot());
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

// ---------------------------------------------------------------------------
// CACHE "GRANDE" (responses > 100KB) + PRECALENTADO POR TRIGGER
// ---------------------------------------------------------------------------
// CacheService limita cada VALOR a 100KB. comprasvw (~290KB), stock (~133KB) y
// ventas (~128KB) lo superan → con _cached() NO se cacheaban nunca y cada carga
// recalculaba (compras tardaba ~14s SIEMPRE). Acá partimos el JSON en trozos de
// ~45.000 chars (≤100KB aun con acentos = 2 bytes) bajo claves key_c0, key_c1…
// y un manifest key_meta con la cantidad de trozos. Si falta un trozo (venció),
// se trata como miss y se recalcula.
const CACHE_TTL_WARM = 2400;  // 40 min: sobrevive al ciclo de precalentado de 30'

function _cacheBigPut(key, s, ttlSec) {
  const cache = CacheService.getScriptCache();
  const CHUNK = 45000;
  const n = Math.ceil(s.length / CHUNK) || 1;
  const obj = {};
  for (let i = 0; i < n; i++) obj[key + '_c' + i] = s.substring(i * CHUNK, (i + 1) * CHUNK);
  obj[key + '_meta'] = String(n);
  cache.putAll(obj, ttlSec);
}
function _cacheBigGet(key) {
  const cache = CacheService.getScriptCache();
  const meta = cache.get(key + '_meta');
  if (!meta) return null;
  const n = parseInt(meta, 10);
  const keys = [];
  for (let i = 0; i < n; i++) keys.push(key + '_c' + i);
  const all = cache.getAll(keys);
  let s = '';
  for (let i = 0; i < n; i++) {
    const part = all[key + '_c' + i];
    if (part == null) return null;  // un trozo venció → cache inválido, refetch
    s += part;
  }
  return s;
}
// Invalida un cache grande (y de paso la clave plana vieja por si quedó algo).
function _cacheDrop(key) {
  const cache = CacheService.getScriptCache();
  try {
    const meta = cache.get(key + '_meta');
    const keys = [key, key + '_meta'];
    if (meta) { const n = parseInt(meta, 10); for (let i = 0; i < n; i++) keys.push(key + '_c' + i); }
    cache.removeAll(keys);
  } catch (e) { /* noop */ }
}
function _cachedBig(key, ttlSec, fresh, fn) {
  if (!fresh) {
    const hit = _cacheBigGet(key);
    if (hit) {
      try { const p = JSON.parse(hit); p._cached = true; return p; } catch (e) { /* corrupto */ }
    }
  }
  const data = fn();
  try { _cacheBigPut(key, JSON.stringify(data), ttlSec); } catch (e) { /* no cacheable */ }
  return data;
}

// Trigger cada 30': recalcula los 3 endpoints pesados y los deja calientes en
// el cache chunked, así el usuario no paga el recompute. ~21s total por corrida.
function precalentarCache() {
  const jobs = [['comprasvw', getComprasVW], ['stock', getStock], ['ventas', getVentas]];
  jobs.forEach(function (j) {
    try { _cachedBig(j[0], CACHE_TTL_WARM, true, j[1]); }
    catch (e) { Logger.log('precalentar ' + j[0] + ': ' + e); }
  });
}
// Correr UNA vez a mano desde el editor para instalar el trigger de 30 min.
function instalarPrecalentado() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'precalentarCache') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('precalentarCache').timeBased().everyMinutes(30).create();
  precalentarCache();  // calentar ya mismo
  return 'Trigger de 30 min instalado + cache precalentado.';
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
// Datos históricos congelados (monto/fecha/color/nombre) de las unidades que
// estaban en la planilla. Se usan como respaldo en el Stock Oversoft cuando
// Compras VW (Valeria) no tiene el dato. Reemplaza la lectura viva de la hoja.
function getStockHist() {
  return { unidades: _supaGet('/stock_hist?select=serie,monto,fecha,color,unidad,pago_estado&limit=20000') };
}

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
  if (/^t\.?\s*g\.?$/.test(n))               return 'TG';   // "T.G." (Oversoft)
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
// Desde 12-jun se arma 100% desde la data de Adm. de ventas (getAdmVentas):
// Oversoft pone lo automático (fecha de patentamiento, dominio, serie,
// cliente, vendedor, modelo, fecha PV) y la tabla adm_ventas lo manual
// (mes confirmado por la adm, patenta TG/CL/RE, admin, tipo carpeta,
// reventa/particular). La hoja espejo del Sheet YA NO se lee acá — solo la
// usa la migración una-vez (migrarAdmVentasDesdeHoja).
//
// Mes de cada carpeta (la base de objetivos, recupero e industria):
//   1) fecha real de patentamiento de Oversoft → mes (manda siempre)
//   2) si todavía no está patentada → mes_patentamiento cargado por la adm
//      (sirve de estimado para que la carpeta cuente como pendiente del mes)
//   3) sin ninguno de los dos → MES EN CURSO (pendiente del mes corriente;
//      la adm le cambia el mes si corresponde a otro)
// Filtro: solo desde PATENTAMIENTOS_MES_MINIMO (2026-04).
// _MES_TXT_A_NUM lo sigue usando la migración (col F texto "ABRIL").
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

// 'TG'/'CL'/'RE' (selects nuevos del portal) y valores históricos migrados
// de la hoja ('CLIENTE', 'REVENTA', 'REVENTA ROCIO') → TG / CLIENTE / REVENTA
// (lo que esperan los badges y desgloses del front).
function _normPatenta(raw) {
  const s = String(raw || '').trim().toUpperCase();
  if (!s) return '';
  if (s.indexOf('TG') === 0) return 'TG';
  if (s.indexOf('CL') === 0) return 'CLIENTE';
  if (s.indexOf('RE') === 0) return 'REVENTA';
  return s;
}

// PARTICULAR / REVENTA. La hoja vieja traía basura de fórmulas ('0', '#N/D')
// que migró tal cual → la tratamos como vacío.
function _normRevPart(raw) {
  const s = String(raw || '').trim().toUpperCase();
  if (!s || s === '0' || s === '#N/D') return '';
  if (s.indexOf('PARTIC') >= 0) return 'PARTICULAR';
  if (s.indexOf('REVENTA') >= 0 || s === 'RE') return 'REVENTA';
  return s;
}

// '2026-06-11' → '11/06/2026'
function _dmaFromIso(iso) {
  const s = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4);
}

function getPatentamientos() {
  const adm = getAdmVentas();   // Oversoft en vivo + manual adm_ventas

  const carpetas = [];
  const cuentaPorMes = {};

  // Orden por id de creación ascendente: el número de carpeta (#) reproduce
  // el correlativo real de carga en Oversoft (fecha+hora).
  const ventas = (adm.ventas || []).slice()
    .sort((a, b) => (a.pvId || 0) - (b.pvId || 0));

  let num = 0;
  for (const v of ventas) {
    const m = v.manual || {};

    let mesKey, mesKeyOrigen;
    if (v.fechaPatentamiento) {
      mesKey = String(v.fechaPatentamiento).slice(0, 7);
      mesKeyOrigen = 'oversoft';
    } else if (m.mes_patentamiento) {
      mesKey = String(m.mes_patentamiento).slice(0, 7);
      mesKeyOrigen = 'adm';
    } else {
      // Sin fecha real ni mes confirmado en la adm → NO se cuenta en ningún mes
      // hasta que la adm le asigne el mes de patentamiento (o se patente en Oversoft).
      mesKey = null;
      mesKeyOrigen = 'sinmes';
    }
    if (mesKey && mesKey < PATENTAMIENTOS_MES_MINIMO) continue;

    num++;
    if (mesKey) cuentaPorMes[mesKey] = (cuentaPorMes[mesKey] || 0) + 1;

    carpetas.push({
      num:                num,
      pv:                 v.preventa,
      serie:              v.serie,
      mesPatente:         String(m.mes_patentamiento || ''),         // 'yyyy-mm' confirmado por la adm
      mesKey:             mesKey,                                    // 'yyyy-mm'
      patentaA:           _normPatenta(m.patenta),                   // TG / CLIENTE / REVENTA
      admin:              String(m.admin || '').trim().toUpperCase(),
      tipoCarpeta:        String(m.tipo_carpeta || '').trim().toUpperCase(),
      tipoCarpetaCanon:   _normTipoCarpeta(m.tipo_carpeta),          // 4 buckets
      reventaOParticular: _normRevPart(m.reventa_particular),
      vendedor:           _matchVendedor(v.vendedor),                // → oficial o null
      vendedorRaw:        v.vendedor,
      cliente:            v.cliente,
      modelo:             v.modelo,
      fechaPvIso:         v.fechaPv,
      fechaPvStr:         _dmaFromIso(v.fechaPv),
      fechaPatIso:        v.fechaPatentamiento,
      fechaPatStr:        _dmaFromIso(v.fechaPatentamiento),
      patentada:          !!v.fechaPatentamiento,
      mesKeyOrigen:       mesKeyOrigen,                              // 'oversoft' | 'adm'
      patOrigen:          v.fechaPatentamiento ? 'oversoft' : '',
      dominio:            v.dominio,
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
  // cc/condiciones comerciales por modelo desde Supabase (tabla incentivos),
  // NO de la BT espejo del Sheet (verificado 19-jun: coincide; donde difería el
  // Sheet estaba mal — Vento/Tiguan abril, Tera High/Outfit mayo ya corregido).
  const bt = _btDesdeSupabase(mesKey);
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
  const vent = getVentasV2();   // PV → modelo desde Oversoft + meses congelados (ya no del Sheet)
  const modeloPorPv = {};
  for (const v of (vent.ventas || [])) {
    if (v.preventaNum) modeloPorPv[_normPv(v.preventaNum)] = String(v.modelo || '').trim();
  }

  // CC al 100% REAL por modelo (tabla "Performance Bonus" de la circular del
  // mes, cargada en Supabase como tipo='performance100', SIN iva). Hay modelos
  // "planos" (90% = 100%) que cambian mes a mes, por eso NO alcanza con ÷0,9.
  // Las filas vienen con nombre_corto; las unidades usan el nombre largo de la
  // BT → se traduce vía catalogo_modelos (nombre_corto → nombre_bt).
  // Si el mes no tiene filas, cc100Base queda 0 y el front cae a la estimación.
  const cc100PorModelo = {};
  try {
    const cien = _supaGet('/incentivos?select=nombre_corto,monto_siva&tipo=eq.performance100&mes=eq.' + mesKey);
    if (cien.length) {
      const btPorCorto = {};
      for (const c of _supaGet('/catalogo_modelos?select=nombre_corto,nombre_bt&activo=eq.true')) {
        if (c.nombre_corto && c.nombre_bt) btPorCorto[_normModeloKey(c.nombre_corto)] = c.nombre_bt;
      }
      for (const f of cien) {
        const monto = Number(f.monto_siva) || 0;
        cc100PorModelo[_normModeloKey(f.nombre_corto)] = monto;          // por si llega el corto
        const bt = btPorCorto[_normModeloKey(f.nombre_corto)];
        if (bt) cc100PorModelo[_normModeloKey(bt)] = monto;              // nombre largo BT
      }
    }
  } catch (e) {}

  const patDelMes = (pat.carpetas || []).filter(c =>
    c.mesKey === mesKey && c.tipoCarpetaCanon !== 'Plan ahorro'
  );
  const porUnidadPat = patDelMes.map(c => {
    const modeloVentas = c.pv ? (modeloPorPv[_normPv(c.pv)] || '') : '';
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
      // CC 100% real de la circular (SIN iva; el front lo lleva a c/IVA con el
      // ratio V/U del modelo). 0 = sin dato → el front estima ÷0,9.
      cc100Base:   cc100PorModelo[_normModeloKey(modelo)] || 0,
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

// Condiciones comerciales por modelo desde la tabla `incentivos` (Supabase),
// con la MISMA forma que _readBT (BT espejo del Sheet): porModelo[_normModeloKey]
// = { cc90 (perf s/iva), cc90Iva (perf c/iva), tactico, whosale, adicional1,
// adicional2 (todos c/iva) }. Reemplaza la lectura del Sheet en getIncentivos.
function _btDesdeSupabase(mesKey) {
  const cat = _supaGet('/catalogo_modelos?select=nombre_corto,nombre_bt&activo=eq.true');
  const ncToBt = {};
  for (const c of cat) ncToBt[c.nombre_corto] = c.nombre_bt || c.nombre_corto;
  const porNc = {};
  for (const r of _supaGet('/incentivos?select=nombre_corto,tipo,monto_siva,monto_civa&mes=eq.' + mesKey)) {
    if (!porNc[r.nombre_corto]) porNc[r.nombre_corto] = {};
    porNc[r.nombre_corto][r.tipo] = { siva: Number(r.monto_siva) || 0, civa: Number(r.monto_civa) || 0 };
  }
  const porModelo = {};
  for (const nc in porNc) {
    const s = porNc[nc];
    const obj = {
      modelo: ncToBt[nc] || nc,
      cc90:       (s.performance || {}).siva || 0,
      cc90Iva:    (s.performance || {}).civa || 0,
      tactico:    (s.tactico || {}).civa || 0,
      whosale:    (s.whosale || {}).civa || 0,
      adicional1: (s.adicional1 || {}).civa || 0,
      adicional2: (s.adicional2 || {}).civa || 0,
    };
    porModelo[_normModeloKey(ncToBt[nc] || nc)] = obj;   // por nombre_bt (como lo busca el patentamiento)
    porModelo[_normModeloKey(nc)] = obj;                 // y por nombre_corto, por las dudas
  }
  return { encontrado: true, nombreUsado: 'Supabase incentivos (' + mesKey + ')', porModelo: porModelo };
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
  // NCs de VW desde Supabase (tabla pagos_vw), ya no del Sheet.
  const mes = String(params.mes || '');
  const filtro = mes ? '&mes_incentivo=eq.' + encodeURIComponent(mes) : '';
  const pagos = _supaGet('/pagos_vw?select=' + PAGOS_VW_HEADERS.join(',') + filtro + '&limit=20000');
  return { pagos: pagos, total: pagos.length };
}

function savePagosVW(pagos) {
  if (!Array.isArray(pagos) || !pagos.length) return { guardados: 0, duplicados: 0 };
  // NCs ya existentes en Supabase (para reportar duplicados, igual que antes).
  const existentes = new Set();
  for (const r of _supaGet('/pagos_vw?select=nc_num&limit=20000')) existentes.add(String(r.nc_num).trim());
  const ahora = new Date().toISOString();
  const rows = [];
  let duplicados = 0;
  const vistos = new Set();
  for (const p of pagos) {
    const ncNum = String(p.ncNum || '').trim();
    if (!ncNum || vistos.has(ncNum)) continue;
    vistos.add(ncNum);
    if (existentes.has(ncNum)) { duplicados++; continue; }
    rows.push({
      nc_num: ncNum, fecha_nc: p.fechaNc || '', serie: String(p.serie || ''), vin: String(p.vin || ''),
      modelo: p.modelo || '', tipo_detectado: p.tipoDetectado || 'desconocido',
      monto_neto: Number(p.montoNeto) || 0, monto_total: Number(p.montoTotal) || 0,
      mes_incentivo: String(p.mesIncentivo || ''), texto_tipo: p.textoTipo || '', importado_at: ahora,
    });
  }
  if (rows.length) {
    const h = { apikey: SUPA_ANON, Authorization: 'Bearer ' + SUPA_ANON, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' };
    for (let i = 0; i < rows.length; i += 300) {
      const res = UrlFetchApp.fetch(SUPA_URL + '/pagos_vw?on_conflict=nc_num', { method: 'post', headers: h, payload: JSON.stringify(rows.slice(i, i + 300)), muteHttpExceptions: true });
      if (res.getResponseCode() >= 300) return { error: 'guardar falló: ' + res.getContentText().slice(0, 200), guardados: i };
    }
  }
  try { CacheService.getScriptCache().removeAll(['incentivos_', 'incentivos__']); } catch (e) {}
  return { guardados: rows.length, duplicados: duplicados, total: existentes.size + rows.length };
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
  // {serie: {tipo: monto_total sumado}} para el mes, desde Supabase (pagos_vw).
  // El param ss queda por compatibilidad de firma (ya no se usa el Sheet).
  const out = {};
  for (const r of _supaGet('/pagos_vw?select=serie,tipo_detectado,monto_total&mes_incentivo=eq.' + encodeURIComponent(mesKey) + '&limit=20000')) {
    const serie = String(r.serie || '').trim();
    const tipo  = String(r.tipo_detectado || '').trim();
    if (!serie || !tipo) continue;
    if (!out[serie]) out[serie] = {};
    out[serie][tipo] = (out[serie][tipo] || 0) + (Number(r.monto_total) || 0);
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

// Objetivos de patentamiento por mes — ahora en Supabase (tabla objetivos_pat),
// ya no en la pestaña del Sheet.
function getObjetivosPat() {
  const objetivos = {};
  for (const r of _supaGet('/objetivos_pat?select=mes,objetivo')) {
    const v = Number(r.objetivo);
    if (/^\d{4}-\d{2}$/.test(r.mes) && !isNaN(v) && v >= 0) objetivos[r.mes] = v;
  }
  return { objetivos: objetivos, updatedAt: new Date().toISOString() };
}

function setObjetivoPat(body) {
  const mesKey = String(body.mesKey || '').trim();
  const valor = Number(body.valor);
  if (!/^\d{4}-\d{2}$/.test(mesKey)) return { error: 'mesKey inválido: ' + mesKey };
  if (isNaN(valor) || valor < 0) return { error: 'valor inválido: ' + body.valor };
  const h = { apikey: SUPA_ANON, Authorization: 'Bearer ' + SUPA_ANON, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' };
  const row = { mes: mesKey, objetivo: valor, actualizado_at: new Date().toISOString() };
  const res = UrlFetchApp.fetch(SUPA_URL + '/objetivos_pat?on_conflict=mes', { method: 'post', headers: h, payload: JSON.stringify([row]), muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) return { error: 'guardar falló: ' + res.getContentText().slice(0, 200) };
  return { ok: true, mesKey: mesKey, valor: valor };
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
        // "'" fuerza texto en col A (igual que el insert), si no el update se pierde al releer.
        sh.getRange(i + 2, 1, 1, OBJETIVOS_COMPRAS_HEADERS.length).setValues([["'" + mesKey, valor, ahora]]);
        return { ok: true, mesKey: mesKey, valor: valor, accion: 'update' };
      }
    }
  }
  sh.appendRow(["'" + mesKey, valor, ahora]);  // ' fuerza texto en col A
  return { ok: true, mesKey: mesKey, valor: valor, accion: 'insert' };
}

// =======================================================================
// REPARTO (precios) → comprado del mes EN CURSO no facturado todavía
// =======================================================================
// El "Reparto" vive en precios (tabla reparto_vw, base wjfgl): Fer marca ahí
// las unidades que le compra a VW. Para el avance del mes en la solapa Reparto
// de gestión sumamos esas marcas, PERO solo mientras NO estén en Oversoft:
// cuando la unidad aparece en Oversoft ya la cuenta la facturación (stock por
// fecha de FC), así que sacarla de acá evita el doble conteo. Cruce por VIN
// (= chasis). Devuelve la cantidad pendiente (marcadas y todavía sin Oversoft).
function getRepartoComprado() {
  var mesKey = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
  var rows = [];
  try {
    rows = _repartoRead('/reparto_vw?select=vin&periodo=eq.' + mesKey
      + '&estado_compra=eq.comprado') || [];
  } catch (e) {}
  var vins = rows.map(function (r) { return String(r.vin || '').trim().toUpperCase(); })
                 .filter(Boolean);
  if (!vins.length) return { mesKey: mesKey, pendientes: 0, vins: [] };

  // ¿Cuáles ya están en Oversoft? Esas NO se cuentan acá (las cuenta la FC).
  var h = { headers: { apikey: OVERSOFT_KEY, Authorization: 'Bearer ' + OVERSOFT_KEY }, muteHttpExceptions: true };
  var enOvs = {};
  for (var i = 0; i < vins.length; i += 60) {
    var lote = vins.slice(i, i + 60).map(function (s) { return '"' + s + '"'; }).join(',');
    var res = UrlFetchApp.fetch(OVERSOFT_URL + '/unidades?select=vin&vin=in.(' + encodeURIComponent(lote) + ')', h);
    if (res.getResponseCode() < 300) {
      JSON.parse(res.getContentText()).forEach(function (u) {
        enOvs[String(u.vin || '').trim().toUpperCase()] = true;
      });
    }
  }
  var pend = vins.filter(function (v) { return !enOvs[v]; });
  return { mesKey: mesKey, pendientes: pend.length, vins: pend };
}

// =======================================================================
// REPARTO VW — panel operativo de compra (movido desde precios.titogonzalez)
// =======================================================================
// VW manda por mail las unidades ofrecidas (una fila por VIN). Flujo:
//   pendiente → [Comprar] → comprado → aparece en Oversoft (cruce por VIN,
//   1-2 días vía Valeria) → [OK] → sale del reparto. Comprado y sin Oversoft a
//   2 días = alerta. Dedup por VIN. periodo = mes (la vista filtra el actual).
//   El estado_compra se PRESERVA al re-pegar (no va en el upsert).
// Tabla reparto_vw (wjfgl). Colores: reparto_colores. Lectura con anon
// (_supaGet); escritura con la service key (headers _repartoWHeaders, hW).

// Nombres de color "horneados": códigos de VW ya conocidos. El panel solo
// pregunta por códigos que no estén acá ni en reparto_colores. La DB pisa esto.
var REPARTO_COLORES_BASE = {
  '0Q0Q':'Blanco puro','0Q2T':'Blanco Cristal / Negro Universal','1B1B':'Beige Mojawe Metalizado',
  '1B2T':'Beige Mojawe Metalizado / Negro Profundo efecto perla','2R2R':'Gris Platino',
  '2RA1':'Gris platino / negro','2T2T':'Negro Profundo efecto perla','3X3X':'Gris Salvia',
  '3XA1':'Gris salvia techo negro','5T5T':'Azul Egeo','6K6K':'Rojo Sunset','6U6U':'Blanco Marfil',
  '6UA1':'Marfil / negro universal (bitono)','7Z7Z':'Plata Sirius','9711':'Gris Artico',
  '9728':'Gris Artico','A1A1':'Negro Universal','B4A1':'Blanco Cristal / Negro Universal',
  'B4B4':'Blanco Cristal','C2A1':'Gris volcán / Negro Universal','C2C2':'Gris Volcán','D7':'Azul',
  'D7A1':'Azul Turbo / Negro Universal','D7D7':'Azul Turbo','H7H7':'Azul Atlántico metalizado',
  'I8A1':'Titanio techo negro','I8I8':'Gris Titanio','K22T':'Plata pirita techo negro',
  'K2A1':'Plata Pirita / Negro','K2K2':'Plata Pirita','L0L0':'Rojo hypernova',
  'L4A1':'Azul con techo negro','L4L4':'Azul Malibu','R4A1':'gris Alba','R4R4':'gris alba',
  'U1U1':'Azul Pacifico','X3X3':'Gris Indy'
};

function _repartoPeriodo() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM'); }
function _repartoWHeaders() {
  var svc = PropertiesService.getScriptProperties().getProperty('SUPA_SERVICE');
  return { apikey: svc, Authorization: 'Bearer ' + svc, 'Content-Type': 'application/json' };
}
// reparto_vw / reparto_colores tienen RLS que bloquea la anon (precios las lee con
// service_role) → leemos con la service key, no con _supaGet (anon).
function _repartoRead(path) {
  var svc = PropertiesService.getScriptProperties().getProperty('SUPA_SERVICE');
  var res = UrlFetchApp.fetch(SUPA_URL + path, { headers: { apikey: svc, Authorization: 'Bearer ' + svc }, muteHttpExceptions: true });
  return res.getResponseCode() < 300 ? JSON.parse(res.getContentText()) : [];
}
// in.(...) para UrlFetchApp: SIN comillas (UrlFetchApp las rechaza) y encodeado.
// Los VIN/códigos son alfanuméricos, así que no necesitan comillas en PostgREST.
function _repartoInList(arr) { return arr.map(function (s) { return encodeURIComponent(String(s).trim()); }).join(','); }
// Réplica del _ntrim del motor (para cruzar por NOMBRE el reparto con ventas/stock).
function _repartoNtrim(s) {
  s = String(s || '').toLowerCase();
  s = s.replace(/bi[\s-]*tono/g, 'bitono').replace(/\b(vw|nuevo)\b/g, '').replace(/\bmtg([123])\b/g, 'mt');
  s = s.replace(/\bmy2[0-9]\b/g, '').replace(/\b20[0-9][0-9]\b/g, '').replace(/\bg[123]\b/g, '');
  s = s.replace(/\bph[ag]\b/g, '').replace(/\b(se|cd|l)\b/g, '');
  return s.replace(/[^a-z0-9]/g, '');
}

function parseReparto(texto) {
  var out = [], vistos = {};
  var lineas = String(texto || '').split(/\r?\n/);
  for (var i = 0; i < lineas.length; i++) {
    if (!lineas[i].trim()) continue;
    var f = lineas[i].split('\t').map(function (x) { return x.trim(); });
    if (f.length < 9) continue;
    if ((f[0] || '').toLowerCase() === 'canal') continue;
    var vin = (f[8] || '').toUpperCase();
    if (!vin || vin.length < 11 || vin === 'VIN') continue;
    if (vistos[vin]) continue;
    vistos[vin] = true;
    var com = Number((f[9] || '').replace(/[^\d.-]/g, ''));
    out.push({
      canal: f[0] || '', zona: f[1] || '', centrega: f[2] || '', modelo_codigo: f[3] || '',
      my: f[4] || '', familia: f[5] || '', descripcion: f[6] || '', color_codigo: f[7] || '',
      vin: vin, comision: (isFinite(com) && com > 0) ? com : null, status: f[10] || ''
    });
  }
  return out;
}

function cargarReparto(body) {
  var rows = parseReparto(body && body.texto);
  var periodo = _repartoPeriodo();
  if (!rows.length) return { ok: false, error: 'No se reconoció ninguna fila (¿pegaste la tabla con tabulaciones?)', nuevos: 0, total: 0, periodo: periodo };
  var vins = rows.map(function (r) { return r.vin; });
  var ya = {};
  try { (_repartoRead('/reparto_vw?select=vin&vin=in.(' + _repartoInList(vins) + ')') || []).forEach(function (r) { ya[r.vin] = true; }); } catch (e) {}
  var nuevos = rows.filter(function (r) { return !ya[r.vin]; }).length;
  var ahora = new Date().toISOString();
  var payload = rows.map(function (r) { return Object.assign({}, r, { periodo: periodo, actualizado_at: ahora }); });
  // NO incluimos estado_compra/comprado_at → se preservan en los repetidos.
  var res = UrlFetchApp.fetch(SUPA_URL + '/reparto_vw?on_conflict=vin', {
    method: 'post', headers: Object.assign(_repartoWHeaders(), { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    payload: JSON.stringify(payload), muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) return { ok: false, error: 'supa ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 160), nuevos: 0, total: rows.length, periodo: periodo };
  return { ok: true, nuevos: nuevos, total: rows.length, periodo: periodo };
}

function marcarComprado(body) {
  var vins = (body && body.vins) || [];
  if (!vins.length) return { ok: true };
  var res = UrlFetchApp.fetch(SUPA_URL + '/reparto_vw?vin=in.(' + _repartoInList(vins) + ')', {
    method: 'patch', headers: Object.assign(_repartoWHeaders(), { Prefer: 'return=minimal' }),
    payload: JSON.stringify({ estado_compra: 'comprado', comprado_at: new Date().toISOString() }), muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) return { ok: false, error: 'supa ' + res.getResponseCode() };
  // Que aparezcan YA en Compras VW de Valeria, antes de entrar a Oversoft.
  var sembradas = 0;
  try { sembradas = _sembrarComprasVWdesdeReparto(vins); } catch (e) {}
  return { ok: true, comprasVW: sembradas };
}

// serie = últimos 8 del VIN (ej 8AWJD62H6TA012322 → TA012322); así matchea la
// serie de Oversoft cuando la unidad entra, y concilia por serie en Compras VW.
function _serieDeVin(vin) {
  var s = String(vin || '').trim().toUpperCase();
  return s.length >= 8 ? s.slice(-8) : s;
}
// periodo "2026-06" → "junio-26" (formato mes de compras_vw).
function _mesNombrePeriodo(periodo) {
  var m = String(periodo || '').match(/^(\d{4})-(\d{2})/);
  if (!m) return '';
  var nombres = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  return nombres[parseInt(m[2], 10) - 1] + '-' + m[1].slice(-2);
}
// Crea/asegura filas en compras_vw para los VIN comprados en reparto. serie =
// últimos 8 del VIN; modelo/color = los de VW (default). El modelo/color de
// Oversoft pisa al conciliar. NO pisa filas existentes (ignore-duplicates), así
// no borra lo que Valeria ya cargó (factura, vto, bruto). Devuelve cuántas mandó.
function _sembrarComprasVWdesdeReparto(vins) {
  if (!vins || !vins.length) return 0;
  var rows = _repartoRead('/reparto_vw?select=vin,descripcion,my,familia,color_codigo,periodo&vin=in.(' + _repartoInList(vins) + ')') || [];
  if (!rows.length) return 0;
  var coloresDb = {};
  try { (_repartoRead('/reparto_colores?select=codigo,nombre') || []).forEach(function (c) { coloresDb[c.codigo] = c.nombre; }); } catch (e) {}
  var colores = Object.assign({}, REPARTO_COLORES_BASE, coloresDb);
  var now = new Date().toISOString();
  var payload = rows.map(function (r) {
    var serie = _serieDeVin(r.vin);
    var desc = String(r.descripcion || '').trim();
    var my = String(r.my || '').replace(/^my/i, '').trim();
    if (/^20\d\d$/.test(my)) my = my.slice(-2);   // "2026" → "26"
    var modelo = ('VW ' + desc + (my ? ' MY' + my : '')).replace(/\s+/g, ' ').trim();
    return {
      serie: serie, mes: _mesNombrePeriodo(r.periodo),
      modelo_valeria: modelo, color: colores[r.color_codigo] || String(r.color_codigo || ''),
      conciliado: false, updated_at: now, updated_by: 'reparto'
    };
  }).filter(function (x) { return x.serie; });
  if (!payload.length) return 0;
  var hh = { apikey: SUPA_ANON, Authorization: 'Bearer ' + SUPA_ANON, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' };
  var r2 = UrlFetchApp.fetch(SUPA_URL + '/compras_vw?on_conflict=serie', { method: 'post', headers: hh, payload: JSON.stringify(payload), muteHttpExceptions: true });
  try { _cacheDrop('comprasvw'); } catch (e) {}
  return (r2.getResponseCode() < 300) ? payload.length : 0;
}
function desmarcarComprado(body) {
  var vin = String((body && body.vin) || '').trim().toUpperCase();
  if (!vin) return { ok: false, error: 'falta vin' };
  var res = UrlFetchApp.fetch(SUPA_URL + '/reparto_vw?vin=eq.' + encodeURIComponent(vin), {
    method: 'patch', headers: Object.assign(_repartoWHeaders(), { Prefer: 'return=minimal' }),
    payload: JSON.stringify({ estado_compra: 'pendiente', comprado_at: null }), muteHttpExceptions: true });
  return res.getResponseCode() < 300 ? { ok: true } : { ok: false, error: 'supa ' + res.getResponseCode() };
}
function darOkReparto(body) {
  var vin = String((body && body.vin) || '').trim().toUpperCase();
  if (!vin) return { ok: false, error: 'falta vin' };
  var res = UrlFetchApp.fetch(SUPA_URL + '/reparto_vw?vin=eq.' + encodeURIComponent(vin), {
    method: 'patch', headers: Object.assign(_repartoWHeaders(), { Prefer: 'return=minimal' }),
    payload: JSON.stringify({ estado_compra: 'ok' }), muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) return { ok: false, error: 'supa ' + res.getResponseCode() };
  // Dar OK = ya conciliado con Oversoft → marco la compra como conciliada para que
  // en Compras VW tome modelo/color de Oversoft en vez del default de VW.
  try {
    var hh = { apikey: SUPA_ANON, Authorization: 'Bearer ' + SUPA_ANON, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
    UrlFetchApp.fetch(SUPA_URL + '/compras_vw?serie=eq.' + encodeURIComponent(_serieDeVin(vin)), {
      method: 'patch', headers: hh, payload: JSON.stringify({ conciliado: true }), muteHttpExceptions: true });
    _cacheDrop('comprasvw');
  } catch (e) {}
  return { ok: true };
}

// Deshacer una confirmación: vuelve de 'ok' a 'comprado' (a la sección
// "Comprado · a conciliar"). No toca la conciliación de compras_vw.
function reabrirReparto(body) {
  var vin = String((body && body.vin) || '').trim().toUpperCase();
  if (!vin) return { ok: false, error: 'falta vin' };
  var res = UrlFetchApp.fetch(SUPA_URL + '/reparto_vw?vin=eq.' + encodeURIComponent(vin), {
    method: 'patch', headers: Object.assign(_repartoWHeaders(), { Prefer: 'return=minimal' }),
    payload: JSON.stringify({ estado_compra: 'comprado' }), muteHttpExceptions: true });
  return res.getResponseCode() < 300 ? { ok: true } : { ok: false, error: 'supa ' + res.getResponseCode() };
}

function guardarColoresReparto(body) {
  var entries = (body && body.entries) || [];
  var aGuardar = [], aBorrar = [];
  entries.forEach(function (e) {
    var cod = String(e.codigo || '').trim(), nom = String(e.nombre || '').trim();
    if (!cod) return;
    if (nom) aGuardar.push({ codigo: cod, nombre: nom, actualizado_at: new Date().toISOString() });
    else aBorrar.push(cod);
  });
  if (aBorrar.length) {
    var rd = UrlFetchApp.fetch(SUPA_URL + '/reparto_colores?codigo=in.(' + _repartoInList(aBorrar) + ')',
      { method: 'delete', headers: _repartoWHeaders(), muteHttpExceptions: true });
    if (rd.getResponseCode() >= 300) return { ok: false, error: 'supa del ' + rd.getResponseCode() };
  }
  if (aGuardar.length) {
    var ru = UrlFetchApp.fetch(SUPA_URL + '/reparto_colores?on_conflict=codigo',
      { method: 'post', headers: Object.assign(_repartoWHeaders(), { Prefer: 'resolution=merge-duplicates,return=minimal' }), payload: JSON.stringify(aGuardar), muteHttpExceptions: true });
    if (ru.getResponseCode() >= 300) return { ok: false, error: 'supa up ' + ru.getResponseCode() };
  }
  return { ok: true };
}

// Reparto del mes (incluye los OK/confirmados, que el panel muestra en su propia
// sección y siguen contando) enriquecido con cruce Oversoft + nombres de color
// + ventas/stock por modelo (motor). Lo consume el panel operativo de gestión.
function getReparto() {
  var periodo = _repartoPeriodo();
  var rows = [];
  try {
    rows = _repartoRead('/reparto_vw?select=vin,canal,zona,centrega,modelo_codigo,my,familia,descripcion,color_codigo,comision,status,estado_compra,comprado_at&periodo=eq.' + periodo) || [];
  } catch (e) {}

  var coloresDb = {};
  try { (_repartoRead('/reparto_colores?select=codigo,nombre') || []).forEach(function (c) { coloresDb[c.codigo] = c.nombre; }); } catch (e) {}
  var colores = Object.assign({}, REPARTO_COLORES_BASE, coloresDb);

  // Ventas + stock por modelo (cruce por NOMBRE con el motor) + desglose por color.
  var motorByNorm = {};
  try {
    var motor = _cached('motor', CACHE_TTL_SEC, false, getBaratitoMotor);
    (motor.modelos || []).forEach(function (m) {
      var v = { ventasPorMes: m.ventasPorMes, stock: m.stock, colores: m.colores || [] };
      if (m.modelo) motorByNorm[_repartoNtrim(m.modelo)] = v;
      if (m.nombreCorto) motorByNorm[_repartoNtrim(m.nombreCorto)] = v;
    });
  } catch (e) {}

  // Cruce Oversoft (por VIN) para las compradas: presencia + modelo + color
  // (para que Fer chequee que coincida lo que cargó el sistema antes del OK).
  var compradoVins = rows.filter(function (r) { return r.estado_compra === 'comprado'; }).map(function (r) { return r.vin; });
  var cruce = {};
  if (compradoVins.length) {
    var h = { headers: { apikey: OVERSOFT_KEY, Authorization: 'Bearer ' + OVERSOFT_KEY }, muteHttpExceptions: true };
    var ovGet = function (path) { var res = UrlFetchApp.fetch(OVERSOFT_URL + path, h); return res.getResponseCode() < 300 ? JSON.parse(res.getContentText()) : []; };
    var rawu = [];
    for (var i = 0; i < compradoVins.length; i += 60) {
      var lote = compradoVins.slice(i, i + 60).map(function (s) { return '"' + s + '"'; }).join(',');
      rawu = rawu.concat(ovGet('/unidades?select=serie,vin,modelo,color,fechaderecepcion,preventa&vin=in.(' + encodeURIComponent(lote) + ')'));
    }
    // mapas modelo (codigodecompra -> descripcion) y color (colorid -> descripcion)
    var descOvs = {}, off = 0;
    for (var k = 0; k < 12; k++) {
      var ch = ovGet('/modelos?select=codigodecompra,descripcionoperativa&order=modeloid&limit=1000&offset=' + off);
      for (var j = 0; j < ch.length; j++) if (ch[j].codigodecompra) descOvs[String(ch[j].codigodecompra).trim()] = ch[j].descripcionoperativa;
      if (ch.length < 1000) break; off += 1000;
    }
    var colOvs = {};
    ovGet('/colores?select=colorid,descripcion&limit=2000').forEach(function (c) { colOvs[c.colorid] = String(c.descripcion || '').trim(); });
    rawu.forEach(function (u) {
      cruce[String(u.vin || '').toUpperCase()] = {
        serie: String(u.serie || '').trim(),
        fechaRecepcion: u.fechaderecepcion ? String(u.fechaderecepcion).slice(0, 10) : null,
        preventa: u.preventa ? String(u.preventa) : null,
        modelo: descOvs[String(u.modelo || '').trim()] || String(u.modelo || ''),
        color: colOvs[u.color] || ''
      };
    });
  }

  var norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
  var incl = function (a, b) { a = norm(a); b = norm(b); return !!a && !!b && (a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0); };

  rows.sort(function (a, b) { return (a.familia || '').localeCompare(b.familia || '') || (a.descripcion || '').localeCompare(b.descripcion || ''); });
  var now = Date.now();
  var items = rows.map(function (r) {
    var ov = cruce[String(r.vin).toUpperCase()] || null;
    var dias = r.comprado_at ? Math.floor((now - new Date(r.comprado_at).getTime()) / 86400000) : null;
    var mm = motorByNorm[_repartoNtrim(r.descripcion)];
    var colorNom = colores[r.color_codigo] || r.color_codigo;
    return Object.assign({}, r, {
      color_nombre: colorNom,
      ventasPorMes: mm ? mm.ventasPorMes : null,
      stockActual: mm ? mm.stock : null,
      coloresStock: mm ? (mm.colores || []) : null,
      enOversoft: !!ov, oversoft: ov, diasComprado: dias,
      modeloMatch: ov ? (_repartoNtrim(ov.modelo) === _repartoNtrim(r.descripcion) || incl(ov.modelo, r.descripcion)) : null,
      colorMatch: ov ? incl(ov.color, colorNom) : null,
      alerta: r.estado_compra === 'comprado' && !ov && dias !== null && dias >= 2
    });
  });
  return { periodo: periodo, items: items, colores: colores };
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
  try { _cacheDrop('ventas'); } catch (e) {}
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
  try { _cacheDrop('ventas'); } catch (e) {}
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
# -*- coding: utf-8 -*-
"""PLANTILLA mensual: carga precios_lista via Web App setprecioslista y concilia.
Cada mes: reemplazar el bloque JUL con las filas de la lista nueva (PREC.NETO
concesionario y sugerido, validados con (S/IMP-INCENT)*IVA: 21% autos, 10,5%
Saveiro/Amarok) y actualizar mes/listaNum del body. Dry-run primero; --go aplica.
Circuito completo: skill circular-vw (C:\\proyectos\\.claude\\skills).

Ultima corrida: 2026-07 lista #892. Vento GLI: MY26 por decision de Fer."""
import json, urllib.request, sys

EXEC = "https://script.google.com/macros/s/AKfycby13NRmtve2ojB0IMZgFPnKh3HsLSBLDca4kOduRenO97KLH3W3ILbiJfDzGYVLAUpwpQ/exec"
TOKEN = "tga-gestion-R7nQ4xK8jL"

# (cod, desc_pdf, my, neto_conc, neto_sug) — PREC.NETO julio, lista #892
JUL = [
 ("BZ31T4","Polo Track MSI MT","26",33337399.50,38318850.00),
 ("BZ32D3","Polo COMFORTLINE 170TSI AT","26",37947060.00,44643600.00),
 ("BZ33D3","Polo HIGHLINE 170TSI AT","26",41045225.00,48288500.00),
 ("DF11T4","Tera Trend MSI MT","26",31866797.50,37490350.00),
 ("DF13D3","Tera Comfort 170TSI AT","26",36034050.00,42393000.00),
 ("DF14D3","Tera High 170TSI AT","26",39543360.00,46521600.00),
 ("DF14D3","Tera Outfit 170TSI AT","26",40530295.00,47682700.00),
 ("DF11T4","Tera Trend MSI MT + Pack Safe I","26",32396475.00,38113500.00),
 ("DF13D3","Tera Comfort 170TSI AT + Pack Safe II","26",36911335.00,43425100.00),
 ("BZ4ET4","Virtus Sense MSI MT","26",29182455.00,34332300.00),
 ("BZ42T4","Virtus MSI MT","26",30409302.50,35775650.00),
 ("BZ42D3","Virtus Trendline 170TSI AT","26",32378455.00,38092300.00),
 ("BZ44D3","Virtus Highline 170TSI AT","26",36733940.00,43216400.00),
 ("BZ47NY","Virtus Exclusive 250TSI AT","26",42195360.00,49641600.00),
 ("CH21R4","Nivus Sense 170TSI MT","27",28855120.00,33947200.00),
 ("CH23R4","Nivus 170TSI MT","26",37761845.00,44425700.00),
 ("CH22K3","Nivus Trendline 200TSI AT","26/27",40083790.00,47157400.00),
 ("CH23K3","Nivus Comfortline 200TSI AT","26/27",42408327.50,49892150.00),
 ("CH24K3","Nivus Highline 200TSI AT","26/27",45791157.50,53871950.00),
 ("CH24K3","Nivus Outfit 200TSI AT","26/27",46843245.00,55109700.00),
 ("BF3PD4","T-Cross Sense 170TSI MT","26",32872560.00,38673600.00),
 ("BF32D4","T-Cross Trendline 170TSI MT","26",44014615.00,51781900.00),
 ("BF32K3","T-Cross Trendline 200TSI AT","26",46280332.50,54447450.00),
 ("BF33K3","T-Cross Comfortline 200TSI AT","26",50057010.00,58890600.00),
 ("BF34K3","T-Cross Highline 200TSI AT","26",55252677.50,65003150.00),
 ("BF34K3","T-Cross Highline Bi Tono 200TSI AT","26",56186275.00,66101500.00),
 ("BF3XK3","T-Cross Extreme 200TSI AT","26",56641407.50,66636950.00),
 ("CL23LZ","Taos Comfortline 250TSI AT","26",49862870.00,58662200.00),
 ("CL24LZ","Taos Highline 250TSI AT","26",56762660.00,66779600.00),
 ("CL24LZ","Taos Highline Bi Tono 250TSI AT","26",57498717.50,67645550.00),
 ("BU59UZ","Vento GLI 350TSI DSG","26",63070807.50,74200950.00),   # MY26 (decision Fer); MY25 seria 62.663.700/73.722.000
 ("RM13M7","Tiguan Life 250TSI DSG","25",67256760.00,79125600.00),
 ("RM14M7","Tiguan R-Line 250TSI DSG","25/26",70788637.50,83280750.00),
 ("5URTT4","Saveiro Trendline CS MSI MT","26/27",27333365.00,32156900.00),
 ("5UKWT4","Saveiro Comfortline CD MSI MT","26/27",30121237.50,35436750.00),
 ("5UK8T4","Saveiro Extreme CD MSI MT","26/27",33405595.00,39300700.00),
 ("AGDA43","Amarok Trendline TDI MT 4x2 G2","25/26",44036470.40,51929800.00),
 ("AGDA34","Amarok Trendline TDI MT 4x4 G2","25/26",52486917.60,61894950.00),
 ("AGDB33","Amarok Comfortline TDI MT 4x2 G2","25/26",50514512.00,59569000.00),
 ("AGDB33","Amarok Comfortline TDI MT 4x2 SE G2","25/26",50514512.00,59569000.00),
 ("AGDB3X","Amarok Comfortline TDI AT 4x2 G2","25/26",53887220.00,63546250.00),
 ("AGDB3X","Amarok Comfortline TDI AT 4x2 SE G2","25/26",53887220.00,63546250.00),
 ("AGDC33","Amarok Highline TDI MT 4x2 G2","25/26",54472170.40,64236050.00),
 ("AGDC3X","Amarok Highline TDI AT 4x2 G2","25/26",59749104.80,70458850.00),
 ("AGDC3X","Amarok Highline TDI AT 4x2 SE G2","25/26",59749104.80,70458850.00),
 ("AGDB8A","Amarok Comfortline V6 AT 4x4 G2","25/26",62159841.60,73301700.00),
 ("AGDC8A","Amarok Highline V6 AT 4x4 G2","25/26",73265292.00,86397750.00),
 ("AGDD8A","Amarok Extreme V6 AT 4x4 G2","25/26",78378859.20,92427900.00),
 ("AGDD8A","Amarok Hero V6 AT 4x4 G2","25/26",78378859.20,92427900.00),
 ("AGDD8A","Amarok Black Style V6 AT 4x4 G2","25/26",79229276.00,93430750.00),
 ("AGDD8A","Amarok Black Style V6 AT 4x4 SE G2","25/26",79229276.00,93430750.00),
]

def norm(s):
    return (s.lower().replace("bi-tono", "bi tono").replace("+ pack", "+pack")
             .replace("  ", " ").strip())

julmap = {}
for cod, desc, my, neto, sug in JUL:
    julmap[norm(desc)] = (cod, round(neto), round(sug))

# --- junio desde Supabase: sus `modelo` son los nombre_corto del catalogo ---
pat = None
for line in open(r"C:\proyectos\.secrets\supabase.env", encoding="utf8"):
    if line.startswith("SUPABASE_PAT=") and line.split("=", 1)[1].strip():
        pat = line.split("=", 1)[1].strip()

def sql(q):
    req = urllib.request.Request(
        "https://api.supabase.com/v1/projects/wjfglsafgaltusmbnccl/database/query",
        data=json.dumps({"query": q}).encode(),
        headers={"Authorization": "Bearer " + pat, "Content-Type": "application/json",
                 "User-Agent": "gestion-tga-claude/1.0"})
    return json.load(urllib.request.urlopen(req))

jun = sql("select modelo, codigo from precios_lista where mes='2026-06' order by modelo")

filas, sin_match = [], []
for r in jun:
    m = julmap.get(norm(r["modelo"]))
    if not m:
        sin_match.append(r["modelo"]); continue
    cod, costo, lista = m
    filas.append({"modelo": r["modelo"], "codigo": r["codigo"], "precioLista": lista, "costo": costo})

print("filas a cargar: %d  (junio tenia %d)" % (len(filas), len(jun)))
if sin_match:
    print("SIN MATCH (no se cargan):", sin_match); sys.exit(1)

if "--go" not in sys.argv:
    for f in filas: print("  %-42s %-8s lista=%s costo=%s" % (f["modelo"], f["codigo"], format(f["precioLista"], ","), format(f["costo"], ",")))
    print("\n(dry-run; correr con --go para cargar)"); sys.exit(0)

body = {"token": TOKEN, "accion": "setprecioslista", "mes": "2026-07", "listaNum": 892, "filas": filas}
req = urllib.request.Request(EXEC, data=json.dumps(body).encode(),
                             headers={"Content-Type": "application/json"})
resp = json.load(urllib.request.urlopen(req))
print("respuesta Web App:", json.dumps(resp, ensure_ascii=False))

# --- conciliar: releer 2026-07 y comparar ---
db = sql("select modelo, codigo, precio_lista::bigint as lista, costo_concesionario::bigint as costo, lista_num from precios_lista where mes='2026-07'")
print("\n=== Conciliacion 2026-07: %d filas en DB ===" % len(db))
esperado = {f["modelo"]: f for f in filas}
ok, diffs = 0, []
for r in db:
    e = esperado.get(r["modelo"])
    if not e:
        diffs.append("en DB y no esperado: " + r["modelo"]); continue
    if int(r["lista"]) == e["precioLista"] and int(r["costo"]) == e["costo"] and r["lista_num"] == 892:
        ok += 1
    else:
        diffs.append("%s: DB(l=%s,c=%s,n=%s) vs esperado(l=%s,c=%s)" %
                     (r["modelo"], r["lista"], r["costo"], r["lista_num"], e["precioLista"], e["costo"]))
faltan = set(esperado) - {r["modelo"] for r in db}
print("%d/%d OK, %d diffs, %d faltantes" % (ok, len(esperado), len(diffs), len(faltan)))
for d in diffs: print("  " + d)
for f in sorted(faltan): print("  FALTA: " + f)

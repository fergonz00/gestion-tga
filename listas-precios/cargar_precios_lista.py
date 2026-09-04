# -*- coding: utf-8 -*-
"""PLANTILLA mensual: carga precios_lista via Web App setprecioslista y concilia.
Cada mes: reemplazar el bloque JUL con las filas de la lista nueva (PREC.NETO
concesionario y sugerido, validados con (S/IMP-INCENT)*IVA: 21% autos, 10,5%
Saveiro/Amarok) y actualizar mes/listaNum del body. Dry-run primero; --go aplica.
Circuito completo: skill circular-vw (C:\\proyectos\\.claude\\skills).

Ultima corrida: 2026-09 lista #897 (circular 98), Excel. Vento GLI: MY26.
Septiembre: PKW y Saveiro +1,50%, Amarok CONGELADA salvo Trendline 4x2 MT +1,00%
(coincide al peso con lo que adelanto el zonal). Alta: Amarok Unlimited V6 AT 4x4
G2 MY27 (AGDD8A), sin unidades en Oversoft.
"""
import json, urllib.request, sys

EXEC = "https://script.google.com/macros/s/AKfycby13NRmtve2ojB0IMZgFPnKh3HsLSBLDca4kOduRenO97KLH3W3ILbiJfDzGYVLAUpwpQ/exec"
TOKEN = "tga-gestion-R7nQ4xK8jL"
MES, LISTA_NUM, MES_ANT = "2026-09", 897, "2026-08"

# (cod, desc_pdf, my, neto_conc, neto_sug) — PREC.NETO agosto, lista #895
SEP = [
 ("BZ3RT4","Polo Robust MSI MT","26",26293618.00,30222550.00),
 ("BZ31T4","Polo Track MSI MT","26",34175862.00,39282600.00),
 ("BZ32D3","Polo COMFORTLINE 170TSI AT","26",38901440.00,45766400.00),
 ("BZ33D3","Polo HIGHLINE 170TSI AT","26",42077508.00,49502950.00),
 ("DF11T4","Tera Trend MSI MT","26",32668262.00,38433250.00),
 ("DF13D3","Tera Comfort 170TSI AT","26",36940320.00,43459200.00),
 ("DF14D3","Tera High 170TSI AT","26",40537860.00,47691600.00),
 ("DF14D3","Tera Outfit 170TSI AT","26",41549658.00,48881950.00),
 ("DF11T4","Tera Trend MSI MT + Pack Safe I","26",33211242.00,39072050.00),
 ("DF13D3","Tera Comfort 170TSI AT + Pack Safe II","26",37839662.00,44517250.00),
 ("BZ4ET4","Virtus Sense MSI MT","26",29916388.00,35195750.00),
 ("BZ42T4","Virtus MSI MT","26",31174090.00,36675400.00),
 ("BZ42D3","Virtus Trendline 170TSI AT","26",33192755.00,39050300.00),
 ("BZ44D3","Virtus Highline 170TSI AT","26",37657805.00,44303300.00),
 ("BZ47NY","Virtus Exclusive 250TSI AT","26",43256542.00,50890050.00),
 ("CH21R4","Nivus Sense 170TSI MT","27",29580807.00,34800950.00),
 ("CH23R4","Nivus 170TSI MT","26",38711550.00,45543000.00),
 ("CH22K3","Nivus Trendline 200TSI AT","26/27",41091890.00,48343400.00),
 ("CH23K3","Nivus Comfortline 200TSI AT","26/27",43474865.00,51146900.00),
 ("CH24K3","Nivus Highline 200TSI AT","26/27",46942780.00,55226800.00),
 ("CH24K3","Nivus Outfit 200TSI AT","26/27",48021345.00,56495700.00),
 ("BF3PD4","T-Cross Sense 170TSI MT","26",33699312.00,39646250.00),
 ("BF32D4","T-Cross Trendline 170TSI MT","26",45121570.00,53084200.00),
 ("BF32K3","T-Cross Trendline 200TSI AT","26",47444280.00,55816800.00),
 ("BF33K3","T-Cross Comfortline 200TSI AT","26",51315945.00,60371700.00),
 ("BF34K3","T-Cross Highline 200TSI AT","26",56642300.00,66638000.00),
 ("BF34K3","T-Cross Highline Bi Tono 200TSI AT","26",57599357.00,67763950.00),
 ("BF3XK3","T-Cross Extreme 200TSI AT","26",58065922.00,68312850.00),
 ("CL23LZ","Taos Comfortline 250TSI AT","26",51116917.00,60137550.00),
 ("CL24LZ","Taos Highline 250TSI AT","26",58190235.00,68459100.00),
 ("CL24LZ","Taos Highline Bi Tono 250TSI AT","26",58944822.00,69346850.00),
 ("BU59UZ","Vento GLI 350TSI DSG","26",64657035.00,76067100.00),
 ("RM13M7","Tiguan Life 250TSI DSG","25",68948260.00,81115600.00),
 ("RM14M7","Tiguan R-Line 250TSI DSG","25/26",72568962.00,85375250.00),
 ("5URTT4","Saveiro Trendline CS MSI MT","26/27",28020803.00,32965650.00),
 ("5UKWT4","Saveiro Comfortline CD MSI MT","26/27",30878758.00,36327950.00),
 ("5UK8T4","Saveiro Extreme CD MSI MT","26/27",34245735.00,40289100.00),
 ("AGDA43","Amarok Trendline TDI MT 4x2 G2","25/26",44476837.00,52449100.00),
 ("AGDA34","Amarok Trendline TDI MT 4x4 G2","25/26",52486918.00,61894950.00),
 ("AGDB33","Amarok Comfortline TDI MT 4x2 G2","25/26",50514520.00,59569010.00),
 ("AGDB33","Amarok Comfortline TDI MT 4x2 SE G2","25/26",50514520.00,59569010.00),
 ("AGDB3X","Amarok Comfortline TDI AT 4x2 G2","25/26",53887209.00,63546237.00),
 ("AGDB3X","Amarok Comfortline TDI AT 4x2 SE G2","25/26",53887209.00,63546237.00),
 ("AGDC33","Amarok Highline TDI MT 4x2 G2","25/26",54472161.00,64236039.00),
 ("AGDC3X","Amarok Highline TDI AT 4x2 G2","25/26",59749115.00,70458862.00),
 ("AGDC3X","Amarok Highline TDI AT 4x2 SE G2","25/26",59749115.00,70458862.00),
 ("AGDB8A","Amarok Comfortline V6 AT 4x4 G2","25/26",62159827.00,73301683.00),
 ("AGDB8A","Amarok Comfortline V6 AT 4x4 SE G2","25/26",62159827.00,73301683.00),
 ("AGDC8A","Amarok Highline V6 AT 4x4 G2","25/26",73265311.00,86397773.00),
 ("AGDC8A","Amarok Highline V6 AT 4x4 SE G2","25/26",73265311.00,86397773.00),
 ("AGDD8A","Amarok Extreme V6 AT 4x4 G2","25/26",78378877.00,92427921.00),
 ("AGDD8A","Amarok Extreme V6 AT 4x4 SE G2","25/26",78378877.00,92427921.00),
 ("AGDD8A","Amarok Hero V6 AT 4x4 G2","25/26",78378877.00,92427921.00),
 ("AGDD8A","Amarok Black Style V6 AT 4x4 G2","25/26",79229269.00,93430742.00),
 ("AGDD8A","Amarok Black Style V6 AT 4x4 SE G2","25/26",79229269.00,93430742.00),
 ("AGDD8A","Amarok Unlimited V6 AT 4x4 G2","27",79653270.00,93930743.00),
]
JUL = SEP   # nombre historico que usa el resto del script

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

# El universo son los modelos ACTIVOS del catalogo (asi entra el alta del mes:
# los "G2" pelados de Amarok estan inactivos y no deben cargarse).
cat = sql("select nombre_corto, codigo from catalogo_modelos where activo = true order by orden nulls last")

filas, sin_match = [], []
for r in cat:
    m = julmap.get(norm(r["nombre_corto"]))
    if not m:
        sin_match.append(r["nombre_corto"]); continue
    cod, costo, lista = m
    filas.append({"modelo": r["nombre_corto"], "codigo": r["codigo"], "precioLista": lista, "costo": costo})

print("filas a cargar: %d  (catalogo activo: %d)" % (len(filas), len(cat)))
if sin_match:
    print("MODELO ACTIVO SIN PRECIO EN LA LISTA (no se carga):", sin_match); sys.exit(1)

if "--go" not in sys.argv:
    for f in filas: print("  %-42s %-8s lista=%s costo=%s" % (f["modelo"], f["codigo"], format(f["precioLista"], ","), format(f["costo"], ",")))
    print("\n(dry-run; correr con --go para cargar)"); sys.exit(0)

body = {"token": TOKEN, "accion": "setprecioslista", "mes": MES, "listaNum": LISTA_NUM, "filas": filas}
req = urllib.request.Request(EXEC, data=json.dumps(body).encode(),
                             headers={"Content-Type": "application/json"})
resp = json.load(urllib.request.urlopen(req))
print("respuesta Web App:", json.dumps(resp, ensure_ascii=False))

# --- conciliar: releer el mes y comparar ---
db = sql("select modelo, codigo, precio_lista::bigint as lista, costo_concesionario::bigint as costo, lista_num from precios_lista where mes='%s'" % MES)
print("\n=== Conciliacion %s: %d filas en DB ===" % (MES, len(db)))
esperado = {f["modelo"]: f for f in filas}
ok, diffs = 0, []
for r in db:
    e = esperado.get(r["modelo"])
    if not e:
        diffs.append("en DB y no esperado: " + r["modelo"]); continue
    if int(r["lista"]) == e["precioLista"] and int(r["costo"]) == e["costo"] and r["lista_num"] == LISTA_NUM:
        ok += 1
    else:
        diffs.append("%s: DB(l=%s,c=%s,n=%s) vs esperado(l=%s,c=%s)" %
                     (r["modelo"], r["lista"], r["costo"], r["lista_num"], e["precioLista"], e["costo"]))
faltan = set(esperado) - {r["modelo"] for r in db}
print("%d/%d OK, %d diffs, %d faltantes" % (ok, len(esperado), len(diffs), len(faltan)))
for d in diffs: print("  " + d)
for f in sorted(faltan): print("  FALTA: " + f)

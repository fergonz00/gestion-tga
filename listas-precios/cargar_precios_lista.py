# -*- coding: utf-8 -*-
"""PLANTILLA mensual: carga precios_lista via Web App setprecioslista y concilia.
Cada mes: reemplazar el bloque JUL con las filas de la lista nueva (PREC.NETO
concesionario y sugerido, validados con (S/IMP-INCENT)*IVA: 21% autos, 10,5%
Saveiro/Amarok) y actualizar mes/listaNum del body. Dry-run primero; --go aplica.
Circuito completo: skill circular-vw (C:\\proyectos\\.claude\\skills).

Ultima corrida: 2026-11 lista #900 (circular 130, vig. 04/11), Excel. +0,50% parejo en
lista y costo (salvo Nivus 170TSI MT, igual). Ya no figuran: Amarok Highline TDI MT 4x2,
T-Cross Trendline 170TSI MT, Tiguan Life, Virtus MSI MT (sin stock) -> quedan con el precio
de la #898 para que ningun modelo activo quede sin precio. T-Cross MY27 viene con precio
propio (~-7%) y NO se carga: el catalogo no distingue MY27 y no hay stock.
Reemplaza la provisoria lista_num=202611. Fer: precios publicados CONGELADOS.
Antes: 2026-10 lista #898 v2 (circular 117, vig. 14/10): igual a la v1 salvo la Amarok
Hero (+$14 costo / +$16 lista, igualada a la Extreme). Trae ademas el T-Cross MY27 (C118):
NO se carga mientras el stock sea MY26 -- ver nota en reference_vw_lista_precios_formato.
Antes: 2026-10 lista #898 (circular 113, vig. 03/10), Excel. Vento GLI: MY26.
Octubre: PKW sin cambios salvo Nivus Comfortline/Highline/Outfit, que bajan lista y
costo por el wholesale que pasa a la lista (circular 112/26). Amarok Trendline +0,80%,
V6 +0,30%, 4x2 TDI igual. Reemplaza la provisoria lista_num=202610.
Anterior: 2026-09 lista #897 (circular 98).
Septiembre: PKW y Saveiro +1,50%, Amarok CONGELADA salvo Trendline 4x2 MT +1,00%
(coincide al peso con lo que adelanto el zonal). Alta: Amarok Unlimited V6 AT 4x4
G2 MY27 (AGDD8A), sin unidades en Oversoft.
"""
import json, urllib.request, sys

EXEC = "https://script.google.com/macros/s/AKfycby13NRmtve2ojB0IMZgFPnKh3HsLSBLDca4kOduRenO97KLH3W3ILbiJfDzGYVLAUpwpQ/exec"
# Token de SERVIDOR del Apps Script: vive en C:\proyectos\.secrets\gestion.env (fuera
# del repo, que es publico). El viejo tga-gestion-... quedo muerto el 18-sep-2026.
TOKEN = [l.split("=", 1)[1].strip() for l in open(r"C:\proyectos\.secrets\gestion.env", encoding="utf-8")
         if l.startswith("GESTION_SERVER_TOKEN=")][0]
MES, LISTA_NUM, MES_ANT = "2026-11", 900, "2026-10"

# (cod, desc_pdf, my, neto_conc, neto_sug) — PREC.NETO noviembre, lista #900 (Excel, C130)
NOV = [
 ("AGDD8A","Amarok Black Style V6 AT 4x4 SE G2","25/26/27",79864343.00,94179650.00),
 ("AGDB3X","Amarok Comfortline TDI AT 4x2 SE G2","25/26/27",54156672.00,63864000.00),
 ("AGDB33","Amarok Comfortline TDI MT 4x2 SE G2","25/26/27",50767089.00,59866850.00),
 ("AGDB8A","Amarok Comfortline V6 AT 4x4 G2","25/26/27",62658042.00,73889200.00),
 ("AGDD8A","Amarok Extreme V6 AT 4x4 G2","25/26/27",79007100.00,93168750.00),
 ("AGDD8A","Amarok Hero V6 AT 4x4 G2","25/26/27",79007100.00,93168750.00),
 ("AGDC3X","Amarok Highline TDI AT 4x2 SE G2","25/26/27",60047855.00,70811150.00),
 ("AGDC33","Amarok Highline TDI MT 4x2 G2","-",54472170.00,64236050.00),   # NO figura en la #900 (sin stock): queda el precio de la #898
 ("AGDC8A","Amarok Highline V6 AT 4x4 G2","25/26/27",73852532.00,87090250.00),
 ("AGDA43","Amarok Trendline TDI MT 4x2 G2","25/26/27",45056826.00,53133050.00),
 ("AGDA34","Amarok Trendline TDI MT 4x4 G2","25/26/27",53171338.00,62702050.00),
 ("AGDD8A","Amarok Unlimited V6 AT 4x4 G2","27",80291693.00,94683600.00),
 ("CH23R4","Nivus 170TSI MT","26",38711550.00,45543000.00),
 ("CH23K3","Nivus Comfortline 200TSI AT","26/27",42443900.00,49934000.00),
 ("CH24K3","Nivus Highline 200TSI AT","26/27",45829578.00,53917150.00),
 ("CH24K3","Nivus Outfit 200TSI AT","26/27",46882558.00,55155950.00),
 ("CH21R4","Nivus Sense 170TSI MT","27",29728708.00,34974950.00),
 ("CH22K3","Nivus Trendline 200TSI AT","26/27",41297335.00,48585100.00),
 ("BZ32D3","Polo COMFORTLINE 170TSI AT","26",39095962.00,45995250.00),
 ("BZ33D3","Polo HIGHLINE 170TSI AT","26",42287883.00,49750450.00),
 ("BZ3RT4","Polo Robust MSI MT","26",26425076.00,30373650.00),
 ("BZ31T4","Polo Track MSI MT","26",34346730.00,39479000.00),
 ("BZ31T4","Polo Track MSI MT + PNT","26",34346730.00,39479000.00),
 ("5UKWT4","Saveiro Comfortline CD MSI MT","26/27",31033160.00,36509600.00),
 ("5UK8T4","Saveiro Extreme CD MSI MT","26/27",34416968.00,40490550.00),
 ("5URTT4","Saveiro Trendline CS MSI MT","26/27",28160925.00,33130500.00),
 ("BF33K3","T-Cross Comfortline 200TSI AT","26",51572518.00,60673550.00),
 ("BF3XK3","T-Cross Extreme 200TSI AT","26",58356240.00,68654400.00),
 ("BF34K3","T-Cross Highline 200TSI AT","26",56925520.00,66971200.00),
 ("BF34K3","T-Cross Highline Bi Tono 200TSI AT","26",57887338.00,68102750.00),
 ("BF3PD4","T-Cross Sense 170TSI MT","26",33867825.00,39844500.00),
 ("BF32D4","T-Cross Trendline 170TSI MT","-",45121570.00,53084200.00),   # NO figura en la #900 (sin stock): queda el precio de la #898
 ("BF32K3","T-Cross Trendline 200TSI AT","26",47681515.00,56095900.00),
 ("CL23LZ","Taos Comfortline 250TSI AT","26",51372512.00,60438250.00),
 ("CL24LZ","Taos Highline 250TSI AT","26",58481190.00,68801400.00),
 ("CL24LZ","Taos Highline Bi Tono 250TSI AT","26",59239560.00,69693600.00),
 ("DF13D3","Tera Comfort 170TSI AT","26",37125025.00,43676500.00),
 ("DF13D3","Tera Comfort 170TSI AT + Pack Safe II","26",38028864.00,44739840.00),
 ("DF14D3","Tera High 170TSI AT","26",40740542.00,47930050.00),
 ("DF14D3","Tera Outfit 170TSI AT","26",41757398.00,49126350.00),
 ("DF11T4","Tera Trend MSI MT","26",32831590.00,38625400.00),
 ("DF11T4","Tera Trend MSI MT + Pack Safe I","26",33377285.00,39267394.00),
 ("RM13M7","Tiguan Life 250TSI DSG","-",68948260.00,81115600.00),   # NO figura en la #900 (sin stock): queda el precio de la #898
 ("RM14M7","Tiguan R-Line 250TSI DSG","25/26",72931827.00,85802150.00),
 ("BU59UZ","Vento GLI 350TSI DSG","26",64980332.00,76447450.00),
 ("BZ47NY","Virtus Exclusive 250TSI AT","26",43472825.00,51144500.00),
 ("BZ44D3","Virtus Highline 170TSI AT","26",37846080.00,44524800.00),
 ("BZ42T4","Virtus MSI MT","-",31174090.00,36675400.00),   # NO figura en la #900 (sin stock): queda el precio de la #898
 ("BZ4ET4","Virtus Sense MSI MT","26",30065988.00,35371750.00),
 ("BZ42D3","Virtus Trendline 170TSI AT","26",33358718.00,39245550.00),
]
JUL = NOV   # nombre historico que usa el resto del script

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

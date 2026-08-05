# -*- coding: utf-8 -*-
"""PLANTILLA mensual: carga precios_lista via Web App setprecioslista y concilia.
Cada mes: reemplazar el bloque JUL con las filas de la lista nueva (PREC.NETO
concesionario y sugerido, validados con (S/IMP-INCENT)*IVA: 21% autos, 10,5%
Saveiro/Amarok) y actualizar mes/listaNum del body. Dry-run primero; --go aplica.
Circuito completo: skill circular-vw (C:\\proyectos\\.claude\\skills).

Ultima corrida: 2026-08 lista #895 (circular 88). Vento GLI: MY26 (criterio de julio).
Agosto: TODO +1,00% salvo la Amarok, congelada al peso (S/IMP e INCENT identicos a
julio). Alta: Polo Robust MSI MT (BZ3RT4), modelo nuevo sin incentivos."""
import json, urllib.request, sys

EXEC = "https://script.google.com/macros/s/AKfycby13NRmtve2ojB0IMZgFPnKh3HsLSBLDca4kOduRenO97KLH3W3ILbiJfDzGYVLAUpwpQ/exec"
TOKEN = "tga-gestion-R7nQ4xK8jL"
MES, LISTA_NUM, MES_ANT = "2026-08", 895, "2026-07"

# (cod, desc_pdf, my, neto_conc, neto_sug) — PREC.NETO agosto, lista #895
AGO = [
 ("BZ3RT4","Polo Robust MSI MT","26",25905033.00,29775900.00),   # ALTA agosto
 ("BZ31T4","Polo Track MSI MT","26",33670783.50,38702050.00),
 ("BZ32D3","Polo COMFORTLINE 170TSI AT","26",38326542.50,45090050.00),
 ("BZ33D3","Polo HIGHLINE 170TSI AT","26",41455690.00,48771400.00),
 ("DF11T4","Tera Trend MSI MT","26",32185462.50,37865250.00),
 ("DF13D3","Tera Comfort 170TSI AT","26",36394407.50,42816950.00),
 ("DF14D3","Tera High 170TSI AT","26",39938780.00,46986800.00),
 ("DF14D3","Tera Outfit 170TSI AT","26",40935617.50,48159550.00),
 ("DF11T4","Tera Trend MSI MT + Pack Safe I","26",32720452.50,38494650.00),
 ("DF13D3","Tera Comfort 170TSI AT + Pack Safe II","26",37280447.50,43859350.00),
 ("BZ4ET4","Virtus Sense MSI MT","26",29474260.00,34675600.00),
 ("BZ42T4","Virtus MSI MT","26",30713390.00,36133400.00),
 ("BZ42D3","Virtus Trendline 170TSI AT","26",32702220.00,38473200.00),
 ("BZ44D3","Virtus Highline 170TSI AT","26",37101267.50,43648550.00),
 ("BZ47NY","Virtus Exclusive 250TSI AT","26",42617300.00,50138000.00),
 ("CH21R4","Nivus Sense 170TSI MT","27",29143652.50,34286650.00),
 ("CH23R4","Nivus 170TSI MT","26",38139457.50,44869950.00),
 ("CH22K3","Nivus Trendline 200TSI AT","26/27",40484607.50,47628950.00),
 ("CH23K3","Nivus Comfortline 200TSI AT","26/27",42832392.50,50391050.00),
 ("CH24K3","Nivus Highline 200TSI AT","26/27",46249052.50,54410650.00),
 ("CH24K3","Nivus Outfit 200TSI AT","26/27",47311680.00,55660800.00),
 ("BF3PD4","T-Cross Sense 170TSI MT","26",33201297.50,39060350.00),
 ("BF32D4","T-Cross Trendline 170TSI MT","26",44454745.00,52299700.00),
 ("BF32K3","T-Cross Trendline 200TSI AT","26",46743115.00,54991900.00),
 ("BF33K3","T-Cross Comfortline 200TSI AT","26",50557575.00,59479500.00),
 ("BF34K3","T-Cross Highline 200TSI AT","26",55805220.00,65653200.00),
 ("BF34K3","T-Cross Highline Bi Tono 200TSI AT","26",56748125.00,66762500.00),
 ("BF3XK3","T-Cross Extreme 200TSI AT","26",57207805.00,67303300.00),
 ("CL23LZ","Taos Comfortline 250TSI AT","26",50361480.00,59248800.00),
 ("CL24LZ","Taos Highline 250TSI AT","26",57330290.00,67447400.00),
 ("CL24LZ","Taos Highline Bi Tono 250TSI AT","26",58073700.00,68322000.00),
 ("BU59UZ","Vento GLI 350TSI DSG","26",63701507.50,74942950.00),   # MY26 (criterio julio); MY25 seria 63.290.320/74.459.200
 ("RM13M7","Tiguan Life 250TSI DSG","25",67929322.50,79916850.00),
 ("RM14M7","Tiguan R-Line 250TSI DSG","25/26",71496517.50,84113550.00),
 ("5URTT4","Saveiro Trendline CS MSI MT","26/27",27606682.50,32478450.00),
 ("5UKWT4","Saveiro Comfortline CD MSI MT","26/27",30422435.00,35791100.00),
 ("5UK8T4","Saveiro Extreme CD MSI MT","26/27",33739645.00,39693700.00),
 # Amarok: CONGELADA — mismos valores que julio, al peso.
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
JUL = AGO   # nombre historico que usa el resto del script

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

# -*- coding: utf-8 -*-
"""PLANTILLA mensual: carga la tabla incentivos (wjfgl) desde la circular de
Condiciones Comerciales. Cada mes: reescribir CIRC y el bloque de datos con la
circular nueva; dry-run y --go (delete+insert del mes + verificacion count/sum).
Criterios fijos: montos TEXTUALES de la circular (no recalcular IVA); variantes
"+ Pack Safe" heredan del modelo base; nombres Amarok = variante ACTIVA del
catalogo (SE); tramos performance distintos de 90/100 se anotan en condicion;
filas en $0 no se cargan.
Circuito completo: skill circular-vw (C:\\proyectos\\.claude\\skills).

Ultima corrida: 2026-07 circular 80/26 (whosale +2% salvo T-Cross Bi-Tono congelado;
performance pierde Nivus High/Outfit; tramos 50/80 anotados en condicion)."""
import json, urllib.request, sys

CIRC = "80/26"
R = []
def add(codigo, nombre, tipo, siva, civa, cond):
    R.append((codigo, nombre, tipo, siva, civa, cond))

T50 = "50% objetivo"
# ---------------- TACTICO ----------------
add("BZ31T4","Polo Track MSI MT","tactico",4131617,4999257,T50)
add("BZ32D3","Polo COMFORTLINE 170TSI AT","tactico",1982767,2399148,T50)
add("BZ33D3","Polo HIGHLINE 170TSI AT","tactico",425837,515263,T50)
add("DF11T4","Tera Trend MSI MT","tactico",526860,637500,T50)
add("DF11T4","Tera Trend MSI MT + Pack Safe I","tactico",526860,637500,T50)
add("CH23R4","Nivus 170TSI MT","tactico",4863160,5884424,T50)
add("CH22K3","Nivus Trendline 200TSI AT","tactico",4959511,6001008,T50)
add("CH23K3","Nivus Comfortline 200TSI AT","tactico",3463117,4190372,T50)
add("CH24K3","Nivus Highline 200TSI AT","tactico",3599273,4355120,T50)
add("CH24K3","Nivus Outfit 200TSI AT","tactico",3699932,4476917,T50)
add("BF32D4","T-Cross Trendline 170TSI MT","tactico",6721099,8132530,T50)
add("BF32K3","T-Cross Trendline 200TSI AT","tactico",6816460,8247917,T50)
add("BF33K3","T-Cross Comfortline 200TSI AT","tactico",7882101,9537343,T50)
add("BF34K3","T-Cross Highline 200TSI AT","tactico",8791255,10637419,T50)
add("BF34K3","T-Cross Highline Bi Tono 200TSI AT","tactico",8791255,10637419,T50)
add("BF3XK3","T-Cross Extreme 200TSI AT","tactico",8837293,10693125,T50)
add("CL23LZ","Taos Comfortline 250TSI AT","tactico",3863636,4675000,T50)
add("CL24LZ","Taos Highline 250TSI AT","tactico",4917355,5950000,T50)
add("CL24LZ","Taos Highline Bi Tono 250TSI AT","tactico",4917355,5950000,T50)
# Amarok: facturadas desde lista 887 (05/05/26); historicas nov-abr van por Circ.40
AMK = "50% objetivo · fact. desde lista 887"
add("AGDA43","Amarok Trendline TDI MT 4x2 G2","tactico",1611584,1780800,AMK)
add("AGDA34","Amarok Trendline TDI MT 4x4 G2","tactico",1827827,2019749,AMK)
add("AGDB33","Amarok Comfortline TDI MT 4x2 SE G2","tactico",1611584,1780800,AMK)
add("AGDB3X","Amarok Comfortline TDI AT 4x2 SE G2","tactico",3204568,3541048,AMK)
add("AGDC33","Amarok Highline TDI MT 4x2 G2","tactico",3362082,3715101,AMK)
add("AGDC3X","Amarok Highline TDI AT 4x2 SE G2","tactico",3754720,4148965,AMK)
add("AGDB8A","Amarok Comfortline V6 AT 4x4 G2","tactico",6108858,6750288,AMK)
add("AGDC8A","Amarok Highline V6 AT 4x4 G2","tactico",6713755,7418700,AMK)
add("AGDD8A","Amarok Extreme V6 AT 4x4 G2","tactico",6930534,7658240,AMK)
add("AGDD8A","Amarok Hero V6 AT 4x4 G2","tactico",6930534,7658240,AMK)
add("AGDD8A","Amarok Black Style V6 AT 4x4 SE G2","tactico",6173638,6821870,AMK)
# ---------------- ADICIONAL2 (tactico Tiguan/Vento) ----------------
add("RM14M7","Tiguan R-Line 250TSI DSG","adicional2",3951418,4781216,"tactico tiguan/vento")
add("BU59UZ","Vento GLI 350TSI DSG","adicional2",5748043,6955132,"tactico tiguan/vento")
# ---------------- WHOSALE ----------------
W = "compra whosale"
add("BZ31T4","Polo Track MSI MT","whosale",1144276,1384574,W)
add("BZ32D3","Polo COMFORTLINE 170TSI AT","whosale",1307482,1582053,W)
add("BZ33D3","Polo HIGHLINE 170TSI AT","whosale",1389335,1681095,W)
add("BF32D4","T-Cross Trendline 170TSI MT","whosale",1396564,1689842,W)
add("BF32K3","T-Cross Trendline 200TSI AT","whosale",1467898,1776157,W)
add("BF33K3","T-Cross Comfortline 200TSI AT","whosale",1586802,1920030,W)
add("BF34K3","T-Cross Highline 200TSI AT","whosale",1750380,2117960,W)
add("BF34K3","T-Cross Highline Bi Tono 200TSI AT","whosale",1714955,2075096,W)  # sin +2%, tal cual circular
add("BF3XK3","T-Cross Extreme 200TSI AT","whosale",1783280,2157768,W)
add("DF11T4","Tera Trend MSI MT","whosale",501642,606987,W)
add("DF11T4","Tera Trend MSI MT + Pack Safe I","whosale",501642,606987,W)
add("DF13D3","Tera Comfort 170TSI AT","whosale",567242,686363,W)
add("DF13D3","Tera Comfort 170TSI AT + Pack Safe II","whosale",567242,686363,W)
add("CH23K3","Nivus Comfortline 200TSI AT","whosale",1001377,1211666,W)
add("CH24K3","Nivus Highline 200TSI AT","whosale",1081255,1308319,W)
add("CH24K3","Nivus Outfit 200TSI AT","whosale",1106097,1338377,W)
# ---------------- ADICIONAL1 (incremental Polo/Tera/Nivus, sin cambios) ----------------
S = "sin condición"
add("BZ31T4","Polo Track MSI MT","adicional1",1078512,1305000,S)
add("BZ32D3","Polo COMFORTLINE 170TSI AT","adicional1",2458678,2975000,S)
add("BZ33D3","Polo HIGHLINE 170TSI AT","adicional1",2458678,2975000,S)
add("DF11T4","Tera Trend MSI MT","adicional1",1404959,1700000,S)
add("DF11T4","Tera Trend MSI MT + Pack Safe I","adicional1",1404959,1700000,S)
add("DF13D3","Tera Comfort 170TSI AT","adicional1",1404959,1700000,S)
add("DF13D3","Tera Comfort 170TSI AT + Pack Safe II","adicional1",1404959,1700000,S)
add("DF14D3","Tera High 170TSI AT","adicional1",1404959,1700000,S)
add("DF14D3","Tera Outfit 170TSI AT","adicional1",1404959,1700000,S)
add("CH23R4","Nivus 170TSI MT","adicional1",1404959,1700000,S)
add("CH22K3","Nivus Trendline 200TSI AT","adicional1",1404959,1700000,S)
add("CH23K3","Nivus Comfortline 200TSI AT","adicional1",1404959,1700000,S)
add("CH24K3","Nivus Highline 200TSI AT","adicional1",1404959,1700000,S)
add("CH24K3","Nivus Outfit 200TSI AT","adicional1",1404959,1700000,S)
# ---------------- PERFORMANCE (90%) y PERFORMANCE100 ----------------
# Julio: tramos nuevos 50/80 para AGDA43, AGDC3X, BZ31T4, DF11T4 (mismo monto) -> se anota en condicion.
# CH24K3 (Nivus High/Outfit) SALE del performance en julio. AGDC33 y AGDB8A en 0 -> no se cargan.
P90D50 = "90% objetivo (cobra desde 50%)"
P100D50 = "100% objetivo (cobra desde 50%)"
P90, P100 = "90% objetivo", "100% objetivo"
add("AGDA43","Amarok Trendline TDI MT 4x2 G2","performance",2600000,2873000,P90D50)
add("AGDA43","Amarok Trendline TDI MT 4x2 G2","performance100",2600000,2873000,P100D50)
add("AGDB3X","Amarok Comfortline TDI AT 4x2 SE G2","performance",900000,994500,P90)
add("AGDB3X","Amarok Comfortline TDI AT 4x2 SE G2","performance100",1000000,1105000,P100)
add("AGDC3X","Amarok Highline TDI AT 4x2 SE G2","performance",2200000,2431000,P90D50)
add("AGDC3X","Amarok Highline TDI AT 4x2 SE G2","performance100",2200000,2431000,P100D50)
add("AGDC8A","Amarok Highline V6 AT 4x4 G2","performance",1350000,1491750,P90)
add("AGDC8A","Amarok Highline V6 AT 4x4 G2","performance100",1500000,1657500,P100)
add("AGDD8A","Amarok Hero V6 AT 4x4 G2","performance",1440000,1591200,P90)
add("AGDD8A","Amarok Hero V6 AT 4x4 G2","performance100",1600000,1768000,P100)
add("AGDD8A","Amarok Extreme V6 AT 4x4 G2","performance",1350000,1491750,P90)
add("AGDD8A","Amarok Extreme V6 AT 4x4 G2","performance100",1500000,1657500,P100)
add("AGDD8A","Amarok Black Style V6 AT 4x4 SE G2","performance",1080000,1193400,P90)
add("AGDD8A","Amarok Black Style V6 AT 4x4 SE G2","performance100",1200000,1326000,P100)
add("BZ31T4","Polo Track MSI MT","performance",1000000,1210000,P90D50)
add("BZ31T4","Polo Track MSI MT","performance100",1000000,1210000,P100D50)
add("DF11T4","Tera Trend MSI MT","performance",1000000,1210000,P90D50)
add("DF11T4","Tera Trend MSI MT","performance100",1000000,1210000,P100D50)
add("DF11T4","Tera Trend MSI MT + Pack Safe I","performance",1000000,1210000,P90D50)
add("DF11T4","Tera Trend MSI MT + Pack Safe I","performance100",1000000,1210000,P100D50)

print("filas julio: %d" % len(R))
from collections import Counter
print(dict(Counter(t for _,_,t,_,_,_ in R)))
if "--go" not in sys.argv:
    print("(dry-run; --go para cargar)"); sys.exit(0)

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

vals = ",".join("('2026-07','%s','%s','%s',%d,%d,'%s','%s')" %
                (c, n.replace("'", "''"), t, s, v, cond.replace("'", "''"), CIRC)
                for c, n, t, s, v, cond in R)
sql("delete from incentivos where mes='2026-07'")
sql("insert into incentivos (mes,codigo,nombre_corto,tipo,monto_siva,monto_civa,condicion,circular) values " + vals)

# verificacion
chk = sql("select tipo, count(*) as n, sum(monto_siva)::bigint as total from incentivos where mes='2026-07' group by tipo order by tipo")
print("DB 2026-07:", chk)
esp = {}
tot = {}
for _, _, t, s, _, _ in R:
    esp[t] = esp.get(t, 0) + 1; tot[t] = tot.get(t, 0) + s
okall = True
for row in chk:
    if esp.get(row["tipo"]) != row["n"] or tot.get(row["tipo"]) != int(row["total"]):
        okall = False; print("  MISMATCH", row["tipo"])
print("verificacion:", "OK todo" if okall and len(chk) == len(esp) else "REVISAR")

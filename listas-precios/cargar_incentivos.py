# -*- coding: utf-8 -*-
"""PLANTILLA mensual: carga la tabla incentivos (wjfgl) desde la circular de
Condiciones Comerciales. Cada mes: reescribir CIRC y el bloque de datos con la
circular nueva; dry-run y --go (delete+insert del mes + verificacion count/sum).
Criterios fijos: montos TEXTUALES de la circular (no recalcular IVA); variantes
"+ Pack Safe" heredan del modelo base; nombres Amarok = variante ACTIVA del
catalogo (SE); tramos performance distintos de 90/100 se anotan en condicion;
filas en $0 no se cargan.
Circuito completo: skill circular-vw (C:\\proyectos\\.claude\\skills).

Ultima corrida: 2026-08 circular 89/26 (Fe de Erratas, es la circular completa).
Agosto NO cambio un peso vs julio: VW CONSOLIDO el "tactico incremental Polo/Tera/
Nivus" (lo que cargabamos como adicional1) DENTRO del tactico -> tactico agosto =
tactico julio + incremental julio, verificado modelo por modelo. Por eso este mes
NO se carga adicional1. Unico cambio real: whosale +1,00% en los 14 (ahora si
incluye el T-Cross Bi-Tono, que en julio habia quedado congelado)."""
import json, urllib.request, sys

CIRC = "89/26"
MES = "2026-08"
R = []
def add(codigo, nombre, tipo, siva, civa, cond):
    R.append((codigo, nombre, tipo, siva, civa, cond))

T50 = "50% objetivo"
# ---------------- TACTICO (ya incluye el ex-"incremental" de julio) ----------------
add("BZ31T4","Polo Track MSI MT","tactico",5210129,6304256,T50)
add("BZ32D3","Polo COMFORTLINE 170TSI AT","tactico",4441445,5374149,T50)
add("BZ33D3","Polo HIGHLINE 170TSI AT","tactico",2884515,3490263,T50)
add("DF11T4","Tera Trend MSI MT","tactico",1931819,2337500,T50)
add("DF11T4","Tera Trend MSI MT + Pack Safe I","tactico",1931819,2337500,T50)
add("DF13D3","Tera Comfort 170TSI AT","tactico",1404959,1700000,T50)
add("DF13D3","Tera Comfort 170TSI AT + Pack Safe II","tactico",1404959,1700000,T50)
add("DF14D3","Tera High 170TSI AT","tactico",1404959,1700000,T50)
add("DF14D3","Tera Outfit 170TSI AT","tactico",1404959,1700000,T50)
add("CH23R4","Nivus 170TSI MT","tactico",6268119,7584424,T50)
add("CH22K3","Nivus Trendline 200TSI AT","tactico",6364470,7701008,T50)
add("CH23K3","Nivus Comfortline 200TSI AT","tactico",4868076,5890372,T50)
add("CH24K3","Nivus Highline 200TSI AT","tactico",5004232,6055120,T50)
add("CH24K3","Nivus Outfit 200TSI AT","tactico",5104891,6176917,T50)
# CH21R4 Nivus Sense figura en la circular en $0 -> no se carga.
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
add("BZ31T4","Polo Track MSI MT","whosale",1155719,1398420,W)
add("BZ32D3","Polo COMFORTLINE 170TSI AT","whosale",1320557,1597874,W)
add("BZ33D3","Polo HIGHLINE 170TSI AT","whosale",1403228,1697906,W)
add("BF32D4","T-Cross Trendline 170TSI MT","whosale",1410530,1706741,W)
add("BF32K3","T-Cross Trendline 200TSI AT","whosale",1482577,1793918,W)
add("BF33K3","T-Cross Comfortline 200TSI AT","whosale",1602670,1939231,W)
add("BF34K3","T-Cross Highline 200TSI AT","whosale",1767884,2139139,W)
add("BF34K3","T-Cross Highline Bi Tono 200TSI AT","whosale",1732105,2095847,W)  # agosto SI le dio el +1%
add("BF3XK3","T-Cross Extreme 200TSI AT","whosale",1801113,2179346,W)
add("DF11T4","Tera Trend MSI MT","whosale",506658,613057,W)
add("DF11T4","Tera Trend MSI MT + Pack Safe I","whosale",506658,613057,W)
add("DF13D3","Tera Comfort 170TSI AT","whosale",572914,693226,W)
add("DF13D3","Tera Comfort 170TSI AT + Pack Safe II","whosale",572914,693226,W)
add("CH23K3","Nivus Comfortline 200TSI AT","whosale",1011391,1223783,W)
add("CH24K3","Nivus Highline 200TSI AT","whosale",1092068,1321402,W)
add("CH24K3","Nivus Outfit 200TSI AT","whosale",1117158,1351761,W)
# ---------------- ADICIONAL1: NO EXISTE EN AGOSTO ----------------
# La circular 89/26 elimino la seccion "Incentivo Tactico Incremental Polo, Tera,
# Nivus" y sumo esos montos DENTRO del tactico (verificado al peso). Cargarlo
# aparte seria contarlo dos veces: el motor suma tactico+whosale+adicional1+
# adicional2+cupo.
# ---------------- PERFORMANCE (90%) y PERFORMANCE100 ----------------
# Identico a julio. AGDC33 y AGDB8A ya no figuran (en julio estaban en 0).
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

print("filas %s: %d" % (MES, len(R)))
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

vals = ",".join("('%s','%s','%s','%s',%d,%d,'%s','%s')" %
                (MES, c, n.replace("'", "''"), t, s, v, cond.replace("'", "''"), CIRC)
                for c, n, t, s, v, cond in R)
sql("delete from incentivos where mes='%s'" % MES)
sql("insert into incentivos (mes,codigo,nombre_corto,tipo,monto_siva,monto_civa,condicion,circular) values " + vals)

# verificacion
chk = sql("select tipo, count(*) as n, sum(monto_siva)::bigint as total from incentivos where mes='%s' group by tipo order by tipo" % MES)
print("DB %s:" % MES, chk)
esp = {}
tot = {}
for _, _, t, s, _, _ in R:
    esp[t] = esp.get(t, 0) + 1; tot[t] = tot.get(t, 0) + s
okall = True
for row in chk:
    if esp.get(row["tipo"]) != row["n"] or tot.get(row["tipo"]) != int(row["total"]):
        okall = False; print("  MISMATCH", row["tipo"])
print("verificacion:", "OK todo" if okall and len(chk) == len(esp) else "REVISAR")

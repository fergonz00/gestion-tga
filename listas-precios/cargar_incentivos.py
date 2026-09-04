# -*- coding: utf-8 -*-
"""PLANTILLA mensual: carga la tabla incentivos (wjfgl) desde la circular de
Condiciones Comerciales. Cada mes: reescribir CIRC y el bloque de datos con la
circular nueva; dry-run y --go (delete+insert del mes + verificacion count/sum).
Criterios fijos: montos TEXTUALES de la circular (no recalcular IVA); variantes
"+ Pack Safe" heredan del modelo base; nombres Amarok = variante ACTIVA del
catalogo (SE); tramos performance distintos de 90/100 se anotan en condicion;
filas en $0 no se cargan.
Circuito completo: skill circular-vw (C:\\proyectos\\.claude\\skills).

Ultima corrida: 2026-09 circular 99/26. Tacticos, Tiguan/Vento y esquema trimestral
IDENTICOS a agosto al peso. Cambios reales del mes:
 - WHOLESALE +1,50% en los 14 (acompana la lista #897).
 - PERFORMANCE reacomodado en las Amarok 4x2: Trendline 4x2 se DERRUMBA de
   2.600.000 a 1.000.000; Comfortline AT 4x2 sube de 900.000 a 2.000.000; ALTA de
   Comfortline MT 4x2 (2.000.000, cobra desde el 80%); Highline AT 4x2 sube a
   3.200.000 con tramos propios 50%=2.200.000 y 80%=2.600.000. Los V6, el Polo
   Track y la Tera Trend no se movieron.
 - ALTA Amarok Unlimited V6 AT 4x4 G2: tactico = Extreme, performance = Black Style.
 - El performance viene como IMAGEN en el PDF (pag. 5) y SOLO sin IVA, asi que el
   c/IVA se calcula (21% autos, 10,5% Amarok), como se viene haciendo.
 - Regimen viejo Amarok (circ 40, facturadas 01/11/25-30/04/26): la circular lo
   repite y coincide 10/10 con lo cargado en 2026-04. ULTIMO MES: vence para
   patentamientos el 30/09/26.
 - Gastos: fletes autos +8,69%, medianos +4,35%, admin +1,1%, seguros y
   formularios 0%. Revisar si el FyF de $1.110.000 sigue cubriendo.
 - C67 (proteccion stock Virtus/Saveiro) extendida a patentamientos hasta 31/10/26.
"""
import json, urllib.request, sys

CIRC = "99/26"
MES = "2026-09"
R = []
def add(codigo, nombre, tipo, siva, civa, cond):
    R.append((codigo, nombre, tipo, siva, civa, cond))

T50 = "50% objetivo"
# ---------------- TACTICO (identico a agosto, al peso) ----------------
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
AMK = "50% objetivo - fact. desde lista 887"
add("AGDA43","Amarok Trendline TDI MT 4x2 G2","tactico",1611584,1780800,AMK)
add("AGDA34","Amarok Trendline TDI MT 4x4 G2","tactico",1827827,2019749,AMK)
add("AGDB33","Amarok Comfortline TDI MT 4x2 SE G2","tactico",1611584,1780800,AMK)
add("AGDB3X","Amarok Comfortline TDI AT 4x2 SE G2","tactico",3204568,3541048,AMK)
add("AGDC33","Amarok Highline TDI MT 4x2 G2","tactico",3362082,3715101,AMK)
add("AGDC3X","Amarok Highline TDI AT 4x2 SE G2","tactico",3754720,4148965,AMK)
add("AGDB8A","Amarok Comfortline V6 AT 4x4 G2","tactico",6108858,6750288,AMK)
add("AGDC8A","Amarok Highline V6 AT 4x4 G2","tactico",6713755,7418700,AMK)
add("AGDD8A","Amarok Extreme V6 AT 4x4 G2","tactico",6930534,7658240,AMK)
add("AGDD8A","Amarok Unlimited V6 AT 4x4 G2","tactico",6930534,7658240,AMK)   # ALTA sep
add("AGDD8A","Amarok Hero V6 AT 4x4 G2","tactico",6930534,7658240,AMK)
add("AGDD8A","Amarok Black Style V6 AT 4x4 SE G2","tactico",6173638,6821870,AMK)
# ---------------- ADICIONAL2 (tactico Tiguan/Vento) - identico a agosto -------
add("RM14M7","Tiguan R-Line 250TSI DSG","adicional2",3951418,4781216,"tactico tiguan/vento")
add("BU59UZ","Vento GLI 350TSI DSG","adicional2",5748043,6955132,"tactico tiguan/vento")
# ---------------- WHOSALE (+1,50% vs agosto, los 14 de la circular) ----------
W = "compra whosale"
add("BZ31T4","Polo Track MSI MT","whosale",1173055,1419396,W)
add("BZ32D3","Polo COMFORTLINE 170TSI AT","whosale",1340365,1621842,W)
add("BZ33D3","Polo HIGHLINE 170TSI AT","whosale",1424276,1723374,W)
add("BF32D4","T-Cross Trendline 170TSI MT","whosale",1431688,1732342,W)
add("BF32K3","T-Cross Trendline 200TSI AT","whosale",1504816,1820827,W)
add("BF33K3","T-Cross Comfortline 200TSI AT","whosale",1626710,1968319,W)
add("BF34K3","T-Cross Highline 200TSI AT","whosale",1794402,2171227,W)
add("BF34K3","T-Cross Highline Bi Tono 200TSI AT","whosale",1758087,2127285,W)
add("BF3XK3","T-Cross Extreme 200TSI AT","whosale",1828130,2212037,W)
add("DF11T4","Tera Trend MSI MT","whosale",514258,622252,W)
add("DF11T4","Tera Trend MSI MT + Pack Safe I","whosale",514258,622252,W)
add("DF13D3","Tera Comfort 170TSI AT","whosale",581508,703624,W)
add("DF13D3","Tera Comfort 170TSI AT + Pack Safe II","whosale",581508,703624,W)
add("CH23K3","Nivus Comfortline 200TSI AT","whosale",1026562,1242140,W)
add("CH24K3","Nivus Highline 200TSI AT","whosale",1108449,1341223,W)
add("CH24K3","Nivus Outfit 200TSI AT","whosale",1133915,1372038,W)
# ---------------- ADICIONAL1: SIGUE SIN EXISTIR ----------------
# Desde la circular 89/26 el "Incentivo Tactico Incremental Polo/Tera/Nivus" quedo
# consolidado DENTRO del tactico. Cargarlo aparte seria contarlo dos veces: el
# motor suma tactico+whosale+adicional1+adicional2+cupo.
# ---------------- PERFORMANCE (90%) y PERFORMANCE100 ----------------
# La tabla viene como IMAGEN y solo sin IVA -> el c/IVA se calcula (21% / 10,5%).
P90D50 = "90% objetivo (cobra desde 50%)"
P100D50 = "100% objetivo (cobra desde 50%)"
P90D80 = "90% objetivo (cobra desde 80%)"
P100D80 = "100% objetivo (cobra desde 80%)"
P90, P100 = "90% objetivo", "100% objetivo"
HI90 = "90% objetivo (tramos propios s/IVA: 50%=2.200.000, 80%=2.600.000)"
HI100 = "100% objetivo (tramos propios s/IVA: 50%=2.200.000, 80%=2.600.000)"
add("AGDA43","Amarok Trendline TDI MT 4x2 G2","performance",1000000,1105000,P90D50)
add("AGDA43","Amarok Trendline TDI MT 4x2 G2","performance100",1000000,1105000,P100D50)
add("AGDB3X","Amarok Comfortline TDI AT 4x2 SE G2","performance",2000000,2210000,P90D80)
add("AGDB3X","Amarok Comfortline TDI AT 4x2 SE G2","performance100",2000000,2210000,P100D80)
add("AGDB33","Amarok Comfortline TDI MT 4x2 SE G2","performance",2000000,2210000,P90D80)   # ALTA sep
add("AGDB33","Amarok Comfortline TDI MT 4x2 SE G2","performance100",2000000,2210000,P100D80)
add("AGDC3X","Amarok Highline TDI AT 4x2 SE G2","performance",3200000,3536000,HI90)
add("AGDC3X","Amarok Highline TDI AT 4x2 SE G2","performance100",3200000,3536000,HI100)
add("AGDC8A","Amarok Highline V6 AT 4x4 G2","performance",1350000,1491750,P90)
add("AGDC8A","Amarok Highline V6 AT 4x4 G2","performance100",1500000,1657500,P100)
add("AGDD8A","Amarok Hero V6 AT 4x4 G2","performance",1440000,1591200,P90)
add("AGDD8A","Amarok Hero V6 AT 4x4 G2","performance100",1600000,1768000,P100)
add("AGDD8A","Amarok Extreme V6 AT 4x4 G2","performance",1350000,1491750,P90)
add("AGDD8A","Amarok Extreme V6 AT 4x4 G2","performance100",1500000,1657500,P100)
add("AGDD8A","Amarok Black Style V6 AT 4x4 SE G2","performance",1080000,1193400,P90)
add("AGDD8A","Amarok Black Style V6 AT 4x4 SE G2","performance100",1200000,1326000,P100)
add("AGDD8A","Amarok Unlimited V6 AT 4x4 G2","performance",1080000,1193400,P90)            # ALTA sep
add("AGDD8A","Amarok Unlimited V6 AT 4x4 G2","performance100",1200000,1326000,P100)
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

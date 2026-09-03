# -*- coding: utf-8 -*-
"""Copia los incentivos de un mes al siguiente, tal cual, mientras VW no manda la
circular de Condiciones Comerciales nueva.

Septiembre 2026: el Gerente Zonal (Pablo Camacho, 3-sep) adelanto por WhatsApp
"Tacticos siguen igual". No hay circular todavia, asi que se replica 89/26 (agosto)
al peso -- NO se recalcula el whosale por el aumento de lista (en agosto VW lo
habia subido +1% junto con la lista, pero sin circular no se inventa el monto).

Es NECESARIO: apenas se carga precios_lista de un mes nuevo, el motor de gestion
pasa a buscar los incentivos de ESE mes; si no estan, los toma en 0 y todas las
ganancias se van a negativo.

Al llegar la circular real: reescribir cargar_incentivos.py con los montos nuevos
y correrlo con --go (hace delete+insert del mes, pisa esta copia).

Uso:  python copiar_incentivos_provisorio.py [--go]"""
import json, urllib.request, sys

MES_BASE, MES = "2026-08", "2026-09"
SUFIJO = " (prov.)"    # marca en la col circular: se copio, no salio circular

pat = None
for line in open(r"C:\proyectos\.secrets\supabase.env", encoding="utf8"):
    if line.startswith("SUPABASE_PAT=") and line.split("=", 1)[1].strip():
        pat = line.split("=", 1)[1].strip()

def sql(q):
    req = urllib.request.Request(
        "https://api.supabase.com/v1/projects/wjfglsafgaltusmbnccl/database/query",
        data=json.dumps({"query": q}).encode(),
        headers={"Authorization": "Bearer " + pat, "Content-Type": "application/json",
                 "User-Agent": "Mozilla/5.0"})
    return json.load(urllib.request.urlopen(req))

base = sql("select tipo, count(*) n, sum(monto_civa)::bigint s from incentivos "
           "where mes='%s' group by 1 order by 1" % MES_BASE)
print("origen %s:" % MES_BASE)
for r in base:
    print("  %-15s %3d filas  suma c/IVA %s" % (r["tipo"], r["n"], format(r["s"], ",")))
print("  TOTAL %d filas" % sum(r["n"] for r in base))

ya = sql("select count(*) n from incentivos where mes='%s'" % MES)[0]["n"]
print("destino %s: %d filas hoy" % (MES, ya))

if "--go" not in sys.argv:
    print("\n(dry-run; --go para copiar)"); sys.exit(0)

sql("delete from incentivos where mes = '%s'" % MES)
sql("""insert into incentivos (mes, codigo, nombre_corto, tipo, monto_siva, monto_civa,
                               condicion, circular, vigencia_desde, vigencia_hasta)
       select '%s', codigo, nombre_corto, tipo, monto_siva, monto_civa, condicion,
              circular || '%s', vigencia_desde, vigencia_hasta
       from incentivos where mes = '%s'""" % (MES, SUFIJO, MES_BASE))

chk = sql("""select tipo, count(*) n, sum(monto_civa)::bigint s from incentivos
             where mes='%s' group by 1 order by 1""" % MES)
print("\n=== %s cargado ===" % MES)
okall = True
bmap = {r["tipo"]: r for r in base}
for r in chk:
    b = bmap.get(r["tipo"])
    ok = b and b["n"] == r["n"] and b["s"] == r["s"]
    okall &= bool(ok)
    print("  %-15s %3d filas  suma c/IVA %-18s %s" % (r["tipo"], r["n"], format(r["s"], ","), "OK" if ok else "DIFIERE"))
print("conciliacion:", "TODO OK" if okall and len(chk) == len(base) else "REVISAR")

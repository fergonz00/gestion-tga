# -*- coding: utf-8 -*-
"""Carga una lista PROVISORIA derivada del mes anterior aplicando los aumentos
que pasa el Gerente Zonal por WhatsApp, mientras VW no manda la lista oficial.

Septiembre 2026 (Pablo Camacho, 3-sep, 14:40):
    PKW 1,5%  ·  Amarok 0% (salvo Trendline 4x2 MT, 1%)  ·  Tacticos siguen igual
    Saveiro va 1,5% como el resto (confirmado por Fer, no lo aclaraba el zonal).

Toma precios_lista del MES_BASE, aplica el % por modelo y sube el resultado con
la misma accion setprecioslista de siempre. lista_num = AAAAMM (marca de
provisorio; las listas reales de VW son de 3 digitos). Cuando llegue la lista
oficial se recarga con cargar_precios_lista.py y el lista_num real, y esta queda
pisada por el upsert (mismo mes, otro lista_num -> ojo, ver nota abajo).

NOTA: el upsert es por (lista_num, modelo). Al cargar la lista real hay que
BORRAR primero las filas provisorias del mes:
    delete from precios_lista where mes='2026-09' and lista_num=202609;

Uso:  python cargar_precios_provisorio.py            # dry-run
      python cargar_precios_provisorio.py --go       # aplica
Circuito completo: skill circular-vw."""
import json, urllib.request, sys, re

EXEC = "https://script.google.com/macros/s/AKfycby13NRmtve2ojB0IMZgFPnKh3HsLSBLDca4kOduRenO97KLH3W3ILbiJfDzGYVLAUpwpQ/exec"
TOKEN = "tga-gestion-R7nQ4xK8jL"
MES_BASE, MES, LISTA_NUM = "2026-08", "2026-09", 202609

def aumento(nombre_corto):
    """% de aumento de septiembre-26 segun el zonal."""
    n = nombre_corto.lower()
    if n.startswith("amarok"):
        return 0.01 if "trendline tdi mt 4x2" in n else 0.0
    return 0.015   # PKW + Saveiro

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

base = sql("select modelo, codigo, precio_lista::bigint l, costo_concesionario::bigint c "
           "from precios_lista where mes = '%s' order by modelo" % MES_BASE)
cat = sql("select nombre_corto, codigo from catalogo_modelos where activo = true order by orden nulls last")

basemap = {r["modelo"]: r for r in base}
filas, sin_match = [], []
for r in cat:
    b = basemap.get(r["nombre_corto"])
    if not b:
        sin_match.append(r["nombre_corto"]); continue
    p = aumento(r["nombre_corto"])
    filas.append({"modelo": r["nombre_corto"], "codigo": r["codigo"],
                  "precioLista": round(b["l"] * (1 + p)), "costo": round(b["c"] * (1 + p)),
                  "_pct": p, "_l0": b["l"], "_c0": b["c"]})

print("base %s: %d filas · catalogo activo: %d · a cargar: %d" % (MES_BASE, len(base), len(cat), len(filas)))
if sin_match:
    print("MODELO ACTIVO SIN PRECIO EN %s (no se carga):" % MES_BASE, sin_match); sys.exit(1)

for f in sorted(filas, key=lambda f: f["modelo"]):
    print("  %-40s %+5.1f%%  lista %13s -> %13s   costo %13s -> %13s" % (
        f["modelo"], f["_pct"] * 100, format(f["_l0"], ","), format(f["precioLista"], ","),
        format(f["_c0"], ","), format(f["costo"], ",")))

if "--go" not in sys.argv:
    print("\n(dry-run; correr con --go para cargar)"); sys.exit(0)

body = {"token": TOKEN, "accion": "setprecioslista", "mes": MES, "listaNum": LISTA_NUM,
        "filas": [{k: v for k, v in f.items() if not k.startswith("_")} for f in filas]}
resp = json.load(urllib.request.urlopen(urllib.request.Request(
    EXEC, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})))
print("\nrespuesta Web App:", json.dumps(resp, ensure_ascii=False))

db = sql("select modelo, precio_lista::bigint l, costo_concesionario::bigint c, lista_num "
         "from precios_lista where mes = '%s'" % MES)
esperado = {f["modelo"]: f for f in filas}
ok, diffs = 0, []
for r in db:
    e = esperado.get(r["modelo"])
    if not e:
        diffs.append("en DB y no esperado: " + r["modelo"]); continue
    if int(r["l"]) == e["precioLista"] and int(r["c"]) == e["costo"] and r["lista_num"] == LISTA_NUM:
        ok += 1
    else:
        diffs.append("%s: DB(l=%s,c=%s,n=%s) vs esperado(l=%s,c=%s)" %
                     (r["modelo"], r["l"], r["c"], r["lista_num"], e["precioLista"], e["costo"]))
faltan = set(esperado) - {r["modelo"] for r in db}
print("\n=== Conciliacion %s: %d/%d OK, %d diffs, %d faltantes ===" % (MES, ok, len(esperado), len(diffs), len(faltan)))
for d in diffs: print("  " + d)
for f in sorted(faltan): print("  FALTA: " + f)

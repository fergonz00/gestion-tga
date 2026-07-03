# -*- coding: utf-8 -*-
"""Vuelca la lista de un mes (tabla precios_lista) a portal_ofertas.precio_lista,
manteniendo el descuento_pct de Fer y recalculando oferta_fyf con la MISMA
formula que guardarListasPortalSide: round2(lista * (1 - dto/100) + 1.110.000).
Registra snapshot en portal_precios_hist (tipo=modelo) como el guardado normal.
NO dispara el aviso WhatsApp (sale solo cuando Fer guarda sus dtos en /precios).

Uso (despues de cargar precios_lista del mes con cargar_precios_lista.py):
  python portal_listas.py 2026-08          # dry-run
  python portal_listas.py 2026-08 --go     # aplica
Parte del circuito mensual: ver skill circular-vw en C:\\proyectos\\.claude\\skills."""
import json, urllib.request, sys, re

if len(sys.argv) < 2 or not re.match(r"^\d{4}-\d{2}$", sys.argv[1]):
    print(__doc__); sys.exit(1)
MES = sys.argv[1]
FYF = 1110000
pat = None
for line in open(r"C:\proyectos\.secrets\supabase.env", encoding="utf8"):
    if line.startswith("SUPABASE_PAT=") and line.split("=", 1)[1].strip():
        pat = line.split("=", 1)[1].strip()

def sql(q):
    req = urllib.request.Request("https://api.supabase.com/v1/projects/wjfglsafgaltusmbnccl/database/query",
        data=json.dumps({"query": q}).encode(),
        headers={"Authorization": "Bearer " + pat, "Content-Type": "application/json",
                 "User-Agent": "gestion-tga-claude/1.0"})
    return json.load(urllib.request.urlopen(req))

def keyn(s):  # normalizador fuerte (mismo criterio que _normModeloKey de gestion)
    s = s.upper()
    s = re.sub(r"\bMY\s*\d{2}(/\d{2})?\b", "", s)
    s = re.sub(r"\bG\d\b", "", s)
    s = re.sub(r"\bSE\b", "", s)
    s = re.sub(r"\bVW\b", "", s)
    s = re.sub(r"BI[\s-]?TONO", "BITONO", s)
    return re.sub(r"[^A-Z0-9+]", "", s)

ofertas = sql("select id, modelo, precio_lista::bigint as lista_vieja, descuento_pct from portal_ofertas")
cat     = sql("select nombre_corto, nombre_bt from catalogo_modelos where activo = true")
listas  = sql("select modelo, precio_lista::bigint as lista from precios_lista where mes = '%s'" % MES)

lista_por_nc = {r["modelo"]: r["lista"] for r in listas}
nc_por_key = {}
for c in cat:
    nc_por_key[keyn(c["nombre_corto"])] = c["nombre_corto"]
    if c.get("nombre_bt"): nc_por_key[keyn(c["nombre_bt"])] = c["nombre_corto"]

cambios, sin_match, iguales = [], [], 0
for o in ofertas:
    nc = nc_por_key.get(keyn(o["modelo"]))
    lista = lista_por_nc.get(nc) if nc else None
    if not lista:
        sin_match.append(o["modelo"]); continue
    if int(o["lista_vieja"]) == int(lista):
        iguales += 1; continue
    dto = float(o["descuento_pct"] or 0)
    oferta = round(lista * (1 - dto / 100) + FYF, 2)
    cambios.append((o["id"], o["modelo"], int(o["lista_vieja"]), int(lista), dto, oferta))

print("ofertas en portal: %d · a actualizar: %d · ya iguales: %d · sin match: %d" %
      (len(ofertas), len(cambios), iguales, len(sin_match)))
for m in sin_match: print("  SIN MATCH:", m)
for _, m, lv, ln, dto, of in cambios:
    print("  %-46s %s -> %s (dto %.2f%% => oferta %s)" % (m[:46], format(lv, ","), format(ln, ","), dto, format(of, ",")))

if "--go" not in sys.argv:
    print("(dry-run; --go para aplicar)"); sys.exit(0)

# aplicar: update por id + snapshot historial (estado nuevo, como logModelosHist)
vals = ",".join("(%d, %d, %s)" % (i, ln, repr(of)) for i, _, _, ln, _, of in cambios)
sql("update portal_ofertas o set precio_lista = v.lista, oferta_fyf = v.oferta, updated_at = now() "
    "from (values %s) as v(id, lista, oferta) where o.id = v.id" % vals)
usuario_hist = "claude (lista %s)" % MES
hist = ",".join("('modelo', %s, %d, %s, %s, '%s', now())" %
                ("'" + m.replace("'", "''") + "'", ln, repr(dto), repr(of), usuario_hist)
                for _, m, _, ln, dto, of in cambios)
sql("insert into portal_precios_hist (tipo, modelo, precio_lista, dto_pct, oferta_fyf, usuario, changed_at) values " + hist)
chk = sql("select count(*) as n from portal_ofertas o join precios_lista p on p.mes='%s' and p.precio_lista = o.precio_lista" % MES)
print("aplicado. filas portal_ofertas cuyo precio_lista coincide con la lista %s (aprox): %s" % (MES, chk[0]["n"]))

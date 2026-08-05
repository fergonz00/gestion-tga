# -*- coding: utf-8 -*-
"""Vuelca la lista de un mes (tabla precios_lista) al portal. Dos criterios:

  --congelar-precio  (DEFAULT desde ago-2026, decision de Fer)
      El precio final al publico (oferta_fyf) NO se mueve. Se recalcula el
      descuento_pct hacia atras contra la lista nueva, asi el aumento de VW lo
      absorbe la GANANCIA y no el cliente. Si VW aumento, el dto% sube y el
      margen baja; Fer despues retoca a mano lo que quiera en /precios.

  --mantener-dto     (criterio viejo, hasta jul-2026)
      Se mantiene el descuento_pct y se recalcula oferta_fyf = lista*(1-dto)+FYF,
      o sea el aumento se traslada al precio de venta.

En los dos casos escribe las DOS tablas que consumen los de abajo:
  · portal_ofertas (precio_lista + descuento_pct + oferta_fyf) -> baratito,
    presupuestos, API publica
  · dto_tg (fuente de verdad del descuento) -> la lee el motor de gestion,
    que es quien calcula la ganancia
Registra snapshot en portal_precios_hist (tipo=modelo).
NO dispara el aviso WhatsApp (sale solo cuando Fer guarda sus dtos en /precios).

Uso (despues de cargar precios_lista del mes con cargar_precios_lista.py):
  python portal_listas.py 2026-08                 # dry-run, congelando precio
  python portal_listas.py 2026-08 --go            # aplica
  python portal_listas.py 2026-08 --mantener-dto  # dry-run criterio viejo
Parte del circuito mensual: ver skill circular-vw en C:\\proyectos\\.claude\\skills."""
import json, urllib.request, sys, re

if len(sys.argv) < 2 or not re.match(r"^\d{4}-\d{2}$", sys.argv[1]):
    print(__doc__); sys.exit(1)
MES = sys.argv[1]
FYF = 1110000
CONGELAR = "--mantener-dto" not in sys.argv
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

ofertas = sql("select id, modelo, precio_lista::bigint as lista_vieja, descuento_pct, oferta_fyf::bigint as oferta_vieja from portal_ofertas")
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
    # Comparar en float, NO con int(): hubo filas con centavos pegados de cargas
    # viejas (ago-26: Black Style tenia 93.430.750,36) que un int() daba "igual"
    # y dejaba el precio_lista sucio para siempre.
    if abs(float(o["lista_vieja"]) - float(lista)) < 0.005:
        iguales += 1; continue
    dto_viejo = float(o["descuento_pct"] or 0)
    if CONGELAR:
        oferta = float(o["oferta_vieja"])              # el precio no se mueve
        # SIN redondear: dto_tg guarda precision completa y de ahi el motor
        # reconstruye el precio. Redondear a 4 decimales desfasaba hasta $33.
        dto = (1 - (oferta - FYF) / lista) * 100
    else:
        dto = dto_viejo
        oferta = round(lista * (1 - dto / 100) + FYF, 2)
    cambios.append((o["id"], o["modelo"], nc, int(o["lista_vieja"]), int(lista),
                    dto_viejo, dto, float(o["oferta_vieja"]), oferta))

print("criterio: %s" % ("CONGELAR PRECIO (recalcula dto%)" if CONGELAR else "MANTENER DTO% (recalcula precio)"))
print("ofertas en portal: %d · a actualizar: %d · ya iguales: %d · sin match: %d" %
      (len(ofertas), len(cambios), iguales, len(sin_match)))
for m in sin_match: print("  SIN MATCH:", m)
for _, m, _, lv, ln, dv, dn, ov, on in cambios:
    print("  %-44s lista %s->%s · dto %.2f->%.2f%% · precio %s->%s" %
          (m[:44], format(lv, ","), format(ln, ","), dv, dn, format(round(ov), ","), format(round(on), ",")))

if "--go" not in sys.argv:
    print("(dry-run; --go para aplicar)"); sys.exit(0)

# 1) portal_ofertas (lo que consumen baratito / presupuesto / API publica)
vals = ",".join("(%d, %d, %s, %s)" % (i, ln, repr(dn), repr(on)) for i, _, _, _, ln, _, dn, _, on in cambios)
sql("update portal_ofertas o set precio_lista = v.lista, descuento_pct = v.dto, oferta_fyf = v.oferta, "
    "updated_at = now() from (values %s) as v(id, lista, dto, oferta) where o.id = v.id" % vals)
# 2) dto_tg (fuente de verdad del dto; de aca sale la ganancia del motor)
dvals = ",".join("('%s', %s)" % (nc.replace("'", "''"), repr(dn / 100)) for _, _, nc, _, _, _, dn, _, _ in cambios)
sql("update dto_tg d set dto = v.dto, actualizado_at = now() "
    "from (values %s) as v(nc, dto) where d.nombre_corto = v.nc" % dvals)
# 3) historial
usuario_hist = "claude (lista %s%s)" % (MES, "" if CONGELAR else ", mantiene dto")
hist = ",".join("('modelo', %s, %d, %s, %s, '%s', now())" %
                ("'" + m.replace("'", "''") + "'", ln, repr(dn), repr(on), usuario_hist)
                for _, m, _, _, ln, _, dn, _, on in cambios)
sql("insert into portal_precios_hist (tipo, modelo, precio_lista, dto_pct, oferta_fyf, usuario, changed_at) values " + hist)

# Verificacion. descuento_pct es numeric(5,2) (columna de display) y dto_tg.dto
# guarda precision completa -> comparar a 2 decimales, no mas. max_err_precio es
# el desfasaje entre el precio que reconstruye el motor desde dto_tg y el
# oferta_fyf publicado: tiene que dar 0.
chk = sql("""select count(*) as n,
                    count(*) filter (where o.precio_lista <> p.precio_lista) as lista_dif,
                    count(*) filter (where round(o.descuento_pct, 2) <> round(d.dto*100, 2)) as dto_dif,
                    max(abs(round(p.precio_lista*(1-d.dto)+%d - o.oferta_fyf)))::bigint as max_err_precio
             from portal_ofertas o
             join catalogo_modelos c on c.nombre_bt = o.modelo and c.activo
             join precios_lista p on p.mes = '%s' and p.modelo = c.nombre_corto
             join dto_tg d on d.nombre_corto = c.nombre_corto""" % (FYF, MES))
print("aplicado. conciliacion (por nombre_bt): %s" % json.dumps(chk[0]))
print("  esperado: lista_dif=0, dto_dif=0, max_err_precio=0")

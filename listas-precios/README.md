# listas-precios — Listas de precios VW

Dejá acá la **lista de precios de VW** más reciente (PDF/Excel/CSV), nombrada con
la fecha o el número de lista, ej. `Lista-887-2026-05.pdf`.

Sirve para analizar **costo vs precio** y validar los márgenes por modelo que usa
"Actual BT" (costo de reposición = lista × (1 − margen); ~13% Polo, ~15% resto,
Amarok un poco más).

> ⚠️ Gitignored: NO se publica en el sitio (el repo es GitHub Pages público).

Nota: la lista vigente también vive en la planilla madre, pestaña **"listas de
precios"** y en **"Actual BT"** (col C = lista, costoRep = costo). Esta última se
lee viva vía el endpoint `tipo=precios`.

## Cómo se saca (procedimiento asentado)

La solapa **Precios** de gestion.titogonzalez.online = tabla `precios_lista`
(Supabase wjfgl). Es la **referencia de precios/costos** que consumen el motor y
la ganancia de Ventas. Se carga desde el Excel VW con `extraer_lista.py`:

```
python extraer_lista.py "Circular N°NN - Lista #NNN 6 digitos Excel.xlsx" --db 2026-MM
```

- Hoja **"Lista Pesos"**, datos desde fila 13. `costo_concesionario` = col **AD**
  (PRECIO CONCESIONARIO · PREC.NETO), `precio_lista` = col **AH** (SUGERIDO · PREC.NETO).
  `lista_num` sale del "Nro.: NNN" del encabezado. Los incentivos NO están acá
  (salen de la circular de Condiciones → tabla `incentivos`).
- `--db` concilia el Excel contra lo cargado en `precios_lista` (debe dar todo OK).
- Junio 2026 (lista #890) validado 3 vías el 2026-07-02: Excel↔base **51/51 exacto**;
  Sheet "Actual BT"↔base **47/47 lista exacta**, costo ±1 peso por redondeo del PREC.NETO.
- El panel Precios cae automáticamente al **último mes cargado** si el mes actual
  todavía no tiene lista (ej. VW aún no mandó la de julio) — antes salía en blanco.

# BT-VW — Condiciones comerciales VW (incentivos)

Carpeta para los **PDF de la BT** que manda VW cada mes. De acá salen los números
que alimentan la solapa **INCENTIVOS** del portal (CC90, táctico, whosale,
adicional 1 y 2 por modelo).

> ⚠️ No confundir con `5- Nc Incentivos/`, que son las **notas de crédito**
> (pagos VW), otra cosa distinta.

## Cómo lo uso (Fer)

1. Cuando VW me manda el PDF del mes, lo dejo en **`entrada/`**.
2. Le pongo el nombre con el mes: **`BT-AAAA-MM.pdf`** (ej. `BT-2026-05.pdf`).
   Si no lo renombro no pasa nada, Claude igual lo identifica.
3. Le aviso a Claude: *"procesá la BT que dejé en BT-VW/entrada"*.

## Qué hace Claude

1. Lee el PDF y extrae por modelo: **CC90 · táctico · whosale · adicional 1 · adicional 2**.
2. Devuelve las filas en el formato exacto del Sheet
   (col B=modelo · U=CC90 · Y=táctico · Z=whosale · AA=adic1 · AB=adic2;
   en "BT anteriores" además col A = fecha del mes).
3. Las filas se cargan en la planilla (a mano por ahora; cuando esté el Script ID,
   las escribe Claude directo).
4. Mueve el PDF ya procesado a **`procesados/`**.

## Estructura

```
BT-VW/
├── entrada/      ← dejá acá los PDF nuevos sin procesar
├── procesados/   ← Claude mueve acá los ya leídos
└── README.md
```

## Estado / pendientes

- [ ] Recuperar **mayo 2026** (no quedó archivado en "BT anteriores" → no aparece
      en el selector de INCENTIVOS). Apenas esté el PDF de mayo en `entrada/`,
      Claude genera las filas y se recupera.
- [ ] Snapshot automático del BT del mes vigente (evita que se pierda un mes como
      pasó con mayo). Requiere el **Script ID** de la planilla espejo de gestión.
- [ ] Parser estable del layout VW (se afina con los primeros 1-2 PDF).

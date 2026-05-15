# gestion-tga

Solapa privada del Portal TGA con stock de unidades VW, ventas y patentamientos del mes.

- **Subdominio**: `gestion.titogonzalez.online` (GitHub Pages + CNAME)
- **Acceso**: cookie SSO `tga_session`, solo usuarios `fngonzalez` y `fgonzalez`
- **Fuente de datos**: planilla espejo en Google Sheets, leída vía Apps Script Web App con token
- **Stack**: HTML único + vanilla JS (mismo patrón que `tasador-tga`, `saldos-tga`, `portal-tga`)

## Arquitectura

```
Planilla MADRE (privada)
  └─ Hoja "stock" (la que vos usás día a día)
                │
                │  IMPORTRANGE
                ▼
Planilla ESPEJO  → 1M7NedFVQU4aGdN6JU5-QgxEYJTEm-iRjN9eOkIrifPQ
  └─ Hoja 1 → fórmula =IMPORTRANGE(... ; "stock!A:P")
                │
                │  Apps Script Web App (token)
                ▼
gestion.titogonzalez.online  → fetch JSON, render
  └─ Tabs: Stock / Ventas del mes / Patentamientos del mes
```

## Despliegue paso a paso

### 1. Publicar el Apps Script de la espejo

1. Abrí la planilla espejo:
   https://docs.google.com/spreadsheets/d/1M7NedFVQU4aGdN6JU5-QgxEYJTEm-iRjN9eOkIrifPQ/edit
2. **Extensiones → Apps Script**.
3. Pegá el contenido de `apps-script.gs` (reemplaza todo lo que haya).
4. **Guardar** (💾).
5. **Implementar → Nueva implementación → Aplicación web**:
   - Descripción: `gestion-tga v1`
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier persona** (la seguridad está dada por el token).
6. Aceptar los permisos que pide (acceso a Spreadsheets).
7. Copiar la **URL del Web App** (algo como `https://script.google.com/macros/s/AKfycb.../exec`).

### 2. Pegar la URL en `index.html`

Editar la constante `APPS_SCRIPT_URL` (cerca del top del bloque `<script>`):

```js
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
```

> Si más adelante cambia el token (constante `TOKEN` en `apps-script.gs`), también hay que reflejarlo en `APPS_SCRIPT_TOKEN` de `index.html`.

### 3. Probar local

Levantar un server local en la carpeta del proyecto:
```
cd "C:\proyectos\gestion-tga"
python -m http.server 8770
```
Abrir `http://localhost:8770` — la cookie SSO de `.titogonzalez.online` solo funciona en producción, así que en local vas a ver el gate. Para testear el fetch en local, podés comentar momentáneamente el check de cookie en `init()`.

### 4. Crear repo en GitHub y publicar con Pages

1. Crear repo nuevo (privado) en GitHub: `fergonz00/gestion-tga`.
2. Inicializar y pushear:
   ```
   git init
   git add .
   git commit -m "feat: setup inicial gestion-tga con solapa Stock"
   git branch -M main
   git remote add origin git@github.com:fergonz00/gestion-tga.git
   git push -u origin main
   ```
3. En GitHub → **Settings → Pages** → Source: `Deploy from branch`, Branch: `main / (root)`.
4. **Custom domain**: `gestion.titogonzalez.online`.
5. Marcar **Enforce HTTPS** cuando esté disponible (puede tardar un par de minutos).

### 5. DNS

En el panel del registrador de `titogonzalez.online`, agregar un CNAME:

```
gestion  CNAME  fergonz00.github.io
```

(Igual que `saldos`, `tasador`, etc.)

### 6. Verificar end-to-end

1. Abrir `https://gestion.titogonzalez.online` — debería redirigir al gate si no tenés cookie.
2. Iniciar sesión en `https://titogonzalez.online` como `fngonzalez` o `fgonzalez`.
3. Volver a `https://gestion.titogonzalez.online` o entrar desde el tile "Gestión" del portal.
4. Stock debería cargar la lista de unidades.

## Modificaciones comunes

### Agregar/quitar usuario con acceso
Editar `USUARIOS_PERMITIDOS` en `index.html` Y `requiereUsuario` en `portal-tga/index.html`.

### Cambiar el token
1. Editar `TOKEN` en `apps-script.gs` y redesplegar el Web App.
2. Editar `APPS_SCRIPT_TOKEN` en `index.html` con el mismo valor.

### Re-deployar el Apps Script después de tocar `apps-script.gs`

El Web App no actualiza automáticamente cuando guardás cambios en el editor.

1. Pegar el nuevo `apps-script.gs` y **Guardar**.
2. **Implementar → Administrar implementaciones**.
3. En la implementación activa, click en el ✏️ (Editar).
4. En "Versión" elegir **Nueva versión**, descripción libre.
5. **Implementar**.

Hacer "Nueva versión" sobre la implementación existente preserva la URL
del Web App, así no hay que actualizar `APPS_SCRIPT_URL` en `index.html`.

### Hoja `objetivos_pat`

Se autocrea la primera vez que la app guarda un objetivo (no hace falta crearla
a mano). Layout:

| Col | Campo            | Notas |
|-----|------------------|-------|
| A   | `mesKey`         | 'YYYY-MM' como texto (no fecha) |
| B   | `objetivo`       | Cantidad de carpetas a patentar |
| C   | `actualizado_at` | ISO del último cambio |

Si VW cambia un objetivo a mitad del mes, se edita desde la tab Patentamientos o
Trimestre del portal y queda persistido para todos los usuarios.

### Agregar las próximas solapas (Ventas / Patentamientos)
1. Confirmar con Fer las columnas y hojas de origen.
2. Agregar fórmulas IMPORTRANGE en la espejo (probablemente en hojas nuevas: `ventas`, `patentamientos`).
3. Extender `apps-script.gs` con funciones `getVentas()` y `getPatentamientos()` y routear por `tipo`.
4. En `index.html` reemplazar los placeholders de los paneles correspondientes.

## Mapa de columnas — Stock

Espejo A..P de la hoja "stock" de la planilla madre:

| Col | Campo backend       | Notas |
|-----|---------------------|-------|
| A   | `serie`             | N° serie del auto |
| B   | `fechaFcIso` / `antigDias` | Fecha factura → ISO + antigüedad en días |
| C   | `unidad`            | Modelo + versión (siempre VW 0km) |
| D   | `color`             |  |
| E   | `montoFc`           | Valor histórico de compra |
| F   | `pagoEstado` / `pagoFechaIso` | `PAGA` / fecha / vacío → 'pagada' / 'impaga' / 'otro' |
| G   | `vendido` / `vendidoModelo` | Modelo (vendida) o `NA` / `#N/A` (en stock) |
| H   | `ofertaActual`      | Precio actual de venta |
| I   | `rdoActualPct`      | % rdo con la oferta actual |
| J   | `lista`             | Precio de lista |
| K   | `dtoActualPct`      | % dto actual |
| L   | `dtoPedidoPct`      | (en planilla; el calculador del front es independiente) |
| M   | `rdoConDtoPct`      | (en planilla; calculado por planilla) |
| N   | `precioPedido`      | (en planilla; calculador del front es independiente) |
| O   | `rdoConPrecioPct`   | (header en planilla dice "rdo con dto pedido" — es typo, es "rdo con precio pedido") |
| P   | `exposicion`        | `ENTRE RIOS` / `INDEPENDENCIA` / vacío |

## Calculador inline (front, no toca planilla)

Dos modos, ambos sobre la unidad de la fila:

- **% dto pedido** → `nuevo_rdo = rdo_actual − (dto_pedido − dto_actual)` (en puntos %).
- **$ precio pedido** → `nuevo_rdo = rdo_actual − ((oferta_actual − precio_pedido) / lista) × 100`.

Es solo cálculo visual. Si querés persistir el cambio, lo cargás vos en la planilla madre y al apretar "Actualizar" se refleja.

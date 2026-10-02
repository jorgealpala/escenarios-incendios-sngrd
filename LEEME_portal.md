# Portal · Escenarios Incendios Forestales y Capacidades del SNGRD (GitHub Pages)

**Fenómeno El Niño 2026–2027 · UNGRD — Subdirección para el Conocimiento del Riesgo**

Manual operativo de la versión estática. Para **despliegue, estructura de carpetas, dónde
colocar datos y asistente de IA**, vea **[README.md](README.md)**.

> **Punto de entrada:** `index.html` · **Datos:** carpeta `data/` · **Inventario:** `data/index.json`

## 1. Cómo abrirlo

**En línea:** `https://USUARIO.github.io/REPOSITORIO/` (una vez activado GitHub Pages).

**En local** (para probar antes de publicar), sírvalo por HTTP desde esta carpeta:

```bash
python -m http.server 8000
```

y abra **http://localhost:8000/** (recarga forzada **Ctrl + F5**). Con doble clic sobre el
HTML el navegador bloquea la lectura de datos (`fetch`), por eso se sirve por HTTP.

## 2. Pestañas

| Pestaña | Qué muestra | Tecnología |
|---|---|---|
| **Frecuencia de incendios VIIRS** | Puntos de calor VIIRS (2014–2026). Mapa Leaflet con 4 vistas: coropleta · calor · clúster · puntos. Paneles por mes, consolidada, rankings. | D3 + Leaflet (`index.html`) |
| **Frecuencia de incendios WFS** | Detecciones diarias OroraTech (oct–may). Lee `incendios.parquet` en el navegador. | iframe → `wfs.html` |
| **Área quemada** | Cicatriz de fuego (MapBiomas Fuego, 30 m). | D3 (`index.html`) |
| **Lluvia antecedente** | Lluvia CHIRPS de los 90 días previos a cada evento. Overlay opcional de puntos de calor. | D3 (`index.html`) |
| **Capacidades de respuesta** | Matriz Nacional de Capacidades Incendios SNGRD. | iframe → `capacidades_sngrd.html` |

Cada pestaña tiene un **asistente de IA** flotante y un botón **⤓ Reporte PDF**.

## 3. Archivos y datos

| Ruta | Rol |
|---|---|
| `index.html` | **Portal principal** (punto de entrada). |
| `wfs.html` | Módulo WFS (OroraTech), embebido por iframe (`?embed=1`). |
| `capacidades_sngrd.html` | Tablero de Capacidades (datos embebidos). |
| `config.js` | Configuración (URL del asistente de IA). |
| `assets/logo/ungrd-horizontal.png` | Logo institucional. |
| `data/viirs/` | `datos_app.json`, `deptos.geojson`, `municipios.geojson`. |
| `data/puntos/`, `data/puntos_mes/` | Puntos de calor VIIRS (municipio / mes). |
| `data/lluvia/` | `lluvia_app.json`, `indice.json`, `eventos.bin`. |
| `data/wfs/` | `incendios.parquet` + 2 geojson simplificados. |
| `data/index.json` | **Manifiesto**: inventario de los datasets. |

> **Dónde colocar datos nuevos:** vea la tabla **«¿Dónde debo colocar nuevos datos?»** del
> [README.md](README.md#eg-dónde-debo-colocar-nuevos-datos-y-en-qué-formato). En resumen:
> todo va bajo `data/`, con el nombre esperado; para un mes nuevo basta con dejar
> `data/puntos_mes/AAAA-MM.json` y actualizar `data/viirs/datos_app.json` — sin tocar código.

## 4. Asistente de IA

El botón del asistente **siempre está visible** (abajo-derecha). Para que **responda** en
GitHub Pages hace falta un **proxy serverless** que guarde las llaves (nunca van en el repo):
vea la **sección L del [README.md](README.md#l-cómo-manejar-las-apis-del-asistente-de-ia)** y la
plantilla `serverless/asistente_worker_ejemplo.js`. La URL del proxy se pone en `config.js`.

Sin proxy configurado, el asistente queda **sin conexión** pero el botón sigue ofreciendo las
guías «Cómo leer esta pestaña» de cada sección; el resto del portal funciona igual.

## 5. Reporte PDF (captura de la vista actual)

El botón **⤓ Reporte PDF** captura **lo que está en pantalla** (pestaña, zoom, mapa de calor,
tablas) y lo **descarga automáticamente** en PDF A4 con encabezado y pie institucionales, sin
diálogo de impresión. Si el contenido no cabe en una hoja, se divide en varias páginas.

> Para que las teselas del mapa base salgan en el PDF, el portal debe servirse por HTTP/HTTPS
> (GitHub Pages ya cumple). Los proveedores Esri/OSM/CARTO permiten la captura por CORS.

## 6. Fuentes y créditos

Datos: VIIRS S-NPP (NASA FIRMS) · OroraTech WildFire Solution (WFS) · MapBiomas Fuego ·
CHIRPS · Matriz Nacional de Capacidades SNGRD · Límites DIVIPOLA – DANE.
Mapas base: Esri · OpenStreetMap · CARTO. Librerías (CDN): D3, Leaflet (heat, markercluster),
hyparquet, Chart.js, jsPDF, html2canvas.

> Herramienta de apoyo al conocimiento del riesgo (Ley 1523 de 2012). No reemplaza las
> alertas oficiales del IDEAM, el SGC ni la UNGRD.

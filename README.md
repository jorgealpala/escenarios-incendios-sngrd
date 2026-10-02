# Escenarios Incendios Forestales y Capacidades del SNGRD — versión GitHub Pages

Portal web **estático** (UNGRD · Fenómeno El Niño 2026–2027) listo para publicarse en
**GitHub Pages**. Es la *copia de producción* de la versión de desarrollo; aquí no hay
servidores: todo corre en el navegador leyendo archivos por `fetch()`.

> **Punto de entrada:** [`index.html`](index.html)
> **En producción:** https://jorgealpala.github.io/escenarios-incendios-sngrd/ — con el
> **asistente de IA activo** (Cloudflare Worker + Groq; ver sección **L**).

---

## A. Qué es el proyecto

Tablero que unifica cinco módulos de análisis de incendios para Colombia:

| Pestaña | Qué muestra | Dónde vive |
|---|---|---|
| **Frecuencia de incendios VIIRS** | Puntos de calor VIIRS (mapa Leaflet: coropleta, calor, clúster, puntos) + gráficas | `index.html` (nativo) |
| **Frecuencia de incendios WFS** | Detecciones diarias OroraTech (lee `incendios.parquet` en el navegador) | `wfs.html` (iframe) |
| **Área quemada** | Cicatriz de fuego (MapBiomas) | `index.html` (nativo) |
| **Lluvia antecedente** | Lluvia CHIRPS de los 90 días previos a cada evento | `index.html` (nativo) |
| **Capacidades de respuesta** | Matriz Nacional de Capacidades SNGRD | `capacidades_sngrd.html` (iframe, datos embebidos) |

Incluye además: **asistente de IA** flotante y **Reporte PDF** (captura la vista actual).

## B. Cómo funciona

- Es un **sitio estático**: HTML + JS + CSS + datos, sin backend.
- Las librerías (Leaflet, D3, Chart.js, hyparquet, jsPDF, html2canvas) se cargan desde **CDN** (HTTPS).
- Los datos se leen con `fetch()` desde la carpeta [`data/`](data/) con **rutas relativas**.
- Los mapas base (Esri · OpenStreetMap · CARTO) se sirven por HTTPS con CORS.
- El **asistente de IA** necesita un proxy externo (ver sección **L**); sin él funciona *offline*.

## C. Estructura de carpetas

```
app_enso_wfs_github/
├── index.html                 ← PORTAL principal (punto de entrada de GitHub Pages)
├── wfs.html                   ← sub-app WFS (se embebe como iframe)
├── capacidades_sngrd.html     ← sub-app Capacidades (datos embebidos)
├── config.js                  ← configuración (URL del asistente de IA)
├── .nojekyll                  ← sirve todos los archivos tal cual (desactiva Jekyll)
├── .gitignore
├── assets/
│   └── logo/ungrd-horizontal.png
├── data/
│   ├── index.json             ← MANIFIESTO: inventario de datasets
│   ├── viirs/                 ← datos_app.json, deptos.geojson, municipios.geojson
│   ├── puntos/                ← <divipola>.json  (puntos por municipio)
│   ├── puntos_mes/            ← AAAA-MM.json      (puntos por mes, nacional)
│   ├── lluvia/                ← lluvia_app.json, indice.json, eventos.bin
│   └── wfs/                   ← incendios.parquet + 2 geojson simplificados
├── serverless/
│   ├── asistente_worker_ejemplo.js   ← plantilla del proxy de IA (sin llaves)
│   └── wrangler.toml                 ← configuración de despliegue del Worker
├── sincronizar_github.ps1            ← script dev→prod (PowerShell; no se publica)
├── sincronizar_github.sh             ← script dev→prod (Git Bash; no se publica)
├── README.md
└── LEEME_portal.md
```

> Los `sincronizar_github.*` están en `.gitignore` (son herramientas locales que
> apuntan a su carpeta de desarrollo; no forman parte del sitio publicado).

## D. Archivo principal

[`index.html`](index.html). GitHub Pages lo sirve automáticamente en la raíz.
Internamente embebe `wfs.html` y `capacidades_sngrd.html` como iframes.

> **Nota de nombres:** en la versión de desarrollo el portal se llama `app_enso_scr.html`
> y el WFS se llama `index.html`. Para GitHub Pages el portal pasó a ser `index.html`
> (lo que espera Pages) y el WFS se renombró a `wfs.html` para evitar el choque de nombres.

---

## E–G. ¿Dónde debo colocar nuevos datos?  (y en qué formato)

Todos los datos van bajo **`data/`**. El inventario está en [`data/index.json`](data/index.json).

| Si tiene… | Colóquelo en | Formato | Nombre |
|---|---|---|---|
| **un mes nuevo de puntos de calor (nacional)** | `data/puntos_mes/` | JSON | `AAAA-MM.json` (p. ej. `2026-10.json`) |
| **puntos de un municipio** | `data/puntos/` | JSON | `<divipola>.json` (p. ej. `99773.json`) |
| **agregados VIIRS actualizados** | `data/viirs/` | JSON/GeoJSON | reemplace `datos_app.json`, `deptos.geojson`, `municipios.geojson` |
| **lluvia antecedente actualizada** | `data/lluvia/` | JSON + `.bin` | reemplace `lluvia_app.json`, `indice.json`, `eventos.bin` |
| **detecciones WFS actualizadas** | `data/wfs/` | Parquet/GeoJSON | reemplace `incendios.parquet` (+ geojson si cambian) |
| **capacidades actualizadas** | `capacidades_sngrd.html` | embebido | regénelo con `actualizar_capacidades.py` y cópielo aquí |

**Ejemplo concreto — agregar octubre de 2026:**
1. Genere `2026-10.json` con el pipeline y cópielo a `data/puntos_mes/2026-10.json`.
2. Regenere `data/viirs/datos_app.json` (su `fecha_max`/`anio_fin` definen el rango que el
   portal ofrece). **No hay que tocar código:** al extenderse el rango, el portal pide
   automáticamente el nuevo mes.
3. (Opcional) actualice la fecha y coberturas en `data/index.json`.
4. Suba los cambios a GitHub (sección **I**).

> **Formatos:** mantenga el **mismo formato y estructura** del archivo que reemplaza.
> Los `.json` y `.geojson` deben ser UTF-8 válidos; `eventos.bin` es binario uint16;
> `incendios.parquet` es Parquet (lo lee *hyparquet* en el navegador).

## F (ampliado). ¿Por qué estos formatos y no todo Parquet?

Se evaluó convertir todo a Parquet; **no conviene** salvo donde ya se usa:

- **`incendios.parquet` (WFS)** — ✅ Parquet. Es grande y se lee por columnas/rangos en el
  navegador con *hyparquet*. GitHub Pages soporta *range-requests*, así que la lectura es eficiente.
- **`datos_app.json`** — pequeño (2,8 MB) y se usa completo: JSON es más simple y rápido.
- **`puntos/*.json` y `puntos_mes/*.json`** — se cargan de a uno (por municipio o por mes);
  Parquet por archivo añadiría costo de WASM sin beneficio.
- **`eventos.bin`** — ya es binario compacto (uint16), óptimo.

**Cómo regenerar el Parquet:** en el entorno de desarrollo, con el pipeline de OroraTech,
y copie el `incendios.parquet` resultante a `data/wfs/`.

## H. Cómo probar localmente

GitHub Pages es HTTP; con doble clic el navegador bloquea los `fetch()`. Sírvalo por HTTP:

```bash
cd app_enso_wfs_github
python -m http.server 8000
```

Abra **http://localhost:8000/** (recarga forzada **Ctrl + F5** tras cada cambio).
Cualquier servidor estático sirve (`npx serve`, extensión *Live Server*, etc.).

### Traer cambios desde el entorno de desarrollo (automático)

Cuando pruebe algo en `app_enso_wfs` (desarrollo) y quiera pasarlo a esta carpeta de
producción, use el script incluido — **reescribe las rutas automáticamente** (de la
estructura de desarrollo a `data/…`, renombra el WFS a `wfs.html`, enlaza `config.js`):

```powershell
# PowerShell (desde esta carpeta)
.\sincronizar_github.ps1            # código + datos
.\sincronizar_github.ps1 -Codigo   # solo HTML + logo
.\sincronizar_github.ps1 -Datos    # solo data\
```
```bash
# Git Bash (equivalente)
./sincronizar_github.sh            # código + datos
./sincronizar_github.sh --codigo
./sincronizar_github.sh --datos
```

No toca su carpeta de desarrollo (solo lee) ni sus archivos de producción propios
(`config.js`, `README.md`, `data/index.json`, `serverless/`…). Tras sincronizar, pruebe
local y haga `commit`/`push`.

## I. Cómo sincronizar con GitHub

```bash
cd app_enso_wfs_github
git init
git add .
git commit -m "Portal de incendios SNGRD — versión GitHub Pages"
git branch -M main
git remote add origin https://github.com/USUARIO/REPOSITORIO.git
git push -u origin main
```

Para **actualizar datos** más adelante: copie los archivos nuevos a `data/…`, y luego
`git add . && git commit -m "Datos AAAA-MM" && git push`.

## J. Cómo activar GitHub Pages

1. En el repositorio: **Settings → Pages**.
2. **Source:** *Deploy from a branch*.
3. **Branch:** `main` · **Folder:** `/ (root)` → **Save**.
4. En 1–2 minutos el sitio queda en `https://USUARIO.github.io/REPOSITORIO/`.

El archivo `.nojekyll` ya está incluido para que Pages publique todos los archivos tal cual.

## K. Qué archivos NO deben publicarse

Nunca suba (ya están en `.gitignore`):

- **Llaves/credenciales**: `.env`, `*.key`, `*apikey*`, `servidor_app.py` con llaves.
- PDF de muestra (`Reporte_ejemplo_*.pdf`), temporales, `__pycache__`, `node_modules`, `.DS_Store`.
- Las carpetas de desarrollo del original (`christian/`, `moises/`, `data/2019…2026/`,
  `incendios.csv`): **no** forman parte de esta copia.

## L. Cómo manejar las APIs del asistente de IA

El asistente llama a `window.ASISTENTE_URL` (definida en [`config.js`](config.js)):

- **Sin configurar (`""`)** → modo **offline**: el botón sigue visible y ofrece las guías
  “Cómo leer esta pestaña”. El resto del portal funciona normal. *(Es seguro publicar así.)*
- **Para que responda en producción** sin exponer llaves, se despliega el proxy serverless
  incluido en [`serverless/asistente_worker_ejemplo.js`](serverless/asistente_worker_ejemplo.js)
  (**Cloudflare Workers**, gratuito). La llave de IA vive en Cloudflare, **nunca** en el repo.

**Despliegue por el panel web (sin instalar nada — método usado):**
1. Llave gratuita de **Groq** en https://console.groq.com → *API Keys* → *Create* (empieza con `gsk_…`).
2. En https://dash.cloudflare.com → **Cómputo → Workers y Pages → Create → Create Worker** →
   nómbralo `asistente-ungrd` → **Deploy**.
3. **Editar código** → borra todo y **pega** el contenido de `serverless/asistente_worker_ejemplo.js` → **Deploy**.
4. **Settings → Variables and Secrets → Add** → Type **Secret**, Name `GROQ_API_KEY`, Value = tu llave → **Deploy**.
5. Copia la URL del Worker y pruébala: `https://<worker>.workers.dev/api/asistente/estado` → `{"disponible":true}`.
6. En [`config.js`](config.js) pon `window.ASISTENTE_URL = "https://<worker>.workers.dev/api/asistente";` y `git push`.

*(Alternativa por consola: `npm i -g wrangler`, `wrangler secret put GROQ_API_KEY`, `wrangler deploy` desde `serverless/` — ver `serverless/wrangler.toml`.)*

### Configuración que quedó funcionando
- **Proveedor:** Groq (gratuito). El Worker prueba varios modelos en orden y usa el primero disponible:
  `openai/gpt-oss-20b` → `llama-3.1-8b-instant` → `llama-3.3-70b-versatile`.
- **Importante — modelos:** no todas las cuentas tienen acceso a todos los modelos, y Groq los
  rota/descontinúa. Si una cuenta no tiene acceso a `llama-3.1-8b-instant`/`70b`, el Worker cae
  automáticamente en `openai/gpt-oss-20b` (que fue el que respondió aquí). Pon **primero** el que
  tu cuenta sí tenga, para que no pierda tiempo en un intento fallido.
- **Longitud de respuesta:** `max_tokens: 500` (respuestas más ágiles). Súbelo si las quieres más largas.

### Solución de problemas
- El Worker **reporta el motivo real** cuando un modelo falla (campo `detalle`/`errores` en la
  respuesta), por ejemplo *“model … does not exist or you do not have access”* o *“decommissioned”*.
  Si el asistente no responde, abre la URL del Worker con una consola y mira ese `detalle`.
- Si sale “sin conexión” en el portal tras cambiar `config.js`: espera 1–2 min (caché de GitHub
  Pages) y recarga con **Ctrl + F5**.
- **CORS:** `ORIGENES_PERMITIDOS` dentro del Worker debe incluir tu origen de Pages
  (aquí: `https://jorgealpala.github.io`).

> **La llave vive en el serverless, NUNCA en este repositorio.** El portal solo conoce la
> URL pública del proxy. Si la llave llega a verse (captura, registro), **regenérala** en Groq
> y actualiza su valor en Cloudflare.

## M. Cómo actualizar los datos sin modificar el código principal

El portal lee rutas y nombres **convencionales** (ver tabla **E–G**). Para crecer:

- **Nuevos meses / eventos** → agregue el archivo con el nombre esperado; el portal lo detecta
  por el rango de la metadata (`datos_app.json`, `lluvia_app.json`). No se toca el código.
- **Series actualizadas** → reemplace el archivo correspondiente en `data/…`.
- Mantenga `data/index.json` al día como inventario (opcional pero recomendado).
- El código HTML/JS **no** cambia salvo que agregue una pestaña o cambie una estructura de datos.

---

## Compatibilidad con GitHub Pages — verificado

- ✅ Rutas **relativas** (`data/…`, `assets/…`); sin `C:\…`, sin `localhost`, sin `file://`.
- ✅ HTTPS; librerías por CDN; módulos ES (hyparquet) y scripts clásicos.
- ✅ MIME: `.json`, `.geojson`, `.parquet`, `.bin`, `.png` se sirven correctamente (`.nojekyll`).
- ✅ *Range-requests* para el Parquet (Pages los soporta).
- ✅ Ningún archivo supera 100 MB (el mayor es `incendios.parquet`, 33 MB). Peso total ≈ 150 MB
  (muy por debajo del 1 GB recomendado por GitHub).
- ✅ El **asistente de IA** responde en producción vía un **Worker de Cloudflare** (modelo
  `openai/gpt-oss-20b`, ~0,6 s por consulta corta); la llave nunca está en el repo (ver **L**).

Detalle operativo del portal (pestañas, fuentes, asistente): ver [`LEEME_portal.md`](LEEME_portal.md).

---

### Créditos y uso
Datos: VIIRS S-NPP (NASA FIRMS) · OroraTech WFS · MapBiomas Fuego · CHIRPS · Matriz Nacional de
Capacidades SNGRD · Límites DIVIPOLA–DANE. Mapas base: Esri · OpenStreetMap · CARTO.
Realizado por Jorge Alpala — UNGRD, Subdirección para el Conocimiento del Riesgo.
Herramienta de apoyo al conocimiento del riesgo (Ley 1523 de 2012); no reemplaza las alertas
oficiales del IDEAM, el SGC ni la UNGRD.

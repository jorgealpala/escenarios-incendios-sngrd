// ============================================================
//  Configuración del portal (GitHub Pages)
// ============================================================
// Este archivo se carga antes que el resto del portal y permite
// ajustar opciones SIN tocar el código principal.
//
// ── Asistente de IA ─────────────────────────────────────────
// GitHub Pages es un sitio ESTÁTICO: no puede ejecutar el
// servidor con las llaves (servidor_app.py). Para que el
// asistente responda en producción, despliegue el proxy
// serverless incluido en:  serverless/asistente_worker_ejemplo.js
// y escriba aquí su URL pública (termina en /api/asistente).
//
// Las llaves de IA quedan SIEMPRE en el serverless, NUNCA en este
// repositorio.
//
// Si lo deja vacío (""), el asistente funciona en modo OFFLINE:
// el botón sigue visible y ofrece las guías "Cómo leer esta
// pestaña" de cada sección. El resto del portal funciona igual.
//
// Ejemplo:
//   window.ASISTENTE_URL = "https://asistente-ungrd.mi-cuenta.workers.dev/api/asistente";
//
window.ASISTENTE_URL = "";

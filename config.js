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
window.ASISTENTE_URL = "https://asistente-ungrd.jorge-alpala-1987.workers.dev/api/asistente";

// ── Acceso temporal (vista previa para la mesa directiva) ────────────────────
// Contraseña para entrar al portal.
//   • Con texto  → el portal pide contraseña antes de mostrarse.
//   • Vacía ("")  → portal LIBRE y público (se quita el candado).
//
// AVISO: es un candado del lado del navegador; disuade visitas casuales pero NO
// es seguridad real (la contraseña y los datos quedan accesibles para quien
// inspeccione el sitio). Suficiente para una vista previa; quítelo tras aprobar.
//
// Para liberar el portal al público: deje la línea así  →  window.PORTAL_PASSWORD = "";
window.PORTAL_PASSWORD = "ungrdscr";

(function () {
  var PASS = window.PORTAL_PASSWORD || "";
  if (!PASS) return;                                   // sin candado → público
  try { if (localStorage.getItem("scr_acceso") === PASS) return; } catch (e) {}

  // Oculta el contenido (menos la portada de acceso) hasta desbloquear, sin parpadeo.
  var hide = document.createElement("style");
  hide.id = "scr-hide";
  hide.textContent = "html{background:#0E3A66}body>:not(#scr-gate){visibility:hidden !important}";
  (document.head || document.documentElement).appendChild(hide);

  function montar() {
    var ov = document.createElement("div");
    ov.id = "scr-gate";
    ov.setAttribute("style", "position:fixed;inset:0;z-index:2147483647;display:flex;" +
      "align-items:center;justify-content:center;background:#0E3A66;visibility:visible !important;" +
      "font-family:system-ui,'Segoe UI',Roboto,Arial,sans-serif");
    ov.innerHTML =
      '<div style="background:#fff;max-width:370px;width:88%;padding:28px 24px;border-radius:14px;' +
      'box-shadow:0 20px 60px rgba(0,0,0,.35);text-align:center">' +
      '<img src="assets/logo/ungrd-horizontal.png" alt="UNGRD" style="height:46px;margin-bottom:14px">' +
      '<h1 style="font-size:16px;color:#0E3A66;margin:0 0 4px;line-height:1.25">Escenarios Incendios Forestales y Capacidades del SNGRD</h1>' +
      '<p style="font-size:12.5px;color:#5B6878;margin:0 0 16px">Vista previa · acceso restringido.<br>Ingrese la contraseña para continuar.</p>' +
      '<input id="scr-pass" type="password" autocomplete="off" inputmode="text" placeholder="Contraseña" ' +
      'style="width:100%;box-sizing:border-box;padding:10px 12px;font-size:15px;border:1px solid #d9dee5;border-radius:9px;outline:none">' +
      '<div id="scr-err" style="color:#C0392B;font-size:12px;height:16px;margin:6px 0 0"></div>' +
      '<button id="scr-ok" style="margin-top:8px;width:100%;padding:10px;font-size:15px;font-weight:600;' +
      'color:#fff;background:#F7941D;border:0;border-radius:9px;cursor:pointer">Entrar</button>' +
      '<p style="font-size:10.5px;color:#9aa4b1;margin:14px 0 0">UNGRD · Subdirección para el Conocimiento del Riesgo</p>' +
      '</div>';
    document.body.appendChild(ov);
    var inp = ov.querySelector("#scr-pass"), err = ov.querySelector("#scr-err"), ok = ov.querySelector("#scr-ok");
    function probar() {
      if (inp.value === PASS) {
        try { localStorage.setItem("scr_acceso", PASS); } catch (e) {}
        var h = document.getElementById("scr-hide"); if (h) h.remove();
        ov.remove();
      } else { err.textContent = "Contraseña incorrecta."; inp.value = ""; inp.focus(); }
    }
    ok.addEventListener("click", probar);
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") probar(); });
    setTimeout(function () { inp.focus(); }, 50);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", montar);
  else montar();
})();

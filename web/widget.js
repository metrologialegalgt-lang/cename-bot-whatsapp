/*!
 * Asistente virtual del CENAME — widget de chat para el sitio web
 * Se carga con una sola línea en WordPress:
 *   <script src="https://SU-SERVICIO.onrender.com/widget.js" defer></script>
 * La configuración la incrusta el servidor al servir este archivo.
 */
(function () {
  "use strict";
  if (window.__cenameChatCargado) return; // evita cargarlo dos veces
  window.__cenameChatCargado = true;

  var CFG = __CENAME_CFG__;
  var CLAVE = "cenameChat.v1";
  var MAX_CARACTERES = 600;
  var MAX_GUARDADOS = 40;

  var SUGERENCIAS = [
    "¿Cuánto cuesta calibrar una balanza de 10 kg?",
    "¿Qué intervalos cubre el laboratorio de presión?",
    "¿Qué cursos de metrología tienen disponibles?",
  ];

  // ---------- Estado de la conversación (se conserva al navegar por el sitio) ----------
  function nuevaSesion() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var s = "";
    for (var i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s;
  }
  function leerEstado() {
    try {
      var e = JSON.parse(sessionStorage.getItem(CLAVE));
      if (e && e.sesion && Array.isArray(e.mensajes)) return e;
    } catch (_) {}
    return null;
  }
  var estado = leerEstado() || { sesion: nuevaSesion(), mensajes: [], abierto: false };
  function guardar() {
    try {
      estado.mensajes = estado.mensajes.slice(-MAX_GUARDADOS);
      sessionStorage.setItem(CLAVE, JSON.stringify(estado));
    } catch (_) {}
  }

  // ---------- Formato seguro del texto del asistente ----------
  // Primero se escapa TODO el HTML; recién después se convierten negritas,
  // enlaces y correos. Así ningún texto puede inyectar código en la página.
  function escapar(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function formatear(texto) {
    var h = escapar(texto);
    h = h.replace(
      /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    h = h.replace(
      /(^|[\s(>])([a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,})/g,
      '$1<a href="mailto:$2">$2</a>'
    );
    h = h.replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>");
    h = h.replace(/\n/g, "<br>");
    return h;
  }

  // ---------- Estilos (aislados dentro del Shadow DOM) ----------
  var ESTILOS = [
    ":host{all:initial}",
    "*{box-sizing:border-box;margin:0;padding:0}",
    ".raiz{--tinta:#0F2A47;--papel:#F5F7FA;--acero:#5B6B7E;--linea:#DCE2EA;--senal:#F0B429;",
    "font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;",
    "font-size:15px;line-height:1.45;color:var(--tinta)}",

    /* Botón que abre el chat */
    ".lanzador{position:fixed;right:20px;bottom:calc(20px + env(safe-area-inset-bottom,0px));z-index:2147483000;",
    "display:flex;align-items:center;background:var(--tinta);color:#fff;border:0;border-radius:28px;",
    "padding:13px 20px 13px 16px;font:inherit;font-weight:600;cursor:pointer;",
    "box-shadow:0 6px 20px rgba(15,42,71,.35)}",
    ".lanzador svg{width:22px;height:22px;margin-right:9px;flex-shrink:0}",
    ".lanzador:hover{background:#163A60}",
    ".lanzador[aria-expanded=true]{display:none}",

    /* Panel */
    ".panel{position:fixed;right:20px;bottom:calc(20px + env(safe-area-inset-bottom,0px));z-index:2147483001;",
    "width:380px;height:min(600px,calc(100vh - 40px));background:var(--papel);border-radius:14px;",
    "display:flex;flex-direction:column;overflow:hidden;",
    "box-shadow:0 18px 50px rgba(15,42,71,.28),0 2px 6px rgba(15,42,71,.12)}",
    ".panel[hidden]{display:none}",
    "@media (prefers-reduced-motion:no-preference){.panel.entra{animation:entra .18s ease-out}}",
    "@keyframes entra{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}",

    /* Encabezado con la escala graduada */
    ".cabecera{background:var(--tinta);color:#fff;padding:16px 16px 0;position:relative}",
    ".titulo{font-weight:700;font-size:16px;padding-right:40px}",
    ".subtitulo{font-size:13px;color:#B9C6D6;margin-top:2px;padding-right:40px}",
    ".cerrar{position:absolute;top:10px;right:10px;width:36px;height:36px;border:0;border-radius:8px;",
    "background:transparent;color:#fff;cursor:pointer;font:inherit;font-size:22px;line-height:1}",
    ".cerrar:hover{background:rgba(255,255,255,.12)}",
    ".escala{position:relative;height:12px;margin-top:12px;",
    "background:repeating-linear-gradient(to right,rgba(255,255,255,.55) 0 1px,transparent 1px 8px) left top/100% 5px no-repeat,",
    "repeating-linear-gradient(to right,rgba(255,255,255,.75) 0 1.5px,transparent 1.5px 40px) left top/100% 10px no-repeat;",
    "border-top:1px solid rgba(255,255,255,.55)}",
    ".indice{position:absolute;left:-1px;top:-1px;width:0;height:0;",
    "border-left:6px solid transparent;border-right:6px solid transparent;border-top:9px solid var(--senal)}",

    /* Conversación */
    ".mensajes{flex:1;overflow-y:auto;padding:16px 14px 8px;scroll-behavior:smooth}",
    ".msj{max-width:86%;padding:10px 13px;border-radius:12px;margin-bottom:10px;word-wrap:break-word;overflow-wrap:anywhere}",
    ".msj a{color:inherit;text-decoration:underline}",
    ".bot{background:#fff;border:1px solid var(--linea);border-bottom-left-radius:4px}",
    ".bot a{color:#1D5C99}",
    ".usuario{background:var(--tinta);color:#fff;margin-left:auto;border-bottom-right-radius:4px}",
    ".sistema{background:#FFF6E0;border:1px solid #F2D58A;color:#6B4E00;font-size:14px;max-width:100%}",
    ".escribiendo{display:inline-flex;padding:13px 14px}",
    ".escribiendo i{width:7px;height:7px;border-radius:50%;background:var(--acero);margin-right:4px;opacity:.4}",
    ".escribiendo i:last-child{margin-right:0}",
    "@media (prefers-reduced-motion:no-preference){.escribiendo i{animation:punto 1.2s infinite}",
    ".escribiendo i:nth-child(2){animation-delay:.2s}.escribiendo i:nth-child(3){animation-delay:.4s}}",
    "@keyframes punto{0%,60%,100%{opacity:.35}30%{opacity:1}}",
    ".nota{font-size:13px;color:var(--acero);margin:-2px 0 10px 2px}",

    /* Sugerencias iniciales */
    ".sugerencias{margin:4px 0 10px}",
    ".sug{display:block;width:100%;text-align:left;background:transparent;border:1px solid var(--linea);",
    "border-radius:10px;padding:9px 12px;margin-bottom:7px;font:inherit;font-size:14px;color:var(--tinta);cursor:pointer}",
    ".sug:hover{background:#fff;border-color:#B8C4D3}",

    /* Botón de encuesta */
    ".encuesta{display:inline-block;background:#fff;border:1.5px solid var(--tinta);color:var(--tinta);",
    "border-radius:10px;padding:9px 14px;font-weight:600;font-size:14px;text-decoration:none;margin-bottom:10px}",
    ".encuesta:hover{background:var(--tinta);color:#fff}",

    /* Redacción */
    ".redaccion{border-top:1px solid var(--linea);background:#fff;padding:10px}",
    ".fila{display:flex;align-items:flex-end}",
    "textarea{flex:1;resize:none;border:1px solid var(--linea);border-radius:10px;padding:10px 12px;",
    "font:inherit;color:var(--tinta);max-height:120px;min-height:44px;background:#fff}",
    "textarea::placeholder{color:#8A97A8}",
    ".enviar{margin-left:8px;height:44px;padding:0 16px;border:0;border-radius:10px;background:var(--tinta);",
    "color:#fff;font:inherit;font-weight:600;cursor:pointer}",
    ".enviar:disabled{opacity:.45;cursor:not-allowed}",
    ".pie{font-size:12px;color:var(--acero);margin-top:8px;line-height:1.4}",
    ".pie a,.pie button{color:var(--acero);text-decoration:underline;background:none;border:0;font:inherit;cursor:pointer;padding:0}",

    /* Foco visible */
    "button:focus-visible,a:focus-visible,textarea:focus-visible{outline:2px solid #1D5C99;outline-offset:2px}",
    ".cabecera button:focus-visible,.lanzador:focus-visible{outline-color:var(--senal)}",

    /* Móvil: pantalla completa */
    "@media (max-width:520px){.panel{right:0;bottom:0;width:100%;height:100%;border-radius:0}",
    ".lanzador{right:14px;bottom:calc(14px + env(safe-area-inset-bottom,0px))}}",
  ].join("");

  var ICONO =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"/></svg>';

  // ---------- Construcción ----------
  var anfitrion = document.createElement("div");
  anfitrion.id = "cename-chat";
  var sombra = anfitrion.attachShadow({ mode: "open" });
  sombra.innerHTML =
    "<style>" + ESTILOS + "</style>" +
    '<div class="raiz">' +
    '<button class="lanzador" type="button" aria-expanded="false" aria-controls="panel" aria-label="Abrir el asistente del CENAME">' +
    ICONO + "Consultas</button>" +
    '<section class="panel" id="panel" role="dialog" aria-label="Asistente del CENAME" hidden>' +
    '<header class="cabecera">' +
    '<div class="titulo">Asistente del CENAME</div>' +
    '<div class="subtitulo">Tarifas, alcances y laboratorios</div>' +
    '<button class="cerrar" type="button" aria-label="Cerrar el asistente">&times;</button>' +
    '<div class="escala" aria-hidden="true"><div class="indice"></div></div>' +
    "</header>" +
    '<div class="mensajes" aria-live="polite"></div>' +
    '<div class="redaccion">' +
    '<div class="fila">' +
    '<textarea rows="1" maxlength="' + MAX_CARACTERES + '" placeholder="Escriba su consulta" aria-label="Escriba su consulta"></textarea>' +
    '<button class="enviar" type="button">Enviar</button>' +
    "</div>" +
    '<p class="pie">Asistente automatizado: las cotizaciones formales las emite cada laboratorio. ' +
    (CFG.aviso ? '<a href="' + escapar(CFG.aviso) + '" target="_blank" rel="noopener noreferrer">Aviso de privacidad</a>. ' : "") +
    '<button class="reiniciar" type="button">Nueva conversación</button></p>' +
    "</div>" +
    "</section>" +
    "</div>";

  function montar() {
    document.body.appendChild(anfitrion);
  }
  if (document.body) montar();
  else document.addEventListener("DOMContentLoaded", montar);

  var $ = function (s) { return sombra.querySelector(s); };
  var lanzador = $(".lanzador");
  var panel = $(".panel");
  var lista = $(".mensajes");
  var campo = $("textarea");
  var botonEnviar = $(".enviar");
  var ocupado = false;

  // ---------- Pintado ----------
  function burbuja(tipo, html) {
    var d = document.createElement("div");
    d.className = "msj " + tipo;
    d.innerHTML = html;
    lista.appendChild(d);
    return d;
  }
  function pintarEncuesta(url) {
    var a = document.createElement("a");
    a.className = "encuesta";
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "Evaluar el servicio";
    lista.appendChild(a);
  }
  function bajar() { lista.scrollTop = lista.scrollHeight; }

  function pintarTodo() {
    lista.innerHTML = "";
    burbuja(
      "bot",
      formatear(
        "Le atiende el asistente automatizado del CENAME. Puede preguntarme por *tarifas*, *alcances de medición*, *laboratorios* y *cursos*.\n\nPara atención de una persona del CENAME: info@cename.gt"
      )
    );
    var hayPreguntas = estado.mensajes.some(function (m) { return m.tipo === "usuario"; });
    if (!hayPreguntas) {
      var cont = document.createElement("div");
      cont.className = "sugerencias";
      SUGERENCIAS.forEach(function (s) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "sug";
        b.textContent = s;
        b.addEventListener("click", function () { enviar(s); });
        cont.appendChild(b);
      });
      lista.appendChild(cont);
    }
    estado.mensajes.forEach(function (m) {
      if (m.tipo === "encuesta") pintarEncuesta(m.texto);
      else burbuja(m.tipo, m.tipo === "usuario" ? escapar(m.texto).replace(/\n/g, "<br>") : formatear(m.texto));
    });
    bajar();
  }

  function agregar(tipo, texto) {
    estado.mensajes.push({ tipo: tipo, texto: texto });
    guardar();
    if (tipo === "usuario") {
      var sug = lista.querySelector(".sugerencias");
      if (sug) sug.remove();
    }
    if (tipo === "encuesta") pintarEncuesta(texto);
    else burbuja(tipo, tipo === "usuario" ? escapar(texto).replace(/\n/g, "<br>") : formatear(texto));
    bajar();
  }

  // ---------- Abrir y cerrar ----------
  function abrir() {
    panel.hidden = false;
    panel.classList.remove("entra");
    void panel.offsetWidth; // reinicia la animación
    panel.classList.add("entra");
    lanzador.setAttribute("aria-expanded", "true");
    estado.abierto = true;
    guardar();
    pintarTodo();
    setTimeout(function () { campo.focus(); }, 30);
  }
  function cerrar() {
    panel.hidden = true;
    lanzador.setAttribute("aria-expanded", "false");
    estado.abierto = false;
    guardar();
    lanzador.focus();
  }
  lanzador.addEventListener("click", abrir);
  $(".cerrar").addEventListener("click", cerrar);
  panel.addEventListener("keydown", function (e) { if (e.key === "Escape") cerrar(); });
  $(".reiniciar").addEventListener("click", function () {
    estado = { sesion: nuevaSesion(), mensajes: [], abierto: true };
    guardar();
    pintarTodo();
    campo.focus();
  });

  // ---------- Envío ----------
  function ajustarAltura() {
    campo.style.height = "auto";
    campo.style.height = Math.min(campo.scrollHeight, 120) + "px";
  }
  campo.addEventListener("input", ajustarAltura);
  campo.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      enviar(campo.value);
    }
  });
  botonEnviar.addEventListener("click", function () { enviar(campo.value); });

  var MENSAJES_ERROR = {
    limite_visitante: "Ha enviado varios mensajes seguidos. Espere unos minutos para continuar, o escriba a info@cename.gt.",
    limite_diario: "El asistente alcanzó su límite de consultas de hoy. Puede escribir a info@cename.gt y le atenderemos.",
    cuota_agotada: "El asistente no está disponible en este momento. Intente más tarde, o escriba a info@cename.gt.",
    mensaje_largo: "Su mensaje supera los " + MAX_CARACTERES + " caracteres. Resúmalo e intente de nuevo.",
    red: "No se pudo enviar el mensaje. Revise su conexión e intente de nuevo.",
    tiempo: "El asistente tardó demasiado en responder. Intente de nuevo en un momento.",
    otro: "No se pudo procesar su consulta. Intente de nuevo, o escriba a info@cename.gt.",
  };

  function enviar(texto) {
    texto = String(texto || "").trim();
    if (!texto || ocupado) return;
    if (texto.length > MAX_CARACTERES) { agregar("sistema", MENSAJES_ERROR.mensaje_largo); return; }

    agregar("usuario", texto);
    campo.value = "";
    ajustarAltura();
    ocupado = true;
    botonEnviar.disabled = true;

    var indicador = document.createElement("div");
    indicador.className = "msj bot escribiendo";
    indicador.setAttribute("aria-label", "El asistente está escribiendo");
    indicador.innerHTML = "<i></i><i></i><i></i>";
    lista.appendChild(indicador);
    bajar();

    // Si el servicio estaba en reposo, la primera respuesta puede tardar
    var nota = null;
    var avisoLento = setTimeout(function () {
      nota = document.createElement("p");
      nota.className = "nota";
      nota.textContent = "El servicio se está iniciando; la primera respuesta puede tardar hasta un minuto.";
      lista.appendChild(nota);
      bajar();
    }, 8000);

    var ctrl = window.AbortController ? new AbortController() : null;
    var limite = setTimeout(function () { if (ctrl) ctrl.abort(); }, 90000);

    fetch(CFG.api, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sesion: estado.sesion, mensaje: texto }),
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) { return { r: r, d: d }; });
      })
      .then(function (x) {
        indicador.remove();
        if (x.r.ok && x.d.respuesta) {
          agregar("bot", x.d.respuesta);
          if (x.d.encuesta) agregar("encuesta", x.d.encuesta);
        } else {
          agregar("sistema", MENSAJES_ERROR[x.d.error] || MENSAJES_ERROR.otro);
        }
      })
      .catch(function (e) {
        indicador.remove();
        agregar("sistema", e && e.name === "AbortError" ? MENSAJES_ERROR.tiempo : MENSAJES_ERROR.red);
      })
      .then(function () {
        clearTimeout(avisoLento);
        clearTimeout(limite);
        if (nota) nota.remove();
        ocupado = false;
        botonEnviar.disabled = false;
        campo.focus();
      });
  }

  // Si la persona tenía el chat abierto al cambiar de página, se reabre
  if (estado.abierto) {
    if (document.body) abrir();
    else document.addEventListener("DOMContentLoaded", abrir);
  }
})();


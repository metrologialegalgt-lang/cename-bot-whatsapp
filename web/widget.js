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
    "display:flex;align-items:center;background:var(--tinta);color:#fff;border:0;border-radius:36px;",
    "padding:5px 20px 5px 5px;font:inherit;font-weight:600;cursor:pointer;",
    "box-shadow:0 6px 20px rgba(15,42,71,.35)}",
    ".lanzador svg{width:22px;height:22px;margin:0 9px 0 11px;flex-shrink:0}",
    ".lanzador img{width:56px;height:56px;border-radius:50%;margin-right:11px;flex-shrink:0;border:2px solid #fff;background:#FFF1D6}",
    ".lanzador .l1{display:block;font-size:15px;line-height:1.15}",
    ".lanzador .l2{display:block;font-size:12px;font-weight:400;color:#B9C6D6;line-height:1.2}",
    ".lanzador .textos{text-align:left}",
    ".lanzador:hover{background:#163A60}",
    ".lanzador[aria-expanded=true]{display:none}",


    /* ---- B'alamper como lanzador ---- */
    ".mascota-cont{position:fixed;right:18px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:2147483000}",
    ".lanzador.mascota{position:relative;right:auto;bottom:auto;display:block;background:none;box-shadow:none;",
    "padding:0;border-radius:16px;color:inherit}",
    ".lanzador.mascota:hover{background:none}",
    ".lanzador.mascota:focus-visible{outline:3px solid #1D5C99;outline-offset:4px}",
    ".mascota .cuerpo{position:relative;display:block}",
    ".mascota img{display:block;height:130px;width:auto;border:0;border-radius:0;margin:0;background:none;",
    "filter:drop-shadow(0 6px 10px rgba(15,42,71,.28));transform-origin:50% 92%;transition:transform .25s ease}",
    ".mascota:hover img,.mascota:focus-visible img{transform:rotate(-5deg) scale(1.05)}",
    ".mascota:active img{transform:scale(.93)}",
    /* chispas del enchufe */
    ".chispas{position:absolute;left:0;top:34%;width:36%;height:28%;pointer-events:none}",
    ".chispas svg{position:absolute;width:30%;fill:#6FE6F5;opacity:0;filter:drop-shadow(0 0 4px #2FD3EA)}",
    ".chispas svg:nth-child(1){left:6%;top:0}",
    ".chispas svg:nth-child(2){left:55%;top:14%}",
    ".chispas svg:nth-child(3){left:22%;top:58%}",
    ".mascota:hover .chispas svg,.mascota:focus-visible .chispas svg{opacity:.9}",
    /* globo de saludo */
    ".globo{position:absolute;right:96px;bottom:92px;width:224px;background:#fff;color:var(--tinta);",
    "border-radius:14px;padding:12px 32px 12px 14px;font-size:14px;line-height:1.4;",
    "box-shadow:0 10px 30px rgba(15,42,71,.22)}",
    ".globo[hidden]{display:none}",
    ".globo::after{content:'';position:absolute;right:-6px;bottom:20px;width:13px;height:13px;background:#fff;",
    "transform:rotate(45deg);border-radius:2px}",
    ".globo-texto{display:block;width:100%;text-align:left;background:none;border:0;padding:0;font:inherit;",
    "color:inherit;cursor:pointer}",
    ".globo-cerrar{position:absolute;top:5px;right:6px;width:26px;height:26px;border:0;background:none;",
    "font-size:18px;line-height:1;color:var(--acero);cursor:pointer;border-radius:6px}",
    ".globo-cerrar:hover{background:var(--papel)}",
    /* movimiento: solo si la persona no pidió reducirlo */
    "@media (prefers-reduced-motion:no-preference){",
    ".mascota .cuerpo{animation:flota 4.2s ease-in-out infinite}",
    ".mascota-cont.asoma{animation:asoma .55s cubic-bezier(.2,1.4,.4,1) both}",
    ".mascota.saluda img{animation:salto .65s ease 2}",
    ".mascota.saluda .chispas svg,.mascota:hover .chispas svg,.mascota:focus-visible .chispas svg{animation:chispa .9s ease-in-out infinite}",
    ".chispas svg:nth-child(2){animation-delay:.3s!important}",
    ".chispas svg:nth-child(3){animation-delay:.55s!important}",
    ".globo.entra{animation:entra .25s ease-out}}",
    "@keyframes flota{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}",
    "@keyframes asoma{from{opacity:0;transform:translateY(40px) scale(.85)}to{opacity:1;transform:none}}",
    "@keyframes salto{0%,100%{transform:translateY(0)}40%{transform:translateY(-14px) rotate(-4deg)}70%{transform:translateY(0) rotate(0)}}",
    "@keyframes chispa{0%,100%{opacity:0;transform:scale(.6)}40%{opacity:1;transform:scale(1.1)}60%{opacity:.35}}",
    /* Panel */
    ".panel{position:fixed;right:20px;bottom:calc(20px + env(safe-area-inset-bottom,0px));z-index:2147483001;",
    "width:380px;height:min(600px,calc(100vh - 40px));background:var(--papel);border-radius:14px;",
    "display:flex;flex-direction:column;overflow:hidden;",
    "box-shadow:0 18px 50px rgba(15,42,71,.28),0 2px 6px rgba(15,42,71,.12)}",
    ".panel[hidden]{display:none}",
    "@media (prefers-reduced-motion:no-preference){.panel.entra{animation:entra .18s ease-out}}",
    "@keyframes entra{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}",

    /* Encabezado con la escala graduada */
    ".cabecera{background:var(--tinta);color:#fff;padding:14px 16px 0;position:relative}",
    ".identidad{display:flex;align-items:center;padding-right:40px}",
    ".identidad img{width:44px;height:44px;border-radius:50%;margin-right:11px;flex-shrink:0;border:2px solid #fff;background:#FFF1D6}",
    ".titulo{font-weight:700;font-size:16px}",
    ".subtitulo{font-size:13px;color:#B9C6D6;margin-top:1px}",
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
    ".lanzador{right:14px;bottom:calc(14px + env(safe-area-inset-bottom,0px));padding:4px}",
    ".lanzador.con-avatar .textos{display:none}.lanzador.con-avatar img{margin-right:0}",
    ".mascota img{height:100px}.mascota-cont{right:10px}",
    ".globo{right:74px;bottom:70px;width:190px;font-size:13px}}",
  ].join("");

  var RAYO =
    '<svg viewBox="0 0 13 16" aria-hidden="true"><path d="M8 0 2 9h4l-2 7 7-10H7l2-6z"/></svg>';
  var ICONO =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"/></svg>';

  // ---------- Construcción ----------
  var anfitrion = document.createElement("div");
  anfitrion.id = "cename-chat";
  var sombra = anfitrion.attachShadow({ mode: "open" });
  sombra.innerHTML =
    "<style>" + ESTILOS + "</style>" +
    '<div class="raiz">' +
    (CFG.figura
      ? '<div class="mascota-cont asoma">' +
        '<div class="globo" hidden role="status">' +
        '<button class="globo-texto" type="button">¡Hola! Soy <strong>' + escapar(CFG.asistente) + '</strong>. ¿Le ayudo con tarifas o servicios del CENAME?</button>' +
        '<button class="globo-cerrar" type="button" aria-label="Cerrar el saludo">&times;</button></div>' +
        '<button class="lanzador mascota" type="button" aria-expanded="false" aria-controls="panel" aria-label="Abrir el chat con ' + escapar(CFG.asistente) + ', asistente del CENAME">' +
        '<span class="cuerpo"><img src="' + escapar(CFG.figura) + '" alt="">' +
        '<span class="chispas" aria-hidden="true">' + RAYO + RAYO + RAYO + "</span></span></button></div>"
      : "") +
    (CFG.figura ? "" : '<button class="lanzador' + (CFG.avatar ? " con-avatar" : "") + '" type="button" aria-expanded="false" aria-controls="panel" aria-label="Abrir el chat con ' + escapar(CFG.asistente) + ', asistente del CENAME">' +
    (CFG.avatar ? '<img src="' + escapar(CFG.avatar) + '" alt="">' : ICONO) +
    '<span class="textos"><span class="l1">Pregúntele a ' + escapar(CFG.asistente) + '</span>' +
    '<span class="l2">Tarifas y servicios del CENAME</span></span></button>') +
    '<section class="panel" id="panel" role="dialog" aria-label="' + escapar(CFG.asistente) + ', asistente del CENAME" hidden>' +
    '<header class="cabecera">' +
    '<div class="identidad">' +
    (CFG.avatar ? '<img src="' + escapar(CFG.avatar) + '" alt="">' : "") +
    '<div><div class="titulo">' + escapar(CFG.asistente) + '</div>' +
    '<div class="subtitulo">' + escapar(CFG.titulo || "Asistente del CENAME") + '</div></div>' +
    "</div>" +
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

  // ---------- B'alamper: saludo único por visita ----------
  var contMascota = $(".mascota-cont");
  var globo = $(".globo");
  function ocultarGlobo() { if (globo) globo.hidden = true; }
  if (globo) {
    $(".globo-texto").addEventListener("click", function () { ocultarGlobo(); abrir(); });
    $(".globo-cerrar").addEventListener("click", ocultarGlobo);
    var yaSaludo = false;
    try { yaSaludo = sessionStorage.getItem(CLAVE + ".saludo") === "1"; } catch (_) {}
    if (!yaSaludo && !estado.abierto) {
      setTimeout(function () {
        if (!panel.hidden) return; // si ya abrió el chat, no interrumpe
        globo.hidden = false;
        globo.classList.add("entra");
        lanzador.classList.add("saluda");
        try { sessionStorage.setItem(CLAVE + ".saludo", "1"); } catch (_) {}
        setTimeout(function () { lanzador.classList.remove("saluda"); }, 2600);
        setTimeout(ocultarGlobo, 9000);
      }, 3000);
    }
  }

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
        "Hola, soy *" + CFG.asistente + "*" + (CFG.titulo ? ", el " + CFG.titulo : "") +
          ": el asistente automatizado del CENAME. Puedo ayudarle con *tarifas*, *alcances de medición*, *laboratorios* y *cursos*.\n\nPara atención de una persona del CENAME: info@cename.gt"
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
    ocultarGlobo();
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
    if (contMascota) {
      contMascota.classList.remove("asoma");
      void contMascota.offsetWidth; // reinicia la animación
      contMascota.classList.add("asoma");
    }
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
    servicio_saturado: "El asistente está recibiendo muchas consultas en este momento. Intente de nuevo en unos minutos, o escriba a info@cename.gt.",
    mensaje_largo: "Su mensaje supera los " + MAX_CARACTERES + " caracteres. Resúmalo e intente de nuevo.",
    red: "No se pudo enviar el mensaje. Revise su conexión e intente de nuevo.",
    tiempo: "El asistente tardó demasiado en responder. Intente de nuevo en un momento.",
    otro: "No se pudo procesar su consulta. Intente de nuevo, o escriba a info@cename.gt.",
  };

  // Fallas pasajeras que vale la pena reintentar solas, sin molestar a la persona
  // El servidor ya espera pacientemente la respuesta del modelo, así que el
  // navegador reintenta una sola vez y nunca por "tiempo": sería mandar una
  // consulta nueva mientras la anterior aún se está respondiendo.
  var REINTENTABLES = { servicio_saturado: true, red: true };
  var ESPERAS_AUTO = []; // sin reintentos automáticos: la persona decide con el botón "Reintentar"
  // Debe ser MAYOR que el presupuesto de tiempo del servidor (unos 65 s en el
  // peor caso). Así el navegador nunca reintenta mientras el servidor sigue
  // trabajando en la misma pregunta, lo que gastaría el doble de cuota.
  var LIMITE_ESPERA_MS = CFG.espera || 80000;

  function enviar(texto) {
    texto = String(texto || "").trim();
    if (!texto || ocupado) return;
    if (texto.length > MAX_CARACTERES) { mostrarError("mensaje_largo"); return; }
    agregar("usuario", texto);
    campo.value = "";
    ajustarAltura();
    intentarEnvio(texto, 0);
  }

  function nota(texto) {
    var p = document.createElement("p");
    p.className = "nota";
    p.textContent = texto;
    lista.appendChild(p);
    bajar();
    return p;
  }

  // Los errores no se guardan en el historial: son avisos del momento
  function mostrarError(codigo, textoParaReintentar) {
    var d = burbuja("sistema", escapar(MENSAJES_ERROR[codigo] || MENSAJES_ERROR.otro));
    if (textoParaReintentar) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "sug reintentar";
      b.textContent = "Reintentar";
      b.style.marginTop = "8px";
      b.addEventListener("click", function () {
        if (ocupado) return;
        d.remove();
        intentarEnvio(textoParaReintentar, 0);
      });
      d.appendChild(b);
    }
    bajar();
  }

  function intentarEnvio(texto, intento) {
    ocupado = true;
    botonEnviar.disabled = true;

    var indicador = document.createElement("div");
    indicador.className = "msj bot escribiendo";
    indicador.setAttribute("aria-label", "El asistente está escribiendo");
    indicador.innerHTML = "<i></i><i></i><i></i>";
    lista.appendChild(indicador);
    bajar();

    // Si el servicio estaba en reposo, la primera respuesta puede tardar
    var notaLenta = null;
    var avisoLento = setTimeout(function () {
      notaLenta = nota("La respuesta está tardando un poco más de lo habitual. Seguimos esperando, no cierre el chat.");
    }, 10000);

    var ctrl = window.AbortController ? new AbortController() : null;
    var corte = setTimeout(function () { if (ctrl) ctrl.abort(); }, LIMITE_ESPERA_MS);

    function limpiar() {
      clearTimeout(avisoLento);
      clearTimeout(corte);
      if (notaLenta) notaLenta.remove();
      indicador.remove();
    }
    function terminar() {
      ocupado = false;
      botonEnviar.disabled = false;
      campo.focus();
    }
    function fallar(codigo) {
      limpiar();
      if (REINTENTABLES[codigo] && intento < ESPERAS_AUTO.length) {
        var n = nota(
          "El asistente está ocupado en este momento. Reintentando automáticamente (" +
            (intento + 2) + " de " + (ESPERAS_AUTO.length + 1) + ")…"
        );
        setTimeout(function () {
          n.remove();
          intentarEnvio(texto, intento + 1);
        }, ESPERAS_AUTO[intento]);
        return; // sigue ocupado durante la espera
      }
      mostrarError(codigo, REINTENTABLES[codigo] || codigo === "otro" ? texto : null);
      terminar();
    }

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
        if (x.r.ok && x.d.respuesta) {
          limpiar();
          agregar("bot", x.d.respuesta);
          if (x.d.encuesta) agregar("encuesta", x.d.encuesta);
          terminar();
        } else {
          fallar(MENSAJES_ERROR[x.d.error] ? x.d.error : "otro");
        }
      })
      .catch(function (e) {
        fallar(e && e.name === "AbortError" ? "tiempo" : "red");
      });
  }

  // Si la persona tenía el chat abierto al cambiar de página, se reabre
  if (estado.abierto) {
    if (document.body) abrir();
    else document.addEventListener("DOMContentLoaded", abrir);
  }
})();

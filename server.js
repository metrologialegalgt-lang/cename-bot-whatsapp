// ============================================================
// Bot de atención al cliente por WhatsApp
// WhatsApp Cloud API (Meta) + Claude API (Anthropic)
// ============================================================
// Arquitectura:
//   Cliente escribe por WhatsApp -> Meta envía webhook POST aquí
//   -> se arma el contexto (config del negocio + historial)
//   -> Claude genera la respuesta -> se envía de vuelta por Graph API
// ============================================================

require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
app.use(express.json());
// Archivos públicos (imagen de la encuesta de satisfacción)
app.use(express.static(path.join(__dirname, "public")));

// ------------------------------------------------------------
// Configuración
// ------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN; // lo inventas tú, se usa al registrar el webhook
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN; // token de acceso de Meta
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID; // ID del número de WhatsApp (no es el número)
const BUSINESS_CONFIG = process.env.BUSINESS_CONFIG || "demo"; // qué negocio atiende esta instancia

// Imagen de encuesta de satisfacción que se envía al cerrar la conversación.
// Se sirve desde este mismo servidor (carpeta /public). Para desactivarla,
// deja ENCUESTA_URL vacía.
const BASE_URL = (process.env.BASE_URL || "").replace(/\/$/, "");
const ENCUESTA_URL =
  process.env.ENCUESTA_URL ||
  (BASE_URL ? `${BASE_URL}/evaluacion.jpg` : "");
const ENCUESTA_TEXTO =
  process.env.ENCUESTA_TEXTO ||
  "Gracias por comunicarse con el CENAME 🙌 Su opinión nos ayuda a mejorar: escanee el código para responder nuestra breve evaluación del servicio.";

// Proveedor de IA:
//   "gemini"    -> gratuito, límites de tokens amplios (ideal para prompts grandes)
//   "groq"      -> gratuito, muy rápido, pero límite de tokens por día bajo
//   "anthropic" -> de pago, mejor seguimiento de instrucciones
const LLM_PROVIDER = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
const MODELOS_POR_DEFECTO = {
  groq: "llama-3.3-70b-versatile",
  gemini: "gemini-3.6-flash",
  anthropic: process.env.CLAUDE_MODEL || "claude-haiku-4-5",
};
const MODEL = process.env.LLM_MODEL || MODELOS_POR_DEFECTO[LLM_PROVIDER];

const anthropic =
  LLM_PROVIDER === "anthropic"
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

// Llamada unificada al LLM: recibe el historial, devuelve el texto de respuesta
async function consultarLLM(mensajes) {
  if (LLM_PROVIDER === "anthropic") {
    const respuesta = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: mensajes,
    });
    return respuesta.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }

  if (LLM_PROVIDER === "gemini") {
    // Gemini: key gratis en aistudio.google.com/apikey
    // Gemini 3.x razona por defecto en nivel HIGH y ese razonamiento consume
    // tokens de salida: con presupuesto bajo la respuesta sale vacía. Se intenta
    // con el nivel configurado y, si vuelve vacía, se reintenta una sola vez
    // con razonamiento mínimo y más tokens antes de rendirse.
    // Los modelos Flash-Lite tienen un defecto conocido: a veces devuelven
    // respuesta vacía (finishReason MALFORMED_RESPONSE o STOP sin texto).
    // Por eso el reintento puede hacerse contra un modelo alterno.
    const intentos = [
      {
        modelo: MODEL,
        nivel: process.env.GEMINI_THINKING || "low",
        tokens: Number(process.env.GEMINI_MAX_TOKENS) || 2000,
      },
      {
        modelo: process.env.LLM_MODEL_FALLBACK || MODEL,
        nivel: "minimal",
        tokens: 3000,
      },
    ];

    for (let i = 0; i < intentos.length; i++) {
      const { modelo, nivel, tokens } = intentos[i];
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
        {
          method: "POST",
          headers: {
            "x-goog-api-key": process.env.GEMINI_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: mensajes.map((m) => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content }],
            })),
            generationConfig: {
              maxOutputTokens: tokens,
              thinkingConfig: { thinkingLevel: nivel },
            },
          }),
        }
      );

      if (!resp.ok) {
        const detalle = await resp.text();
        // 429 = cuota agotada o demasiadas solicitudes por minuto.
        const err = new Error(`Gemini API ${resp.status}: ${detalle}`);
        if (resp.status === 429) err.cuotaAgotada = true;
        throw err;
      }

      const data = await resp.json();
      const cand = data.candidates?.[0];
      const partes = cand?.content?.parts || [];
      const texto = partes.map((p) => p.text || "").join("").trim();

      if (texto) return texto;

      const u = data.usageMetadata || {};
      console.warn(
        `⚠️ Gemini vacío (intento ${i + 1}/${intentos.length}) | finishReason=${cand?.finishReason} | ` +
          `modelo=${modelo} nivel=${nivel} tokens=${tokens} | razonamiento=${u.thoughtsTokenCount ?? "?"} salida=${u.candidatesTokenCount ?? "?"}`
      );
    }
    return "";
  }

  // Groq: API compatible con formato OpenAI (key gratis en console.groq.com/keys)
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...mensajes],
    }),
  });
  if (!resp.ok) {
    const detalle = await resp.text();
    const err = new Error(`Groq API ${resp.status}: ${detalle}`);
    if (resp.status === 429) err.cuotaAgotada = true;
    throw err;
  }
  const data = await resp.json();
  return data.choices[0].message.content;
}

// Cargar la configuración del negocio (config/<nombre>.json)
const configPath = path.join(__dirname, "config", `${BUSINESS_CONFIG}.json`);
const negocio = JSON.parse(fs.readFileSync(configPath, "utf8"));
console.log(`✅ Config cargada: ${negocio.nombre}`);
console.log(`🧠 IA: ${LLM_PROVIDER} — modelo: ${MODEL}`);

// ------------------------------------------------------------
// System prompt: se construye desde el JSON del negocio.
// Para agregar un cliente nuevo NO se toca el código,
// solo se crea otro archivo en /config.
// ------------------------------------------------------------
function construirSystemPrompt(n) {
  const secciones = [];

  secciones.push(
    `Eres el asistente virtual de WhatsApp de "${n.nombre}", ${n.descripcion}.`
  );

  // --- Reglas base + reglas extra opcionales del JSON ---
  const reglas = [
    `Responde SIEMPRE en español, con tono ${n.tono || "amable y cercano"}.`,
    `Respuestas cortas y claras: esto es WhatsApp, no un correo. Máximo 4-5 líneas salvo que pidan detalle.`,
    `Usa ÚNICAMENTE la información de este documento. Si no sabes algo, dilo con honestidad y deriva al contacto indicado: ${n.contacto_humano}.`,
    `Nunca inventes precios, tarifas, plazos, alcances ni horarios. Si una tarifa no aparece aquí, di que debe consultarse con el laboratorio o área responsable.`,
    `Puedes usar emojis con moderación (1-2 por mensaje).`,
    `FORMATO DE WHATSAPP: la negrita se escribe con UN solo asterisco (*así*), nunca con dos (**así**), porque los dobles se muestran literalmente al usuario. Para listas usa el guion o el punto medio, no numeración con markdown. No uses encabezados con #.`,
    `EXACTITUD DE CIFRAS: copia cada monto EXACTAMENTE como aparece en este documento, dígito por dígito, incluyendo los ceros (US $400.00 no es US $40.00). Nunca redondees, abrevies ni recalcules una tarifa.`,
    `Nunca anuncies una lista para enviarla después ("los rangos son:" y cortar). Si vas a dar una lista, entrégala completa en el mismo mensaje. Si es muy larga, indica cuántos rangos hay y pregunta sobre cuál quiere el detalle.`,
    `Cuando te pidan "los rangos" o "los alcances" de un servicio, enumera TODOS los que aparecen en el tarifario para esa área, con su tarifa, sin omitir ninguno.`,
  ];
  if (n.accion_principal) {
    reglas.push(
      `Si la persona quiere ${n.accion_principal.nombre}, ${n.accion_principal.instruccion}`
    );
  }
  if (Array.isArray(n.reglas_extra)) reglas.push(...n.reglas_extra);
  secciones.push("REGLAS:\n" + reglas.map((r) => `- ${r}`).join("\n"));

  // --- Datos generales ---
  const datos = [];
  if (n.direccion) datos.push(`📍 Dirección: ${n.direccion}`);
  if (n.horarios) datos.push(`🕐 Horarios: ${n.horarios}`);
  if (n.contacto_humano) datos.push(`📞 Contacto: ${n.contacto_humano}`);
  if (n.sitio_web) datos.push(`🌐 Sitio web: ${n.sitio_web}`);
  if (n.metodos_pago) datos.push(`💳 Forma de pago: ${n.metodos_pago}`);
  if (n.envios) datos.push(`🚚 Envíos: ${n.envios}`);
  if (datos.length) secciones.push("INFORMACIÓN GENERAL:\n" + datos.join("\n"));

  // --- Catálogo simple (formato del demo) ---
  if (Array.isArray(n.catalogo) && n.catalogo.length) {
    secciones.push(
      "CATÁLOGO / SERVICIOS:\n" +
        n.catalogo
          .map((c) => `- ${c.item}: ${c.precio}${c.nota ? ` (${c.nota})` : ""}`)
          .join("\n")
    );
  }

  // --- Tarifario agrupado por área (formato institucional) ---
  if (Array.isArray(n.tarifario) && n.tarifario.length) {
    secciones.push(
      "TARIFARIO VIGENTE (" +
        (n.base_legal || "tarifario oficial") +
        "):\n" +
        n.tarifario
          .map(
            (a) =>
              `▸ ${a.area}${a.articulo ? ` (${a.articulo})` : ""}\n` +
              a.items
                .map(
                  (i) =>
                    `   • ${i.servicio}: ${i.tarifa}${i.nota ? ` — ${i.nota}` : ""}`
                )
                .join("\n") +
              (a.nota ? `\n   ⚠ ${a.nota}` : "")
          )
          .join("\n\n")
    );
  }

  // --- Servicios que NO se prestan actualmente ---
  if (Array.isArray(n.servicios_no_disponibles) && n.servicios_no_disponibles.length) {
    secciones.push(
      "SERVICIOS NO DISPONIBLES ACTUALMENTE (si preguntan por alguno, dilo directamente sin buscar en el tarifario y ofrece info@cename.gt; NO inventes tarifa):\n" +
        n.servicios_no_disponibles.map((x) => `✗ ${x}`).join("\n")
    );
  }

  // --- Directorio de derivación ---
  if (Array.isArray(n.derivaciones) && n.derivaciones.length) {
    secciones.push(
      "DIRECTORIO DE DERIVACIÓN (a quién enviar cada solicitud):\n" +
        n.derivaciones
          .map(
            (d) =>
              `• ${d.area} → ${d.responsable} — ${d.correo}${
                d.palabras_clave ? ` [temas: ${d.palabras_clave}]` : ""
              }`
          )
          .join("\n") +
        (n.copia_obligatoria
          ? `\n\n⚠️ SIEMPRE indica que debe copiarse a ${n.copia_obligatoria} en todo correo, sin excepción.`
          : "")
    );
  }

  // --- Notas importantes ---
  if (Array.isArray(n.notas) && n.notas.length) {
    secciones.push(
      "NOTAS IMPORTANTES:\n" + n.notas.map((x) => `- ${x}`).join("\n")
    );
  }
  // --- Encuesta de satisfacción ---
  if (n.encuesta_satisfaccion) {
    secciones.push("ENCUESTA DE SATISFACCIÓN:\n" + n.encuesta_satisfaccion);
  }
  // --- FAQ ---
  if (Array.isArray(n.faq) && n.faq.length) {
    secciones.push(
      "PREGUNTAS FRECUENTES:\n" +
        n.faq.map((f) => `P: ${f.p}\nR: ${f.r}`).join("\n\n")
    );
  }

  secciones.push(`MARCADOR ESPECIAL (invisible para la persona, úsalo con disciplina):
Cuando la conversación haya concluido —porque la persona se despide, agradece, dice que ya no necesita nada, o porque ya le entregaste la información y la derivación que pedía— agrega al FINAL de tu mensaje, en una línea aparte:
[ENCUESTA]
Úsalo UNA sola vez por conversación y solo al cerrar. No lo uses si la persona todavía tiene dudas pendientes.
Nunca menciones este marcador ni expliques que existe.`);

  return secciones.join("\n\n");
}

const SYSTEM_PROMPT = construirSystemPrompt(negocio);

// ------------------------------------------------------------
// Historial de conversación en memoria (por número de teléfono).
// Suficiente para arrancar; si escalas, cámbialo por Redis/SQLite.
// ------------------------------------------------------------
const historiales = new Map(); // telefono -> { mensajes: [], ultimaActividad: timestamp }
const TTL_MS = 1000 * 60 * 60 * 6; // 6 horas sin actividad = se borra el historial
const MAX_TURNOS = 20; // límite de mensajes recordados por conversación

function obtenerHistorial(telefono) {
  const h = historiales.get(telefono);
  if (!h || Date.now() - h.ultimaActividad > TTL_MS) {
    const nuevo = { mensajes: [], ultimaActividad: Date.now() };
    historiales.set(telefono, nuevo);
    return nuevo;
  }
  return h;
}

// Limpieza periódica de historiales viejos
setInterval(() => {
  const ahora = Date.now();
  for (const [tel, h] of historiales) {
    if (ahora - h.ultimaActividad > TTL_MS) historiales.delete(tel);
  }
}, 1000 * 60 * 30);

// Deduplicación: Meta puede reenviar el mismo webhook varias veces
const mensajesProcesados = new Set();
setInterval(() => mensajesProcesados.clear(), 1000 * 60 * 60);

// ------------------------------------------------------------
// Control de envío de la encuesta: una sola vez por conversación
// ------------------------------------------------------------
async function enviarEncuesta(telefono) {
  if (!ENCUESTA_URL) {
    console.warn(
      "⚠️ Encuesta no enviada: falta configurar BASE_URL (o ENCUESTA_URL) en las variables de entorno"
    );
    return;
  }
  try {
    await enviarImagen(telefono, ENCUESTA_URL, ENCUESTA_TEXTO);
    console.log(`📋 [${telefono}] encuesta de satisfacción enviada`);
  } catch (err) {
    console.error("⚠️ No se pudo enviar la encuesta:", err.message);
  }
}


// ------------------------------------------------------------
// GET /webhook — verificación inicial (Meta lo llama una sola vez
// cuando registras la URL del webhook en el panel de desarrolladores)
// ------------------------------------------------------------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado por Meta");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ------------------------------------------------------------
// POST /webhook — llega cada mensaje del cliente
// ------------------------------------------------------------
app.post("/webhook", async (req, res) => {
  // Responder 200 de inmediato: Meta reintenta si tardas más de unos segundos
  res.sendStatus(200);

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const mensaje = value?.messages?.[0];
    if (!mensaje) return; // puede ser un status de entrega, se ignora

    // Deduplicar
    if (mensajesProcesados.has(mensaje.id)) return;
    mensajesProcesados.add(mensaje.id);

    const telefono = mensaje.from;

    // Solo texto por ahora; para audio/imagen se responde con un aviso
    let texto;
    if (mensaje.type === "text") {
      texto = mensaje.text.body;
    } else {
      await enviarMensaje(
        telefono,
        "Por el momento solo puedo leer mensajes de texto 🙏 ¿Me escribes tu consulta?"
      );
      return;
    }

    console.log(`📩 [${telefono}]: ${texto}`);

    // Marcar como leído (los checks azules generan confianza)
    marcarLeido(mensaje.id).catch(() => {});

    // Armar historial y consultar a la IA
    const historial = obtenerHistorial(telefono);
    historial.mensajes.push({ role: "user", content: texto });
    if (historial.mensajes.length > MAX_TURNOS) {
      historial.mensajes = historial.mensajes.slice(-MAX_TURNOS);
    }
    historial.ultimaActividad = Date.now();

    let textoRespuesta = await consultarLLM(historial.mensajes);

    // --- Marcador [ENCUESTA]: la IA indica que la conversación concluyó ---
    const cierraConversacion = /\[ENCUESTA\]/i.test(textoRespuesta);

    // Limpiar marcadores antes de enviar al ciudadano
    textoRespuesta = textoRespuesta.replace(/\[ENCUESTA\]/gi, "").trim();

    // Si vino vacía, se descarta el turno del usuario para no corromper el
    // historial y se avisa en lugar de quedarse en silencio.
    if (!textoRespuesta) {
      historial.mensajes.pop();
      await enviarMensaje(
        telefono,
        "Disculpe, no pude generar la respuesta en este momento 🙏 ¿Podría repetir su consulta, de preferencia más específica? Si prefiere, puede escribirnos a info@cename.gt."
      );
      console.warn(`⚠️ [${telefono}] respuesta vacía del modelo; se envió aviso`);
      return;
    }

    historial.mensajes.push({ role: "assistant", content: textoRespuesta });
    await enviarMensaje(telefono, textoRespuesta);

    // Encuesta de satisfacción — tres disparadores
    // a) La persona la pide. Se usan raíces de palabra (calific*, evalú*,
    //    opini*...) para cubrir todas las variantes: "calificar",
    //    "calificación", "evaluación", "evalúo", "opinión", "sugerencias".
    const pideEncuesta =
      /(\bqr\b|encuesta|eval[uú]|calific|puntu|opini|opinar|sugerenc|coment)/i.test(
        texto
      );

    // b) El bot PROMETIÓ enviarla en su respuesta. Si lo dice, hay que
    //    cumplirlo: nunca debe prometer el código y no mandarlo.
    const prometioEncuesta =
      /(c[oó]digo qr|\bqr\b|evaluaci[oó]n del servicio|breve evaluaci[oó]n|encuesta)/i.test(
        textoRespuesta
      );

    // c) Cierre de conversación: una sola vez por conversación.
    const despedida =
      /\b(gracias|muchas gracias|adi[oó]s|hasta luego|eso es todo|es todo|nada m[aá]s|listo)\b/i.test(
        texto
      );

    if (pideEncuesta || prometioEncuesta) {
      historial.encuestaEnviada = true;
      await enviarEncuesta(telefono);
    } else if ((cierraConversacion || despedida) && !historial.encuestaEnviada) {
      historial.encuestaEnviada = true;
      await enviarEncuesta(telefono);
    }

    console.log(`📤 [${telefono}]: ${textoRespuesta.slice(0, 80)}...`);
  } catch (err) {
    console.error("❌ Error procesando mensaje:", err.message);

    // Nunca dejar al ciudadano sin respuesta: se le avisa y, si fue por
    // cuota agotada, se alerta al responsable operativo.
    const tel = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;
    if (!tel) return;
    try {
      if (err.cuotaAgotada) {
        await enviarMensaje(
          tel,
          "En este momento estamos atendiendo muchas consultas y no puedo responderle de inmediato 🙏 Por favor intente de nuevo en unos minutos, o escríbanos a info@cename.gt y le atenderemos con gusto."
        );
        console.error("🚨 CUOTA DEL SERVICIO DE IA AGOTADA — revise el plan del proveedor");
      } else {
        await enviarMensaje(
          tel,
          "Disculpe, tuvimos un inconveniente técnico al procesar su consulta 🙏 Por favor intente de nuevo, o escríbanos a info@cename.gt."
        );
      }
    } catch (e2) {
      console.error("❌ Tampoco se pudo enviar el aviso de error:", e2.message);
    }
  }
});

// ------------------------------------------------------------
// Envío de mensajes por la Graph API de Meta
// ------------------------------------------------------------
async function enviarMensaje(telefono, texto) {
  const resp = await fetch(
    `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: telefono,
        type: "text",
        text: { body: texto },
      }),
    }
  );
  if (!resp.ok) {
    const detalle = await resp.text();
    throw new Error(`Graph API ${resp.status}: ${detalle}`);
  }
}

async function enviarImagen(telefono, urlImagen, pie) {
  const resp = await fetch(
    `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: telefono,
        type: "image",
        image: { link: urlImagen, caption: pie },
      }),
    }
  );
  if (!resp.ok) {
    const detalle = await resp.text();
    throw new Error(`Graph API (imagen) ${resp.status}: ${detalle}`);
  }
}

async function marcarLeido(messageId) {
  await fetch(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    }),
  });
}

// ------------------------------------------------------------
// Endpoint de salud (útil para Railway/Render y monitoreo)
// ------------------------------------------------------------
app.get("/", (_req, res) =>
  res.send(`🤖 Bot de ${negocio.nombre} activo — ${new Date().toISOString()}`)
);

app.listen(PORT, () => console.log(`🚀 Servidor escuchando en puerto ${PORT}`));

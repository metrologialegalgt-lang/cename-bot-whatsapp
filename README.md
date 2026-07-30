# 🤖 Bot de WhatsApp con IA para negocios

Bot de atención al cliente por WhatsApp usando la **Cloud API oficial de Meta** (sin intermediarios BSP) y **Claude** de Anthropic. Cada negocio se configura con un simple archivo JSON — sin tocar código.

## Arquitectura

```
Cliente (WhatsApp) → Meta Cloud API → webhook POST → este servidor
                                                          ↓
                                              Claude API (respuesta)
                                                          ↓
Cliente (WhatsApp) ← Meta Graph API  ←  enviarMensaje() ←┘
```

**Costos por cliente atendido:** los mensajes de servicio (cuando el cliente escribe primero y respondes dentro de 24 h) **no tienen costo en Meta**. El único costo variable es Claude Haiku: una conversación típica de 10 mensajes cuesta menos de $0.01 USD.

---

## Paso 1 — Crear la app en Meta for Developers

1. Entra a https://developers.facebook.com y crea una cuenta de desarrollador.
2. **My Apps → Create App → Business** (necesitarás un portafolio de Meta Business; se crea gratis en https://business.facebook.com).
3. En el panel de la app, busca el producto **WhatsApp** y haz clic en **Set up**.
4. Ve a **WhatsApp → API Setup**. Ahí encontrarás:
   - Un **número de prueba** gratuito (sirve para el demo; permite escribir hasta a 5 números verificados por ti).
   - El **Phone number ID** → cópialo a tu `.env`.
   - Un **token temporal** (dura 24 h) → cópialo a tu `.env` para pruebas.
5. En "To", agrega tu número personal como destinatario de prueba y verifícalo con el código que te llega.

> 💡 Para producción con un cliente real: se agrega el número de teléfono del negocio (no puede estar activo en la app normal de WhatsApp — hay que migrarlo) y se genera un **token permanente** creando un System User en Meta Business Suite → Configuración → Usuarios del sistema → Generar token con permisos `whatsapp_business_messaging` y `whatsapp_business_management`.

## Paso 2 — Obtener la API key de Anthropic

1. Crea una cuenta en https://console.anthropic.com
2. **API Keys → Create Key** → cópiala a tu `.env`.
3. Carga saldo (con $5 USD tienes para miles de conversaciones con Haiku).

## Paso 3 — Correr localmente

```bash
npm install
cp .env.example .env   # y llena los valores
npm start
```

Para que Meta alcance tu servidor local, expón el puerto con ngrok:

```bash
ngrok http 3000
```

Copia la URL https que te da ngrok (ej. `https://abc123.ngrok.io`).

## Paso 4 — Registrar el webhook en Meta

1. En el panel: **WhatsApp → Configuration → Webhook → Edit**.
2. **Callback URL:** `https://TU-URL/webhook` (la de ngrok o la de producción).
3. **Verify token:** el mismo que pusiste en `VERIFY_TOKEN` de tu `.env`.
4. Clic en **Verify and save** (tu servidor debe estar corriendo).
5. En **Webhook fields**, suscríbete a **messages**.

¡Listo! Escribe al número de prueba desde tu WhatsApp y el bot responderá.

## Paso 5 — Desplegar en producción (Railway)

1. Sube el proyecto a un repositorio de GitHub (privado).
2. En https://railway.app → **New Project → Deploy from GitHub repo**.
3. En **Variables**, agrega todas las de tu `.env`.
4. Railway te da una URL pública → actualiza el webhook en Meta con esa URL.

Alternativas: Render.com (tiene capa gratuita, pero se duerme con inactividad — mejor el plan de $7/mes) o Fly.io.

---

## Agregar un cliente nuevo (negocio)

1. Copia `config/demo.json` → `config/nombre-negocio.json`.
2. Llena la información real del negocio: catálogo, horarios, FAQ, tono.
3. Despliega una instancia con `BUSINESS_CONFIG=nombre-negocio` y las credenciales de WhatsApp de ese negocio.

Cada negocio = una instancia pequeña (~$5/mes de hosting) con su propio número.

## Campos disponibles en la configuración

Todos son opcionales salvo `nombre` y `descripcion`. El prompt se arma solo con las secciones presentes.

| Campo | Para qué sirve |
|---|---|
| `nombre`, `descripcion`, `tono` | Identidad y estilo del asistente |
| `direccion`, `horarios`, `contacto_humano`, `sitio_web`, `metodos_pago`, `envios` | Bloque de información general |
| `catalogo` | Lista simple de productos/servicios con precio (negocios pequeños) |
| `tarifario` | Tarifas agrupadas por área: `[{area, items:[{servicio, tarifa, nota}]}]` (instituciones, catálogos grandes) |
| `base_legal` | Se cita como fuente del tarifario |
| `derivaciones` | Directorio de enrutamiento: `[{area, responsable, correo, palabras_clave}]` |
| `copia_obligatoria` | Correo que el bot indicará copiar SIEMPRE |
| `notas` | Reglas o condiciones especiales que el bot debe mencionar |
| `faq` | Preguntas frecuentes `[{p, r}]` |
| `reglas_extra` | Reglas de comportamiento adicionales, específicas del cliente |
| `accion_principal` | Acción que se espera del usuario y cómo cerrarla |
| `marcador_notificar` | Cuándo debe avisar al dueño (`OWNER_PHONE`) |

### Ejemplo institucional: `config/cename.json`

Chatbot del Centro Nacional de Metrología (Ministerio de Economía, Guatemala):
tarifario completo del Acuerdo Gubernativo 173-2021 agrupado por laboratorio,
directorio de derivación de los 11 responsables de laboratorio/unidad con sus
palabras clave, copia obligatoria a `info@cename.gt`, y reglas que distinguen
calibración (Laboratorio Nacional de Metrología) de verificación (UIVML).

⚠️ Este prompt ocupa ~6 000 tokens. Con `LLM_PROVIDER=groq` la cuota diaria
gratuita se agota en pocas conversaciones; usa `LLM_PROVIDER=gemini` (límite de
tokens mucho más amplio) o `anthropic` en producción.

## Estructura del proyecto

```
whatsapp-bot/
├── server.js          # Webhook + lógica del bot + envío de mensajes
├── config/
│   └── demo.json      # Configuración del negocio (catálogo, FAQ, tono)
├── .env.example       # Plantilla de variables de entorno
└── package.json
```

## Mejoras siguientes (roadmap)

- [ ] Notificar al dueño (por WhatsApp o correo) cuando el bot toma un pedido/reserva
- [ ] Comando de "hablar con humano" que pausa el bot para ese cliente
- [ ] Persistencia del historial en SQLite (hoy es en memoria)
- [ ] Soporte de audios (transcripción) e imágenes
- [ ] Panel web simple para que el dueño edite su catálogo sin tocar el JSON
- [ ] Métricas: conversaciones/día, preguntas más frecuentes

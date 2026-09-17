# Fase 1 · Diseño — ¿qué hace y por dónde entra y sale?

## Bloque 1 — El encargo (antes de abrir n8n)

- **1.1 El trabajo, en una frase.** "Este agente hace ___ para ___, y le ahorra ___". Si necesitas dos
  frases, son dos agentes.
- **1.2 Lo que NO hace.** Fuera de alcance explícito (descuentos, plazos, consejo legal, médico,
  fiscal, reclamaciones…) y **a quién escala**.
- **1.3 Métrica de éxito, de negocio.** "% resuelto sin humano", "minutos ahorrados al día", "coste
  por conversación". No vale "que responda bien".
- **1.4 Volumen y presupuesto.** Conversaciones/mes × coste objetivo por conversación. Si el techo son
  10 céntimos por tarea con mucho volumen → workflow, no agente.
- **1.5 ¿De verdad necesita ser un agente?** (test de la pizarra). Justifica la respuesta.

## Bloque 2 — Entrada y salida ⭐ lo primero que hay que cerrar

Antes que el prompt y antes que las tools: por dónde entra el mensaje, cómo se procesa hasta el
agente, y por dónde vuelve la respuesta.

**Entrada**

- **2.1 Canal e integración** elegidos y probados: `Chat Trigger` (widget web), `Webhook`
  (WhatsApp/Telegram/API del canal), `Schedule` (tarea periódica), `Execute Workflow` (sub-agente),
  email, formulario.
- **2.2 Normalización del mensaje entrante**: del JSON del canal, extraer un objeto propio y estable
  —`{ usuario, canal, texto, adjuntos, timestamp, ids }`— **antes** del agente. Cambiar de WhatsApp a
  Telegram debe tocar solo este nodo.
- **2.3 Tipos de mensaje contemplados**: texto, audio (¿se transcribe?), imagen (¿se describe?),
  documento, ubicación, sticker, mensaje vacío. Y qué se contesta a los que no soportas.
- **2.4 Mensajes seguidos (buffering)**: tres mensajes del usuario no son tres ejecuciones y tres
  respuestas. En n8n: espera corta + agrupación por `sessionId`.
- **2.5 Deduplicación e idempotencia**: si el canal reintenta el webhook, no se responde dos veces
  (clave por `message_id`).
- **2.6 Ack rápido**: el canal recibe un `200` al aceptar el mensaje, no cuando el agente termina. Si
  no, timeouts y reintentos en cascada.

**Salida**

- **2.7 Camino de vuelta explícito**: `Respond to Webhook`, llamada a la API del canal, o el propio
  Chat Trigger. Saber cuál de los tres y por qué.
- **2.8 Formato adaptado al canal**: WhatsApp no entiende Markdown como Slack; longitud máxima;
  trocear respuestas largas; indicador de "escribiendo…" si el canal lo permite.
- **2.9 Salida estructurada si alimenta a otro nodo** (`Structured Output Parser` / JSON), no texto
  libre. Menos tokens y menos errores de parseo.
- **2.10 Qué ve el usuario si el agente tarda o falla.** Siempre hay respuesta, nunca silencio.
- **2.11 `sessionId` definido**: qué identifica una conversación (teléfono, chat id, user id). Sin
  esto la memoria mezcla usuarios. **Es el fallo nº1 en n8n.**

## Bloque 3 — Contexto y estado ⭐ lo que separa un nodo suelto de un sistema

- **3.1 Distinguir memoria de estado.** Memoria = lo dicho en este chat. Estado = lo que sabemos del
  usuario y del proceso (quién es, qué compró, en qué fase está). Sitios distintos. Confundirlas es
  el error clásico.
- **3.2 Ficha de contexto definida**: qué se carga **antes** de invocar al agente —cliente, pedidos
  abiertos, últimas interacciones, idioma, fase del flujo, si ya habló con un humano.
- **3.3 Dónde vive.** `Data Table` de n8n para lo sencillo (nativo, sin infraestructura),
  Postgres/Supabase para lo serio, o el CRM como fuente de verdad.
- **3.4 Cómo se le pasa al agente**: inyectado en el system prompt como bloque de contexto (barato,
  siempre presente) **o** como tool que consulta (más caro, solo cuando hace falta). Decisión a
  conciencia, no por inercia.
- **3.5 Estados del flujo enumerados** y quién transiciona entre ellos
  (`nuevo → identificado → pedido_en_curso → cerrado → escalado`).
- **3.6 El estado se escribe de vuelta** cuando cambia, y una ejecución interrumpida a medias no deja
  el estado corrupto.
- **3.7 Contexto acotado.** Volcar la ficha entera del cliente es caro y despista al agente: que la
  tool devuelva 5 campos, no 50.

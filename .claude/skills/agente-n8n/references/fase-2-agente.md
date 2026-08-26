# Fase 2 · El agente — ¿cómo decide?

## Bloque 4 — El system prompt (7 secciones)

- **4.1 Rol e identidad** — quién es, de qué empresa, para qué está.
- **4.2 Alcance** — qué resuelve.
- **4.3 Límites** — qué no hace y qué no promete nunca. *"No inventes precios, horarios ni plazos: si
  no está en la herramienta, dilo."*
- **4.4 Contexto** — bloque donde se inyecta lo del bloque 3, delimitado y **marcado como datos, no
  como instrucciones** (media defensa contra inyección).
- **4.5 Herramientas** — cuándo usar cada una y en qué orden, si importa.
- **4.6 Tono y formato** — con ejemplos, no con adjetivos. Longitud, idioma, emojis. Ver
  `tono.md`.
- **4.7 Qué hacer cuando no sabe** — la frase literal de escalado. Fallback **duro** ("no lo sé, te
  paso con una persona"), nunca blando ("déjame intentarlo otra vez").
- **4.8 2-3 ejemplos** (few-shot) de conversación buena, **incluyendo uno en el que se rinde**.
- **4.9 Está versionado.** El prompt es código: histórico, y qué cambiaste y por qué.

## Bloque 5 — El modelo y su fallback

- **5.1 Empieza por el modelo bueno** para fijar el listón; baja después comparando contra ese output.
  Al revés no sabrás si el fallo es tuyo o del modelo.
- **5.2 Modelo elegido y por qué** (una línea). Temperatura consciente (baja para clasificar/extraer).
- **5.3 Fallback de modelo activado.** En el nodo `AI Agent`, **Enable Fallback Model**, y **de otro
  proveedor**: si el que se cae es OpenAI, un segundo modelo de OpenAI se cae con él.
- **5.4 Reintentos y timeout** en el nodo, con espera creciente, no infinitos.
- **5.5 Qué pasa si fallan los dos**: mensaje al usuario + aviso al equipo (bloque 14). Nunca silencio.
- **5.6 Límite de gasto** en el proveedor, no solo en n8n.

## Bloque 6 — Las herramientas

> Son la parte **determinista** del sistema. Se diseñan, escriben y prueban **antes** de conectarlas a
> ningún LLM. Una tool que falla el 5% de las veces hace fallar al agente mucho más del 5%.

Por **cada** herramienta:

- **6.1 Probada sola** antes de conectarla.
- **6.2 Nombre claro** (`consultar_stock`, no `tool1`).
- **6.3 Descripción precisa: qué hace, cuándo usarla y cuándo NO.** La descripción **es prompt**: es el
  único criterio con el que el agente decide si la usa.
- **6.4 Parámetros descritos uno a uno**, con formato, ejemplo y valores por defecto.
- **6.5 Salida limpia y estructurada**: 5 campos útiles, no el JSON entero de la API ni HTML. Filtra
  con `Set`/`Code` **dentro** del sub-workflow.
- **6.6 Errores contemplados**: qué devuelve si la API está caída o no encuentra nada, en algo que el
  agente entienda (`{"error":"cliente_no_encontrado"}`).
- **6.7 Las de escritura** (crear pedidos, enviar emails, cobrar) piden **confirmación explícita** al
  usuario, son idempotentes y quedan registradas.
- **6.8 Menos es más**: más de 6-7 tools → sub-agentes o replanteamiento. Cada tool extra empeora la
  elección de todas las demás.
- **6.9 Reutilizables**: cada tool es un sub-workflow propio (`Call n8n Workflow Tool`), no lógica
  dentro del agente. El workflow principal, 4-6 nodos.

## Bloque 7 — Memoria

- **7.1 ¿La necesita?** Un agente de tarea (clasificar, extraer, publicar) normalmente **no**.
- **7.2 Proveedor elegido:**

| Proveedor | Cuándo | Aviso |
|---|---|---|
| `Simple Memory` | solo pruebas | **se pierde al reiniciar n8n o al guardar el workflow** |
| `Postgres Chat Memory` | producción, lo normal | tabla propia; combina bien con Supabase |
| `Redis Chat Memory` | mucho volumen, TTL nativo | infra extra |
| `Motorhead` / `Zep` | resúmenes y memoria a largo plazo | otra pieza que mantener |
| `Chat Memory Manager` | cargar/insertar/podar a mano | cuando necesitas control fino |

- **7.3 Ventana ajustada.** Por defecto suelen ser 5 interacciones. **Ajústala midiendo**: sube hasta
  que deje de haber "¿de qué me hablas?" y baja hasta que el coste deje de doler. Apunta el número y
  el porqué.
- **7.4 Ventana ≠ contexto del modelo.** Más mensajes = más tokens en **cada** llamada. Es el gasto que
  más crece sin que te des cuenta.
- **7.5 Conversaciones largas**: resumen periódico en vez de arrastrarlo todo.
- **7.6 Aislada por `sessionId`** (2.11), con caducidad y borrado definidos (bloque 10).

## Bloque 8 — Conocimiento: RAG como herramienta

**Solo entra RAG** si se cumple alguna de estas tres: la fuente de verdad no cabe en el contexto; cabe
pero es cara de procesar en cada llamada; o necesitas búsqueda eficiente sobre mucho texto no
estructurado. Si no se cumple ninguna, **no montes RAG**.

- **8.1 ¿Cabe en el prompt y no cambia?** (horarios, política, 10 FAQs) → al system prompt. Fin.
- **8.2 ¿Dato estructurado que cambia?** (stock, precios, reservas) → **tool contra la fuente de
  verdad** (API/SQL). Un vector store con precios es una máquina de dar precios caducados.
- **8.3 ¿Mucho texto no estructurado?** (manuales, contratos, actas) → ahí sí, RAG.

Si hay RAG:

- **8.4 Montado como tool, no como paso previo.** `Vector Store Tool` colgando del agente: busca cuando
  hace falta, no en cada mensaje. Con pgvector en Supabase/Postgres: una tabla, una función de
  búsqueda y listo.
- **8.5 Chunking y metadatos** definidos (tamaño, solape, documento de origen de cada trozo).
- **8.6 Cita la fuente** en la respuesta. Sin cita no hay forma de auditar una alucinación.
- **8.7 Reindexado**: quién, cada cuánto, y qué pasa con lo borrado.
- **8.8 Probado con una pregunta cuya respuesta NO está** en los documentos. Si se la inventa, vuelve
  al 4.7.

---
name: agente-n8n
description: Usar al diseñar, construir, revisar o auditar un agente de IA en n8n (nodo AI Agent con tools, memoria, RAG, guardrails), al decidir si algo debe ser agente o workflow, y antes de enseñar un agente a un cliente, cobrarlo o dejarlo corriendo solo. También al depurar síntomas típicos - la memoria mezcla usuarios, responde tres veces seguidas, se inventa precios, no escala cuando debe, factura sorpresa del proveedor.
---

# Construir y auditar agentes en n8n

Procedimiento destilado del checklist *Anatomía de un agente en n8n* (Ailink, v2, 19-ago-2026).
Cubre **qué tiene que existir y en qué orden**. El **cómo** en n8n —nodos concretos, expresiones,
MCP de instancia— lo cubren las skills oficiales `n8n-*-official`: cárgalas para la mecánica, esta
para el criterio. Si ambas están disponibles, se usan juntas; no se contradicen.

## Paso 0 — ¿Esto necesita ser un agente?

**El test de la pizarra:** si puedes dibujar todos los casos con `if / else` en una pizarra, **no es
un agente**: es un workflow. Más barato, más rápido, depurable. El agente se paga solo cuando hay
tantos "depende" que no los puedes enumerar.

Si la respuesta es workflow, **dilo y para aquí**. Montar un `AI Agent` sobre lógica enumerable es el
error más caro del checklist, y no se arregla más adelante.

## Orden de trabajo

No lo reordenes: cada fase es la entrada de la siguiente, y saltarse la 1 es lo que produce agentes
que "fallan raro".

| Fase | Bloques | La pregunta | Referencia |
|---|---|---|---|
| **1 · Diseño** | 1 Encargo · 2 Entrada/salida · 3 Contexto y estado | ¿Qué hace y por dónde entra y sale? | `references/fase-1-diseno.md` |
| **2 · El agente** | 4 System prompt · 5 Modelo y fallback · 6 Tools · 7 Memoria · 8 RAG | ¿Cómo decide? | `references/fase-2-agente.md` |
| **3 · Seguridad** | 9 Guardrails · 10 PII y cumplimiento | ¿Qué puede salir mal y a quién le explota? | `references/fase-3-seguridad.md` |
| **4 · Operación** | 11 Logging · 12 Evaluaciones · 13 Costes · 14 Excepciones | ¿Cómo sé que sigue funcionando? | `references/fase-4-operacion.md` |

Carga **solo la referencia de la fase en la que estés**. Están numeradas igual que el checklist
original (`2.11`, `6.3`…), así que cita siempre el número: es lo que hace la conversación con el
cliente verificable.

Dos cosas que en la práctica se hacen antes de tiempo y hay que frenar:

- **El bloque 2 (entrada/salida) va antes que el prompt y antes que las tools.** Casi todos los
  agentes rotos lo están por aquí.
- **Las tools se escriben y se prueban solas, antes de conectarlas a ningún LLM** (6.1). Son la parte
  determinista del sistema. Si una tool falla el 5% de las veces, el agente falla mucho más del 5%.

## Regla de corte

Se puntúa cada punto con semáforo: 🟢 hecho y probado · 🟡 a medias o sin probar · 🔴 no está ·
⚪ no aplica (**justificado en una línea**, no como escape).

> Un agente **no se pone delante de un cliente ni de un usuario final** con ningún 🔴 en la
> **fase 3** ni en la **fase 4**. En el resto, el 🟡 se acepta si está apuntado y con fecha.

Aplica esta regla aunque nadie la pida. Si el agente que te enseñan tiene un 🔴 en seguridad u
operación, eso va **primero** en la respuesta, antes que cualquier mejora de prompt.

## Modo construir

Recorre las fases en orden y, en cada bloque, **decide y deja escrito el porqué** en una línea. Un
punto no está resuelto porque exista el nodo: está resuelto cuando hay una decisión consciente
detrás. Al terminar cada fase, resume qué quedó 🟡 y con qué fecha.

## Modo auditar

Cuando te dan un agente ya hecho (propio o de un cliente):

1. Lee el workflow y contesta el paso 0 igual: mucho agente auditado es un workflow disfrazado.
2. Recorre las cuatro fases puntuando con semáforo. **No inventes verdes**: lo que no puedas
   verificar en el JSON del workflow o en una ejecución es 🟡, y se dice que es por falta de acceso.
3. Entrega: (a) los 🔴 de fases 3 y 4 como bloqueantes, (b) el resto ordenado por daño, no por
   bloque, (c) para cada hallazgo, el número del checklist y el arreglo concreto en n8n.

## Atajo desde el síntoma

Cuando lo que llega es una queja y no un encargo, entra por aquí y luego lee el bloque:

| Síntoma | Bloque |
|---|---|
| Hace de todo y nada bien | 1.1, 1.2 |
| Tres respuestas seguidas porque el usuario escribió tres mensajes | 2.4 |
| Responde dos veces por un reintento del canal | 2.5 |
| La memoria mezcla usuarios | 2.11 |
| "No sé quién eres" en el tercer mensaje de un flujo multi-paso | 3.2, 3.4 |
| Se inventa precios, horarios o plazos | 4.3, 8.2 |
| Elige mal la herramienta | 6.3, 6.8 |
| Vector store montado para 10 FAQs | 8.1 |
| Precios caducados servidos desde el vector store | 8.2 |
| "Le pedí que ignorara sus instrucciones y me lo contó todo" | 9.1, 9.6 |
| Un PDF del cliente traía instrucciones ocultas | 9.6 |
| El cliente pregunta por el RGPD y no sabes qué contestar | 10.1-10.6 |
| API key escrita dentro de un nodo | 10.7 |
| "No sé por qué contestó eso" | 11.1, 11.2 |
| Cambiaste el prompt y rompiste otra cosa | 12.5 |
| Funcionaba en marzo y hoy responde peor | 12.6 |
| Factura sorpresa del proveedor | 13.3, 13.4 |
| Se cayó el proveedor y el agente se quedó mudo | 5.3, 14.4 |
| Llevaba tres semanas fallando y te enteraste por el cliente | 14.1 |
| Suena a robot, o suena a colega borracho | `references/tono.md` |

## Lo que no se negocia

Cuatro puntos que aparecen una y otra vez y que conviene defender aunque el cliente tenga prisa:

- **`sessionId` bien definido** (2.11). Sin esto la memoria mezcla usuarios. Es el fallo nº1 en n8n.
- **Fallback duro cuando no sabe** (4.7): "no lo sé, te paso con una persona". El usuario perdona un
  "no lo sé"; no perdona una respuesta segura y falsa.
- **Credenciales en el gestor de n8n** (10.7). Cero tokens dentro de un nodo, un prompt o una URL.
- **Error Workflow configurado** (14.1). Si solo se hace una cosa de la fase 4, es esta: el fallo que
  mata no es el que revienta, es el silencioso.

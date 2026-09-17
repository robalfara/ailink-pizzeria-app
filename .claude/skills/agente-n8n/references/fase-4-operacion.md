# Fase 4 · Operación — ¿cómo sé que sigue funcionando?

Ningún 🔴 de esta fase pasa a producción. El fallo que mata no es el que revienta: es el **silencioso**.

## Bloque 11 — Logging de entrada, salida y estados intermedios

- **11.1 Se registra cada interacción** en una tabla propia — las **Data Tables** de n8n valen para
  empezar: `timestamp`, `sessionId`, `usuario`, `entrada`, `salida`, `execution_id`.
- **11.2 Y los estados intermedios**: qué tools llamó, con qué parámetros, qué devolvieron, si saltó un
  guardrail, qué modelo respondió (¿principal o fallback?), tokens y coste.
- **11.3 Se marca si escaló** y por qué.
- **11.4 El log se consulta por conversación completa**, no solo por mensaje suelto.
- **11.5 Retención del log** decidida y coherente con 10.5, sanitizando antes de guardar.
- **11.6 Las ejecuciones fallidas se guardan** (ajustes del workflow) — si no, depuras a ciegas.

## Bloque 12 — Evaluaciones y deriva

Es lo que convierte "a mí me funciona" en "puedo garantizar un servicio". n8n lo trae nativo:
`Evaluation Trigger` lee un dataset (Data Table o Google Sheet), lo pasa por el workflow caso a caso, y
el nodo `Evaluation` guarda resultado y métricas.

- **12.1 Dataset de 15-20 casos reales**, no inventados. Mínimo: 5 camino feliz · 3 fuera de alcance
  (tiene que rendirse bien) · 3 ambiguos o con faltas · 2 con datos que no existen (¿se lo inventa?) ·
  2 maleducados · 2 de inyección (bloque 9).
- **12.2 Respuesta esperada apuntada** en cada caso. Los mejores casos salen de ejecuciones reales
  pasadas, que traen el desorden que no sabes inventar.
- **12.3 Métricas elegidas**: coincidencia con lo esperado, ¿usó la tool correcta?, ¿escaló cuando
  debía?, latencia, coste.
- **12.4 AI as a judge** para lo que no se compara con `=`: un segundo LLM puntúa contra un criterio
  escrito. Reglas: **modelo bueno**, **rúbrica corta y explícita** (1-5 con qué significa cada
  número), **un criterio por llamada**, y **validas al juez a mano** con 10 casos antes de fiarte. Un
  juez sin calibrar solo da una cifra bonita y falsa.
- **12.5 Se ejecuta la batería entera** cada vez que tocas el prompt, cambias de modelo o añades una
  tool. Ese es el punto de tenerla.
- **12.6 Deriva medida**: la misma batería, en calendario (semanal/mensual), guardando la nota. Una
  bajada sostenida es una alerta, aunque nadie se haya quejado.
- **12.7 Los fallos de producción se añaden al dataset.** Si no, evalúas el agente de hace tres meses.

## Bloque 13 — Costes

- **13.1 Coste por conversación medido** sobre 10-20 ejecuciones reales, comparado con 1.4.
- **13.2 Consumo registrado por ejecución** (los nodos de modelo devuelven el uso de tokens) → al log
  del bloque 11.
- **13.3 Límite de gasto y alerta** en el proveedor. Innegociable.
- **13.4 Herramienta de monitorización según nivel:**

| Nivel | Qué usar | Por qué |
|---|---|---|
| **Introductorio ⭐** | **OpenRouter** como pasarela + su panel | Una credencial para todos los modelos, coste por llamada, **límite de gasto duro**, cambiar de modelo es cambiar un texto |
| **+ trazas propias** | **Data Table de n8n** con tokens y coste + una vista | Nativo, ya montado en el bloque 11, y el dato es tuyo |
| **Cuando duele** | **Langfuse** (capa gratis 50k trazas/mes) | Traza la conversación entera con sus tools, agrupa por `sessionId`/`userId`, cruza coste con calidad |
| **Ya en serio** | Panel del proveedor + presupuestos por cliente | Cuando facturas el consumo al cliente |

- **13.5 Modelo barato donde se pueda**: clasificar, extraer y rutear no necesitan el modelo caro.
- **13.6 Informe de coste al cliente**, aunque sea mensual y de una línea.

## Bloque 14 — Excepciones y avisos

- **14.1 Error Workflow configurado** (ajustes del workflow → *Error Workflow*): avisa a
  Slack/Telegram/email con workflow, nodo, error y `execution_id`. Uno solo sirve para todos.
  **Si solo haces una cosa de este bloque, haz esta.**
- **14.2 Continue On Fail / rama de error** donde tenga sentido, para que un fallo de una tool no tumbe
  la conversación entera.
- **14.3 Reintentos con espera creciente** en llamadas a APIs, y timeouts puestos.
- **14.4 Fallback en cadena**: modelo secundario (5.3) → respuesta degradada → humano.
- **14.5 Alertas con umbral, no por cada error**: "más de 5 fallos en 10 minutos" evita el ruido que
  hace que se ignoren las alertas.
- **14.6 Alertas de negocio, no solo técnicas**: "hoy escaló el 40% cuando lo normal es el 15%" es un
  fallo aunque no haya ninguna excepción en el log.
- **14.7 Revisión semanal agendada** de las conversaciones que escalaron. Ahí está la lista de lo
  próximo que arreglar.
- **14.8 Informe al cliente**: "esta semana atendió 312 consultas, resolvió 268, escaló 44". Es lo que
  renueva el contrato.
- **14.9 Versionado/backup del workflow** (export JSON a git) y saber volver atrás.
- **14.10 Quién lo mantiene y cuánto cuesta al mes**, pactado por escrito. Construir el agente es la
  parte fácil; cuidarlo es el trabajo, y es lo que se cobra.

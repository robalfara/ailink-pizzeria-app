# Comparativa de modelos en las decisiones del agente de sala

Fecha: 2026-10-14

> **Etiquetas propuestas, pendientes de revisión humana.** Las etiquetas de los casos las propuso una IA y nadie las ha revisado todavía: un "fallo" puede ser una etiqueta equivocada. No te fíes de estos números hasta que una persona las revise.

## Configuración

| Modelo | Parámetros |
|---|---|
| `typesafe/jev-1.13` | sin parámetros (endpoint de decisiones) |
| `openai/gpt-4.1-mini` | {"temperature": 0} |
| `anthropic/claude-haiku-4.5` | {"temperature": 0} |
| `openai/gpt-5.4` | {"reasoning": {"effort": "medium"}} |

- Casos: 4 · repeticiones por caso: 1 · llamadas por modelo: 4
- Umbral de jailbreak de Jev: `noul >= 0.7` (el del guardarraíl actual del workflow)
- Coste total de la corrida: $0.0136

## Resumen

| Modelo | Intención | Enfado | Jailbreak (FP/FN) | Conjunto | Formato inválido | Estabilidad (casos que cambian) | Latencia p50/p95 | Coste / 10.000 mensajes |
|---|---|---|---|---|---|---|---|---|
| `typesafe/jev-1.13` | 100.0% | 100.0% | 100.0% (0/0) | 100.0% | 0.0% | n/a | 0.45 s / 0.47 s | $0.21 |
| `openai/gpt-4.1-mini` | 100.0% | 100.0% | 100.0% (0/0) | 100.0% | 0.0% | n/a | 1.20 s / 1.22 s | $2.16 |
| `anthropic/claude-haiku-4.5` | 100.0% | 100.0% | 100.0% (0/0) | 100.0% | 0.0% | n/a | 5.62 s / 6.03 s | $9.99 |
| `openai/gpt-5.4` | 100.0% | 100.0% | 100.0% (0/0) | 100.0% | 0.0% | n/a | 2.13 s / 2.51 s | $21.69 |

## Intención

_Cuántas veces acertó qué quiere el cliente (carta, horario, reservar...) sobre las llamadas válidas._

| Modelo | Aciertos | Llamadas válidas | Acierto |
|---|---|---|---|
| `typesafe/jev-1.13` | 4 | 4 | 100.0% |
| `openai/gpt-4.1-mini` | 4 | 4 | 100.0% |
| `anthropic/claude-haiku-4.5` | 4 | 4 | 100.0% |
| `openai/gpt-5.4` | 4 | 4 | 100.0% |

## Enfado

_Cuántas veces acertó el nivel de enfado exacto (0-3) y cuánto se desvía de media, en niveles. En Jev el error usa el score sin redondear._

| Modelo | Aciertos | Acierto | Error absoluto medio |
|---|---|---|---|
| `typesafe/jev-1.13` | 4 | 100.0% | 0.00 |
| `openai/gpt-4.1-mini` | 4 | 100.0% | 0.00 |
| `anthropic/claude-haiku-4.5` | 4 | 100.0% | 0.00 |
| `openai/gpt-5.4` | 4 | 100.0% | 0.00 |

## Jailbreak

_Cuántas veces acertó si el mensaje es un intento de saltarse las instrucciones. Falso positivo = bloquea a un cliente legítimo; falso negativo = deja pasar un jailbreak._

| Modelo | Acierto | Falsos positivos | Tasa FP | Falsos negativos | Tasa FN |
|---|---|---|---|---|---|
| `typesafe/jev-1.13` | 100.0% | 0 de 4 | 0.0% | 0 de 0 | n/a |
| `openai/gpt-4.1-mini` | 100.0% | 0 de 4 | 0.0% | 0 de 0 | n/a |
| `anthropic/claude-haiku-4.5` | 100.0% | 0 de 4 | 0.0% | 0 de 0 | n/a |
| `openai/gpt-5.4` | 100.0% | 0 de 4 | 0.0% | 0 de 0 | n/a |

## Acierto conjunto

_Cuántas veces acertó las tres decisiones a la vez en la misma llamada._

| Modelo | Aciertos | Acierto conjunto |
|---|---|---|
| `typesafe/jev-1.13` | 4 | 100.0% |
| `openai/gpt-4.1-mini` | 4 | 100.0% |
| `anthropic/claude-haiku-4.5` | 4 | 100.0% |
| `openai/gpt-5.4` | 4 | 100.0% |

## Formato inválido y errores de llamada

_Formato inválido: la respuesta llegó pero la app no podría usarla (no es JSON o no cumple el esquema). Error de llamada: no llegó respuesta tras los reintentos (HTTP o red)._

| Modelo | Llamadas | Formato inválido | % inválido | Errores de llamada | % errores |
|---|---|---|---|---|---|
| `typesafe/jev-1.13` | 4 | 0 | 0.0% | 0 | 0.0% |
| `openai/gpt-4.1-mini` | 4 | 0 | 0.0% | 0 | 0.0% |
| `anthropic/claude-haiku-4.5` | 4 | 0 | 0.0% | 0 | 0.0% |
| `openai/gpt-5.4` | 4 | 0 | 0.0% | 0 | 0.0% |

## Estabilidad

_Con el mismo mensaje repetido, en cuántos casos cambia alguna de las tres decisiones. Menos es mejor; necesita al menos 2 repeticiones válidas._

| Modelo | Casos comparables | Casos que cambian | % que cambian |
|---|---|---|---|
| `typesafe/jev-1.13` | 0 | 0 | n/a |
| `openai/gpt-4.1-mini` | 0 | 0 | n/a |
| `anthropic/claude-haiku-4.5` | 0 | 0 | n/a |
| `openai/gpt-5.4` | 0 | 0 | n/a |

## Latencia

_Cuánto tarda en contestar: la mitad de las llamadas tarda menos que p50, el 95% tarda menos que p95. Cuenta el intento que contestó._

| Modelo | p50 | p95 |
|---|---|---|
| `typesafe/jev-1.13` | 0.45 s | 0.47 s |
| `openai/gpt-4.1-mini` | 1.20 s | 1.22 s |
| `anthropic/claude-haiku-4.5` | 5.62 s | 6.03 s |
| `openai/gpt-5.4` | 2.13 s | 2.51 s |

## Coste

_Lo que cobra OpenRouter (`usage.cost`). Por mensaje = coste de una llamada._

| Modelo | Total corrida | Por mensaje | Por 10.000 mensajes |
|---|---|---|---|
| `typesafe/jev-1.13` | $0.0001 | $0.000021 | $0.21 |
| `openai/gpt-4.1-mini` | $0.0009 | $0.000216 | $2.16 |
| `anthropic/claude-haiku-4.5` | $0.0040 | $0.000999 | $9.99 |
| `openai/gpt-5.4` | $0.0087 | $0.002169 | $21.69 |

## Cobertura con umbral (intención)

_Si el sistema solo se fiara de las respuestas con confianza ≥ umbral: qué parte de las llamadas cubriría y cuánto acertaría dentro de ellas. La confianza de los LLM es autodeclarada; la de Jev es una probabilidad._

| Modelo | ≥ 0.8 | ≥ 0.9 | ≥ 0.95 |
|---|---|---|---|
| `typesafe/jev-1.13` | cubre 100.0% · acierta 100.0% | cubre 75.0% · acierta 100.0% | cubre 75.0% · acierta 100.0% |
| `openai/gpt-4.1-mini` | cubre 100.0% · acierta 100.0% | cubre 100.0% · acierta 100.0% | cubre 75.0% · acierta 100.0% |
| `anthropic/claude-haiku-4.5` | cubre 100.0% · acierta 100.0% | cubre 100.0% · acierta 100.0% | cubre 100.0% · acierta 100.0% |
| `openai/gpt-5.4` | cubre 100.0% · acierta 100.0% | cubre 100.0% · acierta 100.0% | cubre 75.0% · acierta 100.0% |

## Matriz de confusión (intención)

_Solo los pares mal clasificados: lo que tocaba → lo que respondió, y cuántas veces._

- `typesafe/jev-1.13`: sin errores de intención
- `openai/gpt-4.1-mini`: sin errores de intención
- `anthropic/claude-haiku-4.5`: sin errores de intención
- `openai/gpt-5.4`: sin errores de intención

## Acierto por categoría: intención

_Acierto de intención por tipo de caso (entre paréntesis, llamadas válidas)._

| Categoría | `typesafe/jev-1.13` | `openai/gpt-4.1-mini` | `anthropic/claude-haiku-4.5` | `openai/gpt-5.4` |
|---|---|---|---|---|
| carta | 100.0% (3) | 100.0% (3) | 100.0% (3) | 100.0% (3) |
| horarios | 100.0% (1) | 100.0% (1) | 100.0% (1) | 100.0% (1) |

## Acierto por categoría: jailbreak

_Acierto de jailbreak por tipo de caso (entre paréntesis, llamadas válidas)._

| Categoría | `typesafe/jev-1.13` | `openai/gpt-4.1-mini` | `anthropic/claude-haiku-4.5` | `openai/gpt-5.4` |
|---|---|---|---|---|
| carta | 100.0% (3) | 100.0% (3) | 100.0% (3) | 100.0% (3) |
| horarios | 100.0% (1) | 100.0% (1) | 100.0% (1) | 100.0% (1) |

## Fallos

_Por modelo, hasta 15 llamadas donde alguna decisión no coincide con la etiqueta, o donde no hubo respuesta utilizable. Formato: intención / enfado / jailbreak._

### `typesafe/jev-1.13` (0 llamadas con fallo)

Sin fallos.

### `openai/gpt-4.1-mini` (0 llamadas con fallo)

Sin fallos.

### `anthropic/claude-haiku-4.5` (0 llamadas con fallo)

Sin fallos.

### `openai/gpt-5.4` (0 llamadas con fallo)

Sin fallos.

## Cómo leer esto

- La confianza de los LLM es autodeclarada (el modelo escribe un número); la de Jev es una probabilidad calculada. No se pueden comparar sin más.
- Las etiquetas mandan: si una etiqueta está mal, el modelo "falla" sin tener culpa. Mientras no estén revisadas por una persona, los porcentajes son provisionales.
- Con pocos casos, las diferencias pequeñas son ruido: un caso más o menos mueve el porcentaje varios puntos.
- El jailbreak de Jev depende del umbral elegido; con otro umbral cambian los falsos positivos y negativos.
- La latencia y el coste dependen del proveedor y del momento; una sola corrida no los fija.

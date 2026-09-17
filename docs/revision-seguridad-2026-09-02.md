# Revisión de seguridad y calidad — 2026-09-02

Rama `feat/auth-supabase`. Cubre todo lo que la rama añade sobre `main` más lo que
todavía no estaba versionado: el agente de n8n, la migración `0003`, el endpoint
`/api/chat` y el widget del chat.

Cuatro líneas de análisis en paralelo: pentest activo contra un local aislado,
auditoría del agente de IA, auditoría de SQL/RLS y cadena de suministro, y calidad
de código. Todo lo que aquí se afirma está probado; lo que no se pudo probar se
dice explícitamente.

## Alcance autorizado

Solo sistemas propios y solo objetivos locales. **No se tocó producción**: ni la
instancia de n8n, ni el proyecto de Supabase. El endpoint del chat se probó contra
un mock local del webhook, así que no se gastó un solo token del proveedor ni se
creó una reserva real. `scripts/evaluar_agente.py` no se ejecutó en ningún momento
—sus casos de reserva escriben contra producción—; se leyó.

## Cómo se probó

| Línea | Método |
|---|---|
| Pentest | `next dev` aislado, con mocks locales de Supabase y del webhook de n8n. Tráfico real con `curl` y scripts de carga |
| Agente de IA | Análisis estático del workflow versionado nodo a nodo, contra el checklist propio del proyecto (`misc/checklist-agente-n8n.md`) |
| SQL y RLS | Postgres 16 desechable en Docker con andamiaje tipo Supabase (roles `anon`/`authenticated`, `auth.users`, `auth.uid()`). Las tres migraciones aplicadas en orden, y cada hallazgo con repro antes/después |
| Calidad | Lectura completa más `tsc`, `eslint` y `next build`; comprobación de los comentarios contra el código que acompañan |

## Resumen

19 hallazgos de severidad crítica, alta o media. **Todos corregidos y verificados.**
Los de severidad baja e informativa se documentan al final y no se corrigieron
todos, según el criterio acordado.

| Sev. | Hallazgo | Estado |
|---|---|---|
| Crítico | El límite de uso del chat no limitaba a nadie | Corregido |
| Alto | Aforo ilimitado en la franja de las 22:30 | Corregido |
| Alto | `crear_reserva` filtraba el código de reserva de un tercero | Corregido |
| Alto | La deduplicación de reservas se evadía con un espacio | Corregido |
| Alto | `crear_reserva` confirmaba reservas que no existían | Corregido |
| Alto | El nombre editado en `/cuenta` nunca llegaba a la Navbar | Corregido |
| Medio | DoS algorítmico en el propio límite de uso | Corregido |
| Medio | Sin ninguna cabecera de seguridad | Corregido |
| Medio | Carrera de aforo entre comprobar y reservar | Corregido |
| Medio | Errores de Postgres con la fila entera hacia n8n | Corregido |
| Medio | Las funciones nuevas del schema `agente` nacían abiertas | Corregido |
| Medio | `registrar_turno` no comprobaba la sesión | Corregido |
| Medio | `nombre` y `telefono` sin cota superior | Corregido |
| Medio | `abierto_ahora` en NULL llegaba al system prompt | Corregido |
| Medio | Errores de tool crudos hacia el modelo | Corregido |
| Medio | Un fallo transitorio envenenaba el `mensaje_id` | Mitigado → **resuelto el 2026-09-03** (ver el addendum) |
| Medio | 4 vulnerabilidades altas en dependencias de producción | Corregido |
| Medio | `.env.example` no documentaba tres variables | Corregido |
| Medio | Doble fuente de verdad de la carta | Corregido |

## Los que importan, con su repro

### El límite de uso del chat no limitaba a nadie (crítico)

`lib/agente.ts` troceaba por `sessionId`, y el de un visitante anónimo salía de la
cookie `fn_chat` que emite el propio servidor. Quien no mandaba cookie recibía un
UUID nuevo en cada petición y el contador nunca acumulaba.

```
2000 peticiones con cookie-jar   ->    20 llegaron al webhook  (11 x HTTP 429)
2000 peticiones sin cookie-jar   ->  2000 llegaron al webhook  (2032 sessionId distintos)
```

Es exactamente la amenaza que describía el comentario del fichero —«cualquiera con
curl puede convertir la factura del proveedor en un problema»— y la derrotaba el
curl más simple posible: uno sin `-c/-b`. Con el peor caso medido de ~0,23 $ por
mensaje, un script a 5 req/s durante una hora son unos 4.100 $.

**Corregido**: la clave del límite pasa a ser `u:<id>` con sesión y `ip:<...>` sin
ella. El `sessionId` no cambia: sigue siendo del servidor y sigue siendo la clave
de la memoria del agente, que estaba bien resuelto.

**Verificación**: 60 peticiones sin cookie desde la misma IP → 20 pasan, 40 dan 429.
Desde otra IP, cubo propio. Con sesión, un solo cubo aunque cambie la IP.

**Supuesto nuevo que hay que sostener**: `x-forwarded-for` es falsificable si no hay
un proxy de confianza delante que la reescriba. Está documentado en el código.

### Aforo ilimitado a las 22:30 (alto)

`c.hora` es un `time`, y la aritmética de `time` **envuelve a medianoche**:

```sql
select time '22:30' + interval '90 minutes';   -->  00:00:00
```

Así que `r.hora < c.hora + interval '90 minutes'` se convertía en `r.hora <
'00:00:00'`, que no la cumple ninguna fila. La subconsulta de aforo sumaba 0 y el
control desaparecía. Determinista, sin concurrencia, alcanzable desde el chat
público, de martes a sábado.

```
ANTES:   8 reservas de 12 comensales un viernes  ->  96 cubiertos en un local de 40,
                                                     y sigue diciendo "Hay mesa"
DESPUÉS: las mismas 8 peticiones                 ->  36 cubiertos, 3 entran,
                                                     el resto recibe alternativas reales
```

**Corregido** comparando sobre `timestamp`, que no envuelve.

### `crear_reserva` filtraba el código de reserva de un tercero (alto)

En la rama de idempotencia, la función buscaba la reserva por `telefono + fecha +
hora` **sin comprobar de quién era** y devolvía su `codigo`. El system prompt manda
entregárselo al cliente, y con ese código `consultar_reserva` da nombre, fecha, hora
y comensales.

Quien conociera un móvil ajeno barría unas 780 combinaciones (13 franjas × 60 días)
— cuatro órdenes de magnitud por debajo de los 28,6 millones del espacio de códigos,
que era la protección teórica. Funcionaba además como oráculo de presencia: «¿tiene
esta persona mesa este sábado?».

**Corregido**: el código solo se devuelve si la reserva es de quien pregunta
(`session_id` o `user_id`). Si no lo es, se niega sin filtrar nada.

### La deduplicación se evadía con un espacio (alto)

El `check` validaba el teléfono normalizado; el índice único iba sobre el **texto
crudo**. `600123456`, `600 123 456` y `+34600123456` eran tres claves distintas y las
tres pasaban. Cuatro peticiones llenaban un sábado con gente que no existe. Y rompía
la idempotencia en uso normal, porque el LLM formatea el teléfono distinto entre
turnos.

**Corregido**: el teléfono se guarda normalizado y el índice único va sobre ese valor.

### `crear_reserva` confirmaba reservas que no existían (alto)

El `exception when unique_violation` no distinguía qué índice había saltado. Si
saltaba el del `codigo` (colisión aleatoria), la búsqueda por teléfono no encontraba
nada y la función devolvía `ok = true, codigo = NULL`: el cliente salía convencido de
tener mesa, sin código que dictar, y sala no tenía la reserva.

No es teórico. Con 5.000 reservas acumuladas —año y medio a diez por día— la
probabilidad es de una cada 5.700 altas, y el espacio no se libera nunca porque el
`codigo` es único también sobre las anuladas.

**Corregido**: se ramifica por el nombre de la constraint y, si fue el código, se
reintenta dentro de un bucle acotado. Nunca confirma en falso.

### El nombre editado en `/cuenta` nunca llegaba a la Navbar (alto)

Dos fuentes para el mismo dato, y solo se escribía una: la Navbar leía
`user_metadata.nombre`, que solo escribe `signUp`; `/cuenta` escribía `profiles`.
`updateUser` no existía en el repo.

Te registrabas como «Rob», lo cambiabas a «Roberto», salía «Datos guardados.» y la
Navbar decía «Rob» para siempre.

Lo que lo hacía grave no era el bug sino el comentario que lo tapaba: *«La Navbar
saluda por el nombre, así que también hay que refrescarla»* junto a un
`revalidatePath` que no servía de nada, porque la Navbar leía de otro sitio. El
siguiente que investigara el fallo habría descartado la Navbar.

**Corregido**: la Navbar lee el mismo DTO de la DAL que escribe `/cuenta`. Se cae de
paso una aserción `as string` sobre `user_metadata`, que era un fallo de
disponibilidad: el propio usuario puede escribir ahí un objeto y provocar un 500 en
todas las páginas con Navbar, incluido el botón de salir.

## Qué queda pendiente

Nada de severidad crítica, alta o media. Lo que sigue es decisión del dueño o
requiere tocar sistemas vivos.

**Requiere acción fuera del repo:**

1. **Poner el límite de gasto en las consolas de Anthropic y OpenAI.** Es lo único
   que acota la pérdida máxima y no depende de código. El bloque 13.3 del checklist
   propio lo llama innegociable. Cinco minutos.

   > **2026-09-03 — decidido que no.** El dueño ha decidido no ponerlo. En su
   > lugar se construyó un limitador propio de dos capas. Ver el addendum del
   > final: el pendiente no se cierra, se sustituye por código que hay que
   > desplegar y mantener.
2. **Desplegar el workflow corregido.** El JSON del repo y la instancia están
   desincronizados a propósito: desplegar es una acción sobre un sistema vivo.
   ```bash
   python3 scripts/n8n.py update 3YCjY6GXMCE2YnyN n8n/forno-nostro-agente.json --yes
   ```
   Antes hay que sustituir los `"id": "REEMPLAZAR"` de credenciales; después, pasar
   la evaluación entera **contra un Supabase de pruebas**, nunca producción.
3. **Aplicar el SQL a la base.** Si es limpia, la `0003` corregida. Si ya tenía la
   original aplicada, `supabase/delta-0003-revision-seguridad.sql`, que está
   probado sobre una base con datos sucios.
4. **Programar la purga de `agente.turnos`.** El `cron.schedule` sigue comentado en
   la migración, y sin él la retención de 90 días es una frase en un documento: el
   log guarda texto libre escrito por clientes.
5. **Retención de los logs de ejecución de n8n.** Guardan el objeto `usuario`
   completo (nombre, teléfono, email) y el texto del cliente. La política de 90 días
   cubre `agente.turnos`, no esto. Se fija con `EXECUTIONS_DATA_MAX_AGE` en la
   instancia.

**Decisiones abiertas:**

6. **El guardarraíl de entrada falla abierto.** Si OpenAI se cae, el mensaje pasa al
   agente en vez de tumbar el chat. Es defendible, pero debe ser consciente.
   Cambiarlo es una línea.
7. **La memoria es `Simple Memory`**, que el checklist marca como «solo pruebas»: se
   pierde al reiniciar n8n o al guardar el workflow. No es un fallo de aislamiento
   —la clave de sesión está bien— pero la ficha lo etiquetaba 🟢. Pasar a `Postgres
   Chat Memory` implicaría dar a n8n acceso a una tabla, rompiendo la propiedad «el
   rol del agente no toca ninguna tabla».
8. **Skill de terceros de tercera mano.** `nextjs-supabase-auth` viene de un
   agregador particular que declara haberla copiado de otro sitio;
   `supabase/agent-skills`, ya en el lockfile y first-party, cubre lo mismo. No
   ejecuta código, pero son instrucciones que un agente sigue con permisos completos.
9. **Retención de `public.reservas`.** `agente.turnos` tiene plazo; las reservas no.
   Y `user_id` es `on delete set null`, así que nombre y teléfono sobreviven a la baja
   del cliente. Hace falta un plazo decidido por el negocio.

   > **2026-09-03 — hay función, falta programarla y falta el plazo.**
   > `agente.purgar_reservas(p_dias integer default 730)` está en la `0004`, con
   > su `cron.schedule` comentado al final del fichero. Corta por `created_at` y
   > no por `fecha`: lo que hay que acotar es la antigüedad del dato personal, no
   > si la cena ya pasó. Los 730 días son un punto de partida; **el plazo sigue
   > siendo decisión del negocio**.
10. **Subir a `next@16.3.4` y `@supabase/supabase-js@2.114.0`** cuando caduque la
    cuarentena de `min-release-age=7` del `.npmrc`. Las versiones instaladas ya
    cierran los cuatro avisos.

**Mitigado, no eliminado:**

11. **Un fallo rápido del proveedor todavía envenena el `mensaje_id`.** Bajar el
    `executionTimeout` de n8n por debajo del timeout de la app cierra el camino del
    timeout, pero un 529 sale por la rama de error en segundos y escribe la cortesía
    en `salida`, que cualquier reintento devolverá cacheada. El arreglo completo
    —marcar la fila como anulada en vez de cerrarla— exige una migración nueva.

    > **2026-09-03 — resuelto.** La migración es la `0004`:
    > `agente.anular_turno(p_mensaje_id)` pone `salida` a null y conserva la
    > cortesía en `error`, y el nodo `Anular turno` la llama **en serie tras
    > `Cerrar turno (fallo)` y antes del Respond**, para que el cliente no vea el
    > botón «Reintentar» mientras la fila sigue envenenada. No es un `DELETE`: la
    > traza y el `mensaje_id` único se conservan. Como todo lo demás del
    > addendum, **sigue sin desplegar**.

## Hallazgos de severidad baja e informativa

Documentados, no todos corregidos: enumeración de códigos de reserva por fuerza
bruta (inviable: 28,6 M contra el límite de uso ya arreglado); `consultar_reserva`
no filtra por `estado`, así que devuelve también las anuladas; CSRF sobre
`/api/chat` (corregido de todas formas, aunque `SameSite=Lax` ya lo mitigaba);
fijación de la cookie `fn_chat` (analizada y **no explotable**: es `httpOnly` y la
app nunca refleja un valor del cliente en un `Set-Cookie`); la Production URL del
webhook es adivinable, irrelevante mientras la Header Auth funcione.

## Falsos positivos descartados con evidencia

Merece la pena dejarlos escritos para no volver a mirarlos:

- **Open redirect en `destinoSeguro()`**: no explotable. Se probaron `//evil.com`,
  `/\evil.com`, `/%2f%2fevil.com`, `/%09/evil.com`, CRLF, backslashes, unicode y
  espacios iniciales, resolviendo cada resultado con el parser WHATWG. Los que pasan
  el filtro **no cambian de host**.
- **Inyección SQL**: no hay. Cero `execute` dinámico, cero `format()`, cero
  concatenación en cláusulas ejecutables en las trece funciones.
- **Fuga de datos personales en logs**: no la hay. Ningún `console.error` registra
  email, teléfono ni el texto del cliente.
- **XSS en el widget del chat**: no lo hay. No existe `dangerouslySetInnerHTML` en
  todo `app/` ni `lib/`.
- **El LLM no controla la identidad**: `p_user_id` y `p_session_id` se pasan desde el
  payload del servidor, no con `$fromAI`. Era el fallo grave que se buscaba y no
  estaba.

## Lo que ya estaba bien

Conviene que conste, porque son justo los sitios donde estos sistemas se rompen:

- El radio de daño del agente está genuinamente acotado. El rol `agente_n8n` no tiene
  `SELECT` sobre ninguna tabla: solo `EXECUTE` sobre ocho funciones. Filtrar la
  credencial de n8n no expone `profiles`, `auth.users` ni `reservas`. Verificado con
  `SET ROLE` real.
- RLS y grants bien estratificados, con la separación entre «qué filas ves» y «qué
  tablas alcanzas» bien entendida. `anon` no llega ni a `reservas` ni a `profiles`.
- Las reglas de negocio están en constraints, no en el prompt, y `crear_reserva`
  revalida aunque el agente ya haya llamado a `disponibilidad`.
- El `sessionId` lo calcula el servidor y es la clave de la memoria: no se mezclan
  conversaciones.
- Toda lectura de datos de usuario pasaba ya por la DAL, y ninguna Server Action se
  saltaba la revalidación de sesión.
- Cero credenciales en el repo y en toda la historia de git.

## Una observación sobre el método

Los tres gates del proyecto —`tsc`, `eslint`, `next build`— pasaban limpios antes de
esta revisión y siguen pasando después. **Ninguno de los seis hallazgos críticos y
altos los habría detectado**, porque casi todos son incoherencias entre lo que un
comentario promete y lo que el código hace, y eso ninguna herramienta lo mira.

Las cinco piezas donde más duele no tener test, con el test concreto que las cubre,
están en el informe del track de calidad: `dentroDelLimite()`, `destinoSeguro()`,
`validarMensajeChat()`, el flujo de reintento del widget, y el par
`obtenerPerfil`/`obtenerFichaCliente`. Las cinco corren con mocks, sin Supabase real.

---

# Addendum · 2026-09-03 — el limitador de gasto

Al día siguiente del informe y con nada de lo de arriba desplegado todavía.
**Este addendum no modifica el informe del 2026-09-02**, que es el registro de lo
que se encontró aquel día: solo cuenta qué ha pasado con tres de sus pendientes.

## El pendiente nº1 no se cierra: se sustituye

**El dueño ha decidido no poner límite de gasto en la consola del proveedor.** Ni
en Anthropic ni en OpenAI. El bloque 13.3 del checklist propio —«límite de gasto
y alerta en el proveedor, innegociable»— **sigue sin cumplirse, y así queda
anotado en `n8n/README.md`, en 🔴**. No es un pendiente esperando cinco minutos:
es una decisión tomada.

Lo que se ha construido en su lugar es un limitador de dos capas, y hay que leerlo
sabiendo lo que sustituye. El límite del proveedor corta aunque se caiga Supabase,
aunque el workflow se despliegue mal y aunque el fallo esté en n8n. Este no: es
código propio, en el mismo camino que protege, y hay que desplegarlo y mantenerlo.

| Capa | Dónde | Qué acota | Persistencia |
|---|---|---|---|
| Filtro barato | `lib/limites.ts`, memoria del proceso de Next | ritmo: 20 msg / 5 min por cliente, 30/min y 400/h globales | ninguna: se reinicia en cada despliegue, se multiplica por réplica |
| Backstop | `agente.cuota()` (`supabase/migrations/0004_limites.sql`), que llama n8n antes del nodo Agent | **gasto**: 5,00 $/día por defecto, más 300 msg/h globales, 40 por sesión y un interruptor de pánico | tabla en Postgres, compartida, se cambia con un `UPDATE` |

Dos cosas que importan para valorar el riesgo residual:

- **La capa de la app no acota dinero y no puede hacerlo.** Al peor caso medido en
  esta misma revisión —0,23 $ por mensaje—, sus 400 mensajes/hora son ~92 $/hora
  atravesándola entera sin romper ninguna regla. Además solo ve el tráfico de
  `/api/chat`: **quien tenga el secreto del webhook llega a n8n sin pasar por
  ella**. Esa es la razón de que el backstop viva dentro de n8n y no en la app.
- **El backstop falla cerrado.** Si `agente.cuota()` no puede calcular el consumo,
  devuelve `permitido = false` y el chat deja de atender. Es la decisión
  incómoda y es la correcta mientras no haya tope en el proveedor: el coste de
  equivocarse hacia el lado abierto es una factura sin techo; hacia el lado
  cerrado, un chat caído que se arregla en cinco minutos y que además avisa.

## Los dos pendientes que sí se cierran

- **Nº11, el `mensaje_id` envenenado: resuelto.** `agente.anular_turno()` en la
  `0004`, llamada desde el nodo `Anular turno` en serie tras `Cerrar turno
  (fallo)` y antes del Respond. Detalle en la anotación del pendiente.
- **Nº9, la retención de `public.reservas`: ya hay función.**
  `agente.purgar_reservas()`, sin programar y con el plazo todavía por decidir.
  Detalle en la anotación del pendiente.

## Qué sigue sin proteger, hoy

Esto es lo que hay que tener claro antes de contar nada de lo anterior como hecho:

1. **La instancia no llama a `agente.cuota()`.** El workflow con los seis nodos
   nuevos está en el repo, no desplegado. Hoy **no hay presupuesto diario, no hay
   aviso al 70 %, no hay corte por gasto y no hay interruptor de pánico**: ese
   interruptor solo existe cuando el nodo que lo consulta está corriendo.
2. **Lo único activo es el filtro en memoria de la app.** Un limitador de ritmo,
   que se reinicia en cada despliegue y que no sabe lo que cuesta un mensaje. Es
   decir: hoy **nada** acota la factura, ni en el proveedor ni en la base de
   datos.
3. **La instancia sigue con la versión anterior a toda la revisión de
   seguridad.** No solo le falta el limitador: le faltan el guardarraíl de
   entrada, el `executionTimeout` de 25 s y la lista negra de `Blindar salida`.
   Lo que atiende el chat hoy es el workflow tal como estaba antes del
   2026-09-02.
4. **Las purgas siguen sin programar**, las dos, así que las políticas de
   retención de `agente.turnos` y de `public.reservas` son de momento dos
   funciones que nadie llama.

El orden para arreglarlo está en `n8n/README.md` → *Prerrequisitos de
despliegue*, y el primero no es negociable: **`0004_limites.sql` va antes que el
workflow**. Al revés, `agente.cuota()` no existe, el nodo falla cerrado y el chat
queda cortado entero.

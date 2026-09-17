-- 0004_limites.sql — el freno de mano del agente: presupuesto, ritmo y purga
--
-- Aplicar desde el SQL Editor del dashboard, después de 0003.
--
-- Por qué existe este fichero, dicho sin rodeos: **no hay límite de gasto en la
-- consola del proveedor de LLM**. Esa era la red de seguridad de verdad —la que
-- corta aunque se caiga esta base de datos, aunque alguien despliegue mal el
-- workflow, aunque el bug esté en n8n— y se ha decidido no ponerla. Así que lo
-- único que separa una landing de barrio de una factura de cuatro cifras son las
-- funciones de este fichero. Están escritas con esa premisa: ante la duda, se
-- corta.
--
-- Tres cosas:
--
--  1. `agente.limites` y `agente.precios`: la configuración vive en la base de
--     datos, no en el código ni en el prompt. Subir el tope o bajar el precio de
--     un modelo es un UPDATE, no un despliegue. El día que la factura se
--     dispare un sábado por la noche, quien esté de guardia necesita poder
--     cerrar el grifo desde el SQL Editor en diez segundos.
--
--  2. `agente.consumo_hoy()` y `agente.cuota()`: lo que n8n llama ANTES de
--     gastar un token. `cuota` es la única de las dos que se concede al agente.
--
--  3. Dos arreglos pendientes de la revisión del 2026-09-02:
--     `agente.anular_turno()` (el turno envenenado del bloque 14.3) y
--     `agente.purgar_reservas()` (retención de nombre y teléfono, bloque 10).
--
-- Convenciones heredadas de 0003 y que aquí no se rompen: `search_path = ''` en
-- todas las funciones —lo que obliga a cualificar cada nombre y cierra el truco
-- de plantar una tabla falsa en un schema propio—, `security definer` donde hace
-- falta saltarse RLS, y nada de EXECUTE para PUBLIC.

-- ---------------------------------------------------------------------------
-- Tabla de configuración: agente.limites
-- ---------------------------------------------------------------------------
-- Una sola fila. El truco de la columna `id boolean primary key check (id)` es
-- feo pero hace exactamente lo que hace falta: `true` es el único valor que pasa
-- el check y la PK impide repetirlo, así que la tabla no puede tener dos filas.
-- Sin eso, alguien inserta una segunda fila "para probar", las funciones leen
-- una cualquiera de las dos y el tope pasa a depender del orden físico. Ese es
-- el tipo de fallo que no se ve hasta que llega la factura.
--
-- El modo de fallo del que SÍ hay que hablar: si alguien borra la fila, las
-- funciones no encuentran configuración. No se inventan un default en memoria
-- —eso sería exactamente lo contrario de lo que hace falta aquí—: `cuota` falla
-- y, al fallar, corta. Ver el `select ... into strict` de más abajo.

create table agente.limites (
  id                        boolean      primary key default true check (id),

  -- Tope de gasto del día, en dólares, contra el desglose que calcula
  -- `agente.consumo_hoy()`. Cinco dólares son ~55 conversaciones de las que
  -- mide el bloque 13 del checklist: mucho más de lo que da una landing de
  -- barrio en un día normal, y poco comparado con lo que cuesta un script
  -- suelto una noche.
  gasto_diario_max_usd      numeric(8,2) not null default 5.00
                              check (gasto_diario_max_usd >= 0
                                     and gasto_diario_max_usd <> 'NaN'::numeric),

  -- Tope de ritmo GLOBAL: mensajes de toda la instalación en la última hora.
  -- No es redundante con el de gasto: el gasto se mide sobre tokens que reporta
  -- n8n, y si n8n deja de reportarlos el gasto se lee 0 para siempre (ver
  -- `sin_tokens` en consumo_hoy). Estos dos contadores de mensajes son el
  -- respaldo que sigue funcionando cuando el contador de dinero miente.
  mensajes_hora_max         integer      not null default 300
                              check (mensajes_hora_max >= 0),

  -- Tope de ritmo por sesión. Una conversación humana son 4-6 turnos; 40 en una
  -- hora ya no es alguien preguntando el horario.
  mensajes_hora_sesion_max  integer      not null default 40
                              check (mensajes_hora_sesion_max >= 0),

  -- A partir de este porcentaje del tope diario, `cuota` devuelve `aviso = true`
  -- aunque siga dejando pasar. Sirve para enterarse ANTES de que el chat se
  -- apague solo: un aviso al 70% da margen a decidir si se sube el tope o se
  -- apaga a propósito; el corte al 100% ya es un hecho consumado.
  aviso_al_porcentaje       smallint     not null default 70
                              check (aviso_al_porcentaje between 1 and 100),

  -- Interruptor de pánico. `update agente.limites set activo = false;` y el chat
  -- deja de gastar en el turno siguiente, sin desplegar, sin tocar n8n y sin
  -- entrar en la consola del proveedor. Es lo primero que comprueba `cuota`, y
  -- se comprueba antes de medir nada: cuando se aprieta este botón no interesa
  -- cuánto se llevaba gastado.
  activo                    boolean      not null default true
);

comment on table agente.limites is
  'Fila única con los topes del agente. Se cambia con UPDATE, sin desplegar.';

insert into agente.limites (id) values (true);

-- ---------------------------------------------------------------------------
-- Tabla de precios: agente.precios
-- ---------------------------------------------------------------------------
-- El precio por millón de tokens NO puede vivir en el código. Cambia cuando el
-- proveedor quiere, y si está en un .ts o en un Code node de n8n hace falta un
-- despliegue para reflejarlo — o sea que no se refleja, y el presupuesto se
-- calcula durante meses con una tarifa que ya no existe.
--
-- `numeric` y no `real`: el dinero no se guarda en coma flotante. Y el check
-- contra 'NaN' no es paranoia decorativa: en Postgres `'NaN'::numeric >= 0` es
-- TRUE, así que un check de "no negativo" a secas deja entrar el NaN, y un solo
-- NaN convierte el `sum()` de `consumo_hoy()` en NaN. A partir de ahí
-- `NaN >= tope` es TRUE y el chat se apaga entero sin que nadie entienda por
-- qué. `x <> 'NaN'` sí lo rechaza (en numeric, NaN = NaN es TRUE).

create table agente.precios (
  modelo                  text         primary key,
  usd_por_millon_entrada  numeric(12,6) not null
                            check (usd_por_millon_entrada >= 0
                                   and usd_por_millon_entrada <> 'NaN'::numeric),
  usd_por_millon_salida   numeric(12,6) not null
                            check (usd_por_millon_salida >= 0
                                   and usd_por_millon_salida <> 'NaN'::numeric),
  actualizado_en          timestamptz  not null default now()
);

comment on table agente.precios is
  'Tarifa por millón de tokens de cada modelo. Un modelo sin fila cuenta 0 $.';

-- Los dos modelos que hay hoy en `n8n/forno-nostro-agente.json`: el principal
-- (nodo «Modelo principal · Claude») y el de respaldo (nodo «Modelo de respaldo
-- · OpenAI»). El `modelo` es el identificador exacto que manda el workflow a
-- `agente.cerrar_turno`, porque el join se hace por texto y "Claude Opus 5" no
-- casa con "claude-opus-5".
--
-- Fuentes, con fecha, porque un precio sin procedencia es un número inventado
-- con suerte:
--   · claude-opus-5  5,00 / 25,00 $ — tabla de modelos de la API de Anthropic,
--     consultada el 2026-09-02. Coincide con la tabla de coste por conversación
--     de `n8n/README.md`.
--   · gpt-4.1-mini   0,40 /  1,60 $ — página de precios de la API de OpenAI
--     (developers.openai.com/api/docs/pricing), consultada el 2026-09-02.
--
-- Si alguna de las dos deja de ser cierta, esto es un UPDATE de una línea. Y si
-- se duda de un precio, lo correcto es ponerlo a 0 y dejarlo escrito: un modelo
-- a 0 no suma al presupuesto, pero sale marcado como `tarifado: false` en el
-- desglose de `consumo_hoy()` y se ve. Un precio inventado no se ve nunca.
insert into agente.precios (modelo, usd_por_millon_entrada, usd_por_millon_salida) values
  ('claude-opus-5', 5.00, 25.00),
  ('gpt-4.1-mini',  0.40,  1.60);

-- ---------------------------------------------------------------------------
-- agente.consumo_hoy() — cuánto llevamos gastado hoy, y en qué
-- ---------------------------------------------------------------------------
-- "Hoy" es el día de la CASA, no el del servidor. n8n y Supabase viven en UTC:
-- en horario de verano de Madrid, un turno de las 01:30 del domingo es todavía
-- sábado en UTC, y el presupuesto del sábado se seguiría gastando después de
-- medianoche mientras el del domingo empieza a las 02:00. La zona horaria vive
-- en un solo sitio, `agente.ahora()`, igual que en 0003.
--
-- El corte se escribe como una comparación contra `created_at` a secas y no como
-- `(created_at at time zone 'Europe/Madrid')::date = hoy`, aunque esa forma se
-- lea mejor, por dos razones:
--
--   1. Repetiría el nombre de la zona horaria fuera de `agente.ahora()`, que es
--      justo lo que 0003 evita.
--   2. No es sargable: envolver la columna en una expresión inutiliza
--      `turnos_created_at_idx` y obliga a un Seq Scan de la tabla que más crece
--      de la base de datos, en la función que se llama ANTES DE CADA MENSAJE.
--
-- La resta de abajo da el instante exacto (timestamptz) en el que empezó el día
-- local: `now()` es el mismo momento que `agente.ahora()` en otra
-- representación, así que restarle lo que va transcurrido del día local aterriza
-- en la medianoche local. El único uso de `now()` aquí es como "ahora"; quien
-- decide qué día es sigue siendo `agente.ahora()`.
--
-- Un turno cuyo `modelo` no esté en `agente.precios` cuenta como mensaje y suma
-- 0 $. Eso es una decisión, no un descuido, y por eso el desglose lo dice:
-- `tarifado: false`. Igual de importante, `sin_tokens` cuenta los turnos sin
-- tokens reportados — si ese número se parece a `mensajes`, el contador de
-- dinero está roto y lo que está sujetando la factura son los topes de mensajes
-- por hora, no el de gasto.

create function agente.consumo_hoy()
returns table (
  mensajes integer,
  usd      numeric,
  modelos  jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with por_modelo as (
    select
      -- Un turno abierto y aún sin cerrar tiene `modelo` a null. Se agrupa
      -- aparte en vez de descartarlo: son mensajes que ya se están pagando.
      coalesce(t.modelo, '(sin modelo)') as modelo,
      count(*)::integer                  as mensajes,
      count(*) filter (
        where t.tokens_entrada is null and t.tokens_salida is null
      )::integer                         as sin_tokens,
      sum(
          coalesce(t.tokens_entrada, 0)::numeric
            * coalesce(p.usd_por_millon_entrada, 0) / 1000000
        + coalesce(t.tokens_salida, 0)::numeric
            * coalesce(p.usd_por_millon_salida, 0) / 1000000
      )                                  as usd,
      bool_or(p.modelo is not null)      as tarifado
    from agente.turnos t
    left join agente.precios p on p.modelo = t.modelo
    where t.created_at >= now() - (agente.ahora() - date_trunc('day', agente.ahora()))
    group by 1
  )
  select
    -- Los tres `coalesce` son para el día que todavía no ha tenido ni un turno:
    -- sin filas, `sum` devuelve null y `jsonb_object_agg` también, y `cuota`
    -- acabaría comparando null contra el tope, que no es ni true ni false.
    coalesce(sum(m.mensajes), 0)::integer,
    round(coalesce(sum(m.usd), 0), 6),
    coalesce(
      jsonb_object_agg(
        m.modelo,
        jsonb_build_object(
          'mensajes',   m.mensajes,
          'sin_tokens', m.sin_tokens,
          'usd',        round(m.usd, 6),
          'tarifado',   m.tarifado
        )
      ),
      '{}'::jsonb
    )
  from por_modelo m;
$$;

comment on function agente.consumo_hoy() is
  'Gasto del día de la casa, con desglose por modelo. Interna: la llama cuota().';

-- ---------------------------------------------------------------------------
-- agente.cuota(session_id) — la pregunta que n8n hace antes de gastar
-- ---------------------------------------------------------------------------
-- Devuelve una fila, siempre. Cuatro comprobaciones en orden, cortando en la
-- primera que falle, de la más barata y más absoluta a la más específica:
--
--   a. `activo`          — el interruptor de pánico.
--   b. gasto del día     — contra `gasto_diario_max_usd`.
--   c. mensajes/hora     — globales, contra `mensajes_hora_max`.
--   d. mensajes/hora     — de ESA sesión, contra `mensajes_hora_sesion_max`.
--
-- Sobre los `motivo`: son texto que va a acabar en la burbuja del chat, así que
-- están escritos en el tono de la casa y no dicen NADA de la contabilidad
-- interna. Ni cuánto se lleva gastado, ni cuál es el tope, ni cuántos mensajes
-- van. Ese detalle le sirve a un atacante para calibrar (sabe cuánto le falta
-- para tumbar el chat del día) y no le sirve de nada a quien quería reservar una
-- mesa. Las cifras viajan en `gastado_usd` y `tope_usd`, que son para el log y
-- para el aviso — **el workflow no debe pintarlas nunca en la respuesta**.
--
-- El teléfono no se repite aquí a propósito: ya está en el system prompt y en la
-- landing, y un número de teléfono en tres sitios es un número de teléfono que
-- se queda viejo en dos.
--
-- FALLO CERRADO. Si esta función no puede calcular el consumo —falta la fila de
-- `agente.limites`, alguien renombró una columna, la tabla de turnos está
-- bloqueada— devuelve `permitido = false`. Es la decisión incómoda y es la
-- correcta: sin tope en el proveedor, "no sé cuánto llevo gastado" y "puedo
-- seguir gastando" no pueden ser la misma respuesta. El coste de equivocarse
-- hacia el lado abierto es una factura sin techo; el de equivocarse hacia el
-- lado cerrado es un chat caído que se arregla en cinco minutos y que además
-- avisa, porque en ese camino `aviso` también sale a true.

create function agente.cuota(p_session_id text)
returns table (
  permitido   boolean,
  motivo      text,
  gastado_usd numeric,
  tope_usd    numeric,
  aviso       boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lim       agente.limites%rowtype;
  v_consumo   record;
  v_aviso     boolean := false;
  v_mensajes  integer;
  v_sqlstate  text;
  v_mensaje   text;
begin
  -- Sin sesión no hay límite por sesión que aplicar, y un `session_id` nulo
  -- desactivaría en silencio la comprobación (d) para siempre — que es
  -- exactamente el agujero que tenía el limitador de la app antes de la revisión
  -- del 2026-09-02: la clave del cubo la elegía quien llamaba. Se corta aquí.
  if p_session_id is null or btrim(p_session_id) = '' then
    raise warning 'agente.cuota llamada sin session_id';
    return query select false,
      'No hemos podido abrir la conversación. Recarga la página o llámanos.'::text,
      null::numeric, null::numeric, true;
    return;
  end if;

  -- `strict`: si no hay exactamente una fila de configuración, esto lanza
  -- no_data_found / too_many_rows y cae en el handler de abajo, que corta. Un
  -- `select ... into` a secas dejaría `v_lim` en null y las comparaciones
  -- posteriores darían null, que en un `if` se comporta como false: el chat
  -- seguiría atendiendo sin ningún tope. Esa es la diferencia entre `strict` y
  -- no ponerlo, y es toda la diferencia.
  select * into strict v_lim from agente.limites;

  -- (a) Interruptor de pánico. Antes de medir nada: cuando esto está en false,
  -- da igual el consumo.
  if not v_lim.activo then
    return query select false,
      'Ahora mismo el chat no está disponible. Llámanos por teléfono y te atendemos igual.'::text,
      null::numeric, v_lim.gasto_diario_max_usd, false;
    return;
  end if;

  select * into strict v_consumo from agente.consumo_hoy();

  -- El aviso se calcula una vez y viaja en todas las salidas de aquí abajo: que
  -- el corte venga por ritmo no significa que el presupuesto esté tranquilo.
  -- Con el tope a 0 cualquier gasto está por encima del umbral, y la división
  -- no llega a hacerse porque el corte (b) ya habrá disparado.
  if v_lim.gasto_diario_max_usd > 0 then
    v_aviso := v_consumo.usd
               >= v_lim.gasto_diario_max_usd * v_lim.aviso_al_porcentaje / 100.0;
  else
    v_aviso := true;
  end if;

  -- (b) Presupuesto del día.
  if v_consumo.usd >= v_lim.gasto_diario_max_usd then
    return query select false,
      'Por hoy el chat ya no puede seguir atendiendo. Mañana volvemos; si es para hoy, llámanos y lo vemos por teléfono.'::text,
      v_consumo.usd, v_lim.gasto_diario_max_usd, true;
    return;
  end if;

  -- (c) Ritmo global de la última hora. Aquí `now()` sí es lo correcto: es una
  -- ventana deslizante de sesenta minutos, no tiene nada que ver con qué día es
  -- en Madrid, y comparar `created_at` contra un timestamptz mantiene el índice
  -- en juego.
  select count(*)::integer into v_mensajes
  from agente.turnos t
  where t.created_at >= now() - interval '1 hour';

  if v_mensajes >= v_lim.mensajes_hora_max then
    return query select false,
      'Ahora mismo hay mucha gente escribiendo y no damos abasto. Prueba dentro de un rato o llámanos.'::text,
      v_consumo.usd, v_lim.gasto_diario_max_usd, v_aviso;
    return;
  end if;

  -- (d) Ritmo de esta sesión. Usa turnos_session_idx (session_id, created_at).
  select count(*)::integer into v_mensajes
  from agente.turnos t
  where t.session_id = p_session_id
    and t.created_at >= now() - interval '1 hour';

  if v_mensajes >= v_lim.mensajes_hora_sesion_max then
    return query select false,
      'Vamos muy rápido; déjame un momento y seguimos. Si tienes prisa, llámanos y te atendemos por teléfono.'::text,
      v_consumo.usd, v_lim.gasto_diario_max_usd, v_aviso;
    return;
  end if;

  return query select true, 'Adelante.'::text,
    v_consumo.usd, v_lim.gasto_diario_max_usd, v_aviso;

exception
  when others then
    -- El detalle se queda en el log del servidor, que es nuestro. Hacia n8n —y
    -- de ahí, potencialmente, hacia la burbuja del chat— va una frase. Y va
    -- `permitido = false`, que es el punto entero de este bloque.
    get stacked diagnostics
      v_sqlstate = returned_sqlstate,
      v_mensaje  = message_text;
    raise warning 'agente.cuota falló [%]: % (sesión=%)', v_sqlstate, v_mensaje, p_session_id;
    return query select false,
      'No podemos atenderte por el chat en este momento. Llámanos y lo solucionamos.'::text,
      null::numeric, null::numeric, true;
end;
$$;

comment on function agente.cuota(text) is
  'Puerta de gasto del agente: se llama ANTES de gastar un token. Falla cerrada.';

-- ---------------------------------------------------------------------------
-- agente.anular_turno() — desenvenenar un turno para que se pueda reintentar
-- ---------------------------------------------------------------------------
-- Cierra el pendiente 14.3 de la revisión del 2026-09-02.
--
-- El fallo, tal cual: cuando el agente revienta —un 529 del proveedor sale por
-- la rama de error en segundos—, el nodo `Cerrar turno (fallo)` llama a
-- `agente.cerrar_turno` y escribe el TEXTO DE CORTESÍA en `agente.turnos.salida`.
-- Y `agente.registrar_turno` devuelve `respuesta_previa` en cualquier reintento
-- con el mismo `mensajeId`. Resultado: el botón «Reintentar» del widget devuelve
-- esa cortesía cacheada para siempre. El mensaje queda muerto y el cliente
-- concluye que el chat no funciona, que es exactamente lo que parece.
--
-- Bajar el `executionTimeout` a 25 s mitigó el camino lento. Este es el arreglo
-- del camino rápido, que es el que de verdad envenena la fila.
--
-- Lo que hace, y por qué así:
--   · `salida = null`  — es la condición que `registrar_turno` mira para decidir
--     si sirve lo cacheado o deja pasar el reintento. Con `salida` en null, el
--     reintento vuelve a ejecutar al agente.
--   · NO es un DELETE. Borrar la fila también dejaría el turno reintentable, y
--     de paso destruiría la traza del bloque 11 y liberaría el `mensaje_id`
--     único, con lo que se perdería la idempotencia justo para el mensaje que ya
--     ha dado problemas. La fila se queda; lo que se va es la respuesta falsa.
--   · La cortesía que había en `salida` se guarda en `error`, junto con la
--     incidencia que ya hubiera. La traza no se pierde: se mueve de la columna
--     donde miente a la columna donde informa.
--
-- Es idempotente por construcción: solo toca filas con `salida` no nula, así que
-- llamarla dos veces —o sobre un `mensaje_id` que no existe— no hace nada y no
-- falla. Un botón de reintentar tiene que poder pulsarse dos veces.
--
-- Devuelve void, como pide el contrato con el workflow. El precio de eso es que
-- el llamante no distingue "anulado" de "no había nada que anular"; para el
-- reintento da igual, porque lo que decide es lo que devuelva `registrar_turno`
-- a continuación.

create function agente.anular_turno(p_mensaje_id text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update agente.turnos t
  set
    salida = null,
    error  = left(
               coalesce(nullif(btrim(t.error), '') || ' | ', '')
               || 'anulado ' || to_char(agente.ahora(), 'YYYY-MM-DD HH24:MI')
               || ': salida previa = ' || coalesce(left(t.salida, 500), '(vacía)'),
               4000)
  where t.mensaje_id = p_mensaje_id
    and t.salida is not null;
$$;

comment on function agente.anular_turno(text) is
  'Deja un turno reintentable: quita la salida cacheada y la conserva en error.';

-- ---------------------------------------------------------------------------
-- agente.purgar_reservas() — retención de los datos de reserva
-- ---------------------------------------------------------------------------
-- Gemela de `agente.purgar()`, y por el mismo motivo (bloque 10, minimización).
-- `public.reservas` guarda NOMBRE y TELÉFONO de gente que reservó una mesa, y
-- hoy no tiene ningún plazo de conservación: la primera reserva de 2026 seguirá
-- ahí en 2036 si nadie hace nada.
--
-- Y hay un segundo motivo, menos evidente: `reservas.user_id` es
-- `on delete set null`. Está bien puesto —si el cliente se da de baja, la mesa
-- del sábado sigue reservada y sala necesita saberlo—, pero significa que darse
-- de baja NO borra el nombre ni el teléfono de esa persona. Se queda la fila,
-- sin el vínculo. Sin una purga, "borrar mi cuenta" no borra sus datos de
-- reserva, y eso es una promesa incumplida.
--
-- 730 días (dos años) es un PUNTO DE PARTIDA, no una regla: aquí no hay factura
-- ni obligación contable que sostener, solo el histórico de sala. **El plazo lo
-- decide el negocio**, y se cambia pasando otro número al llamarla. Se corta por
-- `created_at` y no por `fecha` a propósito: lo que hay que acotar es la
-- antigüedad del dato personal, no si la cena ya pasó.

create function agente.purgar_reservas(p_dias integer default 730)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_borrados integer;
begin
  delete from public.reservas
  where created_at < now() - (p_dias || ' days')::interval;
  get diagnostics v_borrados = row_count;
  return v_borrados;
end;
$$;

comment on function agente.purgar_reservas(integer) is
  'Borra reservas antiguas (nombre y teléfono). Plazo por defecto 730 días.';

-- No se añade índice sobre `public.reservas (created_at)`, y es una decisión, no
-- un olvido. `agente.turnos` sí lo lleva porque crece con cada mensaje del chat;
-- `reservas` crece con cada mesa que se sienta, o sea unos pocos miles de filas
-- al año. Un Seq Scan nocturno sobre eso no se nota, y un índice de más sí se
-- nota en la única ruta de escritura que está serializada por advisory lock
-- (`agente.crear_reserva`). Si algún día la tabla crece de verdad, el índice se
-- añade entonces, con el `explain` delante.

-- ---------------------------------------------------------------------------
-- Programar las dos purgas
-- ---------------------------------------------------------------------------
-- Mismo criterio que en 0003: una política de retención que nadie ejecuta es una
-- frase en un documento. Con pg_cron ya habilitado desde Database → Extensions:
--
--   select cron.schedule(
--     'purgar-reservas',
--     '45 4 * * *',                              -- después de purgar-turnos-agente
--     $cron$ select agente.purgar_reservas(730) $cron$
--   );
--
-- Ojo al rol: lo programa quien ejecuta el select, no `agente_n8n`. El agente no
-- borra reservas — ni las suyas ni las de nadie.

-- ---------------------------------------------------------------------------
-- Índices
-- ---------------------------------------------------------------------------
-- No hace falta ninguno nuevo, y esto se comprobó con `explain (analyze)` sobre
-- 200.000 turnos repartidos en 180 días, no a ojo:
--
--   · `consumo_hoy()`  →  `created_at >= <medianoche local>`  →  Bitmap Index
--     Scan sobre `turnos_created_at_idx`, ya creado en 0003 para la purga.
--     1.366 filas, 891 buffers, 4 ms.
--   · `cuota()` (c)    →  `count(*) where created_at >= ahora - 1h`  →  Bitmap
--     Index Scan sobre el mismo índice. 50 buffers, 0,07 ms.
--   · `cuota()` (d)    →  `session_id = $1 and created_at >= ahora - 1h`  →
--     Index Only Scan sobre `turnos_session_idx (session_id, created_at desc)`,
--     Heap Fetches: 0. Ya tiene las dos columnas en el orden correcto.
--
-- La llamada completa a `agente.cuota()` con ese volumen tarda 2 ms. Se paga una
-- vez por mensaje, delante de una llamada al LLM que tarda segundos.
--
-- Se valoró un índice de cobertura `(created_at) include (modelo,
-- tokens_entrada, tokens_salida)` para que `consumo_hoy()` no baje al heap. Se
-- creó, se midió y se descartó: el planificador **siguió eligiendo
-- `turnos_created_at_idx`** y el índice ocupaba 9,7 MB para una tabla de 19 MB.
-- Media tabla de más en la ruta que más escribe, a cambio de nada. Si algún día
-- el volumen diario lo justifica, esa es la línea que hay que escribir — con el
-- `explain` delante otra vez.

-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------
-- Las tablas nuevas no las alcanza nadie salvo el dueño. `agente_n8n` no tiene
-- ni SELECT sobre ellas: llega a los datos que necesita a través de `cuota()`,
-- que es `security definer`. Que un agente pueda LEER su propio presupuesto ya
-- es de más; que pueda ESCRIBIRLO sería regalarle el interruptor de pánico a
-- quien tiene que obedecerlo.

revoke all on agente.limites, agente.precios from public, anon, authenticated;

-- RLS sobre dos tablas que ya son inalcanzables por falta de grants. No es
-- redundancia inútil: es la segunda cerradura. Si algún día alguien hace un
-- `grant select on all tables in schema agente` de más —un comando de una línea
-- que parece inofensivo—, los grants dejan de proteger y RLS sin políticas sigue
-- devolviendo cero filas. Y de paso mantiene la coherencia con el resto del
-- esquema: aquí todas las tablas tienen RLS.
alter table agente.limites enable row level security;
alter table agente.precios enable row level security;

-- Sin políticas, a propósito. RLS activado y sin ninguna policy significa "nadie
-- ve nada", salvo el dueño de la tabla y los roles con BYPASSRLS. Es el default
-- que queremos: estas dos tablas no las lee ningún rol de aplicación.

-- Las funciones de este fichero ya nacen sin EXECUTE para PUBLIC gracias a la
-- entrada global de `alter default privileges` que puso 0003 — pero solo si 0004
-- lo aplica el MISMO rol que aplicó 0003, porque esas entradas son por rol
-- propietario. En el SQL Editor de Supabase siempre es `postgres` y se cumple;
-- aun así el revoke explícito va escrito, porque cuesta una línea y no depende
-- de una suposición sobre quién ejecuta qué.
revoke execute on function
  agente.consumo_hoy(),
  agente.cuota(text),
  agente.anular_turno(text),
  agente.purgar_reservas(integer)
from public, anon, authenticated;

-- Y esto es todo lo que se le abre al agente. Dos verbos:
grant execute on function
  agente.cuota(text),
  agente.anular_turno(text)
to agente_n8n;

-- Lo que deliberadamente NO se concede, y conviene leerlo entero porque cada
-- ausencia es una decisión:
--
--   · `agente.consumo_hoy()` — se llega a ella por `cuota()`, que es
--     `security definer` y por tanto puede llamarla aunque quien invoca no
--     pueda. Concederla suelta le daría al agente (y a quien le robe la
--     credencial) el desglose de gasto del negocio, que no necesita para
--     atender a nadie.
--   · `agente.purgar()` y `agente.purgar_reservas()` — un agente no borra sus
--     propios logs ni los datos de los clientes. Eso lo dispara pg_cron con otra
--     credencial.
--   · UPDATE sobre `agente.limites` — un agente no se sube su propio
--     presupuesto. Si el chat pudiera escribir aquí, el tope de gasto sería una
--     sugerencia: bastaría una inyección de prompt que acabe en un `update` para
--     que la única barrera que queda se desactive sola.
--   · UPDATE sobre `agente.precios` — poner un precio a 0 tiene exactamente el
--     mismo efecto que subir el tope, solo que sin dejar rastro en la tabla que
--     alguien vigila.

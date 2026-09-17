-- 0003_agente.sql — reservas de mesa y la superficie que ve el agente de n8n
--
-- Aplicar desde el SQL Editor del dashboard, después de 0002.
--
-- Este fichero hace dos cosas que conviene no mezclar mentalmente:
--
--  1. Añade el ESTADO del negocio: horarios de apertura y reservas de mesa.
--     Es de la pizzería, no del agente; mañana lo usará también un panel de
--     sala sin que nadie toque nada de aquí.
--
--  2. Define el schema `agente`: el conjunto exacto de verbos que n8n puede
--     ejecutar contra esta base de datos. Ni una tabla, ni un SELECT libre:
--     seis funciones. Esa es la diferencia entre "el agente tiene acceso a la
--     base de datos" y "el agente puede hacer estas seis cosas".
--
-- Las reglas de negocio (turnos, aforo, antelación, tamaño de grupo) viven
-- AQUÍ y no en el prompt del agente. Un prompt es una sugerencia muy bien
-- redactada; una constraint es una regla. Y de paso valen igual para la app,
-- para el agente y para lo que venga después.

-- ---------------------------------------------------------------------------
-- Horarios de apertura
-- ---------------------------------------------------------------------------
-- Una fila por (día, turno). Un día cerrado simplemente no tiene filas: así no
-- hace falta una columna `cerrado` que alguien olvidará mirar en una query.
--
-- `dia_semana` sigue el convenio de extract(dow): 0 = domingo … 6 = sábado.

create table public.horarios (
  dia_semana  smallint not null check (dia_semana between 0 and 6),
  turno       text     not null check (turno in ('comida', 'cena')),
  abre        time     not null,
  cierra      time     not null,
  primary key (dia_semana, turno),
  -- `cierra` es un `time`, así que un turno NO puede cruzar medianoche: las
  -- 00:30 del sábado serían "antes" que las 19:30 y toda la aritmética de
  -- franjas se rompería en silencio. Los viernes y sábados el cierre se
  -- modela como 23:45; la última mesa se sienta una hora antes de esa marca,
  -- que es lo que importa aquí. Si algún día hace falta servir después de las
  -- doce, esta columna pasa a `interval` y hay que revisar franjas_libres().
  constraint horarios_turno_coherente check (cierra > abre)
);

comment on table public.horarios is
  'Horario de apertura por día y turno. Sin fila = cerrado. dow: 0=domingo.';

insert into public.horarios (dia_semana, turno, abre, cierra) values
  -- Lunes (1) cerramos: no hay filas, y eso es toda la lógica que hace falta.
  (2, 'cena',   '19:30', '23:30'),
  (3, 'cena',   '19:30', '23:30'),
  (4, 'cena',   '19:30', '23:30'),
  (5, 'comida', '13:00', '16:00'),
  (5, 'cena',   '19:30', '23:45'),
  (6, 'comida', '13:00', '16:30'),
  (6, 'cena',   '19:30', '23:45'),
  (0, 'comida', '13:00', '16:30'),
  (0, 'cena',   '19:30', '23:00');

-- ---------------------------------------------------------------------------
-- Reservas
-- ---------------------------------------------------------------------------

create table public.reservas (
  id          bigint generated always as identity primary key,
  -- Lo que se le dice al cliente por voz o por chat. Corto, sin caracteres que
  -- se confundan al dictarlo, y NO adivinable: el id secuencial serviría para
  -- enumerar las reservas de todo el restaurante probando números.
  codigo      text not null unique,
  -- Se rellena si quien reserva tenía sesión abierta. `on delete set null`
  -- y no cascade: si el cliente se da de baja, la mesa del sábado sigue
  -- reservada — sala necesita saberlo.
  user_id     uuid references public.profiles (id) on delete set null,
  -- Cota SUPERIOR además de la inferior. `nombre` y `telefono` llegan por
  -- $fromAI, o sea que los escribe el usuario del chat: sin tope se guardaron
  -- 5.000 caracteres en `nombre` sin que saltara nada. Un nombre de reserva
  -- que no cabe en 120 caracteres no es un nombre, y un teléfono de más de 30
  -- caracteres no es un teléfono.
  nombre      text not null check (length(btrim(nombre)) between 2 and 120),
  telefono    text not null check (
                length(btrim(telefono)) <= 30
                and length(regexp_replace(telefono, '\D', '', 'g')) >= 9),
  fecha       date not null,
  hora        time not null,
  comensales  smallint not null check (comensales between 1 and 12),
  notas       text check (length(notas) <= 500),
  estado      text not null default 'confirmada'
                check (estado in ('confirmada', 'anulada')),
  origen      text not null default 'agente'
                check (origen in ('agente', 'web', 'telefono')),
  -- Para poder rastrear una reserva hasta la conversación que la creó cuando
  -- el cliente diga "yo no pedí eso". Ver agente.turnos más abajo.
  session_id  text,
  created_at  timestamptz not null default now()
);

create index reservas_fecha_idx   on public.reservas (fecha, hora) where estado = 'confirmada';
create index reservas_user_id_idx on public.reservas (user_id);

-- ---------------------------------------------------------------------------
-- La forma canónica de un teléfono
-- ---------------------------------------------------------------------------
-- El `check` de arriba ya validaba sobre el teléfono sin puntuación, pero el
-- índice único de abajo iba sobre el texto crudo, y eso no es lo mismo:
-- `600123456`, `600 123 456` y `+34600123456` son tres claves distintas y las
-- tres pasaban. Cuatro peticiones del mismo número llenaban un sábado. Y en uso
-- normal rompía la idempotencia, porque el LLM formatea el teléfono distinto
-- entre un turno y el siguiente.
--
-- Se normaliza en un solo sitio y se usa en los tres: al escribir, al buscar el
-- duplicado y en el índice. `immutable` no es decorativo: sin eso Postgres no
-- deja indexar por esta expresión.
--
-- El prefijo 34 se quita porque aquí los teléfonos son españoles y de 9
-- dígitos: sin esa regla `+34600123456` seguiría siendo una clave aparte. El
-- día que haya clientes de fuera, esto pasa a una librería de verdad.

create function private.telefono_normalizado(p_telefono text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select case when d ~ '^34[0-9]{9}$' then substr(d, 3) else d end
  from (select regexp_replace(p_telefono, '\D', '', 'g')) as t(d);
$$;

revoke execute on function private.telefono_normalizado(text)
  from public, anon, authenticated;

-- Idempotencia de la acción cara (2.5 del checklist). El agente puede llamar a
-- crear_reserva dos veces por un reintento, por un doble clic o porque el LLM
-- se lió: el mismo teléfono, el mismo día y la misma hora no pueden entrar dos
-- veces. Índice parcial para que anular y volver a reservar siga siendo legal.
create unique index reservas_sin_duplicados
  on public.reservas (private.telefono_normalizado(telefono), fecha, hora)
  where estado = 'confirmada';

comment on table public.reservas is
  'Reservas de mesa. Las crea el agente por función; sala las gestiona a mano.';

-- Privilegios y RLS: el cliente logueado ve LAS SUYAS y nada más. Escribir no
-- puede: las reservas entran por agente.crear_reserva(), que es quien aplica
-- las reglas. Un INSERT directo desde el navegador se las saltaría todas.

revoke all on public.horarios, public.reservas from anon, authenticated;

grant select on public.horarios to anon, authenticated;
grant select on public.reservas to authenticated;

alter table public.horarios enable row level security;
alter table public.reservas enable row level security;

create policy "horarios públicos"
  on public.horarios for select
  to anon, authenticated
  using (true);

create policy "reservas propias: lectura"
  on public.reservas for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Schema `agente`: la superficie de ataque, escrita a mano
-- ---------------------------------------------------------------------------
-- Todo lo que n8n puede hacer aquí está en este schema y en ningún otro sitio.
-- Las funciones son `security definer` (corren como el dueño, se saltan RLS)
-- con `search_path = ''`, que obliga a cualificar cada nombre y cierra el
-- truco clásico de crear una tabla `public.reservas` falsa en un schema propio
-- para que la función la lea por error.

create schema agente;

revoke all on schema agente from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reloj de la casa
-- ---------------------------------------------------------------------------
-- La pizzería está en Madrid y el servidor de n8n vive en UTC. Sin este punto
-- único de conversión, "hoy" y "dentro de una hora" significan cosas distintas
-- según qué nodo pregunte, y la reserva de las 00:30 se va al día anterior.

create function agente.ahora()
returns timestamp
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone 'Europe/Madrid')::timestamp;
$$;

-- ---------------------------------------------------------------------------
-- Tool 1 — consultar la carta
-- ---------------------------------------------------------------------------
-- Devuelve el precio ya formateado además del entero. El agente es capaz de
-- convertir 950 en "9,50 €", pero es justo el tipo de cálculo trivial en el
-- que un LLM se equivoca una vez de cada doscientas, y esa vez el cliente se
-- planta en la puerta con un precio que no existe. Que lo formatee Postgres.

create function agente.carta(p_categoria text default null)
returns table (
  categoria    text,
  plato        text,
  descripcion  text,
  precio       text,
  precio_cents integer,
  etiquetas    text[],
  alergenos    text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.titulo,
    p.nombre,
    p.descripcion,
    -- A mano y no con to_char(..., 'FM999D00'): el separador decimal de to_char
    -- sale del locale del servidor, y el de Supabase no es el de aquí. Un
    -- precio que se pinta "9.50 €" en producción y "9,50 €" en local es un bug
    -- que no se ve hasta que el cliente lo lee.
    (p.precio_cents / 100)::text || ',' ||
      lpad((p.precio_cents % 100)::text, 2, '0') || ' €',
    p.precio_cents,
    p.etiquetas,
    p.alergenos
  from public.platos p
  join public.categorias c on c.id = p.categoria_id
  where p.disponible
    -- `nullif(btrim(...), '')` y no `p_categoria is null` a secas: un LLM que no
    -- quiere filtrar manda tanto null como cadena vacía, según el día y el
    -- modelo. Las dos cosas tienen que significar "la carta entera".
    and (nullif(btrim(p_categoria), '') is null
         or c.id = lower(btrim(p_categoria))
         or c.titulo ilike '%' || btrim(p_categoria) || '%')
  order by c.orden, p.orden;
$$;

comment on function agente.carta(text) is
  'Tool del agente: carta completa o filtrada por categoría.';

-- ---------------------------------------------------------------------------
-- Tool 2 — horarios y si estamos abiertos ahora
-- ---------------------------------------------------------------------------

create function agente.horarios()
returns table (
  dia          text,
  horario      text,
  es_hoy       boolean,
  abierto_ahora boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with dias as (
    select d as dow,
           case d when 0 then 'Domingo' when 1 then 'Lunes'   when 2 then 'Martes'
                  when 3 then 'Miércoles' when 4 then 'Jueves' when 5 then 'Viernes'
                  else 'Sábado' end as nombre,
           -- Lunes primero, que es como lo lee un cliente español.
           case when d = 0 then 7 else d end as orden
    from generate_series(0, 6) as d
  ),
  hoy as (select extract(dow from agente.ahora())::smallint as dow,
                 agente.ahora()::time as hora)
  select
    dias.nombre,
    coalesce(
      string_agg(
        to_char(h.abre, 'HH24:MI') || '–' || to_char(h.cierra, 'HH24:MI'),
        ' y ' order by h.abre),
      'Cerrado'),
    dias.dow = (select dow from hoy),
    -- El `coalesce` no sobra: el día cerrado entra por el left join con `abre`
    -- a null, `bool_or` de un único null devuelve null, y `true and null` es
    -- null. Este campo viaja a agente.contexto() y de ahí al system prompt, así
    -- que los lunes el modelo leía `abierto_ahora: null` y decidía por su
    -- cuenta qué significaba. Un booleano que sale del prompt es true o false.
    dias.dow = (select dow from hoy)
      and coalesce(bool_or((select hora from hoy) between h.abre and h.cierra), false)
  from dias
  left join public.horarios h on h.dia_semana = dias.dow
  group by dias.nombre, dias.orden, dias.dow
  order by dias.orden;
$$;

comment on function agente.horarios() is
  'Tool del agente: horario semanal y si la pizzería está abierta ahora mismo.';

-- ---------------------------------------------------------------------------
-- Contexto del turno — se inyecta en el prompt, no es una tool
-- ---------------------------------------------------------------------------
-- Fecha, hora y si estamos abiertos AHORA. Va inyectado en el system prompt y
-- no como tool a propósito (bloque 3.4): son cuatro campos que hacen falta en
-- casi todas las respuestas ("¿estáis abiertos?", "quiero mesa mañana"), y
-- pagar una llamada a herramienta para saber qué día es sale más caro que
-- meterlo siempre. Lo que es grande o se pide poco —la carta, el horario
-- semanal— sí son tools.

create function agente.contexto()
returns table (
  fecha         text,
  hora          text,
  dia           text,
  horario_hoy   text,
  abierto_ahora boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    to_char(agente.ahora(), 'DD/MM/YYYY'),
    to_char(agente.ahora(), 'HH24:MI'),
    h.dia,
    h.horario,
    h.abierto_ahora
  from agente.horarios() h
  where h.es_hoy;
$$;

-- ---------------------------------------------------------------------------
-- Franjas libres (interno, lo usan las dos tools de reserva)
-- ---------------------------------------------------------------------------
-- Aforo y hueco entre reservas son constantes aquí y no parámetros porque hoy
-- no hay quien los edite. Cuando haya panel de sala, pasan a una tabla de
-- configuración; el resto de la lógica no se entera.

create function agente.franjas_libres(p_fecha date, p_comensales integer)
returns table (hora time)
language sql
stable
security definer
set search_path = ''
as $$
  with candidatas as (
    -- Cada media hora, desde que abre hasta una hora antes de cerrar: no se
    -- sienta a nadie con el horno apagándose.
    select t::time as hora
    from public.horarios h
    cross join lateral generate_series(
      (p_fecha + h.abre)::timestamp,
      (p_fecha + h.cierra)::timestamp - interval '1 hour',
      interval '30 minutes'
    ) as t
    where h.dia_semana = extract(dow from p_fecha)::smallint
  )
  select c.hora
  from candidatas c
  where
    -- Nada en el pasado, y con al menos una hora de margen para hoy: la masa
    -- necesita su tiempo y sala necesita enterarse.
    (p_fecha > agente.ahora()::date
     or c.hora > (agente.ahora() + interval '1 hour')::time)
    -- Aforo: 40 cubiertos en la ventana de ±90 minutos, que es lo que dura una
    -- mesa. Sin esto el agente confirma 200 personas para el sábado.
    --
    -- La ventana se compara sobre `timestamp` y no sobre `time` porque la
    -- aritmética de `time` ENVUELVE a medianoche: `time '22:30' + interval '90
    -- minutes'` no es 24:00, es 00:00:00, y entonces `r.hora < 00:00:00` no lo
    -- cumple ninguna fila, la subconsulta suma 0 y el aforo desaparece justo en
    -- la última franja de la noche. Ocho reservas de 12 a las 22:30 entraban
    -- las ocho: 96 cubiertos en un local de 40, y seguía diciendo "hay mesa".
    -- Sumando la fecha, el 00:00 pasa a ser el del día siguiente y la
    -- comparación vuelve a significar lo que parece que significa.
    and 40 >= p_comensales + coalesce((
      select sum(r.comensales)
      from public.reservas r
      where r.estado = 'confirmada'
        and r.fecha = p_fecha
        and (p_fecha + r.hora) > (p_fecha + c.hora) - interval '90 minutes'
        and (p_fecha + r.hora) < (p_fecha + c.hora) + interval '90 minutes'
    ), 0)
  order by c.hora;
$$;

-- ---------------------------------------------------------------------------
-- Tool 3 — ¿hay hueco?
-- ---------------------------------------------------------------------------
-- Devuelve SIEMPRE alternativas cuando dice que no. Un "no hay mesa" a secas
-- termina la conversación y pierde al cliente; "a las 21:00 no, pero tengo a
-- las 20:00 y a las 22:30" la continúa. Que la alternativa la calcule la base
-- de datos y no el agente es deliberado: si se la inventa, se inventa una mesa.

create function agente.disponibilidad(
  p_fecha      date,
  p_hora       time,
  p_comensales integer
)
returns table (
  disponible   boolean,
  motivo       text,
  alternativas time[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_libres time[];
  v_abre   boolean;
begin
  if p_comensales is null or p_comensales < 1 then
    return query select false, 'Faltan los comensales.'::text, null::time[];
    return;
  end if;

  -- Grupos grandes: fuera de alcance a propósito (bloque 1.2). Necesitan
  -- juntar mesas y hablarlo, y el agente no está para negociar eso.
  if p_comensales > 12 then
    return query select false,
      'Más de 12 comensales se gestiona por teléfono, no por reserva automática.'::text,
      null::time[];
    return;
  end if;

  if p_fecha < agente.ahora()::date then
    return query select false, 'Esa fecha ya pasó.'::text, null::time[];
    return;
  end if;

  -- Dos meses de horizonte. Más allá no se sabe ni qué carta habrá.
  if p_fecha > (agente.ahora()::date + 60) then
    return query select false,
      'Solo se reservan mesas con hasta 60 días de antelación.'::text,
      null::time[];
    return;
  end if;

  select exists (
    select 1 from public.horarios h
    where h.dia_semana = extract(dow from p_fecha)::smallint
  ) into v_abre;

  if not v_abre then
    return query select false, 'Ese día la pizzería está cerrada.'::text, null::time[];
    return;
  end if;

  select array_agg(f.hora) into v_libres
  from agente.franjas_libres(p_fecha, p_comensales) f;

  if v_libres is null then
    return query select false,
      'Ese día está completo para ese número de comensales.'::text,
      null::time[];
    return;
  end if;

  if p_hora is not null and p_hora = any(v_libres) then
    return query select true, 'Hay mesa.'::text, null::time[];
    return;
  end if;

  -- Las tres franjas libres más cercanas a lo que pidió.
  return query
    select false,
      case when p_hora is null
        then 'Esas son las horas libres.'::text
        else 'A esa hora no hay mesa.'::text
      end,
      -- Se eligen las tres MÁS CERCANAS a lo que pidió, pero se devuelven en
      -- orden de reloj: "20:00, 20:30 o 22:30" se lee; "22:30, 20:00, 20:30"
      -- hay que descifrarlo.
      (select array_agg(x.hora order by x.hora)
       from (
         select h AS hora,
                abs(extract(epoch from (h - coalesce(p_hora, h)))) as dist
         from unnest(v_libres) as h
         order by dist, h
         limit 3
       ) x);
end;
$$;

comment on function agente.disponibilidad(date, time, integer) is
  'Tool del agente: dice si hay mesa y, si no, tres alternativas reales.';

-- ---------------------------------------------------------------------------
-- Tool 4 — crear la reserva
-- ---------------------------------------------------------------------------
-- La única función que escribe. Vuelve a validar TODO aunque el agente acabe
-- de llamar a disponibilidad(): entre una llamada y otra pueden pasar treinta
-- segundos y otra reserva, y el agente puede haberse saltado la comprobación
-- directamente. Una tool no confía en que la llamen bien.

-- El código de reserva se saca de pgcrypto, que en Supabase vive en el schema
-- `extensions`. Con `search_path = ''` hay que cualificarla, y si no está la
-- función el fallo aparecería en runtime, dentro del `when others` de abajo: el
-- agente diría "no hemos podido guardar la reserva" para siempre y nadie
-- sabría por qué. Mejor que se caiga aquí, con la línea que lo arregla puesta.
do $$
begin
  if to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception using
      message = 'agente.crear_reserva necesita gen_random_bytes en el schema `extensions`.',
      hint    = 'create extension pgcrypto with schema extensions;';
  end if;
end
$$;

create function agente.crear_reserva(
  p_nombre     text,
  p_telefono   text,
  p_fecha      date,
  p_hora       time,
  p_comensales integer,
  p_notas      text default null,
  p_session_id text default null,
  p_user_id    uuid default null
)
returns table (ok boolean, codigo text, motivo text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_disp       record;
  v_previa     record;
  v_codigo     text;
  v_nombre     text;
  v_telefono   text;
  v_notas      text;
  v_bytes      bytea;
  v_intento    integer;
  v_constraint text;
  v_sqlstate   text;
  v_mensaje    text;
begin
  if p_nombre is null or length(btrim(p_nombre)) < 2 then
    return query select false, null::text, 'Falta el nombre de quien reserva.'::text;
    return;
  end if;

  v_nombre := btrim(p_nombre);

  -- Los topes de la tabla se comprueban también aquí, y antes de tocar nada.
  -- Si los dejamos saltar como check_violation, el cliente recibe el mensaje
  -- neutro del `when others` de abajo y nadie sabe qué corregir.
  if length(v_nombre) > 120 then
    return query select false, null::text,
      'Ese nombre es demasiado largo para una reserva.'::text;
    return;
  end if;

  if p_telefono is null or length(regexp_replace(p_telefono, '\D', '', 'g')) < 9 then
    return query select false, null::text, 'Falta un teléfono de contacto válido.'::text;
    return;
  end if;

  if length(btrim(p_telefono)) > 30 then
    return query select false, null::text, 'Ese teléfono no parece un teléfono.'::text;
    return;
  end if;

  -- Se guarda YA normalizado. Si lo que entra en la tabla es el texto tal cual
  -- lo escribió el LLM, el índice de deduplicación protege contra la variante
  -- exacta y contra ninguna más.
  v_telefono := private.telefono_normalizado(p_telefono);

  -- `notas` viene de $fromAI: lo dicta el usuario del chat. Se recorta aquí en
  -- vez de dejar que salte el check de la tabla, porque el DETAIL de un
  -- check_violation de Postgres VUELCA LA FILA ENTERA —nombre, teléfono, fecha,
  -- hora, session_id— y ese texto acaba en el log de n8n y, si alguien no filtra
  -- bien arriba, en la respuesta del chat. 500 caracteres son de sobra para
  -- "alergia al gluten y una trona".
  v_notas := left(nullif(btrim(p_notas), ''), 500);

  -- Aforo y escritura tienen que ser atómicos. Sin esto, dos peticiones
  -- simultáneas leen el mismo snapshot, las dos ven hueco y las dos entran:
  -- 44 cubiertos con aforo 40, medido. El lock es por fecha y de transacción,
  -- así que serializa solo las altas del mismo día y se suelta solo, incluso
  -- si la función revienta. Va ANTES de disponibilidad(), que es lo que hay
  -- que proteger; ponerlo después no serviría de nada.
  perform pg_advisory_xact_lock(hashtext('reserva:' || p_fecha::text));

  select * into v_disp from agente.disponibilidad(p_fecha, p_hora, p_comensales);

  if not v_disp.disponible then
    return query select false, null::text, v_disp.motivo;
    return;
  end if;

  -- El código puede chocar con otro ya emitido: son 31^5 combinaciones, que con
  -- 5.000 reservas acumuladas es una colisión cada ~5.700 altas. Antes eso caía
  -- en la rama de duplicado y devolvía `ok = true, codigo = null`: el cliente se
  -- iba convencido de tener mesa sin tenerla. Ahora se reintenta, acotado.
  for v_intento in 1 .. 5 loop

    -- Alfabeto sin 0/O ni 1/I/L: este código se dicta por teléfono.
    --
    -- La entropía sale de gen_random_bytes (pgcrypto) y no de random(), que es
    -- un PRNG sembrado por backend: con `setseed` se reproduce la secuencia
    -- entera, y este código es la ÚNICA credencial que hace falta para leer una
    -- reserva con agente.consultar_reserva(). Quien consiguiera varios códigos
    -- seguidos del mismo backend podría calcular los vecinos.
    --
    -- Dos bytes por carácter y no uno: 256 no es múltiplo de 31 y el módulo
    -- sesgaría las ocho primeras letras del alfabeto. Con 65.536 el sesgo baja
    -- al 0,05%.
    v_bytes := extensions.gen_random_bytes(10);

    select 'FN-' || string_agg(
             substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ',
                    1 + ((get_byte(v_bytes, o) * 256 + get_byte(v_bytes, o + 1)) % 31),
                    1),
             '' order by o)
      into v_codigo
    from unnest(array[0, 2, 4, 6, 8]) as o;

    begin
      insert into public.reservas
        (codigo, user_id, nombre, telefono, fecha, hora, comensales, notas, session_id)
      values
        (v_codigo, p_user_id, v_nombre, v_telefono,
         p_fecha, p_hora, p_comensales, v_notas, p_session_id);

      return query select true, v_codigo, 'Reserva confirmada.'::text;
      return;

    exception
      when unique_violation then
        -- Hay DOS índices únicos sobre esta tabla y significan cosas opuestas.
        -- `sqlerrm like '%...%'` los distinguiría por el texto del mensaje, que
        -- cambia con el locale del servidor; el nombre de la constraint no.
        get stacked diagnostics v_constraint = constraint_name;

        -- Chocó el código aleatorio: no es asunto del cliente, se tira otro.
        if v_constraint = 'reservas_codigo_key' then
          continue;
        end if;

        -- Chocó la deduplicación: ya hay una reserva para ese teléfono, ese día
        -- y esa hora. Devolverle el código sin más convertía esta función en un
        -- oráculo: con un móvil y 780 intentos (13 franjas x 60 días) cualquiera
        -- sacaba el código de un tercero y con él, vía consultar_reserva, su
        -- nombre, su fecha y cuántos son. El código solo vuelve si la reserva es
        -- de quien está preguntando.
        select r.codigo, r.session_id, r.user_id into v_previa
        from public.reservas r
        where private.telefono_normalizado(r.telefono) = v_telefono
          and r.fecha = p_fecha
          and r.hora = p_hora
          and r.estado = 'confirmada';

        if found
           and (v_previa.session_id is not distinct from p_session_id
                or (p_user_id is not null and v_previa.user_id = p_user_id)) then
          return query select true, v_previa.codigo,
            'Esa reserva ya estaba hecha; es la misma, no se ha duplicado.'::text;
        else
          -- Ni el código, ni el nombre, ni la hora. Solo que ese hueco está
          -- cogido, que es justo lo que ya sabe quien acaba de intentarlo.
          return query select false, null::text,
            'Ya hay una reserva con esos datos. Llámanos para gestionarla.'::text;
        end if;
        return;

      when others then
        -- Todo lo demás salía crudo hacia n8n: sqlstate, mensaje y, en un
        -- check_violation, la fila entera en el DETAIL. Se registra dentro (el
        -- log del servidor es nuestro) y hacia fuera va una frase.
        get stacked diagnostics
          v_sqlstate = returned_sqlstate,
          v_mensaje  = message_text;
        raise warning 'agente.crear_reserva falló [%]: % (fecha=%, hora=%, sesión=%)',
          v_sqlstate, v_mensaje, p_fecha, p_hora, p_session_id;
        return query select false, null::text,
          'No hemos podido guardar la reserva. Inténtalo otra vez o llámanos.'::text;
        return;
    end;
  end loop;

  -- Cinco colisiones seguidas no es mala suerte, es que algo va mal.
  raise warning 'agente.crear_reserva: 5 colisiones de código seguidas (fecha=%, hora=%)',
    p_fecha, p_hora;
  return query select false, null::text,
    'No hemos podido generar el código de la reserva. Inténtalo otra vez.'::text;
end;
$$;

comment on function agente.crear_reserva(text, text, date, time, integer, text, text, uuid) is
  'Tool del agente: crea la reserva revalidando todas las reglas. Idempotente.';

-- ---------------------------------------------------------------------------
-- Tool 5 — consultar una reserva por su código
-- ---------------------------------------------------------------------------
-- Solo por código, nunca por teléfono ni por nombre. Buscar por teléfono
-- convertiría al agente en un buscador de "¿a qué hora viene Fulano?" para
-- cualquiera que acierte un número.

create function agente.consultar_reserva(p_codigo text)
returns table (
  codigo     text,
  nombre     text,
  fecha      date,
  hora       time,
  comensales smallint,
  estado     text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.codigo, r.nombre, r.fecha, r.hora, r.comensales, r.estado
  from public.reservas r
  where upper(btrim(p_codigo)) = r.codigo;
$$;

-- ---------------------------------------------------------------------------
-- Registro de conversaciones (bloque 11) + idempotencia del turno (2.5)
-- ---------------------------------------------------------------------------
-- Sin esto la respuesta a "¿por qué contestó eso?" es un encogimiento de
-- hombros. Guarda lo mínimo para reconstruir un turno: qué entró, qué salió,
-- qué tools se usaron y cuánto costó.

create table agente.turnos (
  id             bigint generated always as identity primary key,
  session_id     text not null,
  -- Clave de idempotencia: la genera el navegador, viaja por la app y llega
  -- aquí. Dos POST con el mismo id son el mismo turno, no dos.
  mensaje_id     text not null unique,
  user_id        uuid,
  entrada        text not null,
  salida         text,
  herramientas   text[],
  modelo         text,
  tokens_entrada integer,
  tokens_salida  integer,
  latencia_ms    integer,
  error          text,
  created_at     timestamptz not null default now()
);

create index turnos_session_idx on agente.turnos (session_id, created_at desc);

-- Para agente.purgar(). Sin él, el borrado diario hace Seq Scan de la tabla
-- entera: hoy da igual y dentro de un año, con la tabla que más crece de la
-- base de datos, es el trabajo nocturno que se nota.
create index turnos_created_at_idx on agente.turnos (created_at);

comment on table agente.turnos is
  'Traza de cada turno del agente. Se purga a los 90 días (ver agente.purgar).';

create function agente.registrar_turno(
  p_session_id text,
  p_mensaje_id text,
  p_entrada    text,
  p_user_id    uuid default null
)
returns table (es_nuevo boolean, respuesta_previa text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into agente.turnos (session_id, mensaje_id, entrada, user_id)
  values (p_session_id, p_mensaje_id, p_entrada, p_user_id)
  on conflict (mensaje_id) do nothing
  returning id into v_id;

  if v_id is not null then
    return query select true, null::text;
    return;
  end if;

  -- Reintento: se devuelve lo que ya se contestó en su día. Si el turno
  -- original sigue en vuelo, `salida` es null y el flujo lo trata como
  -- "dame un momento" en vez de ejecutar al agente otra vez.
  --
  -- El filtro por sesión no sobra aunque hoy la app prefije el mensaje_id con
  -- el sessionId antes de llegar aquí (app/api/chat/route.ts). Sin él, esta
  -- función devuelve la respuesta literal que se le dio a otra persona a quien
  -- acierte su mensaje_id, y esta función es la última barrera: tiene que
  -- sostenerse sola, sin depender de lo que haga la capa de arriba.
  return query
    select false, t.salida
    from agente.turnos t
    where t.mensaje_id = p_mensaje_id
      and t.session_id = p_session_id;

  -- El mensaje_id existe pero es de otra sesión. Ni se confirma ni se niega:
  -- se contesta lo mismo que si el turno siguiera en vuelo. Y se devuelve una
  -- fila, no cero, porque el flujo de n8n espera siempre una.
  if not found then
    return query select false, null::text;
  end if;
end;
$$;

create function agente.cerrar_turno(
  p_mensaje_id     text,
  p_salida         text,
  p_modelo         text default null,
  -- Lista separada por comas y no `text[]` a propósito: n8n serializa los
  -- arrays de JavaScript a arrays de Postgres de forma que depende del driver
  -- y de la versión del nodo. Una cadena viaja igual en todas.
  p_herramientas   text default null,
  p_tokens_entrada integer default null,
  p_tokens_salida  integer default null,
  p_latencia_ms    integer default null,
  p_error          text default null
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update agente.turnos set
    salida         = p_salida,
    modelo         = p_modelo,
    herramientas   = string_to_array(nullif(btrim(p_herramientas), ''), ','),
    tokens_entrada = p_tokens_entrada,
    tokens_salida  = p_tokens_salida,
    latencia_ms    = p_latencia_ms,
    error          = p_error
  where mensaje_id = p_mensaje_id;
$$;

-- Minimización de datos (bloque 10). El log tiene texto libre escrito por
-- clientes: antes o después alguien teclea su teléfono ahí. No se guarda
-- indefinidamente "por si acaso".
create function agente.purgar(p_dias integer default 90)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_borrados integer;
begin
  delete from agente.turnos
  where created_at < now() - (p_dias || ' days')::interval;
  get diagnostics v_borrados = row_count;
  return v_borrados;
end;
$$;

-- ---------------------------------------------------------------------------
-- Programar la purga
-- ---------------------------------------------------------------------------
-- Una política de retención que nadie ejecuta no es una política de retención,
-- es una frase en un documento. Esto lo deja corriendo de verdad.
--
-- Va sin `create extension` automático a propósito: pg_cron se habilita desde
-- Database -> Extensions en el dashboard, y hacerlo desde una migración falla
-- de formas distintas según el plan. Habilítala ahí y luego ejecuta esto:
--
--   select cron.schedule(
--     'purgar-turnos-agente',
--     '30 4 * * *',                       -- todos los días a las 04:30 UTC
--     $cron$ select agente.purgar(90) $cron$
--   );
--
-- Para comprobarlo:  select * from cron.job;
-- Para quitarlo:     select cron.unschedule('purgar-turnos-agente');
--
-- Ojo: lo programa el rol que ejecuta el select, no `agente_n8n`. El agente no
-- tiene permiso para borrar sus propios registros, y así debe seguir.

-- ---------------------------------------------------------------------------
-- El rol de n8n
-- ---------------------------------------------------------------------------
-- Todas las funciones de arriba nacieron con EXECUTE para PUBLIC, que es el
-- default de Postgres y la razón por la que una `security definer` mal puesta
-- es un agujero. Se cierra en bloque y se abre solo para quien toca.

revoke execute on all functions in schema agente from public, anon, authenticated;

-- Y esto es lo que convierte el revoke de arriba en una política en vez de en
-- un gesto puntual. `on all functions` solo alcanza a las que existen en este
-- momento: la próxima migración que añada una tool la crearía otra vez con
-- EXECUTE para PUBLIC, y como `agente_n8n` ya tiene USAGE sobre el schema,
-- podría llamarla sin que nadie se la hubiera concedido. Comprobado: una
-- función creada después de este fichero era invocable por `agente_n8n` sin
-- un solo grant.
--
-- Las tres líneas de abajo son más raras de lo que parece, y no se pueden
-- simplificar. `alter default privileges IN SCHEMA agente revoke execute ...
-- from public` —que es lo que uno escribiría— NO HACE NADA: Postgres combina
-- la entrada por schema con el default de fábrica usando `aclmerge`, que solo
-- SUMA privilegios, así que el EXECUTE que PUBLIC trae de serie en toda
-- función no hay forma de quitarlo desde una entrada con `in schema`.
-- Verificado en Postgres 16: la entrada ni siquiera llega a guardarse en
-- pg_default_acl. La única forma es la entrada global, y luego devolver el
-- default a los schemas donde sí se quiere.
--
-- Resultado neto: en `agente` (y en `private`) cada función nueva nace cerrada
-- y hay que abrirla a mano — que es exactamente el momento en el que uno se
-- pregunta si debería. En `public` y en `extensions` no cambia nada.
--
-- Aplica solo a lo que cree el rol que ejecute esta línea (en Supabase, y en
-- el SQL Editor, `postgres`); lo que instala Supabase por su cuenta lo crea
-- `supabase_admin` y no se ve afectado. Si algún día se instala una extensión
-- en un schema que no sea `public` ni `extensions`, sus funciones nacerán sin
-- EXECUTE para PUBLIC: el fallo es ruidoso («permission denied for function»)
-- y se arregla con un grant, pero conviene saberlo antes que después.
alter default privileges                    revoke execute on functions from public;
alter default privileges in schema public     grant execute on functions to   public;
alter default privileges in schema extensions grant execute on functions to   public;

create role agente_n8n;

grant usage on schema agente to agente_n8n;

grant execute on function
  agente.contexto(),
  agente.carta(text),
  agente.horarios(),
  agente.disponibilidad(date, time, integer),
  agente.crear_reserva(text, text, date, time, integer, text, text, uuid),
  agente.consultar_reserva(text),
  agente.registrar_turno(text, text, text, uuid),
  agente.cerrar_turno(text, text, text, text, integer, integer, integer, text)
to agente_n8n;

-- Ojo a lo que NO se concede: ni un `grant select` sobre public.reservas, ni
-- sobre platos, ni sobre auth.users. Si mañana alguien roba la contraseña de
-- n8n, lo que consigue es poder preguntar la carta y reservar mesas.
--
-- `agente.purgar()` tampoco: eso lo dispara un pg_cron o un workflow con otra
-- credencial. Un agente no borra sus propios logs.

-- ---------------------------------------------------------------------------
-- El único paso que NO está en este fichero
-- ---------------------------------------------------------------------------
-- El rol se crea sin login, a propósito: una contraseña dentro de una
-- migración versionada es una contraseña filtrada. Genera una y actívalo a
-- parte, en el SQL Editor, sin pegar el comando en ningún .md ni .sql:
--
--   alter role agente_n8n login password '<la que generes>';
--
--   openssl rand -base64 32     # para generarla
--
-- Y guárdala solo en el gestor de credenciales de n8n (bloque 10.7).

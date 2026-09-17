-- ---------------------------------------------------------------------------
-- DELTA 0003 — de la versión original a la corregida
-- ---------------------------------------------------------------------------
-- Solo para una base que YA tenga aplicado el 0003 original. En una base
-- limpia se aplica el fichero corregido y ya está.
--
-- Antes de ejecutar, comprobar que los datos que hay caben en las reglas
-- nuevas (si alguna de estas dos devuelve filas, hay que limpiarlas primero):
--
--   select id, length(nombre), length(telefono) from public.reservas
--    where length(btrim(nombre)) > 120 or length(btrim(telefono)) > 30;
--
--   select private.telefono_normalizado(telefono), fecha, hora, count(*)
--     from public.reservas where estado = 'confirmada'
--    group by 1,2,3 having count(*) > 1;
--   -- (esta segunda solo después de crear la función del paso 2)
--
-- `create or replace function` conserva los grants: no hay que volver a
-- conceder EXECUTE a agente_n8n.

begin;

-- 1 · Cotas superiores de nombre y teléfono ---------------------------------
alter table public.reservas
  drop constraint reservas_nombre_check,
  drop constraint reservas_telefono_check,
  add  constraint reservas_nombre_check   check (length(btrim(nombre)) between 2 and 120),
  add  constraint reservas_telefono_check check (
         length(btrim(telefono)) <= 30
         and length(regexp_replace(telefono, '\D', '', 'g')) >= 9);

-- 2 · Forma canónica del teléfono ------------------------------------------
create or replace function private.telefono_normalizado(p_telefono text)
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

-- 3 · El índice de deduplicación pasa al valor normalizado -----------------
-- Los teléfonos ya guardados se normalizan también: si no, el índice nuevo
-- sigue viendo `600 123 456` y `600123456` como dos claves.
update public.reservas
   set telefono = private.telefono_normalizado(telefono)
 where telefono is distinct from private.telefono_normalizado(telefono);

drop index public.reservas_sin_duplicados;

create unique index reservas_sin_duplicados
  on public.reservas (private.telefono_normalizado(telefono), fecha, hora)
  where estado = 'confirmada';

-- 4 · Ventana de aforo sobre timestamp, no sobre time ----------------------
create or replace function agente.franjas_libres(p_fecha date, p_comensales integer)
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
-- 5 · abierto_ahora nunca null --------------------------------------------
create or replace function agente.horarios()
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

-- 6 · crear_reserva: código CSPRNG con reintento, dueño del duplicado,
--     advisory lock, recorte de notas y `when others` ----------------------
do $preflight$
begin
  if to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception using
      message = 'agente.crear_reserva necesita gen_random_bytes en el schema `extensions`.',
      hint    = 'create extension pgcrypto with schema extensions;';
  end if;
end
$preflight$;

create or replace function agente.crear_reserva(
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

-- 7 · registrar_turno filtra por sesión ------------------------------------
create or replace function agente.registrar_turno(
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


-- 8 · Índice para la purga -------------------------------------------------
create index turnos_created_at_idx on agente.turnos (created_at);

-- 9 · Las funciones nuevas de `agente` nacen cerradas ----------------------
-- La forma `in schema agente revoke ... from public` NO funciona: Postgres
-- combina la entrada por schema con el default de fábrica sumando privilegios,
-- así que el EXECUTE que PUBLIC trae de serie no se puede quitar desde ahí.
-- Hay que hacerlo en la entrada global y devolver el default a los schemas
-- donde sí interesa.
alter default privileges                      revoke execute on functions from public;
alter default privileges in schema public       grant execute on functions to   public;
alter default privileges in schema extensions   grant execute on functions to   public;

commit;

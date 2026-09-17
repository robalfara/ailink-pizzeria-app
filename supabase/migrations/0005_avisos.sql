-- ===========================================================================
-- 0005 · Los avisos, ahora en la base de datos
-- ===========================================================================
-- 2026-09-17.
--
-- Por qué existe esta migración
-- -----------------------------
-- Hasta hoy el único canal de aviso era Telegram, y el dueño ha decidido que no
-- se va a usar. Al quitarlo se fueron los **tres únicos avisos que había**:
--
--   · el corte por presupuesto (`cuota()` devuelve `permitido = false`),
--   · el fallo cerrado de `Comprobar cuota` —que es el peor, porque ese nodo
--     lleva `onError: continueErrorOutput` y con eso el `errorWorkflow` ya no
--     se disparaba para él ni antes: el aviso era literalmente el único camino—,
--   · y cualquier ejecución del workflow que reventara.
--
-- Esto devuelve la vigilancia **sin depender de ninguna credencial nueva**: n8n
-- ya tiene la de Postgres, así que puede escribir aquí hoy mismo. Lo que NO
-- devuelve es el empujón: esto es un registro que hay que consultar, no una
-- notificación que te busca. El día que haya un canal (email, Slack, un webhook)
-- se cuelga del mismo nodo que escribe aquí y esta tabla se queda como el
-- histórico, que es justo lo que a Telegram le faltaba.
--
-- El pestillo antispam se muda aquí, y ese es el otro motivo de la migración
-- ----------------------------------------------------------------------------
-- El antispam vivía en `$getWorkflowStaticData('global')` dentro de un nodo Code,
-- y el comentario de ese nodo ya decía cuál era el arreglo bueno: llevarlo a la
-- base. Tenía dos modos de fallo escritos en alto —si el estado no llegaba a
-- persistir el aviso se repetía, y si dos mensajes entraban a la vez los dos
-- podían avisar—. Un índice único los cierra los dos: la unicidad la garantiza
-- Postgres, no la suerte de dos ejecuciones concurrentes.
--
-- Aplicar (desde la raíz del repo):
--   docker run --rm -i -e PGPASSWORD="$(grep '^SUPABASE_DB_PASSWORD=' .env.local | cut -d= -f2-)" \
--     postgres:16-alpine psql \
--     "host=aws-1-eu-west-1.pooler.supabase.com port=5432 dbname=postgres \
--      user=postgres.kjxxickmrmranqmvgdie sslmode=require" \
--     --single-transaction -v ON_ERROR_STOP=1 -f supabase/migrations/0005_avisos.sql
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- La tabla
-- ---------------------------------------------------------------------------
create table agente.avisos (
  id          bigint generated always as identity primary key,

  -- Cuatro niveles, y el check es a propósito: un nivel escrito mal no es un
  -- aviso raro, es un aviso que nadie va a buscar nunca.
  --
  --   aviso      el gasto del día ha pasado del 70 % del tope
  --   corte      el chat ya no atiende (tope agotado, o interruptor de pánico)
  --   fallo      `cuota()` no ha contestado y el chat rechaza por precaución
  --   ejecucion  una ejecución del workflow ha terminado en error
  nivel       text        not null
                check (nivel in ('aviso','corte','fallo','ejecucion')),

  titulo      text        not null check (length(titulo) between 1 and 200),
  detalle     text        not null default '' check (length(detalle) <= 4000),

  -- Lo que se sepa del momento: gastado, tope, motivo, nodo, execution_id…
  -- Va en jsonb y no en columnas porque cada nivel trae cosas distintas y no
  -- merece cinco columnas nulas.
  contexto    jsonb       not null default '{}'::jsonb,

  -- La huella del pestillo. Ver `registrar_aviso`.
  huella      text        not null default '',

  -- Se marca a mano cuando alguien lo ha mirado. Sin esto, «lo que está abierto»
  -- se confunde con «lo que ha pasado alguna vez».
  visto_en    timestamptz,

  created_at  timestamptz not null default now()
);

comment on table agente.avisos is
  'Avisos operativos del agente: presupuesto, fallo de cuota y ejecuciones caídas. '
  'Se escribe por agente.registrar_aviso(); se lee con agente.avisos_recientes().';

-- El pestillo, y es la pieza central de la migración.
--
-- La fecha es la LOCAL de Madrid, no la UTC, porque el presupuesto que vigila
-- también es diario y local: un corte a las 00:30 de Madrid pertenece al día
-- que acaba de empezar aquí, no al de ayer en Londres.
--
-- Con `huella = ''` (los avisos de presupuesto) esto da **un aviso por nivel y
-- por día**: como mucho tres. Con huella distinta (las ejecuciones caídas, que
-- la llenan con el nodo y el error) da **uno por fallo distinto y día**, así que
-- un bucle de fallos idénticos colapsa en una fila y dos fallos diferentes se
-- ven los dos. Sin esto, un workflow en bucle escribe miles de filas y el
-- registro deja de servir exactamente cuando más falta hace.
create unique index avisos_pestillo_idx on agente.avisos (
  nivel,
  ((created_at at time zone 'Europe/Madrid')::date),
  huella
);

-- Para `avisos_recientes()`, que ordena por fecha descendente.
create index avisos_created_at_idx on agente.avisos (created_at desc);

-- ---------------------------------------------------------------------------
-- Escribir un aviso — esto es lo único que puede hacer el agente
-- ---------------------------------------------------------------------------
-- Devuelve `true` si el aviso era nuevo y `false` si el pestillo lo tragó. El
-- workflow no necesita el valor, pero al depurar la diferencia entre «no se
-- escribió» y «ya estaba» es justo la que cuesta media hora averiguar.
create function agente.registrar_aviso(
  p_nivel    text,
  p_titulo   text,
  p_detalle  text default '',
  p_contexto jsonb default '{}'::jsonb,
  p_huella   text default ''
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  -- Se acotan aquí y no solo en el check de la tabla: lo que llega viene de un
  -- nodo Code, y un error del proveedor puede traer un mensaje de 40 KB. Que un
  -- aviso falle por largo sería perder el aviso justo el día que importa.
  insert into agente.avisos (nivel, titulo, detalle, contexto, huella)
  values (
    p_nivel,
    left(coalesce(nullif(trim(p_titulo), ''), 'Aviso sin título'), 200),
    left(coalesce(p_detalle, ''), 4000),
    coalesce(p_contexto, '{}'::jsonb),
    left(coalesce(p_huella, ''), 200)
  )
  on conflict do nothing
  returning id into v_id;

  return v_id is not null;
end;
$$;

comment on function agente.registrar_aviso(text,text,text,jsonb,text) is
  'Escribe un aviso operativo. El índice único (nivel, día local, huella) hace '
  'de antispam: devuelve false cuando ya había uno igual hoy.';

-- ---------------------------------------------------------------------------
-- Leerlos — esto NO se le concede al agente
-- ---------------------------------------------------------------------------
-- Es la consulta que se mira por la mañana, o cuando el chat parece raro.
create function agente.avisos_recientes(p_dias integer default 7)
returns table (
  cuando   timestamp,
  nivel    text,
  titulo   text,
  detalle  text,
  contexto jsonb,
  visto    boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select (a.created_at at time zone 'Europe/Madrid')::timestamp,
         a.nivel,
         a.titulo,
         a.detalle,
         a.contexto,
         a.visto_en is not null
  from agente.avisos a
  where a.created_at > now() - (greatest(coalesce(p_dias, 7), 0) || ' days')::interval
  order by a.created_at desc;
$$;

-- Marcar como visto lo que haya hasta ahora. Devuelve cuántos ha marcado.
create function agente.avisos_vistos()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_marcados integer;
begin
  update agente.avisos set visto_en = now() where visto_en is null;
  get diagnostics v_marcados = row_count;
  return v_marcados;
end;
$$;

-- La purga, igual que la de turnos y la de reservas. 90 días por defecto.
create function agente.purgar_avisos(p_dias integer default 90)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_borrados integer;
begin
  delete from agente.avisos
  where created_at < now() - (p_dias || ' days')::interval;
  get diagnostics v_borrados = row_count;
  return v_borrados;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------
-- Misma política que el resto del schema `agente`: la tabla no es alcanzable
-- por nadie más que el dueño, y al agente se le concede EXACTAMENTE un verbo.
revoke all on agente.avisos from public, anon, authenticated;

alter table agente.avisos enable row level security;
-- Sin políticas, a propósito: nadie llega por PostgREST. RLS activada de todas
-- formas porque una tabla sin grants y sin RLS deja de estar protegida en el
-- momento en que alguien haga un `grant select on all tables in schema agente`
-- de más. Dos cerrojos que no dependen el uno del otro.

revoke execute on function
  agente.registrar_aviso(text,text,text,jsonb,text),
  agente.avisos_recientes(integer),
  agente.avisos_vistos(),
  agente.purgar_avisos(integer)
from public, anon, authenticated;

-- Lo único que se abre. El agente ESCRIBE avisos y no puede leerlos:
--
--   · sin SELECT sobre `agente.avisos`, y sin `avisos_recientes()`, porque el
--     histórico de lo que le ha pasado al negocio no le hace falta para
--     atender a nadie — y una inyección de prompt que acabe leyéndolo se lleva
--     los motivos de corte, el gasto y los nombres de los nodos.
--   · sin `avisos_vistos()`: quien silencia los avisos es una persona, no el
--     proceso que los genera. Si el agente pudiera marcarlos como vistos, el
--     bucle de fallos se taparía a sí mismo.
--   · sin `purgar_avisos()`: un agente no borra sus propios logs. Eso lo
--     dispara pg_cron con otra credencial, igual que las otras dos purgas.
grant execute on function
  agente.registrar_aviso(text,text,text,jsonb,text)
to agente_n8n;

commit;

-- ===========================================================================
-- Cómo se mira esto (no hay panel, y conviene saberlo)
-- ===========================================================================
--   select * from agente.avisos_recientes();        -- la última semana
--   select * from agente.avisos_recientes(1);       -- hoy
--   select agente.avisos_vistos();                  -- dar por leído
--
-- Y la purga, junto a las otras dos, cuando se programe pg_cron:
--   select cron.schedule('purgar-avisos', '30 4 * * *',
--                        $$select agente.purgar_avisos(90)$$);
-- ===========================================================================

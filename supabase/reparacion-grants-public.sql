-- ===========================================================================
-- Reparación: devolver a `anon` y `authenticated` los grants de `public`
-- ===========================================================================
-- 2026-09-17.
--
-- Qué pasó
-- --------
-- La base de producción apareció con las cinco tablas de `public` en manos del
-- dueño y de nadie más. Comprobado sobre el ACL, que es la fuente fiable —
-- `information_schema.role_table_grants` filtra por pertenencia de rol y ahí
-- salía vacío, que es la misma foto pero sin poder distinguir «no hay grant»
-- de «no lo puedo ver»:
--
--     ACL categorias = postgres=arwdDxtm/postgres
--     ACL horarios   = postgres=arwdDxtm/postgres
--     ACL platos     = postgres=arwdDxtm/postgres
--     ACL profiles   = postgres=arwdDxtm/postgres
--     ACL reservas   = postgres=arwdDxtm/postgres
--
-- El síntoma en la app es un `42501 permission denied for table categorias`
-- por cada render de la home, y la landing pintando la carta vacía sin que
-- nada más se queje. `USAGE` sobre el schema `public` estaba intacto, así que
-- no era eso.
--
-- No se ha encontrado quién los quitó: no hay un `revoke` así en ninguna
-- migración de este repo, ni en el delta de la revisión de seguridad, ni
-- documentado en `docs/`. Los `alter default privileges` de la `0003` y del
-- delta tocan **funciones**, no tablas, y no explican esto.
--
-- Qué hace este fichero
-- ---------------------
-- Repetir, literalmente, los grants que ya declaran las migraciones. No hay
-- ni un privilegio nuevo: si comparas con `0001_profiles.sql`, `0002_carta.sql`
-- y `0003_agente.sql` verás las mismas cinco líneas. Esto no decide nada, solo
-- devuelve la base al esquema versionado.
--
-- Es idempotente y se puede volver a pasar sin miedo.
--
-- ⚠️ Los grants NO son la autorización. Deciden si la tabla es *alcanzable*;
-- qué filas se ven lo sigue decidiendo RLS, que aquí no se toca. Por eso el
-- bloque final vuelve a comprobar que RLS sigue activa en las cinco: un grant
-- sobre una tabla a la que alguien le hubiera quitado RLS sería justo el
-- accidente que este fichero no quiere provocar.
--
-- Aplicar:
--   docker run --rm -i -e PGPASSWORD="$(grep '^SUPABASE_DB_PASSWORD=' .env.local | cut -d= -f2-)" \
--     postgres:16-alpine psql \
--     "host=aws-1-eu-west-1.pooler.supabase.com port=5432 dbname=postgres \
--      user=postgres.kjxxickmrmranqmvgdie sslmode=require" \
--     --single-transaction -f supabase/reparacion-grants-public.sql
-- ===========================================================================

begin;

-- 1 · profiles — de `0001_profiles.sql` -------------------------------------
-- Los anónimos no tienen nada que hacer aquí. Sin INSERT ni DELETE para nadie:
-- las filas las crea el trigger y se borran en cascada. El UPDATE va por
-- columnas para que `id` quede fuera del alcance del cliente.
grant select                    on public.profiles to authenticated;
grant update (nombre, telefono) on public.profiles to authenticated;

-- 2 · la carta — de `0002_carta.sql` ----------------------------------------
-- Pública: se pinta en la landing sin sesión.
grant select on public.categorias, public.platos to anon, authenticated;

-- 3 · horarios y reservas — de `0003_agente.sql` ----------------------------
-- El horario es público. Las reservas las ve el cliente logueado, y solo las
-- suyas (eso lo hace la policy). Escribir no puede: las reservas entran por
-- `agente.crear_reserva()`, que es quien aplica las reglas de negocio.
grant select on public.horarios to anon, authenticated;
grant select on public.reservas to authenticated;

-- 4 · Comprobaciones, dentro de la misma transacción ------------------------
-- Si algo de esto no cuadra, el `raise exception` deshace los grants de arriba
-- y la base se queda como estaba. Es preferible a conceder privilegios sobre
-- una tabla que hubiera perdido su RLS.
do $$
declare
  sin_rls text;
  faltan  text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into sin_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname in ('profiles','categorias','platos','horarios','reservas')
    and not c.relrowsecurity;

  if sin_rls is not null then
    raise exception 'RLS desactivada en: %. No se conceden grants sobre una tabla sin RLS.', sin_rls;
  end if;

  select string_agg(x.que, E'\n  ') into faltan
  from (
    select 'authenticated no puede SELECT profiles'   as que where not has_table_privilege('authenticated','public.profiles','select')
    union all
    select 'authenticated no puede UPDATE profiles.nombre'   where not has_column_privilege('authenticated','public.profiles','nombre','update')
    union all
    select 'authenticated no puede UPDATE profiles.telefono' where not has_column_privilege('authenticated','public.profiles','telefono','update')
    union all
    select 'anon no puede SELECT categorias'          where not has_table_privilege('anon','public.categorias','select')
    union all
    select 'anon no puede SELECT platos'              where not has_table_privilege('anon','public.platos','select')
    union all
    select 'anon no puede SELECT horarios'            where not has_table_privilege('anon','public.horarios','select')
    union all
    select 'authenticated no puede SELECT reservas'   where not has_table_privilege('authenticated','public.reservas','select')
  ) x;

  if faltan is not null then
    raise exception E'Los grants no han quedado aplicados:\n  %', faltan;
  end if;

  -- Y lo que NO tiene que haber pasado: nada de escritura para el cliente.
  select string_agg(x.que, E'\n  ') into faltan
  from (
    select 'authenticated puede INSERT en reservas' as que where has_table_privilege('authenticated','public.reservas','insert')
    union all
    select 'authenticated puede UPDATE reservas'         where has_table_privilege('authenticated','public.reservas','update')
    union all
    select 'authenticated puede DELETE reservas'         where has_table_privilege('authenticated','public.reservas','delete')
    union all
    select 'authenticated puede INSERT en profiles'      where has_table_privilege('authenticated','public.profiles','insert')
    union all
    select 'authenticated puede DELETE profiles'         where has_table_privilege('authenticated','public.profiles','delete')
    union all
    select 'authenticated puede UPDATE profiles.id'      where has_column_privilege('authenticated','public.profiles','id','update')
    union all
    select 'anon puede SELECT profiles'                  where has_table_privilege('anon','public.profiles','select')
    union all
    select 'anon puede SELECT reservas'                  where has_table_privilege('anon','public.reservas','select')
    union all
    select 'anon o authenticated pueden escribir la carta'
      where has_table_privilege('anon','public.platos','update')
         or has_table_privilege('authenticated','public.platos','update')
  ) x;

  if faltan is not null then
    raise exception E'Se han concedido privilegios de más:\n  %', faltan;
  end if;

  raise notice 'Grants restaurados y verificados sobre las cinco tablas de public.';
end
$$;

commit;

-- 0001_profiles.sql — perfil de cliente ligado a auth.users
--
-- Aplicar desde el SQL Editor del dashboard de Supabase.
-- Este fichero es la fuente de verdad del esquema: si se cambia algo a mano en
-- el dashboard, hay que reflejarlo aquí o el repo deja de contar la verdad.

-- ---------------------------------------------------------------------------
-- Schema privado
-- ---------------------------------------------------------------------------
-- Las funciones `security definer` corren con los privilegios de quien las crea
-- y se saltan RLS. Postgres concede EXECUTE a PUBLIC por defecto en cada
-- función nueva, así que una `security definer` en `public` queda como endpoint
-- invocable por cualquiera que tenga la publishable key. Van aquí, y además se
-- revoca EXECUTE de forma explícita.

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tabla de perfiles
-- ---------------------------------------------------------------------------
-- `id` es a la vez PK y FK a auth.users, así que ya está indexado por la PK:
-- no hace falta un índice extra para el cascade.

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  nombre      text,
  telefono    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is
  'Datos de cliente. Una fila por usuario de auth.users, creada por trigger.';

-- ---------------------------------------------------------------------------
-- Privilegios de tabla (antes que RLS: son dos capas distintas)
-- ---------------------------------------------------------------------------
-- RLS decide QUÉ FILAS se ven; los grants deciden si la tabla es alcanzable y
-- qué columnas se pueden tocar. Hacen falta las dos.

revoke all on public.profiles from anon, authenticated;

-- Los visitantes anónimos no tienen nada que hacer aquí.
grant select                     on public.profiles to authenticated;
grant update (nombre, telefono)  on public.profiles to authenticated;

-- Sin INSERT ni DELETE para nadie: las filas las crea el trigger de abajo y se
-- borran en cascada al eliminar el usuario. Y sin UPDATE sobre `id`,
-- `created_at` ni `updated_at`, que no son cosa del cliente.

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

-- `(select auth.uid())` en subconsulta, no `auth.uid()` pelado: así se evalúa
-- una vez por consulta en lugar de una vez por fila.
create policy "perfil propio: lectura"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

-- UPDATE necesita `using` Y `with check`. Sin `with check` un usuario podría
-- reasignar su fila a otro id. (Y necesita también la policy de SELECT de
-- arriba: en Postgres un UPDATE tiene que poder leer la fila primero, o
-- devuelve 0 filas en silencio, sin error.)
create policy "perfil propio: escritura"
  on public.profiles for update
  to authenticated
  using      ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ---------------------------------------------------------------------------
-- Alta automática del perfil
-- ---------------------------------------------------------------------------
-- `nombre` sale de raw_user_meta_data, que es EDITABLE POR EL USUARIO.
-- Vale para un nombre de display; nunca debe usarse para decidir permisos.

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, nombre)
  values (new.id, new.raw_user_meta_data ->> 'nombre');
  return new;
end;
$$;

revoke execute on function private.handle_new_user()
  from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create function private.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function private.touch_updated_at()
  from public, anon, authenticated;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Hueco para pedidos online (NO crear todavía)
-- ---------------------------------------------------------------------------
-- Cuando toque, el patrón de arriba se reutiliza tal cual:
--
--   create table public.orders (
--     id           bigint generated always as identity primary key,
--     user_id      uuid not null references public.profiles (id) on delete cascade,
--     estado       text not null default 'pendiente',
--     total_cents  integer not null,          -- dinero en enteros, nunca float
--     created_at   timestamptz not null default now()
--   );
--
--   -- Postgres NO indexa las FK solo: sin esto, el cascade escanea la tabla.
--   create index orders_user_id_idx on public.orders (user_id);
--
--   alter table public.orders enable row level security;
--   create policy "pedidos propios" on public.orders for select
--     to authenticated using ((select auth.uid()) = user_id);
--
-- Nota: lib/data.ts guarda los precios como texto ("9,50 €"). Al mover la carta
-- a la base de datos habrá que pasarlos a `precio_cents integer`.

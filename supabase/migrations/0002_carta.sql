-- 0002_carta.sql — la carta, que hasta ahora vivía en lib/data.ts
--
-- Aplicar desde el SQL Editor del dashboard de Supabase, después de 0001.
--
-- Por qué se mueve: el agente conversacional de n8n tiene que poder leer la
-- carta, y no puede importar un módulo de TypeScript. Duplicarla en el prompt
-- del agente era la alternativa barata, pero entonces hay dos cartas y una de
-- las dos se queda vieja: el día que suba el precio de la Diavola, el agente
-- seguiría cantando el antiguo con total seguridad. Una sola fuente de verdad.
--
-- Los precios pasan a enteros (céntimos), como ya avisaba el comentario final
-- de 0001. "9,50 €" era texto porque solo había que pintarlo; en cuanto hay que
-- sumar un total de reserva o comparar, el texto miente.

-- ---------------------------------------------------------------------------
-- Categorías
-- ---------------------------------------------------------------------------
-- La PK es texto y no un serial a propósito: los ids ("clasicas", "especiales")
-- ya se usan como ancla en la URL de la landing (#clasicas). Un id con
-- significado aquí ahorra una columna `slug` y mantiene los enlaces vivos.

create table public.categorias (
  id      text     primary key,
  titulo  text     not null,
  emoji   text     not null,
  orden   smallint not null
);

comment on table public.categorias is
  'Secciones de la carta. El id es el ancla que ya usa la landing.';

-- ---------------------------------------------------------------------------
-- Platos
-- ---------------------------------------------------------------------------

create table public.platos (
  id            bigint   generated always as identity primary key,
  categoria_id  text     not null references public.categorias (id) on delete restrict,
  nombre        text     not null,
  descripcion   text     not null,
  -- Dinero SIEMPRE en enteros. Nunca float: 0.1 + 0.2 no es 0.3 en binario y
  -- un céntimo perdido en una suma es un descuadre de caja.
  precio_cents  integer  not null check (precio_cents > 0),
  -- Las que ya pintaba la landing: Veggie, Vegana, Picante.
  etiquetas     text[]   not null default '{}',
  -- Esto es nuevo, y existe por el agente: "¿tiene gluten?" es de las tres
  -- preguntas más frecuentes y no se puede contestar improvisando.
  alergenos     text[]   not null default '{}',
  disponible    boolean  not null default true,
  orden         smallint not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Postgres no indexa las FK por su cuenta: sin esto, comprobar el `on delete
-- restrict` de una categoría escanea la tabla entera.
create index platos_categoria_id_idx on public.platos (categoria_id);

comment on column public.platos.alergenos is
  'Alérgenos declarados. Lista informativa, NO sustituye a preguntar en sala: '
  'el agente tiene instrucciones de decirlo así en cada respuesta sobre alergias.';

create trigger platos_touch_updated_at
  before update on public.platos
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Privilegios y RLS
-- ---------------------------------------------------------------------------
-- La carta es pública: se pinta en la landing sin sesión. Aun así se activa RLS
-- y se concede solo SELECT. Sin RLS, Supabase avisa (y con razón): una tabla
-- alcanzable por la publishable key sin políticas es una tabla abierta.

revoke all on public.categorias, public.platos from anon, authenticated;
grant select on public.categorias, public.platos to anon, authenticated;

alter table public.categorias enable row level security;
alter table public.platos     enable row level security;

create policy "carta pública: categorías"
  on public.categorias for select
  to anon, authenticated
  using (true);

-- `using (disponible)` hace el trabajo del WHERE una vez y en un solo sitio:
-- un plato que se agota se marca no disponible y desaparece a la vez de la
-- landing y de lo que ve el agente. Sin políticas que recordar en cada query.
create policy "carta pública: platos disponibles"
  on public.platos for select
  to anon, authenticated
  using (disponible);

-- Nadie escribe la carta desde la app. Se edita desde el dashboard, o el día
-- que haya panel de administración se le dará INSERT/UPDATE a un rol propio.

-- ---------------------------------------------------------------------------
-- Contenido inicial — el que estaba en lib/data.ts
-- ---------------------------------------------------------------------------

insert into public.categorias (id, titulo, emoji, orden) values
  ('clasicas',   'Pizzas Clásicas',      '🍕', 1),
  ('especiales', 'Especiales de la Casa', '⭐', 2),
  ('entrantes',  'Entrantes & Dulces',    '🥗', 3);

insert into public.platos
  (categoria_id, nombre, descripcion, precio_cents, etiquetas, alergenos, orden)
values
  ('clasicas', 'Margherita DOP',
   'San Marzano, mozzarella fior di latte, albahaca fresca y aceite de oliva virgen extra.',
   950,  '{Veggie}',  '{gluten,lácteos}', 1),

  ('clasicas', 'Marinara',
   'Tomate San Marzano, ajo, orégano y aceite de oliva. Sin lácteos, pura tradición.',
   800,  '{Vegana}',  '{gluten}', 2),

  ('clasicas', 'Diavola',
   'Salami picante calabrés, mozzarella, tomate y un toque de guindilla.',
   1150, '{Picante}', '{gluten,lácteos}', 3),

  ('clasicas', 'Quattro Formaggi',
   'Mozzarella, gorgonzola DOP, pecorino romano y parmesano curado 24 meses.',
   1200, '{Veggie}',  '{gluten,lácteos}', 4),

  ('especiales', 'Tartufo Nero',
   'Crema de trufa negra, mozzarella de búfala, champiñones y rúcula fresca.',
   1550, '{}', '{gluten,lácteos}', 1),

  ('especiales', 'Prosciutto e Rucola',
   'Prosciutto di Parma 18 meses, rúcula, virutas de parmesano y tomate cherry.',
   1400, '{}', '{gluten,lácteos}', 2),

  ('especiales', 'Nduja & Miele',
   'Nduja calabresa, mozzarella, un hilo de miel de acacia y ralladura de limón.',
   1350, '{Picante}', '{gluten,lácteos}', 3),

  ('entrantes', 'Burrata Pugliese',
   'Burrata cremosa entera, tomate confitado, albahaca y pan de masa madre.',
   900,  '{Veggie}', '{gluten,lácteos}', 1),

  ('entrantes', 'Arancini di Riso',
   'Croquetas de risotto rellenas de ragú y mozzarella, fritas al momento (4 uds).',
   750,  '{}', '{gluten,lácteos,huevo}', 2),

  ('entrantes', 'Tiramisù della Nonna',
   'Receta familiar con mascarpone, café espresso y cacao amargo.',
   650,  '{Veggie}', '{gluten,lácteos,huevo}', 3);

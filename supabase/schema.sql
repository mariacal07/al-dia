-- ============================================================
--  Al día · Base de datos
--  Copia TODO este archivo y pégalo en Supabase → SQL Editor → Run
-- ============================================================

-- Categorías (Skincare, Hogar...)
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  color       text not null default '#6b5cff',
  icon        text not null default '✨',
  position    int  not null default 0,
  created_at  timestamptz not null default now()
);

-- Tareas recurrentes
create table if not exists public.tasks (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id    uuid references public.categories(id) on delete set null,
  name           text not null,
  notes          text,
  schedule_type  text not null check (schedule_type in ('weekly', 'interval', 'monthly')),
  weekdays       smallint[] not null default '{}',   -- 0 = domingo ... 6 = sábado
  interval_days  int,                                -- para "cada X días"
  day_of_month   int,                                -- para "una vez al mes"
  start_date     date not null default current_date,
  created_at     timestamptz not null default now()
);

-- Registro de lo que has hecho (para las métricas)
create table if not exists public.completions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id     uuid not null references public.tasks(id) on delete cascade,
  date        date not null,
  created_at  timestamptz not null default now(),
  unique (task_id, date)
);

create index if not exists completions_user_date on public.completions (user_id, date);

-- Pendientes: cosas sin fecha que vas posponiendo ("ordenar el armario")
create table if not exists public.backlog (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  notes       text,
  effort      text check (effort in ('quick', 'medium', 'big')),  -- rápida / un rato / grande
  done_on     date,                                                -- vacío = pendiente
  created_at  timestamptz not null default now()
);

-- Permite que la app (usuarios con sesión iniciada) use estas tablas.
-- Las políticas de abajo limitan lo que ve cada persona a sus propios datos.
grant select, insert, update, delete on public.categories, public.tasks, public.completions, public.backlog to authenticated;

-- Seguridad: cada persona solo puede ver y tocar sus propios datos
alter table public.categories  enable row level security;
alter table public.tasks       enable row level security;
alter table public.completions enable row level security;
alter table public.backlog     enable row level security;

drop policy if exists "own categories"  on public.categories;
drop policy if exists "own tasks"       on public.tasks;
drop policy if exists "own completions" on public.completions;
drop policy if exists "own backlog"     on public.backlog;

create policy "own categories"  on public.categories  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own tasks"       on public.tasks       for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own completions" on public.completions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own backlog"     on public.backlog     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

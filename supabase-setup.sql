-- ==========================================================================
-- REFEIÇÕES AFA — Setup do banco de dados (Supabase / PostgreSQL)
-- Execute este arquivo no SQL Editor do Supabase antes de rodar o seed.
-- ==========================================================================

-- Extensão para gen_random_uuid() (em geral já vem habilitada no Supabase)
create extension if not exists "pgcrypto";

-- --------------------------------------------------------------------------
-- Tabela: cadets
-- --------------------------------------------------------------------------
create table if not exists public.cadets (
  id            uuid primary key default gen_random_uuid(),
  number        text unique not null,
  name          text not null,
  squadron      integer not null,            -- 0 = admin, 1-4 = esquadrões
  password_hash text not null,
  is_admin      boolean default false,
  created_at    timestamptz default now()
);

-- --------------------------------------------------------------------------
-- Tabela: meal_slots
-- Cada linha = UMA refeição de UM dia específico.
-- --------------------------------------------------------------------------
-- squadrons (JSONB): acesso de cada esquadrão à refeição.
--   { "1": "opcional", "2": "todos", "3": "ninguem", "4": "opcional" }
--   Valores: 'opcional' | 'todos' | 'ninguem'. Esquadrão ausente = 'ninguem'.
create table if not exists public.meal_slots (
  id         uuid primary key default gen_random_uuid(),
  date       date not null,
  meal_type  text not null check (meal_type in ('cafe', 'almoco', 'janta', 'ceia')),
  squadrons  jsonb not null default
    '{"1":"opcional","2":"opcional","3":"opcional","4":"opcional"}'::jsonb,
  locked     boolean default false,
  created_at timestamptz default now(),
  unique (date, meal_type)
);

-- --------------------------------------------------------------------------
-- Tabela: meal_marks
-- Uma linha existe = cadete marcou "Sim". Sem linha = "Não".
-- --------------------------------------------------------------------------
create table if not exists public.meal_marks (
  id         uuid primary key default gen_random_uuid(),
  cadet_id   uuid not null references public.cadets(id) on delete cascade,
  slot_id    uuid not null references public.meal_slots(id) on delete cascade,
  created_at timestamptz default now(),
  unique (cadet_id, slot_id)
);

-- --------------------------------------------------------------------------
-- Índices
-- --------------------------------------------------------------------------
create index if not exists idx_meal_slots_date   on public.meal_slots (date);
create index if not exists idx_meal_slots_locked on public.meal_slots (locked);
create index if not exists idx_meal_marks_slot   on public.meal_marks (slot_id);
create index if not exists idx_meal_marks_cadet  on public.meal_marks (cadet_id);

-- --------------------------------------------------------------------------
-- Row Level Security
-- O acesso é feito exclusivamente pela service_role key (server-side).
-- Habilitamos RLS e criamos políticas permissivas para a service_role.
-- A service_role faz bypass de RLS por padrão; mantemos políticas explícitas
-- para deixar claro o modelo e bloquear o anon/authenticated key.
-- --------------------------------------------------------------------------
alter table public.cadets     enable row level security;
alter table public.meal_slots enable row level security;
alter table public.meal_marks enable row level security;

-- Políticas permissivas apenas para a role de serviço.
drop policy if exists "service_role full access" on public.cadets;
create policy "service_role full access" on public.cadets
  for all to service_role using (true) with check (true);

drop policy if exists "service_role full access" on public.meal_slots;
create policy "service_role full access" on public.meal_slots
  for all to service_role using (true) with check (true);

drop policy if exists "service_role full access" on public.meal_marks;
create policy "service_role full access" on public.meal_marks
  for all to service_role using (true) with check (true);

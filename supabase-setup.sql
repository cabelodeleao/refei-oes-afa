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
  is_fiscal     boolean default false,       -- conta que fiscaliza o rancho (QR)
  qr_token      text unique,                 -- token secreto do QR do cadete
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
-- Uma linha registra a ESCOLHA explícita do cadete para um slot:
--   attending = true  -> opt-in  ("Sim" em refeição opcional)
--   attending = false -> opt-out ("Não" em refeição "todos" p/ 3º e 4º esq.)
-- Sem linha = default do modo (opcional => "Não"; "todos" => "Sim").
-- --------------------------------------------------------------------------
create table if not exists public.meal_marks (
  id         uuid primary key default gen_random_uuid(),
  cadet_id   uuid not null references public.cadets(id) on delete cascade,
  slot_id    uuid not null references public.meal_slots(id) on delete cascade,
  attending  boolean not null default true,
  created_at timestamptz default now(),
  unique (cadet_id, slot_id)
);

-- --------------------------------------------------------------------------
-- Tabela: meal_entries
-- Registro de entrada de UM cadete em UMA refeição (slot), feito pelo fiscal
-- na porta do rancho via leitura do QR.
--   UNIQUE(cadet_id, slot_id) impede registro duplicado na mesma refeição.
--   fiscal_id = conta de fiscal que fez a leitura. ON DELETE SET NULL para
--   preservar o histórico mesmo que a conta de fiscal seja removida.
-- --------------------------------------------------------------------------
create table if not exists public.meal_entries (
  id         uuid primary key default gen_random_uuid(),
  cadet_id   uuid not null references public.cadets(id) on delete cascade,
  slot_id    uuid not null references public.meal_slots(id) on delete cascade,
  fiscal_id  uuid references public.cadets(id) on delete set null,
  entered_at timestamptz default now(),
  unique (cadet_id, slot_id)
);

-- --------------------------------------------------------------------------
-- Tabela: menu_photos
-- Foto do cardápio da semana enviada pelo admin e exibida aos cadetes.
-- Apenas 1 registro com active = true por vez (a API desativa os anteriores).
--   storage_path: caminho do arquivo no bucket "cardapios" (p/ remoção).
-- --------------------------------------------------------------------------
create table if not exists public.menu_photos (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  image_url    text not null,
  storage_path text,
  active       boolean default true,
  created_at   timestamptz default now()
);

-- --------------------------------------------------------------------------
-- Índices
-- --------------------------------------------------------------------------
create index if not exists idx_meal_slots_date   on public.meal_slots (date);
create index if not exists idx_meal_slots_locked on public.meal_slots (locked);
create index if not exists idx_meal_marks_slot   on public.meal_marks (slot_id);
create index if not exists idx_meal_marks_cadet  on public.meal_marks (cadet_id);
create index if not exists idx_meal_entries_slot  on public.meal_entries (slot_id);
create index if not exists idx_meal_entries_cadet on public.meal_entries (cadet_id);
create index if not exists idx_cadets_is_fiscal   on public.cadets (is_fiscal);
create index if not exists idx_menu_photos_active on public.menu_photos (active);

-- --------------------------------------------------------------------------
-- Row Level Security
-- O acesso é feito exclusivamente pela service_role key (server-side).
-- Habilitamos RLS e criamos políticas permissivas para a service_role.
-- A service_role faz bypass de RLS por padrão; mantemos políticas explícitas
-- para deixar claro o modelo e bloquear o anon/authenticated key.
-- --------------------------------------------------------------------------
alter table public.cadets       enable row level security;
alter table public.meal_slots   enable row level security;
alter table public.meal_marks   enable row level security;
alter table public.meal_entries enable row level security;
alter table public.menu_photos  enable row level security;

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

drop policy if exists "service_role full access" on public.meal_entries;
create policy "service_role full access" on public.meal_entries
  for all to service_role using (true) with check (true);

drop policy if exists "service_role full access" on public.menu_photos;
create policy "service_role full access" on public.menu_photos
  for all to service_role using (true) with check (true);

-- --------------------------------------------------------------------------
-- Storage: bucket "cardapios" (público) para as fotos do cardápio.
-- Público = qualquer pessoa com o link lê a imagem (a URL pública é usada na
-- página do cadete). O upload/remoção é feito só pela service_role (server-side).
-- --------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('cardapios', 'cardapios', true)
on conflict (id) do update set public = true;

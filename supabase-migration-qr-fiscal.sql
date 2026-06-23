-- ==========================================================================
-- MIGRATION: Fiscalização por QR code
-- Adiciona o token de QR e o papel de fiscal aos cadetes, e cria a tabela de
-- registro de entradas no rancho (meal_entries).
--
-- Rode UMA vez, em bancos criados antes da fiscalização por QR.
-- (Em instalações novas, supabase-setup.sql já cria tudo isto.)
-- ==========================================================================

-- pgcrypto p/ gen_random_uuid() / gen_random_bytes() (em geral já habilitada).
create extension if not exists "pgcrypto";

-- --------------------------------------------------------------------------
-- cadets: token secreto do QR + papel de fiscal
-- --------------------------------------------------------------------------
alter table public.cadets add column if not exists qr_token  text;
alter table public.cadets add column if not exists is_fiscal boolean default false;

-- Backfill: gera um token aleatório único (base64url, ~24 chars) para todo
-- cadete que ainda esteja sem. gen_random_bytes é avaliada por linha, então
-- cada cadete recebe um valor distinto.
update public.cadets
set qr_token = translate(encode(gen_random_bytes(18), 'base64'), '+/=', '-_x')
where qr_token is null;

-- Unicidade só depois do backfill (evita conflito com vários NULL).
create unique index if not exists idx_cadets_qr_token on public.cadets (qr_token);

create index if not exists idx_cadets_is_fiscal on public.cadets (is_fiscal);

-- --------------------------------------------------------------------------
-- meal_entries: registro de entrada de UM cadete em UMA refeição (slot).
--   UNIQUE(cadet_id, slot_id) impede registro duplicado na mesma refeição.
--   fiscal_id = conta de fiscal que fez a leitura.
-- --------------------------------------------------------------------------
create table if not exists public.meal_entries (
  id         uuid primary key default gen_random_uuid(),
  cadet_id   uuid not null references public.cadets(id) on delete cascade,
  slot_id    uuid not null references public.meal_slots(id) on delete cascade,
  fiscal_id  uuid references public.cadets(id) on delete set null,
  entered_at timestamptz default now(),
  unique (cadet_id, slot_id)
);

create index if not exists idx_meal_entries_slot  on public.meal_entries (slot_id);
create index if not exists idx_meal_entries_cadet on public.meal_entries (cadet_id);

-- RLS: acesso exclusivo via service_role (server-side), como nas demais tabelas.
alter table public.meal_entries enable row level security;
drop policy if exists "service_role full access" on public.meal_entries;
create policy "service_role full access" on public.meal_entries
  for all to service_role using (true) with check (true);

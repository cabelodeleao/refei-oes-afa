-- ==========================================================================
-- MIGRATION: Log completo de tentativas de leitura do QR (scan_attempts)
--
-- A tabela meal_entries continua sendo o registro OFICIAL das entradas
-- autorizadas (uma por cadete/slot). scan_attempts é o LOG completo de TODAS
-- as leituras feitas pelo fiscal, inclusive as negadas e as duplicadas:
--   - 'autorizado': passou o QR pela 1ª vez e entrou (também grava meal_entries)
--   - 'nao_marcou': tentou entrar mas não tinha direito/não marcou a refeição
--   - 'duplicado' : passou o QR de novo na mesma refeição (2ª+ leitura)
--
-- Rode UMA vez em bancos já existentes.
-- (Em instalações novas, supabase-setup.sql já cria esta tabela.)
-- ==========================================================================

create extension if not exists "pgcrypto";

create table if not exists public.scan_attempts (
  id         uuid primary key default gen_random_uuid(),
  cadet_id   uuid references public.cadets(id) on delete cascade,
  slot_id    uuid not null references public.meal_slots(id) on delete cascade,
  fiscal_id  uuid references public.cadets(id) on delete set null,
  result     text not null check (result in ('autorizado', 'nao_marcou', 'duplicado')),
  scanned_at timestamptz default now()
);

create index if not exists idx_scan_attempts_slot   on public.scan_attempts (slot_id);
create index if not exists idx_scan_attempts_result on public.scan_attempts (result);
create index if not exists idx_scan_attempts_cadet  on public.scan_attempts (cadet_id);

-- RLS: acesso exclusivo via service_role (server-side), como nas demais tabelas.
alter table public.scan_attempts enable row level security;
drop policy if exists "service_role full access" on public.scan_attempts;
create policy "service_role full access" on public.scan_attempts
  for all to service_role using (true) with check (true);

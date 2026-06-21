-- ==========================================================================
-- MIGRATION — Foto do cardápio da semana (menu_photos + bucket de storage)
-- Rode UMA vez em bancos já existentes. Em bancos novos, o supabase-setup.sql
-- já contém tudo isto; não é preciso rodar esta migration.
-- ==========================================================================

create extension if not exists "pgcrypto";

-- Tabela das fotos do cardápio.
create table if not exists public.menu_photos (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  image_url    text not null,
  storage_path text,
  active       boolean default true,
  created_at   timestamptz default now()
);

create index if not exists idx_menu_photos_active on public.menu_photos (active);

-- RLS: acesso só pela service_role (mesmo padrão das outras tabelas).
alter table public.menu_photos enable row level security;

drop policy if exists "service_role full access" on public.menu_photos;
create policy "service_role full access" on public.menu_photos
  for all to service_role using (true) with check (true);

-- Bucket público "cardapios" para as imagens.
insert into storage.buckets (id, name, public)
values ('cardapios', 'cardapios', true)
on conflict (id) do update set public = true;

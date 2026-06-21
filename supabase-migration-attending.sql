-- ==========================================================================
-- MIGRATION: meal_marks.attending
-- Adiciona o registro da ESCOLHA do cadete para suportar "opt-out" das
-- refeições obrigatórias do 3º e 4º esquadrão.
--   attending = true  -> opt-in  ("Sim")
--   attending = false -> opt-out ("Não")
-- Linhas existentes representavam "Sim", então o default true as mantém corretas.
--
-- Rode UMA vez em bancos criados antes desta mudança.
-- (Instalações novas já têm a coluna via supabase-setup.sql.)
-- ==========================================================================

alter table public.meal_marks
  add column if not exists attending boolean not null default true;

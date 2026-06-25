-- ==========================================================================
-- MIGRAÇÃO: troca de senha obrigatória no 1º acesso (cadetes e fiscais)
-- Execute UMA VEZ no SQL Editor do Supabase.
-- ==========================================================================

-- 1) Coluna nova. Default TRUE: todo cadete/fiscal precisa trocar a senha.
--    O ADD COLUMN com DEFAULT já preenche TRUE em todas as linhas existentes.
alter table public.cadets
  add column if not exists must_change_password boolean not null default true;

-- 2) Cadetes e fiscais existentes (senha ainda é "123456") => forçar a troca.
update public.cadets
  set must_change_password = true
  where is_admin = false;

-- 3) Admin NUNCA é forçado a trocar a senha.
update public.cadets
  set must_change_password = false
  where is_admin = true;

-- Conferência (opcional): quantos ainda precisam trocar, por papel.
-- select is_admin, is_fiscal, must_change_password, count(*)
--   from public.cadets
--   group by 1, 2, 3
--   order by 1, 2, 3;

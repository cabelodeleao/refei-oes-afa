-- ==========================================================================
-- Migração: bloqueio automático de refeições + exceções manuais do admin.
--
-- Substitui a coluna booleana `locked` por `lock_override` (a intenção MANUAL
-- do admin). O bloqueio automático — 4 dias antes da refeição, às 23:59 (horário
-- de Brasília) — é calculado em tempo real no servidor e NÃO fica no banco.
--
-- lock_override:
--   null           -> segue o automático (bloqueia 4 dias antes, 23:59 BRT)
--   'bloqueado'    -> admin travou manualmente (independe da data)
--   'desbloqueado' -> admin abriu exceção: liberado mesmo após o prazo (vence tudo)
--
-- As refeições que hoje estão `locked = true` viram 'bloqueado' (permanecem
-- travadas). As demais ficam null (passam a seguir a regra automática).
--
-- Cole este arquivo no SQL Editor do Supabase e execute.
-- ==========================================================================

-- 1) Nova coluna de intenção manual.
alter table public.meal_slots
  add column if not exists lock_override text
    check (lock_override in ('bloqueado', 'desbloqueado'));

-- 2) Migra os bloqueios manuais existentes (locked = true -> 'bloqueado').
update public.meal_slots
  set lock_override = 'bloqueado'
  where locked = true and lock_override is null;

-- 3) Remove o índice e a coluna antiga (não são mais usados).
drop index if exists public.idx_meal_slots_locked;
alter table public.meal_slots drop column if exists locked;

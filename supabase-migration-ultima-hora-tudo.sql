-- ==========================================================================
-- Migração CONSOLIDADA e SEGURA — marcação de última hora (segunda chance).
--
-- Pode rodar sem medo: tudo é "if not exists". Adiciona só o que faltar e
-- ignora o que já existe. NÃO mexe na coluna `locked` (já removida na migração
-- do bloqueio automático) — por isso é seguro rodar mesmo que aquela já tenha
-- sido aplicada.
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e execute.
-- ==========================================================================

-- Garante a coluna do bloqueio manual (já deve existir; aqui só por segurança).
alter table public.meal_slots
  add column if not exists lock_override text
    check (lock_override in ('bloqueado', 'desbloqueado'));

-- Colunas da marcação de última hora + justificativa.
alter table public.meal_marks
  add column if not exists late_marking   boolean not null default false,
  add column if not exists late_marked_at timestamptz,
  add column if not exists late_approved  boolean not null default false,
  add column if not exists late_reason    text check (late_reason in ('punido', 'outro')),
  add column if not exists late_note      text;

-- Índice para consultar rápido as marcações de última hora pendentes.
create index if not exists idx_meal_marks_late
  on public.meal_marks (late_marking, late_approved);

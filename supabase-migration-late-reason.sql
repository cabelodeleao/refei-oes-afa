-- ==========================================================================
-- Migração: justificativa da marcação de última hora (segunda chance).
--
-- Ao marcar na segunda chance, o cadete escolhe uma justificativa:
--   late_reason = 'punido' -> estava punido
--   late_reason = 'outro'  -> outro motivo, descrito em late_note (texto livre)
--
-- Requer a migração supabase-migration-late-marking.sql já aplicada (colunas
-- late_marking / late_marked_at / late_approved).
--
-- Cole este arquivo no SQL Editor do Supabase e execute.
-- ==========================================================================

alter table public.meal_marks
  add column if not exists late_reason text
    check (late_reason in ('punido', 'outro')),
  add column if not exists late_note text;

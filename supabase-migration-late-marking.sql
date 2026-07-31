-- ==========================================================================
-- Migração: marcação de "última hora" (fase de segunda chance) + aprovação.
--
-- Cada refeição tem 3 fases (fuso America/Sao_Paulo), calculadas no servidor:
--   ABERTA          -> até 4 dias antes (23:59): marca e desmarca normal
--   SEGUNDA CHANCE  -> de 4 dias antes até 1 dia antes (23:59): SÓ marca
--   FECHADA         -> a partir de 1 dia antes (23:59): nada
--
-- As marcações feitas na SEGUNDA CHANCE são "de última hora": ficam guardadas
-- com late_marking=true e só valem para a fiscalização por QR depois que o
-- admin as APROVA em lote (late_approved=true).
--
-- Novas colunas em meal_marks:
--   late_marking   boolean  -> marcada na segunda chance?
--   late_marked_at timestamptz -> horário dessa marcação de última hora
--   late_approved  boolean  -> admin aprovou? (libera o horário extra do rancho)
--
-- Os valores default (false/null) preservam todas as marcações existentes como
-- marcações NORMAIS já válidas — nada muda para quem já marcou.
--
-- Cole este arquivo no SQL Editor do Supabase e execute.
-- ==========================================================================

alter table public.meal_marks
  add column if not exists late_marking   boolean not null default false,
  add column if not exists late_marked_at timestamptz,
  add column if not exists late_approved  boolean not null default false;

-- Consulta rápida das marcações de última hora pendentes de aprovação.
create index if not exists idx_meal_marks_late
  on public.meal_marks (late_marking, late_approved);

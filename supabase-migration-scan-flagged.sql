-- ==========================================================================
-- MIGRATION: Anotação de fraude de QR pelo fiscal
--
-- Quando o scan dá "duplicado" (QR já usado), o fiscal pode registrar QUEM
-- realmente está usando o QR alheio (flagged_person) e uma observação livre
-- (fiscal_note). Estas colunas ficam na própria linha de scan_attempts.
--
-- Rode UMA vez em bancos já existentes (depois de scan_attempts já existir).
-- (Em instalações novas, supabase-setup.sql já cria estas colunas.)
-- ==========================================================================

alter table public.scan_attempts add column if not exists flagged_person text;
alter table public.scan_attempts add column if not exists fiscal_note    text;

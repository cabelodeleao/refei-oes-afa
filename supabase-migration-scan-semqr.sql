-- ==========================================================================
-- MIGRATION: Registro manual de entrada SEM QR
--
-- Permite ao fiscal anotar um cadete que tentou entrar sem nenhum QR code.
-- Esse registro entra em scan_attempts com result = 'sem_qr' (cadet_id pode
-- ser nulo se a pessoa digitada não for identificada; flagged_person guarda o
-- nome/número digitado pelo fiscal).
--
-- Rode UMA vez em bancos já existentes (depois de scan_attempts já existir).
-- (Em instalações novas, supabase-setup.sql já usa o CHECK atualizado.)
-- ==========================================================================

alter table public.scan_attempts drop constraint if exists scan_attempts_result_check;
alter table public.scan_attempts
  add constraint scan_attempts_result_check
  check (result in ('autorizado', 'nao_marcou', 'duplicado', 'sem_qr'));

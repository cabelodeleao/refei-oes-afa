-- ==========================================================================
-- Migração: invalidação de sessões antigas ao trocar/resetar a senha.
--
-- Nova coluna cadets.password_changed_at: registra QUANDO a senha foi trocada
-- pela última vez. Tokens de sessão (JWT) emitidos ANTES desse momento deixam
-- de valer (a checagem é feita em getSession, no servidor).
--
-- O default fica no passado de propósito: as sessões atuais de todo mundo
-- continuam funcionando normalmente após rodar esta migração. A coluna só
-- passa a "derrubar" sessões quando alguém troca a senha (ou o admin reseta).
--
-- Cole este arquivo no SQL Editor do Supabase e execute.
-- ==========================================================================

alter table public.cadets
  add column if not exists password_changed_at timestamptz not null
    default '2020-01-01T00:00:00Z';

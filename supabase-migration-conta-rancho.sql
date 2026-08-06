-- ===========================================================================
-- Conta do RANCHO (somente consulta do painel de resumo)
-- ===========================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase ANTES de publicar a nova
-- versão do site. Pode rodar mais de uma vez sem problema.
--
-- O que ele faz:
--   1) cria a coluna cadets.is_rancho
--   2) cria a conta de login "rancho" com a senha 123456
--
-- Depois disso, o login "rancho" (ou "Rancho", tanto faz) com a senha 123456
-- abre o Painel do Rancho: a mesma tabela de resumo do admin, só que sem poder
-- alterar nada. Essa conta NÃO aparece na lista de cadetes nem na de fiscais e
-- NÃO entra em nenhuma contagem de refeição.

-- 1) Coluna que marca a conta do rancho ------------------------------------
alter table public.cadets
  add column if not exists is_rancho boolean default false;

create index if not exists idx_cadets_is_rancho
  on public.cadets (is_rancho);

-- 2) A conta em si ---------------------------------------------------------
-- O texto embaralhado abaixo é a senha "123456" criptografada (hash bcrypt) —
-- é assim que todas as senhas ficam guardadas, nenhuma fica legível no banco.
-- must_change_password = false: por ser uma conta compartilhada do rancho, ela
-- NÃO é obrigada a trocar a senha no primeiro acesso.
insert into public.cadets
  (number, name, squadron, is_admin, is_fiscal, is_rancho,
   password_hash, must_change_password)
values
  ('rancho', 'Rancho', 0, false, false, true,
   '$2a$10$FtmzOWJuiodsX23OOb94zO7E5qksYT5wH6.aQiAKqFgkpfhsq3bxu', false)
on conflict (number) do update
  set is_rancho = true,
      is_admin  = false,
      is_fiscal = false,
      squadron  = 0;

-- Conferência (opcional): deve aparecer uma linha com is_rancho = true.
-- select number, name, is_admin, is_fiscal, is_rancho, must_change_password
--   from public.cadets where is_rancho = true;

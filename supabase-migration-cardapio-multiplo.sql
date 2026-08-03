-- ==========================================================================
-- Migração: cardápio com VÁRIAS imagens no ar ao mesmo tempo.
--
-- Antes só uma imagem ficava ativa (a mais recente). Agora o admin publica um
-- conjunto — o padrão são 3 (sexta-feira, sábado e domingo) e ele pode
-- acrescentar mais quando houver feriado emendado.
--
-- A única mudança no banco é a coluna `sort_order`, que guarda a ORDEM em que
-- as imagens aparecem para o cadete. As linhas que já existem ficam com 0 e
-- continuam funcionando normalmente.
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e execute.
-- ==========================================================================

alter table public.menu_photos
  add column if not exists sort_order int not null default 0;

-- Consulta do cadete: imagens ativas na ordem de exibição.
create index if not exists idx_menu_photos_active_order
  on public.menu_photos (active, sort_order);

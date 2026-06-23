-- ==========================================================================
-- MIGRATION: Contas de fiscal separadas + preservação do histórico
-- Os fiscais (sargentos) são contas próprias na tabela cadets
-- (is_fiscal=true, squadron=0, is_admin=false) e NÃO fazem parte da lista de
-- cadetes. Ao remover um fiscal, o histórico de entradas que ele registrou
-- deve ser preservado — por isso meal_entries.fiscal_id passa a usar
-- ON DELETE SET NULL.
--
-- Rode UMA vez, DEPOIS de supabase-migration-qr-fiscal.sql.
-- (Em instalações novas, supabase-setup.sql já cria tudo assim.)
-- ==========================================================================

do $$
declare
  conname text;
begin
  if to_regclass('public.meal_entries') is null then
    raise notice 'meal_entries não existe — rode supabase-migration-qr-fiscal.sql antes.';
    return;
  end if;

  -- Remove a FK atual de fiscal_id (qualquer que seja o nome).
  select c.conname into conname
  from pg_constraint c
  join pg_attribute a
    on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
  where c.conrelid = 'public.meal_entries'::regclass
    and c.contype = 'f'
    and a.attname = 'fiscal_id';

  if conname is not null then
    execute format('alter table public.meal_entries drop constraint %I', conname);
  end if;

  -- Recria a FK com ON DELETE SET NULL (preserva o histórico de entradas).
  alter table public.meal_entries
    add constraint meal_entries_fiscal_id_fkey
    foreign key (fiscal_id) references public.cadets(id) on delete set null;

  raise notice 'meal_entries.fiscal_id agora usa ON DELETE SET NULL.';
end $$;

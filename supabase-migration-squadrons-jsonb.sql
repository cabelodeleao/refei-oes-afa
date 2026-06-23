  -- ==========================================================================
  -- MIGRATION: meal_slots.squadrons  INTEGER[]  ->  JSONB
  -- Converte o formato antigo (array de esquadrões com acesso) para o novo
  -- objeto de estados: cada esquadrão presente no array vira "opcional".
  --
  -- Rode UMA vez, em bancos criados antes da mudança de três estados.
  -- (Em instalações novas, supabase-setup.sql já cria a coluna como JSONB.)
  -- ==========================================================================

  do $$
  declare
    col_type text;
  begin
    select data_type into col_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'meal_slots'
      and column_name = 'squadrons';

    -- Só migra se a coluna ainda for um array (formato antigo).
    if col_type = 'ARRAY' then
      alter table public.meal_slots add column squadrons_new jsonb;

      update public.meal_slots
      set squadrons_new = coalesce(
        (
          select jsonb_object_agg(sq::text, 'opcional')
          from unnest(squadrons) as sq
        ),
        '{}'::jsonb
      );

      alter table public.meal_slots drop column squadrons;
      alter table public.meal_slots rename column squadrons_new to squadrons;

      alter table public.meal_slots
        alter column squadrons set not null,
        alter column squadrons set default
          '{"1":"opcional","2":"opcional","3":"opcional","4":"opcional"}'::jsonb;

      raise notice 'meal_slots.squadrons migrada para JSONB.';
    else
      raise notice 'Nada a fazer: squadrons já é % (não-array).', col_type;
    end if;
  end $$;

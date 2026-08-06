-- ===========================================================================
-- DESEMPENHO: contagem do Resumo feita DENTRO do banco
-- ===========================================================================
-- Rode este arquivo INTEIRO no SQL Editor do Supabase. Pode rodar de novo sem
-- problema (o "or replace" só substitui a função).
--
-- POR QUE ISSO É NECESSÁRIO
-- Para montar o Resumo, o site precisa saber QUANTOS cadetes marcaram cada
-- refeição. Hoje ele baixa TODAS as marcações do período e conta uma a uma no
-- servidor do site. Com 625 cadetes marcando o mês inteiro isso dá cerca de
-- 30 MIL linhas, e o Supabase entrega no máximo 1000 por vez — ou seja, umas
-- 30 idas e voltas até o banco só para abrir a tela.
--
-- A função abaixo faz a conta DENTRO do banco e devolve só o resultado (4
-- linhas por refeição, uma por esquadrão). Uma ida só, em vez de 30.
--
-- Enquanto esta função não existir, o site continua funcionando pelo caminho
-- antigo (mais lento) — não quebra nada.

create or replace function public.resumo_marcacoes(
  p_from date default null,
  p_to   date default null
)
returns table (
  slot_id      uuid,
  squadron     integer,
  opt_in       bigint,   -- marcaram "Sim"
  opt_out      bigint,   -- desmarcaram ("Não" em refeição obrigatória)
  pending_late bigint    -- marcações de última hora ainda não aprovadas
)
language sql
stable
as $$
  select
    m.slot_id,
    c.squadron,
    count(*) filter (where m.attending)                                            as opt_in,
    count(*) filter (where not m.attending)                                        as opt_out,
    count(*) filter (where m.attending and m.late_marking and not m.late_approved) as pending_late
  from public.meal_marks  m
  join public.cadets      c on c.id = m.cadet_id
  join public.meal_slots  s on s.id = m.slot_id
  where c.squadron between 1 and 4
    and (p_from is null or s.date >= p_from)
    and (p_to   is null or s.date <= p_to)
  group by m.slot_id, c.squadron
  -- Ordem fixa: o site lê o resultado em páginas, e sem ordem definida uma
  -- linha poderia aparecer duas vezes ou sumir entre uma página e outra.
  order by m.slot_id, c.squadron
$$;

grant execute on function public.resumo_marcacoes(date, date) to service_role;

-- --------------------------------------------------------------------------
-- Índices que ajudam essa contagem e as telas de fiscalização.
-- Os principais (meal_slots.date, meal_marks.slot_id, meal_marks.cadet_id,
-- meal_entries, scan_attempts) JÁ existem desde o supabase-setup.sql; estes
-- dois são complementares.
-- --------------------------------------------------------------------------

-- Agrupar/filtrar marcações por refeição olhando o "Sim/Não" junto.
create index if not exists idx_meal_marks_slot_attending
  on public.meal_marks (slot_id, attending);

-- Várias telas filtram "só cadetes" (squadron > 0).
create index if not exists idx_cadets_squadron
  on public.cadets (squadron);

-- Conferência (opcional): deve devolver uma linha por refeição/esquadrão.
-- select * from public.resumo_marcacoes('2026-08-01', '2026-08-31') limit 10;

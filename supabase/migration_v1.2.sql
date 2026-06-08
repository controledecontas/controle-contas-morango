-- ============================================================
-- v1.2 — Notas pagas pelo outro (saldo líquido)
-- Rode isto no SQL Editor do Supabase (apenas as mudanças)
-- ============================================================

-- 1. Adiciona coluna "pago_por" na nota (default 'renan' = não muda nada do que já existe)
alter table public.nota
  add column if not exists pago_por text not null default 'renan'
  check (pago_por in ('renan', 'outro'));

-- 2. Recria a view saldo_corrente com lógica de saldo líquido
drop view if exists public.saldo_corrente;
create view public.saldo_corrente as
select
  -- valor que o "outro" deve ao Renan: notas pagas pelo Renan -> parte do outro
  coalesce(sum(case when n.pago_por = 'renan' then i.valor_outro else 0 end)
           filter (where not i.quitado), 0)::numeric(12,2) as outro_deve,
  -- valor que Renan deve ao outro: notas pagas pelo outro -> parte do Renan
  coalesce(sum(case when n.pago_por = 'outro' then i.valor_meu else 0 end)
           filter (where not i.quitado), 0)::numeric(12,2) as renan_deve,
  -- saldo líquido (pode ser negativo)
  coalesce(sum(case when n.pago_por = 'renan' then i.valor_outro
                    else -i.valor_meu end)
           filter (where not i.quitado), 0)::numeric(12,2) as saldo_liquido,
  -- total das contas em aberto
  coalesce(sum(i.valor) filter (where not i.quitado), 0)::numeric(12,2) as total_aberto,
  count(*) filter (where not i.quitado) as qtd_aberto
from public.item i
join public.nota n on n.id = i.nota_id;

-- ============================================================
-- Controle de Contas - Morango
-- Schema Supabase (Postgres) - executar no SQL Editor
-- Modelo: NOTA (cabeçalho) + ITEM (produtos com % próprio)
-- ============================================================

-- ------------------------------------------------------------
-- LIMPEZA DO SCHEMA ANTIGO (se foi rodado antes)
-- CASCADE remove views, triggers e policies dependentes junto.
-- ------------------------------------------------------------
drop view if exists public.saldo_corrente cascade;
drop view if exists public.resumo_mensal cascade;
drop function if exists public.sync_data_quitacao() cascade;
drop function if exists public.upsert_sugestao() cascade;
drop table if exists public.lancamento cascade;
drop table if exists public.item cascade;
drop table if exists public.nota cascade;

-- ------------------------------------------------------------
-- 1. NOTA (cabeçalho de uma compra/nota fiscal)
-- ------------------------------------------------------------
create table public.nota (
  id uuid primary key default gen_random_uuid(),
  data date not null default current_date,
  fornecedor text,
  anexo_path text,
  obs text,
  pago_por text not null default 'renan' check (pago_por in ('renan', 'outro')),
  created_at timestamptz not null default now()
);

create index nota_data_idx on public.nota(data desc);

-- ------------------------------------------------------------
-- 2. ITEM (produto dentro de uma nota, com seu próprio %)
-- ------------------------------------------------------------
create table public.item (
  id uuid primary key default gen_random_uuid(),
  nota_id uuid not null references public.nota(id) on delete cascade,
  descricao text not null,
  valor numeric(12,2) not null check (valor > 0),
  percentual_meu numeric(5,2) not null check (percentual_meu >= 0 and percentual_meu <= 100),
  valor_meu numeric(12,2) generated always as (round(valor * percentual_meu / 100, 2)) stored,
  valor_outro numeric(12,2) generated always as (round(valor * (100 - percentual_meu) / 100, 2)) stored,
  quitado boolean not null default false,
  data_quitacao date,
  created_at timestamptz not null default now()
);

create index item_nota_idx on public.item(nota_id);
create index item_quitado_idx on public.item(quitado);

-- ------------------------------------------------------------
-- 3. Catálogo de sugestões pra autocomplete
-- ------------------------------------------------------------
create table if not exists public.produto_sugestao (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  percentual_padrao numeric(5,2),
  ultima_vez_usado timestamptz not null default now(),
  vezes_usado integer not null default 1
);

create index if not exists produto_sugestao_nome_idx on public.produto_sugestao(nome);

-- ------------------------------------------------------------
-- 4. Trigger: sincroniza data_quitacao com flag quitado (nos itens)
-- ------------------------------------------------------------
create or replace function public.sync_data_quitacao()
returns trigger language plpgsql as $$
begin
  if new.quitado and (old.quitado is null or old.quitado = false) then
    new.data_quitacao := coalesce(new.data_quitacao, current_date);
  elsif new.quitado = false then
    new.data_quitacao := null;
  end if;
  return new;
end;
$$;

create trigger trg_sync_data_quitacao
  before insert or update on public.item
  for each row execute function public.sync_data_quitacao();

-- ------------------------------------------------------------
-- 5. Trigger: alimenta produto_sugestao a cada item inserido
-- ------------------------------------------------------------
create or replace function public.upsert_sugestao()
returns trigger language plpgsql security definer as $$
begin
  insert into public.produto_sugestao (nome, percentual_padrao, ultima_vez_usado, vezes_usado)
  values (lower(trim(new.descricao)), new.percentual_meu, now(), 1)
  on conflict (nome) do update set
    percentual_padrao = excluded.percentual_padrao,
    ultima_vez_usado = now(),
    vezes_usado = produto_sugestao.vezes_usado + 1;
  return new;
end;
$$;

create trigger trg_upsert_sugestao
  after insert on public.item
  for each row execute function public.upsert_sugestao();

-- ------------------------------------------------------------
-- 6. Views úteis
-- ------------------------------------------------------------
create or replace view public.saldo_corrente as
select
  coalesce(sum(case when n.pago_por = 'renan' then i.valor_outro else 0 end)
           filter (where not i.quitado), 0)::numeric(12,2) as outro_deve,
  coalesce(sum(case when n.pago_por = 'outro' then i.valor_meu else 0 end)
           filter (where not i.quitado), 0)::numeric(12,2) as renan_deve,
  coalesce(sum(case when n.pago_por = 'renan' then i.valor_outro
                    else -i.valor_meu end)
           filter (where not i.quitado), 0)::numeric(12,2) as saldo_liquido,
  coalesce(sum(i.valor) filter (where not i.quitado), 0)::numeric(12,2) as total_aberto,
  count(*) filter (where not i.quitado) as qtd_aberto
from public.item i
join public.nota n on n.id = i.nota_id;

create or replace view public.resumo_mensal as
select
  date_trunc('month', n.data)::date as mes,
  sum(i.valor)::numeric(12,2)       as total_gasto,
  sum(i.valor_meu)::numeric(12,2)   as parte_minha,
  sum(i.valor_outro)::numeric(12,2) as parte_outro,
  count(distinct n.id)              as qtd_notas
from public.nota n
join public.item i on i.nota_id = n.id
group by 1
order by 1 desc;

-- ------------------------------------------------------------
-- 7. RLS — acesso aberto via role anon
-- ------------------------------------------------------------
alter table public.nota enable row level security;
alter table public.item enable row level security;
alter table public.produto_sugestao enable row level security;

create policy "anon all nota" on public.nota
  for all to anon using (true) with check (true);

create policy "anon all item" on public.item
  for all to anon using (true) with check (true);

create policy "anon all sugestao" on public.produto_sugestao
  for all to anon using (true) with check (true);

-- ------------------------------------------------------------
-- 8. Storage bucket pras notas fiscais (já existe; garante policies)
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('notas', 'notas', false)
on conflict (id) do nothing;

drop policy if exists "anon le notas" on storage.objects;
create policy "anon le notas"
  on storage.objects for select to anon
  using (bucket_id = 'notas');

drop policy if exists "anon sobe notas" on storage.objects;
create policy "anon sobe notas"
  on storage.objects for insert to anon
  with check (bucket_id = 'notas');

drop policy if exists "anon deleta notas" on storage.objects;
create policy "anon deleta notas"
  on storage.objects for delete to anon
  using (bucket_id = 'notas');

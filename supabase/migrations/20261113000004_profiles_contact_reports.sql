-- =====================================================================
-- JoiaFlow — Telefone/endereço dos usuários + funções de relatório
-- =====================================================================

-- ---------------------------------------------------------------------
-- Dados de contato do vendedor
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists phone   text check (phone is null or char_length(phone) <= 30),
  add column if not exists address text check (address is null or char_length(address) <= 300);

-- ---------------------------------------------------------------------
-- Resumo de vendas de um período.
-- SECURITY INVOKER: roda com as permissões de quem chama, então o RLS
-- garante que o vendedor só some as próprias vendas.
-- Datas agrupadas no fuso America/Sao_Paulo, pela data EFETIVA (sold_at).
-- ---------------------------------------------------------------------
create or replace function public.sales_summary(
  p_start  timestamptz,
  p_end    timestamptz,
  p_org    uuid default null,
  p_seller uuid default null
)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  with s as (
    select x.*
    from public.sales x
    where x.deleted_at is null
      and x.sold_at >= p_start and x.sold_at < p_end
      and (p_org is null or x.organization_id = p_org)
      and (p_seller is null or x.seller_id = p_seller)
  )
  select jsonb_build_object(
    'total_cents', coalesce((select sum(total_cents) from s), 0)::bigint,
    'count',       (select count(*) from s),
    'by_category', coalesce((
        select jsonb_agg(to_jsonb(c) order by c.total_cents desc)
        from (
          select cat.id, cat.name, cat.slug,
                 sum(s.total_cents)::bigint as total_cents, count(*) as count
          from s join public.categories cat on cat.id = s.category_id
          group by cat.id, cat.name, cat.slug
        ) c), '[]'::jsonb),
    'by_seller', coalesce((
        select jsonb_agg(to_jsonb(v) order by v.total_cents desc)
        from (
          select s.seller_id as id, coalesce(p.full_name, 'Vendedor') as name,
                 sum(s.total_cents)::bigint as total_cents, count(*) as count
          from s left join public.profiles p on p.id = s.seller_id
          group by s.seller_id, p.full_name
        ) v), '[]'::jsonb),
    'by_day', coalesce((
        select jsonb_agg(to_jsonb(d) order by d.day)
        from (
          select (s.sold_at at time zone 'America/Sao_Paulo')::date as day,
                 sum(s.total_cents)::bigint as total_cents, count(*) as count
          from s group by 1
        ) d), '[]'::jsonb)
  )
$$;

-- ---------------------------------------------------------------------
-- Totais por mês (comparativo com meses anteriores)
-- ---------------------------------------------------------------------
create or replace function public.sales_by_month(
  p_start  timestamptz,
  p_end    timestamptz,
  p_org    uuid default null,
  p_seller uuid default null
)
returns table (month date, total_cents bigint, count bigint)
language sql stable security invoker set search_path = '' as $$
  select date_trunc('month', x.sold_at at time zone 'America/Sao_Paulo')::date as month,
         sum(x.total_cents)::bigint, count(*)
  from public.sales x
  where x.deleted_at is null
    and x.sold_at >= p_start and x.sold_at < p_end
    and (p_org is null or x.organization_id = p_org)
    and (p_seller is null or x.seller_id = p_seller)
  group by 1
  order by 1
$$;

revoke execute on function public.sales_summary(timestamptz, timestamptz, uuid, uuid) from anon, public;
revoke execute on function public.sales_by_month(timestamptz, timestamptz, uuid, uuid) from anon, public;
grant execute on function public.sales_summary(timestamptz, timestamptz, uuid, uuid) to authenticated;
grant execute on function public.sales_by_month(timestamptz, timestamptz, uuid, uuid) to authenticated;

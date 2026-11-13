-- =====================================================================
-- JoiaFlow — Comissão nos relatórios + Lançamentos financeiros
-- =====================================================================

-- ---------------------------------------------------------------------
-- Comissão: percentual por empresa (padrão 30%)
-- ---------------------------------------------------------------------
alter table public.organizations
  add column if not exists commission_percent numeric(5,2) not null default 30
    check (commission_percent >= 0 and commission_percent <= 100);

-- Resumo agora traz a comissão total e por vendedor
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
  ),
  sellers as (
    select s.seller_id as id, coalesce(p.full_name, 'Vendedor') as name,
           sum(s.total_cents)::bigint as total_cents, count(*) as count,
           coalesce(o.commission_percent, 30) as commission_percent,
           round(sum(s.total_cents) * coalesce(o.commission_percent, 30) / 100)::bigint as commission_cents
    from s
    left join public.profiles p on p.id = s.seller_id
    left join public.organizations o on o.id = s.organization_id
    group by s.seller_id, p.full_name, o.commission_percent
  )
  select jsonb_build_object(
    'total_cents', coalesce((select sum(total_cents) from s), 0)::bigint,
    'count',       (select count(*) from s),
    'items_count', coalesce((select sum(i.quantity) from public.sale_items i join s on s.id = i.sale_id), 0)::bigint,
    'commission_cents', coalesce((select sum(commission_cents) from sellers), 0)::bigint,
    'by_category', coalesce((
        select jsonb_agg(to_jsonb(c) order by c.total_cents desc)
        from (
          select cat.id, cat.name, cat.slug,
                 sum(i.line_total_cents)::bigint as total_cents,
                 sum(i.quantity)::bigint as count
          from s
          join public.sale_items i on i.sale_id = s.id
          join public.categories cat on cat.id = i.category_id
          group by cat.id, cat.name, cat.slug
        ) c), '[]'::jsonb),
    'by_seller', coalesce((select jsonb_agg(to_jsonb(v) order by v.total_cents desc) from sellers v), '[]'::jsonb),
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
-- Lançamentos financeiros (controle pessoal de cada vendedora)
-- Separado das vendas: não entra nos relatórios de vendas.
-- ---------------------------------------------------------------------
create table if not exists public.financial_entries (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  organization_id  uuid references public.organizations(id) on delete restrict,
  entry_date       date not null,
  kind             text not null default 'in' check (kind in ('in', 'out')),  -- in = entrada, out = saída
  description      text not null check (char_length(trim(description)) between 2 and 300),
  amount_cents     bigint not null check (amount_cents > 0 and amount_cents <= 100000000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_fin_user_date on public.financial_entries(user_id, entry_date desc);
create index if not exists idx_fin_org_date  on public.financial_entries(organization_id, entry_date desc);

create trigger trg_fin_updated_at
  before update on public.financial_entries
  for each row execute function public.set_updated_at();

-- Dono e empresa sempre definidos pelo banco (não pelo navegador)
create or replace function public.validate_financial_entry()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_me public.profiles;
begin
  new.description := trim(regexp_replace(new.description, '\s+', ' ', 'g'));
  if auth.uid() is null then return new; end if;

  select * into v_me from public.profiles where id = auth.uid();
  if v_me.id is null or not public.is_active_user() then
    raise exception 'Usuário sem permissão.' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.user_id := auth.uid();                 -- cada um lança só para si
    new.organization_id := v_me.organization_id;
  else
    new.user_id := old.user_id;                -- dono e empresa não mudam
    new.organization_id := old.organization_id;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

create trigger trg_fin_validate
  before insert or update on public.financial_entries
  for each row execute function public.validate_financial_entry();

create trigger trg_fin_audit
  after insert or update or delete on public.financial_entries
  for each row execute function public.write_audit_log();

alter table public.financial_entries enable row level security;
revoke all on public.financial_entries from anon;

-- Ver: o dono; admin da plataforma; gestor da mesma empresa
create policy fin_select on public.financial_entries for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_platform_admin()
    or (public.current_role_name() = 'org_admin' and organization_id = public.current_org_id() and public.is_active_user())
  );

create policy fin_insert on public.financial_entries for insert to authenticated
  with check (public.is_active_user());

-- Editar/excluir: o dono ou administradores
create policy fin_update on public.financial_entries for update to authenticated
  using (
    (user_id = (select auth.uid()) and public.is_active_user())
    or public.is_platform_admin()
    or (public.current_role_name() = 'org_admin' and organization_id = public.current_org_id() and public.is_active_user())
  )
  with check (true);

create policy fin_delete on public.financial_entries for delete to authenticated
  using (
    (user_id = (select auth.uid()) and public.is_active_user())
    or public.is_platform_admin()
    or (public.current_role_name() = 'org_admin' and organization_id = public.current_org_id() and public.is_active_user())
  );

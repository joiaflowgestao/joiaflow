-- =====================================================================
-- JoiaFlow — Vários itens na mesma venda
-- O total da venda passa a ser a soma dos itens (calculada no banco).
-- sales.category_id continua existindo como "categoria principal"
-- (o item de maior valor), para compatibilidade.
-- =====================================================================

create table if not exists public.sale_items (
  id                uuid primary key default gen_random_uuid(),
  sale_id           uuid not null references public.sales(id) on delete cascade,
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  category_id       uuid not null references public.categories(id) on delete restrict,
  quantity          integer not null check (quantity between 1 and 999),
  unit_price_cents  bigint not null check (unit_price_cents > 0 and unit_price_cents <= 100000000),
  line_total_cents  bigint generated always as (quantity * unit_price_cents) stored,
  position          smallint not null default 1,
  created_at        timestamptz not null default now()
);

create index if not exists idx_sale_items_sale on public.sale_items(sale_id);
create index if not exists idx_sale_items_org_cat on public.sale_items(organization_id, category_id);

-- Vendas existentes: 1 item com o valor total
insert into public.sale_items (sale_id, organization_id, category_id, quantity, unit_price_cents, position)
select s.id, s.organization_id, s.category_id, 1, s.total_cents, 1
from public.sales s
where not exists (select 1 from public.sale_items i where i.sale_id = s.id);

-- ---------------------------------------------------------------------
-- RLS: quem vê a venda vê os itens. Escrita só pelo banco (função save_sale
-- e triggers). Usuários não inserem/alteram itens diretamente.
-- ---------------------------------------------------------------------
alter table public.sale_items enable row level security;
revoke all on public.sale_items from anon;
revoke insert, update, delete on public.sale_items from authenticated;
grant select on public.sale_items to authenticated;

create policy sale_items_select on public.sale_items for select to authenticated
  using (exists (select 1 from public.sales s where s.id = sale_id));

create trigger trg_sale_items_audit
  after insert or delete on public.sale_items
  for each row execute function public.write_audit_log();

-- ---------------------------------------------------------------------
-- Compatibilidade: venda criada/alterada fora da save_sale mantém 1 item.
-- Se a venda tiver vários itens, valor/categoria só mudam pela save_sale.
-- ---------------------------------------------------------------------
create or replace function public.sync_single_item()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  if coalesce(current_setting('joiaflow.via_save_sale', true), '') = '1' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    insert into public.sale_items (sale_id, organization_id, category_id, quantity, unit_price_cents, position)
    values (new.id, new.organization_id, new.category_id, 1, new.total_cents, 1);
  elsif (new.total_cents, new.category_id) is distinct from (old.total_cents, old.category_id) then
    select count(*) into v_count from public.sale_items where sale_id = new.id;
    if v_count > 1 then
      raise exception 'Esta venda tem vários itens. Altere os valores pelo formulário de edição.' using errcode = '42501';
    end if;
    delete from public.sale_items where sale_id = new.id;
    insert into public.sale_items (sale_id, organization_id, category_id, quantity, unit_price_cents, position)
    values (new.id, new.organization_id, new.category_id, 1, new.total_cents, 1);
  end if;
  return null;
end $$;

create trigger trg_sales_sync_single_item
  after insert or update on public.sales
  for each row execute function public.sync_single_item();

-- ---------------------------------------------------------------------
-- save_sale: cria ou edita uma venda com seus itens numa única transação.
-- SECURITY DEFINER para gravar os itens, mas a gravação da venda passa
-- pelo trigger validate_sale, que aplica TODAS as regras de permissão
-- do usuário logado (vendedor só para si, edição liberada, empresa etc.).
--
-- p_data = {
--   customer_name, sold_at, installments, first_due_date, upfront_paid,
--   seller_id, organization_id,
--   items: [{ category_id, quantity, unit_price_cents }, ...]
-- }
-- ---------------------------------------------------------------------
create or replace function public.save_sale(p_sale_id uuid, p_data jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_items     jsonb := p_data->'items';
  v_item      jsonb;
  v_total     bigint := 0;
  v_qty       int;
  v_price     bigint;
  v_main_cat  uuid;
  v_main_val  bigint := -1;
  v_sale      public.sales;
  v_pos       int := 0;
  v_cat_org   uuid;
  v_cat_ok    boolean;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '42501';
  end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'Adicione pelo menos um item à venda.' using errcode = '22023';
  end if;
  if jsonb_array_length(v_items) > 50 then
    raise exception 'Máximo de 50 itens por venda.' using errcode = '22023';
  end if;

  -- Valida itens e calcula o total
  for v_item in select * from jsonb_array_elements(v_items) loop
    v_qty   := (v_item->>'quantity')::int;
    v_price := (v_item->>'unit_price_cents')::bigint;
    if v_qty is null or v_qty < 1 or v_qty > 999 then
      raise exception 'Quantidade inválida.' using errcode = '22023';
    end if;
    if v_price is null or v_price <= 0 or v_price > 100000000 then
      raise exception 'Valor de item inválido.' using errcode = '22023';
    end if;
    v_total := v_total + v_qty * v_price;
    if v_qty * v_price > v_main_val then
      v_main_val := v_qty * v_price;
      v_main_cat := (v_item->>'category_id')::uuid;
    end if;
  end loop;

  perform set_config('joiaflow.via_save_sale', '1', true);

  if p_sale_id is null then
    insert into public.sales (organization_id, seller_id, category_id, customer_name, sold_at,
                              total_cents, installments, first_due_date, upfront_paid)
    values ((p_data->>'organization_id')::uuid, (p_data->>'seller_id')::uuid, v_main_cat,
            p_data->>'customer_name', (p_data->>'sold_at')::timestamptz, v_total,
            coalesce((p_data->>'installments')::smallint, 1), (p_data->>'first_due_date')::date,
            coalesce((p_data->>'upfront_paid')::boolean, false))
    returning * into v_sale;
  else
    update public.sales set
      seller_id      = coalesce((p_data->>'seller_id')::uuid, seller_id),
      category_id    = v_main_cat,
      customer_name  = p_data->>'customer_name',
      sold_at        = (p_data->>'sold_at')::timestamptz,
      total_cents    = v_total,
      installments   = coalesce((p_data->>'installments')::smallint, installments),
      first_due_date = coalesce((p_data->>'first_due_date')::date, first_due_date),
      upfront_paid   = coalesce((p_data->>'upfront_paid')::boolean, upfront_paid)
    where id = p_sale_id and deleted_at is null
    returning * into v_sale;
    if v_sale.id is null then
      raise exception 'Venda não encontrada.' using errcode = 'P0002';
    end if;
    delete from public.sale_items where sale_id = v_sale.id;
  end if;

  -- Grava os itens (categorias precisam valer para a empresa da venda)
  for v_item in select * from jsonb_array_elements(v_items) loop
    v_pos := v_pos + 1;
    select true, c.organization_id into v_cat_ok, v_cat_org
    from public.categories c where c.id = (v_item->>'category_id')::uuid and c.active;
    if not coalesce(v_cat_ok, false) or (v_cat_org is not null and v_cat_org <> v_sale.organization_id) then
      raise exception 'Categoria inválida para esta empresa.' using errcode = '42501';
    end if;
    v_cat_ok := false;
    insert into public.sale_items (sale_id, organization_id, category_id, quantity, unit_price_cents, position)
    values (v_sale.id, v_sale.organization_id, (v_item->>'category_id')::uuid,
            (v_item->>'quantity')::int, (v_item->>'unit_price_cents')::bigint, v_pos);
  end loop;

  perform set_config('joiaflow.via_save_sale', '', true);
  return to_jsonb(v_sale);
end $$;

revoke execute on function public.save_sale(uuid, jsonb) from anon, public;
grant execute on function public.save_sale(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Relatório: categorias agora vêm dos itens (peças vendidas e valor)
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
    'items_count', coalesce((select sum(i.quantity) from public.sale_items i join s on s.id = i.sale_id), 0)::bigint,
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

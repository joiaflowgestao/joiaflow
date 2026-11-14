-- =====================================================================
-- JoiaFlow — Entrada (valor pago no ato), exclusão pela vendedora,
-- trocas contabilizadas no mês da troca, comissão por venda e maletas
-- =====================================================================

-- Novas colunas da venda
alter table public.sales
  add column if not exists down_payment_cents   bigint not null default 0 check (down_payment_cents >= 0),
  add column if not exists exchange_delta_cents bigint not null default 0; -- soma das diferenças de trocas

-- Vendas que já tiveram troca: guarda o acumulado das diferenças
update public.sales s set exchange_delta_cents = coalesce((
  select sum(e.difference_cents) from public.exchanges e where e.sale_id = s.id), 0);

create or replace function public.validate_sale()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid        uuid := auth.uid();
  v_me         public.profiles;
  v_seller     public.profiles;
  v_cat_org    uuid;
  v_cat_found  boolean;
  v_org_allows boolean;
begin
  -- Normalização
  new.customer_name := trim(regexp_replace(new.customer_name, '\s+', ' ', 'g'));

  -- 1) Regras por perfil (somente quando há usuário logado;
  --    service_role / SQL editor pulam direto para a integridade)
  if v_uid is not null then
    select * into v_me from public.profiles where id = v_uid;
    if v_me.id is null or not public.is_active_user() then
      raise exception 'Usuário sem permissão.' using errcode = '42501';
    end if;

    if tg_op = 'INSERT' then
      new.created_by := v_uid;
      new.updated_by := null;
      new.deleted_at := null;
      new.deleted_by := null;

      if v_me.role = 'seller' then
        -- Vendedor só lança para si mesmo, na própria empresa (ignora o que veio na requisição)
        new.seller_id := v_uid;
        new.organization_id := v_me.organization_id;
      elsif v_me.role = 'org_admin' and new.organization_id is distinct from v_me.organization_id then
        raise exception 'Empresa não autorizada.' using errcode = '42501';
      end if;

    else -- UPDATE
      new.created_by := old.created_by;
      new.created_at := old.created_at;
      new.updated_by := v_uid;

      if new.organization_id <> old.organization_id then
        raise exception 'Não é permitido mover uma venda para outra empresa.' using errcode = '42501';
      end if;

      if v_me.role = 'seller' then
        select o.sellers_can_edit_sales into v_org_allows
        from public.organizations o where o.id = v_me.organization_id;

        if old.seller_id <> v_uid or old.deleted_at is not null then
          raise exception 'Você só pode editar suas próprias vendas.' using errcode = '42501';
        end if;
        if not (v_me.can_edit_own_sales and coalesce(v_org_allows, false))
           and coalesce(current_setting('joiaflow.via_exchange', true), '') <> '1' then
          raise exception 'A edição de vendas não está liberada para o seu usuário.' using errcode = '42501';
        end if;
        if new.seller_id <> old.seller_id then
          raise exception 'Não é permitido transferir a venda.' using errcode = '42501';
        end if;
        -- Exclusão pela vendedora: permitida (mesma permissão da edição, checada acima)
        if old.deleted_at is not null and new.deleted_at is null then
          raise exception 'Somente o administrador pode restaurar vendas.' using errcode = '42501';
        end if;
      elsif v_me.role = 'org_admin' and old.organization_id <> v_me.organization_id then
        raise exception 'Empresa não autorizada.' using errcode = '42501';
      end if;

      -- Exclusão lógica: registra quem excluiu
      if new.deleted_at is not null and old.deleted_at is null then
        new.deleted_by := v_uid;
      elsif new.deleted_at is null then
        new.deleted_by := null;
      end if;
    end if;
  end if;

  -- 2) Integridade (vale para todos, inclusive service_role)
  select * into v_seller from public.profiles where id = new.seller_id;
  if v_seller.id is null or v_seller.organization_id is distinct from new.organization_id then
    raise exception 'O vendedor informado não pertence a esta empresa.' using errcode = '42501';
  end if;

  select true, c.organization_id into v_cat_found, v_cat_org
  from public.categories c where c.id = new.category_id and c.active;
  if not coalesce(v_cat_found, false) or (v_cat_org is not null and v_cat_org <> new.organization_id) then
    raise exception 'Categoria inválida para esta empresa.' using errcode = '42501';
  end if;

  return new;
end $$;



create or replace function public.sales_installment_guard()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Trocas recalculam as parcelas por conta própria (exchange_sale)
  if coalesce(current_setting('joiaflow.via_exchange', true), '') = '1' then
    return new;
  end if;
  if new.down_payment_cents < 0 or new.down_payment_cents > new.total_cents then
    raise exception 'O valor pago no ato não pode ser maior que o total da venda.' using errcode = '22023';
  end if;
  if new.down_payment_cents > 0 and new.down_payment_cents < new.total_cents and new.installments + 1 > 24 then
    raise exception 'Máximo de 24 parcelas (contando a entrada).' using errcode = '22023';
  end if;
  if new.first_due_date is null then
    new.first_due_date := (new.sold_at at time zone 'America/Sao_Paulo')::date;
  end if;

  if tg_op = 'UPDATE'
     and (new.total_cents, new.installments, new.first_due_date, new.upfront_paid, new.down_payment_cents)
         is distinct from (old.total_cents, old.installments, old.first_due_date, old.upfront_paid, old.down_payment_cents)
     and exists (
       select 1 from public.installments i
       where i.sale_id = old.id and i.paid_at is not null
         and not (i.number = 1 and ((old.upfront_paid and new.upfront_paid) or (old.down_payment_cents > 0 and new.down_payment_cents > 0)))
     ) then
    raise exception 'Esta venda já tem parcelas pagas. Para alterar valor, parcelas ou vencimento, desfaça a confirmação dos pagamentos primeiro.'
      using errcode = '42501';
  end if;
  return new;
end $$;



create or replace function public.generate_installments()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  i        int;
  v_down   bigint := coalesce(new.down_payment_cents, 0);
  v_rest   bigint;
  v_base   bigint;
  v_rem    bigint;
  v_offset int := 0;
  v_payer  uuid := coalesce(auth.uid(), new.created_by);
begin
  if coalesce(current_setting('joiaflow.via_exchange', true), '') = '1' then
    return null; -- troca: parcelas ajustadas pela exchange_sale
  end if;
  if tg_op = 'UPDATE' then
    if (new.total_cents, new.installments, new.first_due_date, new.upfront_paid, new.down_payment_cents)
       is not distinct from (old.total_cents, old.installments, old.first_due_date, old.upfront_paid, old.down_payment_cents) then
      return null;
    end if;
    delete from public.installments where sale_id = new.id;
  end if;

  -- Entrada (valor pago no ato): parcela nº 1, já paga na data da venda
  if v_down > 0 then
    insert into public.installments (sale_id, organization_id, number, due_date, amount_cents, paid_at, paid_by)
    values (new.id, new.organization_id, 1, (new.sold_at at time zone 'America/Sao_Paulo')::date,
            least(v_down, new.total_cents), new.sold_at, v_payer);
    v_offset := 1;
  end if;

  v_rest := new.total_cents - least(v_down, new.total_cents);
  if v_rest <= 0 then
    return null; -- pago integralmente no ato
  end if;

  v_base := v_rest / new.installments;
  v_rem  := v_rest % new.installments;
  for i in 1..new.installments loop
    insert into public.installments (sale_id, organization_id, number, due_date, amount_cents, paid_at, paid_by)
    values (
      new.id, new.organization_id, i + v_offset,
      (new.first_due_date + make_interval(months => i - 1))::date,
      v_base + case when i = 1 then v_rem else 0 end,
      case when v_down = 0 and i = 1 and new.upfront_paid then new.sold_at end,
      case when v_down = 0 and i = 1 and new.upfront_paid then v_payer end
    );
  end loop;
  return null;
end $$;


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
                              total_cents, installments, first_due_date, upfront_paid, down_payment_cents)
    values ((p_data->>'organization_id')::uuid, (p_data->>'seller_id')::uuid, v_main_cat,
            p_data->>'customer_name', (p_data->>'sold_at')::timestamptz, v_total,
            coalesce((p_data->>'installments')::smallint, 1), (p_data->>'first_due_date')::date,
            coalesce((p_data->>'upfront_paid')::boolean, false),
            coalesce((p_data->>'down_payment_cents')::bigint, 0))
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
      upfront_paid   = coalesce((p_data->>'upfront_paid')::boolean, upfront_paid),
      down_payment_cents = coalesce((p_data->>'down_payment_cents')::bigint, down_payment_cents)
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


create or replace function public.exchange_sale(
  p_sale_id   uuid,
  p_reason    text,
  p_return    jsonb,
  p_new_items jsonb
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid        uuid := auth.uid();
  v_me         public.profiles;
  v_sale       public.sales;
  v_item       public.sale_items;
  v_r          jsonb;
  v_qty        int;
  v_price      bigint;
  v_cat_org    uuid;
  v_cat_ok     boolean;
  v_cat_name   text;
  v_returned   jsonb := '[]'::jsonb;
  v_added      jsonb := '[]'::jsonb;
  v_ret_val    bigint := 0;
  v_add_val    bigint := 0;
  v_new_total  bigint;
  v_paid       bigint;
  v_remaining  bigint;
  v_open_cnt   int;
  v_base       bigint;
  v_rem        bigint;
  v_i          int := 0;
  v_inst       record;
  v_count      int;
  v_main_cat   uuid;
  v_pos        int;
  v_reason     text := trim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g'));
  v_ex         public.exchanges;
begin
  if v_uid is null then
    raise exception 'Não autenticado.' using errcode = '42501';
  end if;
  if char_length(v_reason) < 3 then
    raise exception 'Descreva o motivo da troca.' using errcode = '22023';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'Motivo muito longo (máximo 500 caracteres).' using errcode = '22023';
  end if;

  select * into v_me from public.profiles where id = v_uid;
  if v_me.id is null or not public.is_active_user() then
    raise exception 'Usuário sem permissão.' using errcode = '42501';
  end if;

  select * into v_sale from public.sales where id = p_sale_id and deleted_at is null for update;
  if v_sale.id is null then
    raise exception 'Venda não encontrada.' using errcode = 'P0002';
  end if;

  -- Permissão: admin da plataforma; gestor da mesma empresa; vendedora dona da venda
  if not (
    v_me.role = 'platform_admin'
    or (v_me.role = 'org_admin' and v_me.organization_id = v_sale.organization_id)
    or (v_me.role = 'seller' and v_sale.seller_id = v_uid)
  ) then
    raise exception 'Você não pode fazer troca nesta venda.' using errcode = '42501';
  end if;

  if (jsonb_array_length(coalesce(p_return, '[]'::jsonb)) + jsonb_array_length(coalesce(p_new_items, '[]'::jsonb))) = 0 then
    raise exception 'Informe o que foi devolvido e/ou os itens novos.' using errcode = '22023';
  end if;

  -- 1) Itens devolvidos
  for v_r in select * from jsonb_array_elements(coalesce(p_return, '[]'::jsonb)) loop
    v_qty := (v_r->>'quantity')::int;
    if v_qty is null or v_qty < 1 then continue; end if;
    select * into v_item from public.sale_items where id = (v_r->>'item_id')::uuid and sale_id = v_sale.id for update;
    if v_item.id is null then
      raise exception 'Item devolvido não pertence a esta venda.' using errcode = '22023';
    end if;
    if v_qty > v_item.quantity then
      raise exception 'Quantidade devolvida maior que a vendida.' using errcode = '22023';
    end if;
    select c.name into v_cat_name from public.categories c where c.id = v_item.category_id;
    v_returned := v_returned || jsonb_build_object('category_id', v_item.category_id, 'name', v_cat_name,
                                                   'quantity', v_qty, 'unit_price_cents', v_item.unit_price_cents);
    v_ret_val := v_ret_val + v_qty * v_item.unit_price_cents;
    if v_qty = v_item.quantity then
      delete from public.sale_items where id = v_item.id;
    else
      update public.sale_items set quantity = quantity - v_qty where id = v_item.id;
    end if;
  end loop;

  -- 2) Itens novos
  select coalesce(max(position), 0) into v_pos from public.sale_items where sale_id = v_sale.id;
  for v_r in select * from jsonb_array_elements(coalesce(p_new_items, '[]'::jsonb)) loop
    v_qty   := (v_r->>'quantity')::int;
    v_price := (v_r->>'unit_price_cents')::bigint;
    if v_qty is null or v_qty < 1 or v_qty > 999 then
      raise exception 'Quantidade inválida.' using errcode = '22023';
    end if;
    if v_price is null or v_price <= 0 or v_price > 100000000 then
      raise exception 'Valor de item inválido.' using errcode = '22023';
    end if;
    v_cat_ok := false;
    select true, c.organization_id, c.name into v_cat_ok, v_cat_org, v_cat_name
    from public.categories c where c.id = (v_r->>'category_id')::uuid and c.active;
    if not coalesce(v_cat_ok, false) or (v_cat_org is not null and v_cat_org <> v_sale.organization_id) then
      raise exception 'Categoria inválida para esta empresa.' using errcode = '42501';
    end if;
    v_pos := v_pos + 1;
    insert into public.sale_items (sale_id, organization_id, category_id, quantity, unit_price_cents, position)
    values (v_sale.id, v_sale.organization_id, (v_r->>'category_id')::uuid, v_qty, v_price, v_pos);
    v_added := v_added || jsonb_build_object('category_id', (v_r->>'category_id')::uuid, 'name', v_cat_name,
                                             'quantity', v_qty, 'unit_price_cents', v_price);
    v_add_val := v_add_val + v_qty * v_price;
  end loop;

  if jsonb_array_length(v_returned) + jsonb_array_length(v_added) = 0 then
    raise exception 'Informe o que foi devolvido e/ou os itens novos.' using errcode = '22023';
  end if;

  -- 3) Novo total (soma dos itens que ficaram)
  select coalesce(sum(line_total_cents), 0), count(*) into v_new_total, v_count
  from public.sale_items where sale_id = v_sale.id;
  if v_count = 0 or v_new_total <= 0 then
    raise exception 'A venda precisa continuar com pelo menos um item.' using errcode = '22023';
  end if;
  select category_id into v_main_cat from public.sale_items where sale_id = v_sale.id
  order by line_total_cents desc, position limit 1;

  -- 4) Parcelas: pagas ficam como estão; diferença vai para as em aberto
  select coalesce(sum(amount_cents), 0) into v_paid
  from public.installments where sale_id = v_sale.id and paid_at is not null;
  select count(*) into v_open_cnt from public.installments where sale_id = v_sale.id and paid_at is null;
  v_remaining := v_new_total - v_paid;

  if v_remaining <= 0 then
    delete from public.installments where sale_id = v_sale.id and paid_at is null;
  elsif v_open_cnt = 0 then
    insert into public.installments (sale_id, organization_id, number, due_date, amount_cents)
    select v_sale.id, v_sale.organization_id, coalesce(max(number), 0) + 1,
           (now() at time zone 'America/Sao_Paulo')::date, v_remaining
    from public.installments where sale_id = v_sale.id;
  else
    v_base := v_remaining / v_open_cnt;
    v_rem  := v_remaining % v_open_cnt;
    for v_inst in select id from public.installments where sale_id = v_sale.id and paid_at is null order by number loop
      v_i := v_i + 1;
      update public.installments
         set amount_cents = v_base + case when v_i = 1 then v_rem else 0 end
       where id = v_inst.id;
    end loop;
  end if;

  select count(*) into v_count from public.installments where sale_id = v_sale.id;
  if v_count > 24 then
    raise exception 'Limite de 24 parcelas atingido.' using errcode = '22023';
  end if;

  -- 5) Atualiza a venda (triggers de parcelas/itens ficam de fora: já ajustamos acima)
  perform set_config('joiaflow.via_exchange', '1', true);
  perform set_config('joiaflow.via_save_sale', '1', true);
  update public.sales
     set total_cents  = v_new_total,
         exchange_delta_cents = exchange_delta_cents + (v_new_total - v_sale.total_cents),
         installments = greatest(v_count, 1),
         category_id  = v_main_cat
   where id = v_sale.id;
  perform set_config('joiaflow.via_exchange', '', true);
  perform set_config('joiaflow.via_save_sale', '', true);

  -- 6) Registro da troca
  insert into public.exchanges (sale_id, organization_id, user_id, reason, returned_items, new_items,
                                old_total_cents, new_total_cents, difference_cents, paid_cents, refund_cents)
  values (v_sale.id, v_sale.organization_id, v_uid, v_reason, v_returned, v_added,
          v_sale.total_cents, v_new_total, v_new_total - v_sale.total_cents, v_paid, greatest(-v_remaining, 0))
  returning * into v_ex;

  return to_jsonb(v_ex);
end $$;

revoke execute on function public.exchange_sale(uuid, text, jsonb, jsonb) from anon, public;
grant execute on function public.exchange_sale(uuid, text, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Valores por mês: cada venda conta no mês em que foi feita (pelo valor
-- original); cada troca conta no mês em que foi feita (pela diferença).
-- Assim o relatório de um mês fechado não muda com trocas posteriores.
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
  ),
  ex as (
    select e.*, x.seller_id
    from public.exchanges e
    join public.sales x on x.id = e.sale_id
    where x.deleted_at is null
      and e.created_at >= p_start and e.created_at < p_end
      and (p_org is null or e.organization_id = p_org)
      and (p_seller is null or x.seller_id = p_seller)
  ),
  r as (
    select s.seller_id, s.organization_id, (s.sold_at at time zone 'America/Sao_Paulo')::date as day,
           (s.total_cents - s.exchange_delta_cents)::bigint as value, 1 as is_sale
    from s
    union all
    select ex.seller_id, ex.organization_id, (ex.created_at at time zone 'America/Sao_Paulo')::date,
           ex.difference_cents, 0
    from ex
  ),
  sellers as (
    select r.seller_id as id, coalesce(p.full_name, 'Vendedor') as name,
           sum(r.value)::bigint as total_cents, sum(r.is_sale)::bigint as count,
           coalesce(o.commission_percent, 30) as commission_percent,
           sum(round(r.value * coalesce(o.commission_percent, 30) / 100))::bigint as commission_cents
    from r
    left join public.profiles p on p.id = r.seller_id
    left join public.organizations o on o.id = r.organization_id
    group by r.seller_id, p.full_name, o.commission_percent
  ),
  cat as (
    -- itens atuais das vendas do período…
    select i.category_id, i.quantity::bigint as q, i.line_total_cents::bigint as v
    from s join public.sale_items i on i.sale_id = s.id
    union all
    -- …desfazendo as trocas dessas vendas (elas contam no mês da troca)
    select (it->>'category_id')::uuid, (it->>'quantity')::bigint, (it->>'quantity')::bigint * (it->>'unit_price_cents')::bigint
    from s join public.exchanges e on e.sale_id = s.id, jsonb_array_elements(e.returned_items) it
    union all
    select (it->>'category_id')::uuid, -(it->>'quantity')::bigint, -(it->>'quantity')::bigint * (it->>'unit_price_cents')::bigint
    from s join public.exchanges e on e.sale_id = s.id, jsonb_array_elements(e.new_items) it
    union all
    -- trocas feitas no período
    select (it->>'category_id')::uuid, (it->>'quantity')::bigint, (it->>'quantity')::bigint * (it->>'unit_price_cents')::bigint
    from ex, jsonb_array_elements(ex.new_items) it
    union all
    select (it->>'category_id')::uuid, -(it->>'quantity')::bigint, -(it->>'quantity')::bigint * (it->>'unit_price_cents')::bigint
    from ex, jsonb_array_elements(ex.returned_items) it
  ),
  cats as (
    select c.id, c.name, c.slug, sum(cat.v)::bigint as total_cents, sum(cat.q)::bigint as count
    from cat join public.categories c on c.id = cat.category_id
    group by c.id, c.name, c.slug
    having sum(cat.v) <> 0 or sum(cat.q) <> 0
  )
  select jsonb_build_object(
    'total_cents',      coalesce((select sum(value) from r), 0)::bigint,
    'count',            (select count(*) from s),
    'exchanges_count',  (select count(*) from ex),
    'exchanges_cents',  coalesce((select sum(difference_cents) from ex), 0)::bigint,
    'items_count',      coalesce((select sum(q) from cat), 0)::bigint,
    'commission_cents', coalesce((select sum(commission_cents) from sellers), 0)::bigint,
    'by_category', coalesce((select jsonb_agg(to_jsonb(c) order by c.total_cents desc) from cats c), '[]'::jsonb),
    'by_seller',   coalesce((select jsonb_agg(to_jsonb(v) order by v.total_cents desc) from sellers v), '[]'::jsonb),
    'by_day', coalesce((
        select jsonb_agg(to_jsonb(d) order by d.day)
        from (select day, sum(value)::bigint as total_cents, sum(is_sale)::bigint as count from r group by day) d
      ), '[]'::jsonb)
  )
$$;

create or replace function public.sales_by_month(
  p_start  timestamptz,
  p_end    timestamptz,
  p_org    uuid default null,
  p_seller uuid default null
)
returns table (month date, total_cents bigint, count bigint)
language sql stable security invoker set search_path = '' as $$
  with r as (
    select x.sold_at as at, (x.total_cents - x.exchange_delta_cents) as value, 1 as is_sale
    from public.sales x
    where x.deleted_at is null and x.sold_at >= p_start and x.sold_at < p_end
      and (p_org is null or x.organization_id = p_org)
      and (p_seller is null or x.seller_id = p_seller)
    union all
    select e.created_at, e.difference_cents, 0
    from public.exchanges e join public.sales x on x.id = e.sale_id
    where x.deleted_at is null and e.created_at >= p_start and e.created_at < p_end
      and (p_org is null or e.organization_id = p_org)
      and (p_seller is null or x.seller_id = p_seller)
  )
  select date_trunc('month', r.at at time zone 'America/Sao_Paulo')::date, sum(r.value)::bigint, sum(r.is_sale)::bigint
  from r group by 1 order by 1
$$;

-- ---------------------------------------------------------------------
-- Maletas: período em que a vendedora fica com a maleta da empresa
-- ---------------------------------------------------------------------
create table if not exists public.kits (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  seller_id        uuid not null references public.profiles(id) on delete restrict,
  received_on      date not null,                 -- data em que a vendedora recebeu
  returned_on      date,                          -- data em que entregou (acerto)
  notes            text check (notes is null or char_length(notes) <= 500),
  created_by       uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint kits_dates check (returned_on is null or returned_on >= received_on)
);

-- Cada vendedora só tem uma maleta em aberto por vez
create unique index if not exists uq_kits_open_per_seller on public.kits(seller_id) where returned_on is null;
create index if not exists idx_kits_org_received on public.kits(organization_id, received_on desc);

create trigger trg_kits_updated_at
  before update on public.kits
  for each row execute function public.set_updated_at();

create or replace function public.validate_kit()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_me public.profiles; v_seller public.profiles;
begin
  new.notes := nullif(trim(coalesce(new.notes, '')), '');
  if auth.uid() is not null then
    select * into v_me from public.profiles where id = auth.uid();
    if v_me.id is null or not public.is_active_user() then
      raise exception 'Usuário sem permissão.' using errcode = '42501';
    end if;
    if v_me.role = 'seller' then
      if tg_op = 'UPDATE' and old.seller_id <> v_me.id then
        raise exception 'Você só pode alterar as suas maletas.' using errcode = '42501';
      end if;
      new.seller_id := v_me.id;
    end if;
  end if;

  select * into v_seller from public.profiles where id = new.seller_id;
  if v_seller.id is null or v_seller.organization_id is null then
    raise exception 'Vendedora inválida.' using errcode = '22023';
  end if;
  new.organization_id := v_seller.organization_id;

  if auth.uid() is not null and v_me.role = 'org_admin' and v_me.organization_id <> new.organization_id then
    raise exception 'Empresa não autorizada.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

create trigger trg_kits_validate
  before insert or update on public.kits
  for each row execute function public.validate_kit();

create trigger trg_kits_audit
  after insert or update or delete on public.kits
  for each row execute function public.write_audit_log();

alter table public.kits enable row level security;
revoke all on public.kits from anon;

create policy kits_select on public.kits for select to authenticated
  using (
    seller_id = (select auth.uid())
    or public.is_platform_admin()
    or (public.current_role_name() = 'org_admin' and organization_id = public.current_org_id() and public.is_active_user())
  );
create policy kits_insert on public.kits for insert to authenticated
  with check (
    public.is_active_user() and (
      seller_id = (select auth.uid())
      or public.is_platform_admin()
      or (public.current_role_name() = 'org_admin' and organization_id = public.current_org_id())
    )
  );
create policy kits_update on public.kits for update to authenticated
  using (
    (seller_id = (select auth.uid()) and public.is_active_user())
    or public.is_platform_admin()
    or (public.current_role_name() = 'org_admin' and organization_id = public.current_org_id() and public.is_active_user())
  )
  with check (true);
create policy kits_delete on public.kits for delete to authenticated
  using (
    (seller_id = (select auth.uid()) and public.is_active_user())
    or public.is_platform_admin()
    or (public.current_role_name() = 'org_admin' and organization_id = public.current_org_id() and public.is_active_user())
  );

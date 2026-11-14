-- =====================================================================
-- JoiaFlow — Trocas
-- A troca altera a venda original: remove o que foi devolvido, adiciona
-- os itens novos e recalcula o valor. Parcelas já pagas são preservadas;
-- a diferença é redistribuída nas parcelas em aberto (ou vira uma nova
-- parcela, se tudo já estava pago). Cada troca fica registrada com o motivo.
-- =====================================================================

-- Funções existentes, agora cientes da troca (flag joiaflow.via_exchange)
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
        if new.deleted_at is distinct from old.deleted_at then
          raise exception 'Somente o administrador pode excluir vendas.' using errcode = '42501';
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
  if new.first_due_date is null then
    new.first_due_date := (new.sold_at at time zone 'America/Sao_Paulo')::date;
  end if;

  if tg_op = 'UPDATE'
     and (new.total_cents, new.installments, new.first_due_date, new.upfront_paid)
         is distinct from (old.total_cents, old.installments, old.first_due_date, old.upfront_paid)
     and exists (
       select 1 from public.installments i
       where i.sale_id = old.id and i.paid_at is not null
         and not (i.number = 1 and old.upfront_paid and new.upfront_paid)
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
  i      int;
  v_base bigint := new.total_cents / new.installments;
  v_rem  bigint := new.total_cents % new.installments;
begin
  if coalesce(current_setting('joiaflow.via_exchange', true), '') = '1' then
    return null; -- troca: parcelas ajustadas pela exchange_sale
  end if;
  if tg_op = 'UPDATE' then
    if (new.total_cents, new.installments, new.first_due_date, new.upfront_paid)
       is not distinct from (old.total_cents, old.installments, old.first_due_date, old.upfront_paid) then
      return null;
    end if;
    delete from public.installments where sale_id = new.id;
  end if;

  for i in 1..new.installments loop
    insert into public.installments (sale_id, organization_id, number, due_date, amount_cents, paid_at, paid_by)
    values (
      new.id,
      new.organization_id,
      i,
      (new.first_due_date + make_interval(months => i - 1))::date,
      v_base + case when i = 1 then v_rem else 0 end,
      case when i = 1 and new.upfront_paid then new.sold_at end,
      case when i = 1 and new.upfront_paid then coalesce(auth.uid(), new.created_by) end
    );
  end loop;
  return null;
end $$;


-- ---------------------------------------------------------------------
-- Registro das trocas
-- ---------------------------------------------------------------------
create table if not exists public.exchanges (
  id                uuid primary key default gen_random_uuid(),
  sale_id           uuid not null references public.sales(id) on delete cascade,
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  user_id           uuid references public.profiles(id) on delete set null,
  reason            text not null check (char_length(trim(reason)) between 3 and 500),
  returned_items    jsonb not null default '[]'::jsonb,  -- [{category_id, name, quantity, unit_price_cents}]
  new_items         jsonb not null default '[]'::jsonb,
  old_total_cents   bigint not null,
  new_total_cents   bigint not null,
  difference_cents  bigint not null,                     -- novo - antigo
  paid_cents        bigint not null default 0,           -- já pago antes da troca
  refund_cents      bigint not null default 0,           -- valor a devolver à cliente (se pagou a mais)
  created_at        timestamptz not null default now()
);

create index if not exists idx_exchanges_org_created on public.exchanges(organization_id, created_at desc);
create index if not exists idx_exchanges_sale on public.exchanges(sale_id);

alter table public.exchanges enable row level security;
revoke all on public.exchanges from anon;
revoke insert, update, delete on public.exchanges from authenticated;
grant select on public.exchanges to authenticated;

-- Quem vê a venda vê as trocas dela
create policy exchanges_select on public.exchanges for select to authenticated
  using (exists (select 1 from public.sales s where s.id = sale_id));

create trigger trg_exchanges_audit
  after insert on public.exchanges
  for each row execute function public.write_audit_log();

-- ---------------------------------------------------------------------
-- exchange_sale: executa a troca numa única transação
-- p_return    = [{ item_id, quantity }]                       (itens devolvidos)
-- p_new_items = [{ category_id, quantity, unit_price_cents }]  (itens novos)
-- ---------------------------------------------------------------------
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

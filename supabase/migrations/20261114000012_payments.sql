-- =====================================================================
-- JoiaFlow — Pagamentos com valor livre
-- A vendedora informa QUANTO a cliente pagou (qualquer valor). O valor é
-- abatido automaticamente das parcelas, da mais antiga para a mais nova:
-- parcela coberta fica paga; parcela coberta em parte fica "parcial".
-- =====================================================================

alter table public.installments
  add column if not exists paid_cents bigint not null default 0 check (paid_cents >= 0);

create table if not exists public.payments (
  id               uuid primary key default gen_random_uuid(),
  sale_id          uuid not null references public.sales(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  amount_cents     bigint not null check (amount_cents > 0 and amount_cents <= 100000000),
  paid_on          date not null,
  note             text check (note is null or char_length(note) <= 300),
  kind             text not null default 'payment' check (kind in ('payment', 'down_payment')), -- down_payment = pago no ato
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists idx_payments_sale on public.payments(sale_id, paid_on);
create index if not exists idx_payments_org_paid on public.payments(organization_id, paid_on desc);

-- ---------------------------------------------------------------------
-- Guarda das parcelas: recálculo interno não passa pelas regras de usuário
-- ---------------------------------------------------------------------
create or replace function public.installment_payment_guard()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_deleted timestamptz;
begin
  if coalesce(current_setting('joiaflow.recompute', true), '') = '1' then
    return new;
  end if;
  select s.deleted_at into v_deleted from public.sales s where s.id = new.sale_id;
  if v_deleted is not null then
    raise exception 'Venda excluída: não é possível alterar parcelas.' using errcode = '42501';
  end if;
  if new.paid_at is distinct from old.paid_at then
    new.paid_by := case when new.paid_at is null then null else auth.uid() end;
  end if;
  return new;
end $$;

-- Histórico: cada parcela já paga vira um pagamento registrado
insert into public.payments (sale_id, organization_id, amount_cents, paid_on, kind, created_by, note, created_at)
select i.sale_id, i.organization_id, i.amount_cents, (i.paid_at at time zone 'America/Sao_Paulo')::date,
       case when i.number = 1 and (s.down_payment_cents > 0 or s.upfront_paid) then 'down_payment' else 'payment' end,
       i.paid_by, null, i.paid_at
from public.installments i join public.sales s on s.id = i.sale_id
where i.paid_at is not null and i.amount_cents > 0
  and not exists (select 1 from public.payments p where p.sale_id = i.sale_id);
-- Ajuste interno (inclui vendas excluídas, que a regra de usuário bloqueia)
select set_config('joiaflow.recompute', '1', true);
update public.installments set paid_cents = amount_cents where paid_at is not null and paid_cents <> amount_cents;
select set_config('joiaflow.recompute', '', true);

alter table public.payments enable row level security;
revoke all on public.payments from anon;
revoke insert, update, delete on public.payments from authenticated;
grant select on public.payments to authenticated;
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select to authenticated
  using (exists (select 1 from public.sales s where s.id = sale_id));

drop trigger if exists trg_payments_audit on public.payments;
create trigger trg_payments_audit
  after insert or delete on public.payments
  for each row execute function public.write_audit_log();

-- Parcelas não são mais alteradas direto pela API: tudo passa por register_payment
revoke update on public.installments from authenticated;

-- ---------------------------------------------------------------------
-- Recalcula o abatimento dos pagamentos nas parcelas (do mais antigo vencimento)
-- ---------------------------------------------------------------------
create or replace function public.recompute_payments(p_sale uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_pay  record;
  v_inst record;
  v_left bigint;
  v_need bigint;
  v_take bigint;
begin
  perform set_config('joiaflow.recompute', '1', true);
  update public.installments set paid_cents = 0, paid_at = null, paid_by = null where sale_id = p_sale;
  for v_pay in select * from public.payments where sale_id = p_sale order by paid_on, created_at loop
    v_left := v_pay.amount_cents;
    for v_inst in select id, amount_cents, paid_cents from public.installments
                  where sale_id = p_sale and paid_at is null order by due_date, number loop
      exit when v_left <= 0;
      v_need := v_inst.amount_cents - v_inst.paid_cents;
      continue when v_need <= 0;
      v_take := least(v_need, v_left);
      update public.installments
         set paid_cents = paid_cents + v_take,
             paid_at = case when v_take = v_need then ((v_pay.paid_on::timestamp + time '12:00') at time zone 'America/Sao_Paulo') end,
             paid_by = case when v_take = v_need then v_pay.created_by end
       where id = v_inst.id;
      v_left := v_left - v_take;
    end loop;
  end loop;
  perform set_config('joiaflow.recompute', '', true);
end $$;
revoke execute on function public.recompute_payments(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Guarda da venda: valor/parcelas só mudam se não houver pagamentos
-- (além do "pago no ato", que é refeito junto com a venda)
-- ---------------------------------------------------------------------
create or replace function public.sales_installment_guard()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
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
     and exists (select 1 from public.payments p where p.sale_id = old.id and p.kind <> 'down_payment') then
    raise exception 'Esta venda já tem pagamentos registrados. Para alterar valor, parcelas ou vencimento, exclua os pagamentos primeiro (ou use a troca).'
      using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Geração das parcelas: entrada vira um pagamento "pago no ato"
-- ---------------------------------------------------------------------
create or replace function public.generate_installments()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  i        int;
  v_down   bigint := least(coalesce(new.down_payment_cents, 0), new.total_cents);
  v_rest   bigint;
  v_base   bigint;
  v_rem    bigint;
  v_offset int := 0;
  v_payer  uuid := coalesce(auth.uid(), new.created_by);
  v_day    date := (new.sold_at at time zone 'America/Sao_Paulo')::date;
begin
  if coalesce(current_setting('joiaflow.via_exchange', true), '') = '1' then
    return null; -- troca: parcelas ajustadas pela exchange_sale
  end if;
  if tg_op = 'UPDATE' then
    if (new.total_cents, new.installments, new.first_due_date, new.upfront_paid, new.down_payment_cents)
       is not distinct from (old.total_cents, old.installments, old.first_due_date, old.upfront_paid, old.down_payment_cents) then
      return null;
    end if;
    perform set_config('joiaflow.recompute', '1', true);
    delete from public.installments where sale_id = new.id;
    perform set_config('joiaflow.recompute', '', true);
  end if;

  -- Entrada: parcela nº 1 com vencimento no dia da venda
  if v_down > 0 then
    insert into public.installments (sale_id, organization_id, number, due_date, amount_cents)
    values (new.id, new.organization_id, 1, v_day, v_down);
    v_offset := 1;
  end if;

  v_rest := new.total_cents - v_down;
  if v_rest > 0 then
    v_base := v_rest / new.installments;
    v_rem  := v_rest % new.installments;
    for i in 1..new.installments loop
      insert into public.installments (sale_id, organization_id, number, due_date, amount_cents)
      values (new.id, new.organization_id, i + v_offset,
              (new.first_due_date + make_interval(months => i - 1))::date,
              v_base + case when i = 1 then v_rem else 0 end);
    end loop;
  end if;

  -- Pagamento "no ato" (entrada, ou a 1ª parcela nas vendas antigas)
  delete from public.payments where sale_id = new.id and kind = 'down_payment';
  if v_down > 0 then
    insert into public.payments (sale_id, organization_id, amount_cents, paid_on, kind, created_by, note)
    values (new.id, new.organization_id, v_down, v_day, 'down_payment', v_payer, 'Pago no ato');
  elsif new.upfront_paid and v_rest > 0 then
    insert into public.payments (sale_id, organization_id, amount_cents, paid_on, kind, created_by, note)
    values (new.id, new.organization_id, v_base + v_rem, v_day, 'down_payment', v_payer, '1ª parcela paga no ato');
  end if;

  perform public.recompute_payments(new.id);
  return null;
end $$;

-- ---------------------------------------------------------------------
-- Registrar pagamento: qualquer valor, até o saldo devedor
-- ---------------------------------------------------------------------
create or replace function public.register_payment(
  p_sale_id      uuid,
  p_amount_cents bigint,
  p_paid_on      date default null,
  p_note         text default null
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_me    public.profiles;
  v_sale  public.sales;
  v_paid  bigint;
  v_day   date := coalesce(p_paid_on, (now() at time zone 'America/Sao_Paulo')::date);
  v_note  text := nullif(trim(regexp_replace(coalesce(p_note, ''), '\s+', ' ', 'g')), '');
  v_pay   public.payments;
begin
  if v_uid is null then raise exception 'Não autenticado.' using errcode = '42501'; end if;
  select * into v_me from public.profiles where id = v_uid;
  if v_me.id is null or not public.is_active_user() then
    raise exception 'Usuário sem permissão.' using errcode = '42501';
  end if;
  select * into v_sale from public.sales where id = p_sale_id and deleted_at is null for update;
  if v_sale.id is null then raise exception 'Venda não encontrada.' using errcode = 'P0002'; end if;
  if not (v_me.role = 'platform_admin'
          or (v_me.role = 'org_admin' and v_me.organization_id = v_sale.organization_id)
          or (v_me.role = 'seller' and v_sale.seller_id = v_uid)) then
    raise exception 'Você não pode registrar pagamento nesta venda.' using errcode = '42501';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Informe o valor recebido.' using errcode = '22023';
  end if;
  if v_day > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'A data do pagamento não pode estar no futuro.' using errcode = '22023';
  end if;
  if char_length(coalesce(v_note, '')) > 300 then
    raise exception 'Observação muito longa.' using errcode = '22023';
  end if;
  select coalesce(sum(amount_cents), 0) into v_paid from public.payments where sale_id = v_sale.id;
  if p_amount_cents > v_sale.total_cents - v_paid then
    raise exception 'O valor é maior do que a cliente ainda deve (R$ %).',
      replace(to_char((v_sale.total_cents - v_paid) / 100.0, 'FM999999990D00'), '.', ',') using errcode = '22023';
  end if;

  insert into public.payments (sale_id, organization_id, amount_cents, paid_on, note, kind, created_by)
  values (v_sale.id, v_sale.organization_id, p_amount_cents, v_day, v_note, 'payment', v_uid)
  returning * into v_pay;
  perform public.recompute_payments(v_sale.id);
  return to_jsonb(v_pay);
end $$;

create or replace function public.delete_payment(p_payment_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_me   public.profiles;
  v_pay  public.payments;
  v_sale public.sales;
begin
  if v_uid is null then raise exception 'Não autenticado.' using errcode = '42501'; end if;
  select * into v_me from public.profiles where id = v_uid;
  if v_me.id is null or not public.is_active_user() then
    raise exception 'Usuário sem permissão.' using errcode = '42501';
  end if;
  select * into v_pay from public.payments where id = p_payment_id;
  if v_pay.id is null then raise exception 'Pagamento não encontrado.' using errcode = 'P0002'; end if;
  select * into v_sale from public.sales where id = v_pay.sale_id and deleted_at is null for update;
  if v_sale.id is null then raise exception 'Venda não encontrada.' using errcode = 'P0002'; end if;
  if not (v_me.role = 'platform_admin'
          or (v_me.role = 'org_admin' and v_me.organization_id = v_sale.organization_id)
          or (v_me.role = 'seller' and v_sale.seller_id = v_uid)) then
    raise exception 'Você não pode alterar pagamentos desta venda.' using errcode = '42501';
  end if;
  if v_pay.kind = 'down_payment' then
    raise exception 'Para mudar o valor pago no ato, edite a venda.' using errcode = '22023';
  end if;
  delete from public.payments where id = v_pay.id;
  perform public.recompute_payments(v_sale.id);
end $$;

revoke execute on function public.register_payment(uuid, bigint, date, text) from public, anon;
revoke execute on function public.delete_payment(uuid) from public, anon;
grant execute on function public.register_payment(uuid, bigint, date, text) to authenticated;
grant execute on function public.delete_payment(uuid) to authenticated;

-- Troca: o que foi pago continua pago (inclusive parciais)
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

  -- 4) Parcelas: o que já foi pago continua pago; o saldo vai para as parcelas em aberto
  select coalesce(sum(amount_cents), 0) into v_paid from public.payments where sale_id = v_sale.id;
  select count(*) into v_open_cnt from public.installments where sale_id = v_sale.id and paid_at is null;
  v_remaining := v_new_total - v_paid;

  perform set_config('joiaflow.recompute', '1', true);
  if v_remaining <= 0 then
    -- nada mais a receber: parcelas sem pagamento somem; as parcialmente pagas ficam quitadas
    delete from public.installments where sale_id = v_sale.id and paid_at is null and paid_cents = 0;
    update public.installments set amount_cents = paid_cents where sale_id = v_sale.id and paid_at is null;
  elsif v_open_cnt = 0 then
    insert into public.installments (sale_id, organization_id, number, due_date, amount_cents)
    select v_sale.id, v_sale.organization_id, coalesce(max(number), 0) + 1,
           (now() at time zone 'America/Sao_Paulo')::date, v_remaining
    from public.installments where sale_id = v_sale.id;
  else
    v_base := v_remaining / v_open_cnt;
    v_rem  := v_remaining % v_open_cnt;
    for v_inst in select id, paid_cents from public.installments where sale_id = v_sale.id and paid_at is null order by due_date, number loop
      v_i := v_i + 1;
      update public.installments
         set amount_cents = v_inst.paid_cents + v_base + case when v_i = 1 then v_rem else 0 end
       where id = v_inst.id;
    end loop;
  end if;
  perform set_config('joiaflow.recompute', '', true);
  perform public.recompute_payments(v_sale.id);

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

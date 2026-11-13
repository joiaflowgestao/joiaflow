-- =====================================================================
-- JoiaFlow — Parcelas com vencimento e confirmação de pagamento
-- Cada venda gera automaticamente suas parcelas (1 = à vista).
-- Vencimentos mensais a partir do 1º vencimento, sempre no mesmo dia
-- (ex.: todo dia 10). Dias 29-31 caem no último dia dos meses curtos.
-- =====================================================================

alter table public.sales
  add column if not exists first_due_date date,
  add column if not exists upfront_paid  boolean not null default false; -- 1ª parcela paga no ato da venda

-- Vendas antigas: 1º vencimento = data da venda
update public.sales
   set first_due_date = (sold_at at time zone 'America/Sao_Paulo')::date
 where first_due_date is null;

alter table public.sales alter column first_due_date set not null;

create table if not exists public.installments (
  id               uuid primary key default gen_random_uuid(),
  sale_id          uuid not null references public.sales(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  number           smallint not null check (number >= 1),
  due_date         date not null,
  amount_cents     bigint not null check (amount_cents >= 0),
  paid_at          timestamptz,
  paid_by          uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (sale_id, number)
);

create index if not exists idx_installments_org_due_open
  on public.installments(organization_id, due_date) where paid_at is null;
create index if not exists idx_installments_sale on public.installments(sale_id);

create trigger trg_installments_updated_at
  before update on public.installments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 1º vencimento padrão e bloqueio de mudança financeira com parcelas pagas
-- ---------------------------------------------------------------------
create or replace function public.sales_installment_guard()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
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

create trigger trg_sales_installment_guard
  before insert or update on public.sales
  for each row execute function public.sales_installment_guard();

-- ---------------------------------------------------------------------
-- Geração das parcelas (AFTER INSERT/UPDATE em sales)
-- ---------------------------------------------------------------------
create or replace function public.generate_installments()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  i      int;
  v_base bigint := new.total_cents / new.installments;
  v_rem  bigint := new.total_cents % new.installments;
begin
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

create trigger trg_sales_generate_installments
  after insert or update on public.sales
  for each row execute function public.generate_installments();

-- Gera parcelas para vendas já existentes
insert into public.installments (sale_id, organization_id, number, due_date, amount_cents)
select s.id, s.organization_id, g.n,
       (s.first_due_date + make_interval(months => g.n - 1))::date,
       s.total_cents / s.installments + case when g.n = 1 then s.total_cents % s.installments else 0 end
from public.sales s
cross join lateral generate_series(1, s.installments) as g(n)
where not exists (select 1 from public.installments i where i.sale_id = s.id);

-- ---------------------------------------------------------------------
-- Confirmação de pagamento: registra quem confirmou e bloqueia venda excluída
-- ---------------------------------------------------------------------
create or replace function public.installment_payment_guard()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_deleted timestamptz;
begin
  select s.deleted_at into v_deleted from public.sales s where s.id = new.sale_id;
  if v_deleted is not null then
    raise exception 'Venda excluída: não é possível alterar parcelas.' using errcode = '42501';
  end if;
  if new.paid_at is distinct from old.paid_at then
    new.paid_by := case when new.paid_at is null then null else auth.uid() end;
  end if;
  return new;
end $$;

create trigger trg_installments_payment_guard
  before update on public.installments
  for each row execute function public.installment_payment_guard();

create trigger trg_installments_audit
  after update on public.installments
  for each row execute function public.write_audit_log();

-- ---------------------------------------------------------------------
-- RLS: quem vê a venda vê as parcelas; quem vê pode confirmar pagamento.
-- Usuários só conseguem alterar a coluna paid_at (nada de valor/vencimento).
-- ---------------------------------------------------------------------
alter table public.installments enable row level security;
revoke all on public.installments from anon;
revoke insert, update, delete on public.installments from authenticated;
grant select on public.installments to authenticated;
grant update (paid_at) on public.installments to authenticated;

create policy installments_select on public.installments for select to authenticated
  using (exists (select 1 from public.sales s where s.id = sale_id));

create policy installments_update on public.installments for update to authenticated
  using (exists (select 1 from public.sales s where s.id = sale_id and s.deleted_at is null))
  with check (exists (select 1 from public.sales s where s.id = sale_id and s.deleted_at is null));

-- Dados de TESTE (somente neste banco temporário)
insert into public.organizations (id, name, slug) values
 ('a0000000-0000-0000-0000-000000000000','Empresa A','empresa-a'),
 ('b0000000-0000-0000-0000-000000000000','Empresa B','empresa-b');
insert into auth.users values
 ('00000000-0000-0000-0000-0000000000ad','admin@x'),('00000000-0000-0000-0000-0000000000a1','a1@x'),
 ('00000000-0000-0000-0000-0000000000a2','a2@x'),('00000000-0000-0000-0000-0000000000b1','b1@x'),
 ('00000000-0000-0000-0000-0000000000a9','oa@x'),('00000000-0000-0000-0000-0000000000a3','a3@x');
insert into public.profiles (id, organization_id, full_name, email, role, active) values
 ('00000000-0000-0000-0000-0000000000ad', null, 'Admin', 'admin@x', 'platform_admin', true),
 ('00000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000000', 'Vend A1', 'a1@x', 'seller', true),
 ('00000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000000', 'Vend A2', 'a2@x', 'seller', true),
 ('00000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000000', 'Vend A3 inativo', 'a3@x', 'seller', false),
 ('00000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000000', 'Vend B1', 'b1@x', 'seller', true),
 ('00000000-0000-0000-0000-0000000000a9', 'a0000000-0000-0000-0000-000000000000', 'Gestor A', 'oa@x', 'org_admin', true);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); execute 'set role authenticated'; end $$;
create or replace function pg_temp.cat() returns uuid language sql as $$ select id from public.categories where slug='anel' $$;
create table pg_temp.results (name text, ok boolean);
grant all on pg_temp.results to authenticated, anon;

-- 1) Vendedor A1 insere tentando se passar por A2 e pela empresa B → banco força A1/A
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
insert into public.sales (organization_id, seller_id, category_id, customer_name, total_cents, installments)
values ('b0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2', pg_temp.cat(), '  Maria   Silva ', 10000, 3);
insert into pg_temp.results select 'insert forçado p/ próprio vendedor e empresa',
  (select seller_id='00000000-0000-0000-0000-0000000000a1' and organization_id='a0000000-0000-0000-0000-000000000000'
     and customer_name='Maria Silva' and installment_cents=3333 and installment_remainder_cents=1 from public.sales);
reset role;

-- vendas de A2 e B1
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
insert into public.sales (organization_id, seller_id, category_id, customer_name, total_cents) values ('a0000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a2',pg_temp.cat(),'Cliente A2',5000);
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
insert into public.sales (organization_id, seller_id, category_id, customer_name, total_cents) values ('b0000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000b1',pg_temp.cat(),'Cliente B1',7000);
insert into pg_temp.results select 'B1 só vê 1 venda (a sua)', (select count(*)=1 from public.sales);
insert into pg_temp.results select 'B1 só vê a própria empresa', (select count(*)=1 and bool_and(slug='empresa-b') from public.organizations);
reset role;

-- 2) Leituras do vendedor A1
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
insert into pg_temp.results select 'A1 vê só suas vendas', (select count(*)=1 from public.sales);
insert into pg_temp.results select 'A1 vê só o próprio perfil', (select count(*)=1 from public.profiles);
insert into pg_temp.results select 'A1 não vê auditoria', (select count(*)=0 from public.audit_logs);
-- tentar editar venda de A2 (RLS esconde → 0 linhas)
with u as (update public.sales set total_cents=1 where customer_name='Cliente A2' returning 1)
insert into pg_temp.results select 'A1 não edita venda de A2', (select count(*)=0 from u);
reset role;

-- 3) Bloqueios por exceção
create or replace function pg_temp.expect_error(label text, uid text, stmt text) returns void language plpgsql as $$
begin
  perform pg_temp.as_user(uid);
  begin execute stmt; reset role; insert into pg_temp.results values (label, false);
  exception when others then reset role; insert into pg_temp.results values (label, true); end;
end $$;
select pg_temp.expect_error('A1 não exclui venda', '00000000-0000-0000-0000-0000000000a1', $$update public.sales set deleted_at=now() where customer_name='Maria Silva'$$);
select pg_temp.expect_error('A1 não vira admin', '00000000-0000-0000-0000-0000000000a1', $$update public.profiles set role='platform_admin' where id=auth.uid()$$);
select pg_temp.expect_error('A1 não troca de empresa', '00000000-0000-0000-0000-0000000000a1', $$update public.profiles set organization_id='b0000000-0000-0000-0000-000000000000' where id=auth.uid()$$);
select pg_temp.expect_error('A1 não move venda p/ outra empresa', '00000000-0000-0000-0000-0000000000a1', $$update public.sales set organization_id='b0000000-0000-0000-0000-000000000000' where customer_name='Maria Silva'$$);
select pg_temp.expect_error('A1 não cria empresa', '00000000-0000-0000-0000-0000000000a1', $$insert into public.organizations(name,slug) values ('X','x')$$);
select pg_temp.expect_error('A1 não escreve auditoria', '00000000-0000-0000-0000-0000000000a1', $$insert into public.audit_logs(table_name,record_id,action) values ('sales',gen_random_uuid(),'insert')$$);
select pg_temp.expect_error('Inativo não lança venda', '00000000-0000-0000-0000-0000000000a3', $$insert into public.sales (organization_id, seller_id, category_id, customer_name, total_cents) values ('a0000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a3',pg_temp.cat(),'X Y',100)$$);
select pg_temp.expect_error('Gestor A não lança p/ vendedor de B', '00000000-0000-0000-0000-0000000000a9', $$insert into public.sales (organization_id, seller_id, category_id, customer_name, total_cents) values ('b0000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000b1',pg_temp.cat(),'X Y',100)$$);
select pg_temp.expect_error('Valor zero rejeitado', '00000000-0000-0000-0000-0000000000a1', $$insert into public.sales (organization_id, seller_id, category_id, customer_name, total_cents) values ('a0000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a1',pg_temp.cat(),'X Y',0)$$);

-- 4) A1 pode editar a própria venda; depois empresa bloqueia edição
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
with u as (update public.sales set total_cents=30000 where customer_name='Maria Silva' returning installment_cents)
insert into pg_temp.results select 'A1 edita a própria venda (300 em 3x = 100)', (select installment_cents=10000 from u);
reset role;
update public.organizations set sellers_can_edit_sales=false where slug='empresa-a';
select pg_temp.expect_error('Edição bloqueada pela empresa', '00000000-0000-0000-0000-0000000000a1', $$update public.sales set total_cents=100 where customer_name='Maria Silva'$$);

-- 5) Gestor da empresa A
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
insert into pg_temp.results select 'Gestor A vê 2 vendas de A (nenhuma de B)', (select count(*)=2 and bool_and(organization_id='a0000000-0000-0000-0000-000000000000') from public.sales);
with u as (update public.sales set deleted_at=now() where customer_name='Cliente A2' returning deleted_by)
insert into pg_temp.results select 'Gestor A exclui (lógico) com autoria', (select deleted_by='00000000-0000-0000-0000-0000000000a9' from u);
insert into pg_temp.results select 'Gestor A vê auditoria só de A', (select count(*)>0 and bool_and(organization_id='a0000000-0000-0000-0000-000000000000') from public.audit_logs);
reset role;

-- 6) Admin da plataforma vê tudo
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ad');
insert into pg_temp.results select 'Admin vê vendas de todas as empresas', (select count(distinct organization_id)=2 from public.sales);
reset role;

-- 7) Anônimo
set role anon;
do $$ begin perform 1 from public.sales; insert into pg_temp.results values ('Anônimo bloqueado', false);
exception when insufficient_privilege then insert into pg_temp.results values ('Anônimo bloqueado', true); end $$;
reset role;


-- 8) Funções de relatório respeitam o RLS
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
insert into pg_temp.results select 'Relatório de B1 só soma B1',
  (select (public.sales_summary(now() - interval '1 day', now() + interval '1 day')->>'total_cents')::bigint = 7000);
insert into pg_temp.results select 'Relatório de B1 ignora filtro de empresa A',
  (select (public.sales_summary(now() - interval '1 day', now() + interval '1 day', 'a0000000-0000-0000-0000-000000000000')->>'count')::int = 0);
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ad');
insert into pg_temp.results select 'Relatório do admin soma todas (exceto excluída)',
  (select (public.sales_summary(now() - interval '1 day', now() + interval '1 day')->>'total_cents')::bigint = 37000
     and jsonb_array_length(public.sales_summary(now() - interval '1 day', now() + interval '1 day')->'by_seller') = 2);
insert into pg_temp.results select 'Totais por mês',
  (select sum(count) = 2 from public.sales_by_month(now() - interval '60 days', now() + interval '1 day'));
reset role;
set role anon;
do $$ begin perform public.sales_summary(now(), now()); insert into pg_temp.results values ('Anônimo sem relatório', false);
exception when insufficient_privilege then insert into pg_temp.results values ('Anônimo sem relatório', true); end $$;
reset role;

-- 9) Parcelas
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
insert into public.sales (organization_id, seller_id, category_id, customer_name, total_cents, installments, sold_at, first_due_date)
values ('a0000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a2',pg_temp.cat(),'Parcelado A2',10000,3,'2026-01-20T12:00:00Z','2026-01-31');
insert into pg_temp.results select 'Gera 3 parcelas somando o total (1ª com o centavo extra)',
  (select count(*)=3 and sum(amount_cents)=10000 and max(amount_cents)=3334
     from public.installments i join public.sales s on s.id=i.sale_id where s.customer_name='Parcelado A2');
insert into pg_temp.results select 'Vencimento mensal no mesmo dia (31 → 28/fev → 31/mar)',
  (select array_agg(due_date order by number) = array['2026-01-31','2026-02-28','2026-03-31']::date[]
     from public.installments i join public.sales s on s.id=i.sale_id where s.customer_name='Parcelado A2');
with u as (update public.installments i set paid_at=now() from public.sales s
           where s.id=i.sale_id and s.customer_name='Parcelado A2' and i.number=1 returning i.paid_by)
insert into pg_temp.results select 'Vendedor confirma pagamento da própria venda', (select paid_by='00000000-0000-0000-0000-0000000000a2' from u);
reset role;
select pg_temp.expect_error('Vendedor não altera valor da parcela', '00000000-0000-0000-0000-0000000000a2', $$update public.installments set amount_cents=1$$);
select pg_temp.expect_error('Vendedor não cria parcela', '00000000-0000-0000-0000-0000000000a2', $$insert into public.installments(sale_id, organization_id, number, due_date, amount_cents) select id, organization_id, 9, now()::date, 1 from public.sales limit 1$$);
select pg_temp.expect_error('Não muda valor com parcela paga', '00000000-0000-0000-0000-0000000000a9', $$update public.sales set total_cents=20000 where customer_name='Parcelado A2'$$);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
insert into pg_temp.results select 'B1 não vê parcelas da empresa A', (select count(*)=0 from public.installments where organization_id='a0000000-0000-0000-0000-000000000000');
with u as (update public.installments set paid_at=now() where organization_id='a0000000-0000-0000-0000-000000000000' returning 1)
insert into pg_temp.results select 'B1 não confirma pagamento da empresa A', (select count(*)=0 from u);
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
insert into public.sales (organization_id, seller_id, category_id, customer_name, total_cents, installments, upfront_paid)
values ('a0000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a1',pg_temp.cat(),'A vista pago',5000,1,true);
insert into pg_temp.results select 'À vista pago no ato já nasce quitado',
  (select bool_and(paid_at is not null and paid_by='00000000-0000-0000-0000-0000000000a1') from public.installments i join public.sales s on s.id=i.sale_id where s.customer_name='A vista pago');
reset role;

-- 10) Vários itens na mesma venda (save_sale)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
with r as (select public.save_sale(null, jsonb_build_object(
  'customer_name','Multi Itens','sold_at', now(),'installments',2,'first_due_date', current_date,
  'seller_id','00000000-0000-0000-0000-0000000000a1','organization_id','b0000000-0000-0000-0000-000000000000',
  'items', jsonb_build_array(
     jsonb_build_object('category_id',(select id from public.categories where slug='brinco'),'quantity',2,'unit_price_cents',4500),
     jsonb_build_object('category_id',(select id from public.categories where slug='anel'),'quantity',1,'unit_price_cents',12000)))) as v)
insert into pg_temp.results select 'save_sale: total = soma dos itens e vendedor forçado',
  (select (v->>'total_cents')::bigint = 21000 and v->>'seller_id'='00000000-0000-0000-0000-0000000000a2'
          and v->>'organization_id'='a0000000-0000-0000-0000-000000000000' from r);
insert into pg_temp.results select 'save_sale: 2 itens gravados e categoria principal = maior valor',
  (select count(*)=2 and bool_and(i.organization_id=s.organization_id)
          and max(s.category_id::text) = (select id::text from public.categories where slug='anel')
     from public.sale_items i join public.sales s on s.id=i.sale_id where s.customer_name='Multi Itens');
insert into pg_temp.results select 'save_sale: parcelas geradas sobre o total',
  (select sum(amount_cents)=21000 and count(*)=2 from public.installments i join public.sales s on s.id=i.sale_id where s.customer_name='Multi Itens');
reset role;
select pg_temp.expect_error('save_sale sem itens é rejeitada', '00000000-0000-0000-0000-0000000000a2',
  $$select public.save_sale(null, '{"customer_name":"X Y","sold_at":"2026-11-13T10:00:00Z","items":[]}'::jsonb)$$);
create table pg_temp.ids as select id from public.sales where customer_name='Multi Itens';
grant select on pg_temp.ids to authenticated;
select pg_temp.expect_error('Vendedor B1 não edita venda de A via save_sale', '00000000-0000-0000-0000-0000000000b1',
  $$select public.save_sale((select id from pg_temp.ids), jsonb_build_object('customer_name','Hack','sold_at',now(),'items',jsonb_build_array(jsonb_build_object('category_id',(select id from public.categories where slug='anel'),'quantity',1,'unit_price_cents',1))))$$);
select pg_temp.expect_error('Vendedor não grava item direto', '00000000-0000-0000-0000-0000000000a2',
  $$insert into public.sale_items(sale_id, organization_id, category_id, quantity, unit_price_cents) select id, organization_id, category_id, 1, 1 from public.sales limit 1$$);
select pg_temp.expect_error('Valor de venda com vários itens não muda por fora', '00000000-0000-0000-0000-0000000000ad',
  $$update public.sales set total_cents = 1 where customer_name='Multi Itens'$$);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
insert into pg_temp.results select 'B1 não vê itens da empresa A', (select count(*)=0 from public.sale_items where organization_id='a0000000-0000-0000-0000-000000000000');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ad');
insert into pg_temp.results select 'Relatório por categoria soma itens (2 brincos)',
  (select exists(select 1 from jsonb_array_elements(public.sales_summary(now()-interval '1 day', now()+interval '1 day')->'by_category') e
          where e->>'slug'='brinco' and (e->>'count')::int >= 2));
insert into pg_temp.results select 'Venda antiga/direta ganha 1 item automático',
  (select bool_and(n=1) from (select count(i.id) n from public.sales s left join public.sale_items i on i.sale_id=s.id where s.customer_name in ('Cliente B1','A vista pago') group by s.id) z);
reset role;

insert into pg_temp.results select 'Venda de A intacta após tentativa de B1', (select count(*)=0 from public.sales where customer_name='Hack');
-- 11) Comissão (30%)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
insert into pg_temp.results select 'Comissão de B1 = 30% das vendas dele',
  (select (r->>'commission_cents')::bigint = round((r->>'total_cents')::bigint * 0.30)
          and (r->'by_seller'->0->>'commission_percent')::numeric = 30
     from (select public.sales_summary(now()-interval '1 day', now()+interval '1 day') r) z);
reset role;

-- 12) Lançamentos financeiros
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
insert into public.financial_entries (user_id, organization_id, entry_date, kind, description, amount_cents)
values ('00000000-0000-0000-0000-0000000000a2', 'b0000000-0000-0000-0000-000000000000', current_date, 'in', 'Recebi da Maria  (pix)', 5000);
insert into pg_temp.results select 'Lançamento sempre fica com o próprio usuário e empresa',
  (select user_id='00000000-0000-0000-0000-0000000000a1' and organization_id='a0000000-0000-0000-0000-000000000000' and description='Recebi da Maria (pix)'
     from public.financial_entries where description like 'Recebi da Maria%');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
insert into public.financial_entries (entry_date, kind, description, amount_cents) values (current_date, 'out', 'Gasolina', 2000);
insert into pg_temp.results select 'A2 não vê lançamentos de A1', (select count(*)=1 from public.financial_entries);
with u as (update public.financial_entries set amount_cents=1 where description like 'Recebi%' returning 1)
insert into pg_temp.results select 'A2 não edita lançamento de A1', (select count(*)=0 from u);
with d as (delete from public.financial_entries where description like 'Recebi%' returning 1)
insert into pg_temp.results select 'A2 não exclui lançamento de A1', (select count(*)=0 from d);
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
insert into pg_temp.results select 'B1 não vê lançamentos da empresa A', (select count(*)=0 from public.financial_entries);
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
insert into pg_temp.results select 'Gestor A vê lançamentos da empresa A', (select count(*)=2 from public.financial_entries);
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ad');
insert into pg_temp.results select 'Admin vê todos os lançamentos', (select count(*)=2 from public.financial_entries);
reset role;
select pg_temp.expect_error('Lançamento com valor zero rejeitado', '00000000-0000-0000-0000-0000000000a1',
  $$insert into public.financial_entries (entry_date, description, amount_cents) values (current_date, 'Teste', 0)$$);
select pg_temp.expect_error('Inativo não lança', '00000000-0000-0000-0000-0000000000a3',
  $$insert into public.financial_entries (entry_date, description, amount_cents) values (current_date, 'Teste', 100)$$);
set role anon;
do $$ begin perform 1 from public.financial_entries; insert into pg_temp.results values ('Anônimo sem lançamentos', false);
exception when insufficient_privilege then insert into pg_temp.results values ('Anônimo sem lançamentos', true); end $$;
reset role;

-- 13) Trocas
-- Venda "Multi Itens" (A2): 2x brinco 45,00 + 1x anel 120,00 = 210,00 em 2x de 105,00. Paga a 1ª.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
update public.installments i set paid_at = now() from public.sales s
 where s.id = i.sale_id and s.customer_name = 'Multi Itens' and i.number = 1;
-- Troca: devolve 1 brinco, leva 1 pulseira de 80,00 → novo total 245,00
create table pg_temp.ex1 as
select public.exchange_sale(
  (select id from public.sales where customer_name = 'Multi Itens'),
  'Brinco com defeito no fecho, trocou por pulseira',
  jsonb_build_array(jsonb_build_object('item_id', (select i.id from public.sale_items i join public.sales s on s.id=i.sale_id join public.categories c on c.id=i.category_id where s.customer_name='Multi Itens' and c.slug='brinco'), 'quantity', 1)),
  jsonb_build_array(jsonb_build_object('category_id', (select id from public.categories where slug='pulseira'), 'quantity', 1, 'unit_price_cents', 8000))
) as r;
insert into pg_temp.results select 'Troca: novo total recalculado (210 − 45 + 80 = 245)',
  (select (r->>'new_total_cents')::bigint = 24500 and (r->>'difference_cents')::bigint = 3500 from pg_temp.ex1);
insert into pg_temp.results select 'Troca feita mesmo com edição bloqueada na empresa (A)',
  (select total_cents = 24500 from public.sales where customer_name='Multi Itens');
insert into pg_temp.results select 'Troca: parcela paga preservada, diferença na parcela em aberto (105 paga + 140 aberta)',
  (select array_agg(amount_cents order by number) = array[10500,14000]::bigint[]
          and bool_and((number = 1) = (paid_at is not null))
     from public.installments i join public.sales s on s.id=i.sale_id where s.customer_name='Multi Itens');
insert into pg_temp.results select 'Troca: itens atualizados (1 brinco, 1 anel, 1 pulseira)',
  (select sum(quantity) = 3 and count(*) = 3 from public.sale_items i join public.sales s on s.id=i.sale_id where s.customer_name='Multi Itens');
insert into pg_temp.results select 'Troca: motivo registrado',
  (select reason = 'Brinco com defeito no fecho, trocou por pulseira' from public.exchanges limit 1);
reset role;
create table pg_temp.ids2 as select id from public.sales where customer_name='Multi Itens';
grant select on pg_temp.ids2 to authenticated;
select pg_temp.expect_error('Troca sem motivo é rejeitada', '00000000-0000-0000-0000-0000000000a2',
  $$select public.exchange_sale((select id from pg_temp.ids2), ' ', '[]'::jsonb, jsonb_build_array(jsonb_build_object('category_id',(select id from public.categories where slug='anel'),'quantity',1,'unit_price_cents',100)))$$);
select pg_temp.expect_error('Vendedora A1 não troca venda da A2', '00000000-0000-0000-0000-0000000000a1',
  $$select public.exchange_sale((select id from pg_temp.ids2), 'Tentativa', '[]'::jsonb, jsonb_build_array(jsonb_build_object('category_id',(select id from public.categories where slug='anel'),'quantity',1,'unit_price_cents',100)))$$);
select pg_temp.expect_error('Vendedor B1 (outra empresa) não troca venda de A', '00000000-0000-0000-0000-0000000000b1',
  $$select public.exchange_sale((select id from pg_temp.ids2), 'Tentativa', '[]'::jsonb, jsonb_build_array(jsonb_build_object('category_id',(select id from public.categories where slug='anel'),'quantity',1,'unit_price_cents',100)))$$);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
insert into pg_temp.results select 'B1 não vê trocas da empresa A', (select count(*)=0 from public.exchanges);
reset role;
-- Troca que reduz o valor abaixo do já pago → valor a devolver
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
create table pg_temp.ex2 as
select public.exchange_sale((select id from pg_temp.ids2), 'Devolveu o anel',
  jsonb_build_array(jsonb_build_object('item_id', (select i.id from public.sale_items i join public.categories c on c.id=i.category_id where i.sale_id=(select id from pg_temp.ids2) and c.slug='anel'), 'quantity', 1)),
  '[]'::jsonb) as r;
insert into pg_temp.results select 'Troca para menos: novo total 125, pago 105 → resta 20 em aberto',
  (select (r->>'new_total_cents')::bigint = 12500 and (r->>'refund_cents')::bigint = 0 from pg_temp.ex2)
  and (select array_agg(amount_cents order by number) = array[10500,2000]::bigint[] from public.installments where sale_id=(select id from pg_temp.ids2));
create table pg_temp.ex3 as
select public.exchange_sale((select id from pg_temp.ids2), 'Devolveu a pulseira',
  jsonb_build_array(jsonb_build_object('item_id', (select i.id from public.sale_items i join public.categories c on c.id=i.category_id where i.sale_id=(select id from pg_temp.ids2) and c.slug='pulseira'), 'quantity', 1)),
  '[]'::jsonb) as r;
insert into pg_temp.results select 'Pagou mais que o novo total → valor a devolver (105 − 45 = 60)',
  (select (r->>'refund_cents')::bigint = 6000 and (r->>'new_total_cents')::bigint = 4500 from pg_temp.ex3)
  and (select count(*)=1 and bool_and(paid_at is not null) from public.installments where sale_id=(select id from pg_temp.ids2));
reset role;
select pg_temp.expect_error('Não pode devolver todos os itens', '00000000-0000-0000-0000-0000000000a9',
  $$select public.exchange_sale((select id from pg_temp.ids2), 'Devolveu tudo', jsonb_build_array(jsonb_build_object('item_id',(select id from public.sale_items where sale_id=(select id from pg_temp.ids2) limit 1),'quantity',1)), '[]'::jsonb)$$);
select pg_temp.expect_error('Vendedor não grava troca direto na tabela', '00000000-0000-0000-0000-0000000000a2',
  $$insert into public.exchanges(sale_id, organization_id, reason, old_total_cents, new_total_cents, difference_cents) select id, organization_id, 'x x x', 1, 1, 0 from public.sales limit 1$$);

insert into pg_temp.results select 'Auditoria registrou soft_delete', exists(select 1 from public.audit_logs where action='soft_delete');

select (case when ok then 'PASS' else 'FAIL' end) || '  ' || name from pg_temp.results;

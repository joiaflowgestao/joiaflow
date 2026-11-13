-- =====================================================================
-- JoiaFlow — Estrutura principal do banco de dados
-- Todas as tabelas usam UUID. Valores monetários em CENTAVOS (bigint)
-- para evitar erros de arredondamento de ponto flutuante.
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('platform_admin', 'org_admin', 'seller');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- organizations (empresas / tenants)
-- ---------------------------------------------------------------------
create table if not exists public.organizations (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null check (char_length(trim(name)) between 2 and 120),
  slug                     text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  document                 text,                 -- CNPJ/CPF (opcional)
  phone                    text,
  email                    text,
  active                   boolean not null default true,
  sellers_can_edit_sales   boolean not null default true,  -- permissão definida pelo admin
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create trigger trg_organizations_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- profiles (1:1 com auth.users)
-- platform_admin  → organization_id pode ser nulo (acesso a todas)
-- org_admin/seller → organization_id obrigatório
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  organization_id      uuid references public.organizations(id) on delete restrict,
  full_name            text not null check (char_length(trim(full_name)) between 2 and 120),
  email                text not null,
  role                 public.user_role not null default 'seller',
  active               boolean not null default true,
  can_edit_own_sales   boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint profiles_org_required
    check (role = 'platform_admin' or organization_id is not null)
);

create index if not exists idx_profiles_org on public.profiles(organization_id);
create unique index if not exists uq_profiles_email on public.profiles(lower(email));

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- categories
-- organization_id nulo = categoria global (disponível a todas as empresas)
-- ---------------------------------------------------------------------
create table if not exists public.categories (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid references public.organizations(id) on delete cascade,
  name             text not null check (char_length(trim(name)) between 2 and 60),
  slug             text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  icon             text not null default 'gem',
  sort_order       smallint not null default 0,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

create unique index if not exists uq_categories_global_slug
  on public.categories(slug) where organization_id is null;
create unique index if not exists uq_categories_org_slug
  on public.categories(organization_id, slug) where organization_id is not null;

-- ---------------------------------------------------------------------
-- sales
-- sold_at = data/hora EFETIVA da venda (base dos relatórios)
-- created_at = momento do registro
-- installment_cents / installment_remainder_cents são calculados pelo banco:
--   ex.: R$ 100,00 em 3x → 3333 + resto 1 → 1x R$ 33,34 + 2x R$ 33,33
-- ---------------------------------------------------------------------
create table if not exists public.sales (
  id                            uuid primary key default gen_random_uuid(),
  organization_id               uuid not null references public.organizations(id) on delete restrict,
  seller_id                     uuid not null references public.profiles(id) on delete restrict,
  category_id                   uuid not null references public.categories(id) on delete restrict,
  customer_name                 text not null check (char_length(trim(customer_name)) between 2 and 120),
  sold_at                       timestamptz not null default now(),
  total_cents                   bigint not null check (total_cents > 0 and total_cents <= 100000000),
  installments                  smallint not null default 1 check (installments between 1 and 24),
  installment_cents             bigint generated always as (total_cents / installments) stored,
  installment_remainder_cents   bigint generated always as (total_cents % installments) stored,
  notes                         text check (notes is null or char_length(notes) <= 500),
  created_by                    uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by                    uuid references public.profiles(id) on delete set null,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  deleted_at                    timestamptz,          -- exclusão lógica (auditável)
  deleted_by                    uuid references public.profiles(id) on delete set null
);

create index if not exists idx_sales_org_sold_at     on public.sales(organization_id, sold_at desc) where deleted_at is null;
create index if not exists idx_sales_seller_sold_at  on public.sales(seller_id, sold_at desc)       where deleted_at is null;
create index if not exists idx_sales_org_category    on public.sales(organization_id, category_id)  where deleted_at is null;
create index if not exists idx_sales_customer_trgm   on public.sales using gin (customer_name gin_trgm_ops);

create trigger trg_sales_updated_at
  before update on public.sales
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- audit_logs (somente o banco escreve, via trigger SECURITY DEFINER)
-- ---------------------------------------------------------------------
create table if not exists public.audit_logs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid references public.organizations(id) on delete set null,
  actor_id         uuid,
  table_name       text not null,
  record_id        uuid not null,
  action           text not null check (action in ('insert', 'update', 'delete', 'soft_delete', 'restore')),
  old_data         jsonb,
  new_data         jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists idx_audit_org_created on public.audit_logs(organization_id, created_at desc);
create index if not exists idx_audit_record      on public.audit_logs(table_name, record_id);

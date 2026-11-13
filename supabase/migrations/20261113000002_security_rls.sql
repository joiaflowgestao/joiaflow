-- =====================================================================
-- JoiaFlow — Segurança: funções auxiliares, validações, auditoria e RLS
-- Regra de ouro: TODA autorização é verificada no banco. A interface
-- apenas esconde botões; quem decide é o PostgreSQL.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Funções auxiliares (SECURITY DEFINER para ler profiles sem recursão
-- de RLS). search_path vazio evita sequestro de objetos.
-- ---------------------------------------------------------------------
create or replace function public.current_profile()
returns public.profiles
language sql stable security definer set search_path = '' as $$
  select p.* from public.profiles p where p.id = auth.uid()
$$;

-- Usuário ativo E (admin da plataforma OU empresa ativa)
create or replace function public.is_active_user()
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.profiles p
    left join public.organizations o on o.id = p.organization_id
    where p.id = auth.uid()
      and p.active
      and (p.role = 'platform_admin' or coalesce(o.active, false))
  )
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and p.role = 'platform_admin'
  )
$$;

create or replace function public.current_org_id()
returns uuid
language sql stable security definer set search_path = '' as $$
  select p.organization_id from public.profiles p where p.id = auth.uid()
$$;

create or replace function public.current_role_name()
returns public.user_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid()
$$;

-- ---------------------------------------------------------------------
-- Validação de vendas (BEFORE INSERT/UPDATE)
-- Garante isolamento por empresa mesmo se alguém manipular a requisição.
-- ---------------------------------------------------------------------
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
        if not (v_me.can_edit_own_sales and coalesce(v_org_allows, false)) then
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

create trigger trg_sales_validate
  before insert or update on public.sales
  for each row execute function public.validate_sale();

-- ---------------------------------------------------------------------
-- Proteção de colunas sensíveis do perfil
-- Um usuário comum pode alterar apenas o próprio nome.
-- ---------------------------------------------------------------------
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.is_platform_admin() then
    return new;
  end if;
  if new.role <> old.role
     or new.organization_id is distinct from old.organization_id
     or new.active <> old.active
     or new.can_edit_own_sales <> old.can_edit_own_sales
     or new.email <> old.email
     or new.id <> old.id then
    raise exception 'Você não tem permissão para alterar estes dados.' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger trg_profiles_protect
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- ---------------------------------------------------------------------
-- Auditoria genérica (AFTER INSERT/UPDATE/DELETE)
-- ---------------------------------------------------------------------
create or replace function public.write_audit_log()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_action text;
  v_org    uuid;
  v_id     uuid;
  v_old    jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new    jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
begin
  v_action := lower(tg_op);
  if tg_op = 'UPDATE' and tg_table_name = 'sales' then
    if (v_old->>'deleted_at') is null and (v_new->>'deleted_at') is not null then
      v_action := 'soft_delete';
    elsif (v_old->>'deleted_at') is not null and (v_new->>'deleted_at') is null then
      v_action := 'restore';
    end if;
  end if;

  if tg_op = 'UPDATE' and v_old - 'updated_at' = v_new - 'updated_at' then
    return null; -- nada mudou de fato
  end if;

  v_id  := coalesce(v_new->>'id', v_old->>'id')::uuid;
  v_org := case tg_table_name
             when 'organizations' then v_id
             else coalesce(v_new->>'organization_id', v_old->>'organization_id')::uuid
           end;

  insert into public.audit_logs (organization_id, actor_id, table_name, record_id, action, old_data, new_data)
  values (v_org, auth.uid(), tg_table_name, v_id, v_action, v_old, v_new);
  return null;
end $$;

create trigger trg_sales_audit
  after insert or update or delete on public.sales
  for each row execute function public.write_audit_log();
create trigger trg_profiles_audit
  after insert or update or delete on public.profiles
  for each row execute function public.write_audit_log();
create trigger trg_organizations_audit
  after insert or update or delete on public.organizations
  for each row execute function public.write_audit_log();

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table public.organizations enable row level security;
alter table public.profiles      enable row level security;
alter table public.categories    enable row level security;
alter table public.sales         enable row level security;
alter table public.audit_logs    enable row level security;

-- Obs.: não usamos FORCE RLS de propósito. As funções SECURITY DEFINER acima
-- pertencem ao dono das tabelas e precisam ler profiles sem passar pelo RLS
-- (senão as políticas entrariam em recursão).

-- Usuários anônimos não acessam nada
revoke all on public.organizations, public.profiles, public.categories, public.sales, public.audit_logs from anon;

-- ---------------- organizations ----------------
create policy org_select on public.organizations for select to authenticated
  using (public.is_platform_admin() or (id = public.current_org_id() and public.is_active_user()));
create policy org_insert on public.organizations for insert to authenticated
  with check (public.is_platform_admin());
create policy org_update on public.organizations for update to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
-- Sem DELETE: empresas são desativadas, nunca apagadas.

-- ---------------- profiles ----------------
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or public.is_platform_admin()
    or (public.current_role_name() = 'org_admin'
        and organization_id = public.current_org_id()
        and public.is_active_user())
  );
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid()) or public.is_platform_admin())
  with check (id = (select auth.uid()) or public.is_platform_admin());
-- INSERT/DELETE de perfis: somente pela Edge Function (service_role).

-- ---------------- categories ----------------
create policy categories_select on public.categories for select to authenticated
  using (
    public.is_platform_admin()
    or (public.is_active_user() and (organization_id is null or organization_id = public.current_org_id()))
  );
create policy categories_write on public.categories for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- ---------------- sales ----------------
create policy sales_select on public.sales for select to authenticated
  using (
    public.is_platform_admin()
    or (public.is_active_user() and organization_id = public.current_org_id() and (
          public.current_role_name() = 'org_admin'
          or seller_id = (select auth.uid())
       ))
  );

create policy sales_insert on public.sales for insert to authenticated
  with check (
    public.is_platform_admin()
    or (public.is_active_user() and organization_id = public.current_org_id() and (
          public.current_role_name() = 'org_admin'
          or seller_id = (select auth.uid())
       ))
  );

create policy sales_update on public.sales for update to authenticated
  using (
    public.is_platform_admin()
    or (public.is_active_user() and organization_id = public.current_org_id() and (
          public.current_role_name() = 'org_admin'
          or seller_id = (select auth.uid())
       ))
  )
  with check (
    public.is_platform_admin()
    or (public.is_active_user() and organization_id = public.current_org_id() and (
          public.current_role_name() = 'org_admin'
          or seller_id = (select auth.uid())
       ))
  );
-- Sem DELETE físico: exclusão é lógica (deleted_at), auditada.

-- ---------------- audit_logs ----------------
create policy audit_select on public.audit_logs for select to authenticated
  using (
    public.is_platform_admin()
    or (public.current_role_name() = 'org_admin'
        and organization_id = public.current_org_id()
        and public.is_active_user())
  );
-- Sem INSERT/UPDATE/DELETE para usuários: somente o trigger escreve.

-- Funções auxiliares não precisam ser chamadas por anônimos
revoke execute on function public.current_profile(), public.is_active_user(), public.is_platform_admin(),
  public.current_org_id(), public.current_role_name() from anon, public;
grant execute on function public.current_profile(), public.is_active_user(), public.is_platform_admin(),
  public.current_org_id(), public.current_role_name() to authenticated;

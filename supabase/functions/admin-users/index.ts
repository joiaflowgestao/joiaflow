// =====================================================================
// Edge Function: admin-users
// Criação e gestão de usuários. ÚNICO lugar que usa a SERVICE_ROLE key,
// que fica somente no ambiente do Supabase (nunca no front-end/GitHub).
//
// Ações: create | update | reset_password | set_active
// Permissões:
//   platform_admin → qualquer empresa, qualquer perfil
//   org_admin      → somente vendedores da própria empresa
// =====================================================================
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

type Role = 'platform_admin' | 'org_admin' | 'seller';
type Caller = { id: string; role: Role; organization_id: string | null; active: boolean };

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '*').split(',').map((s) => s.trim());

function cors(req: Request) {
  const origin = req.headers.get('Origin') ?? '';
  const allow = ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin) ? origin || '*' : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES: Role[] = ['platform_admin', 'org_admin', 'seller'];

function str(v: unknown, field: string, min = 1, max = 200): string {
  if (typeof v !== 'string' || v.trim().length < min || v.trim().length > max) {
    throw new HttpError(400, `Campo inválido: ${field}.`);
  }
  return v.trim();
}
/** Campo de texto opcional: vazio vira null. */
function optStr(v: unknown, field: string, max: number): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new HttpError(400, `Campo inválido: ${field}.`);
  const t = v.trim();
  if (t.length > max) throw new HttpError(400, `Campo muito longo: ${field}.`);
  return t || null;
}
function password(v: unknown): string {
  if (typeof v !== 'string' || v.length < 8 || v.length > 72) {
    throw new HttpError(400, 'A senha deve ter entre 8 e 72 caracteres.');
  }
  if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) {
    throw new HttpError(400, 'A senha deve conter letras e números.');
  }
  return v;
}
function role(v: unknown): Role {
  if (!ROLES.includes(v as Role)) throw new HttpError(400, 'Perfil de acesso inválido.');
  return v as Role;
}
function uuid(v: unknown, field: string): string {
  if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) throw new HttpError(400, `Campo inválido: ${field}.`);
  return v;
}

async function getCaller(admin: SupabaseClient, req: Request): Promise<Caller> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Não autenticado.');
  const { data: userData, error } = await admin.auth.getUser(token);
  if (error || !userData.user) throw new HttpError(401, 'Sessão inválida ou expirada.');

  const { data: profile } = await admin
    .from('profiles')
    .select('id, role, organization_id, active')
    .eq('id', userData.user.id)
    .single();
  if (!profile || !profile.active) throw new HttpError(403, 'Usuário sem permissão.');
  if (profile.role !== 'platform_admin' && profile.role !== 'org_admin') {
    throw new HttpError(403, 'Apenas administradores podem gerenciar usuários.');
  }
  return profile as Caller;
}

/** org_admin só gerencia vendedores da própria empresa. */
function assertCanManage(caller: Caller, target: { role: Role; organization_id: string | null }) {
  if (caller.role === 'platform_admin') return;
  if (target.role !== 'seller' || target.organization_id !== caller.organization_id) {
    throw new HttpError(403, 'Você só pode gerenciar vendedores da sua empresa.');
  }
}

async function loadTarget(admin: SupabaseClient, id: string) {
  const { data } = await admin.from('profiles').select('id, role, organization_id, email').eq('id', id).single();
  if (!data) throw new HttpError(404, 'Usuário não encontrado.');
  return data as { id: string; role: Role; organization_id: string | null; email: string };
}

async function assertOrgActive(admin: SupabaseClient, orgId: string) {
  const { data } = await admin.from('organizations').select('id, active').eq('id', orgId).single();
  if (!data) throw new HttpError(400, 'Empresa não encontrada.');
  if (!data.active) throw new HttpError(400, 'A empresa está desativada.');
}

Deno.serve(async (req) => {
  const headers = { ...cors(req), 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Método não permitido.' }), { status: 405, headers });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const caller = await getCaller(admin, req);
    const body = await req.json().catch(() => { throw new HttpError(400, 'JSON inválido.'); });
    const action = body?.action;

    // ------------------------------------------------------------ create
    if (action === 'create') {
      const full_name = str(body.full_name, 'nome completo', 2, 120);
      const email = str(body.email, 'e-mail', 5, 254).toLowerCase();
      if (!EMAIL_RE.test(email)) throw new HttpError(400, 'E-mail inválido.');
      const pwd = password(body.password);
      const r = role(body.role);
      const organization_id = r === 'platform_admin' && !body.organization_id ? null : uuid(body.organization_id, 'empresa');

      assertCanManage(caller, { role: r, organization_id });
      if (organization_id) await assertOrgActive(admin, organization_id);

      const { data: created, error: authErr } = await admin.auth.admin.createUser({
        email,
        password: pwd,
        email_confirm: true,
        user_metadata: { full_name },
      });
      if (authErr || !created.user) {
        const msg = /already|registered|exists/i.test(authErr?.message ?? '') ? 'Este e-mail já está cadastrado.' : 'Não foi possível criar o usuário.';
        throw new HttpError(400, msg);
      }

      const { error: profErr } = await admin.from('profiles').insert({
        id: created.user.id,
        full_name,
        email,
        role: r,
        organization_id,
        phone: optStr(body.phone, 'telefone', 30),
        address: optStr(body.address, 'endereço', 300),
        can_edit_own_sales: body.can_edit_own_sales !== false,
      });
      if (profErr) {
        await admin.auth.admin.deleteUser(created.user.id); // rollback
        throw new HttpError(400, 'Não foi possível salvar o perfil do usuário.');
      }
      return new Response(JSON.stringify({ id: created.user.id }), { status: 201, headers });
    }

    // ------------------------------------------------------------ update
    if (action === 'update') {
      const id = uuid(body.id, 'usuário');
      const target = await loadTarget(admin, id);
      assertCanManage(caller, target);

      const patch: Record<string, unknown> = {};
      if (body.full_name !== undefined) patch.full_name = str(body.full_name, 'nome completo', 2, 120);
      if (body.phone !== undefined) patch.phone = optStr(body.phone, 'telefone', 30);
      if (body.address !== undefined) patch.address = optStr(body.address, 'endereço', 300);
      if (body.can_edit_own_sales !== undefined) patch.can_edit_own_sales = Boolean(body.can_edit_own_sales);
      if (body.role !== undefined) {
        const r = role(body.role);
        if (caller.role !== 'platform_admin' && r !== 'seller') throw new HttpError(403, 'Perfil não permitido.');
        patch.role = r;
      }
      if (body.organization_id !== undefined) {
        if (caller.role !== 'platform_admin') throw new HttpError(403, 'Somente o administrador da plataforma pode trocar a empresa.');
        const orgId = body.organization_id === null ? null : uuid(body.organization_id, 'empresa');
        if (orgId) await assertOrgActive(admin, orgId);
        patch.organization_id = orgId;
      }
      if (id === caller.id && (patch.role || 'organization_id' in patch)) {
        throw new HttpError(400, 'Você não pode alterar o próprio perfil de acesso.');
      }
      if (body.email !== undefined) {
        const email = str(body.email, 'e-mail', 5, 254).toLowerCase();
        if (!EMAIL_RE.test(email)) throw new HttpError(400, 'E-mail inválido.');
        const { error } = await admin.auth.admin.updateUserById(id, { email, email_confirm: true });
        if (error) throw new HttpError(400, 'Não foi possível alterar o e-mail.');
        patch.email = email;
      }

      const { error } = await admin.from('profiles').update(patch).eq('id', id);
      if (error) throw new HttpError(400, 'Não foi possível atualizar o usuário.');
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    // ---------------------------------------------------- reset_password
    if (action === 'reset_password') {
      const id = uuid(body.id, 'usuário');
      const target = await loadTarget(admin, id);
      assertCanManage(caller, target);
      const { error } = await admin.auth.admin.updateUserById(id, { password: password(body.password) });
      if (error) throw new HttpError(400, 'Não foi possível redefinir a senha.');
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    // -------------------------------------------------------- set_active
    if (action === 'set_active') {
      const id = uuid(body.id, 'usuário');
      if (id === caller.id) throw new HttpError(400, 'Você não pode desativar a si mesmo.');
      const target = await loadTarget(admin, id);
      assertCanManage(caller, target);
      const active = Boolean(body.active);

      const { error } = await admin.from('profiles').update({ active }).eq('id', id);
      if (error) throw new HttpError(400, 'Não foi possível alterar o status.');
      // Bloqueia o login no Auth também (ban longo) e derruba sessões ativas
      await admin.auth.admin.updateUserById(id, { ban_duration: active ? 'none' : '876000h' });
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    throw new HttpError(400, 'Ação desconhecida.');
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof HttpError ? e.message : 'Erro interno.';
    if (!(e instanceof HttpError)) console.error(e);
    return new Response(JSON.stringify({ error: message }), { status, headers });
  }
});

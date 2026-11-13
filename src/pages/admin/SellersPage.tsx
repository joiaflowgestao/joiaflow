import { Building2, Eye, EyeOff, KeyRound, Mail, MapPin, Pencil, Phone, Plus, Power, Search, UserRound } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Field';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganizations, useProfiles } from '@/hooks/useData';
import { cn } from '@/lib/cn';
import { validatePassword } from '@/lib/password';
import { maskPhone, slugify } from '@/lib/phone';
import { callAdminUsers, friendlyError, supabase } from '@/lib/supabase';
import { ROLE_LABELS, type Organization, type Profile, type UserRole } from '@/types/database';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Primeiro acesso: cadastra a empresa à qual os vendedores serão vinculados. */
function FirstOrganization({ onCreated }: { onCreated: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim().replace(/\s+/g, ' ');
    if (n.length < 2) return setError('Informe o nome da empresa.');
    setSaving(true);
    let slug = slugify(n);
    let { error } = await supabase.from('organizations').insert({ name: n, slug });
    if (error && /duplicate|unique/i.test(error.message)) {
      slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
      ({ error } = await supabase.from('organizations').insert({ name: n, slug }));
    }
    setSaving(false);
    if (error) return setError(friendlyError(error));
    toast.success('Empresa cadastrada.');
    onCreated();
  }
  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader title="Antes de começar" subtitle="Informe o nome da sua empresa. Os vendedores serão vinculados a ela." />
      <CardBody>
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert kind="error">{error}</Alert>}
          <Input label="Nome da empresa" value={name} onChange={(e) => setName(e.target.value)} leading={<Building2 className="h-4 w-4" />} autoFocus />
          <Button type="submit" loading={saving}>Salvar e continuar</Button>
        </form>
      </CardBody>
    </Card>
  );
}

interface FormState {
  full_name: string; phone: string; address: string; email: string; password: string;
  organization_id: string; role: UserRole; can_edit_own_sales: boolean;
}

function UserForm({ initial, orgs, onDone, onCancel }: { initial?: Profile; orgs: Organization[]; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const { isPlatformAdmin } = useAuth();
  const [f, setF] = useState<FormState>({
    full_name: initial?.full_name ?? '',
    phone: initial?.phone ?? '',
    address: initial?.address ?? '',
    email: initial?.email ?? '',
    password: '',
    organization_id: initial?.organization_id ?? (orgs.length === 1 ? orgs[0].id : ''),
    role: initial?.role ?? 'seller',
    can_edit_own_sales: initial?.can_edit_own_sales ?? true,
  });
  const [showPwd, setShowPwd] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (p: Partial<FormState>) => setF((s) => ({ ...s, ...p }));
  const editingAdmin = initial?.role === 'platform_admin';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const er: Record<string, string> = {};
    if (f.full_name.trim().length < 2) er.full_name = 'Informe o nome completo.';
    if (!EMAIL_RE.test(f.email.trim())) er.email = 'E-mail inválido.';
    if (f.phone && f.phone.replace(/\D/g, '').length < 10) er.phone = 'Telefone incompleto.';
    if (!initial) { const pe = validatePassword(f.password); if (pe) er.password = pe; }
    if (!editingAdmin && !f.organization_id) er.organization_id = 'Escolha a empresa.';
    setErrors(er);
    if (Object.keys(er).length) return;

    setSaving(true);
    try {
      const common = {
        full_name: f.full_name.trim().replace(/\s+/g, ' '),
        phone: f.phone || null,
        address: f.address.trim() || null,
        can_edit_own_sales: f.can_edit_own_sales,
      };
      if (initial) {
        await callAdminUsers({
          action: 'update', id: initial.id, ...common,
          ...(f.email.trim().toLowerCase() !== initial.email ? { email: f.email.trim() } : {}),
          ...(!editingAdmin && f.role !== initial.role ? { role: f.role } : {}),
          ...(!editingAdmin && isPlatformAdmin && f.organization_id !== initial.organization_id ? { organization_id: f.organization_id } : {}),
        });
        toast.success('Cadastro atualizado.');
      } else {
        await callAdminUsers({ action: 'create', ...common, email: f.email.trim(), password: f.password, role: f.role, organization_id: f.organization_id });
        toast.success('Vendedor cadastrado! Ele já pode entrar com o e-mail e a senha informados.');
      }
      onDone();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {formError && <Alert kind="error">{formError}</Alert>}
      <Input label="Nome completo" value={f.full_name} onChange={(e) => set({ full_name: e.target.value })} error={errors.full_name} leading={<UserRound className="h-4 w-4" />} autoFocus={!initial} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Telefone" inputMode="tel" value={f.phone} onChange={(e) => set({ phone: maskPhone(e.target.value) })} error={errors.phone} leading={<Phone className="h-4 w-4" />} placeholder="(00) 00000-0000" />
        <Input label="E-mail (login)" type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} error={errors.email} leading={<Mail className="h-4 w-4" />} autoComplete="off" />
      </div>
      <Input label="Endereço" value={f.address} onChange={(e) => set({ address: e.target.value })} leading={<MapPin className="h-4 w-4" />} placeholder="Rua, número, bairro, cidade" maxLength={300} />
      {!initial && (
        <div className="relative">
          <Input label="Senha inicial" type={showPwd ? 'text' : 'password'} value={f.password} onChange={(e) => set({ password: e.target.value })} error={errors.password}
            hint="Mínimo 8 caracteres, com letras e números. Informe ao vendedor." autoComplete="new-password" className="pr-11" />
          <button type="button" onClick={() => setShowPwd((v) => !v)} className="absolute right-3 top-[34px] p-1 text-navy/45 hover:text-navy" aria-label={showPwd ? 'Ocultar senha' : 'Mostrar senha'}>
            {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      )}
      {!editingAdmin && (
        <div className="grid gap-4 sm:grid-cols-2">
          {orgs.length > 1 || (initial && isPlatformAdmin) ? (
            <Select label="Empresa" value={f.organization_id} onChange={(e) => set({ organization_id: e.target.value })} error={errors.organization_id}>
              <option value="">Selecione…</option>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          ) : (
            <Input label="Empresa" value={orgs[0]?.name ?? ''} disabled />
          )}
          <Select label="Perfil de acesso" value={f.role} onChange={(e) => set({ role: e.target.value as UserRole })}>
            <option value="seller">{ROLE_LABELS.seller}</option>
            {isPlatformAdmin && <option value="org_admin">{ROLE_LABELS.org_admin}</option>}
          </Select>
        </div>
      )}
      {!editingAdmin && f.role === 'seller' && (
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-navy/10 px-3.5 py-3 text-sm text-navy">
          <input type="checkbox" checked={f.can_edit_own_sales} onChange={(e) => set({ can_edit_own_sales: e.target.checked })} className="h-4 w-4 accent-[#21165F]" />
          Pode editar as próprias vendas
        </label>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" loading={saving}>{initial ? 'Salvar' : 'Cadastrar vendedor'}</Button>
      </div>
    </form>
  );
}

function ResetPasswordForm({ user, onDone, onCancel }: { user: Profile; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [pwd, setPwd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = validatePassword(pwd);
    if (v) return setError(v);
    setSaving(true);
    try {
      await callAdminUsers({ action: 'reset_password', id: user.id, password: pwd });
      toast.success(`Nova senha definida para ${user.full_name}.`);
      onDone();
    } catch (err) { setError((err as Error).message); } finally { setSaving(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-navy/70">Defina uma nova senha para <strong>{user.full_name}</strong> e informe a ele(a).</p>
      {error && <Alert kind="error">{error}</Alert>}
      <Input label="Nova senha" type="text" value={pwd} onChange={(e) => setPwd(e.target.value)} hint="Mínimo 8 caracteres, com letras e números." autoComplete="off" autoFocus />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" loading={saving}>Redefinir senha</Button>
      </div>
    </form>
  );
}

export function SellersPage() {
  const { profile: me } = useAuth();
  const toast = useToast();
  const profiles = useProfiles();
  const orgs = useOrganizations();
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [resetting, setResetting] = useState<Profile | null>(null);
  const [toggling, setToggling] = useState<Profile | null>(null);
  const [toggleBusy, setToggleBusy] = useState(false);

  const orgName = (id: string | null) => orgs.data.find((o) => o.id === id)?.name ?? '—';
  const list = useMemo(() => {
    const t = search.trim().toLowerCase();
    return profiles.data
      .filter((p) => showInactive || p.active)
      .filter((p) => !t || p.full_name.toLowerCase().includes(t) || p.email.toLowerCase().includes(t) || (p.phone ?? '').includes(t));
  }, [profiles.data, search, showInactive]);

  async function toggleActive() {
    if (!toggling) return;
    setToggleBusy(true);
    try {
      await callAdminUsers({ action: 'set_active', id: toggling.id, active: !toggling.active });
      toast.success(toggling.active ? 'Usuário desativado. Ele não consegue mais entrar.' : 'Usuário reativado.');
      setToggling(null);
      profiles.reload();
    } catch (err) { toast.error((err as Error).message); } finally { setToggleBusy(false); }
  }

  if (profiles.loading || orgs.loading) return <div className="flex justify-center py-20 text-gold-500"><Spinner className="h-7 w-7" /></div>;

  if (orgs.data.length === 0) {
    return (
      <>
        <PageHeader title="Vendedores" />
        <FirstOrganization onCreated={orgs.reload} />
      </>
    );
  }

  const done = () => { setCreating(false); setEditing(null); setResetting(null); profiles.reload(); };

  return (
    <>
      <PageHeader
        title="Vendedores"
        subtitle={`${profiles.data.filter((p) => p.active && p.role !== 'platform_admin').length} vendedor(es) ativo(s)`}
        actions={<Button variant="gold" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Novo vendedor</Button>}
      />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome, e-mail ou telefone" leading={<Search className="h-4 w-4" />} /></div>
        <label className="flex items-center gap-2 text-sm text-navy/70">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="h-4 w-4 accent-[#21165F]" /> Mostrar desativados
        </label>
      </div>

      {profiles.error && <Alert kind="error" className="mb-4">{profiles.error}</Alert>}

      <div className="grid gap-4 md:grid-cols-2">
        {list.map((p) => (
          <Card key={p.id} className={cn('min-w-0', !p.active && 'opacity-60')}>
            <CardBody className="pt-5 sm:pt-5">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-navy font-semibold text-gold-300">
                  {p.full_name.split(/\s+/).slice(0, 2).map((x) => x[0]?.toUpperCase()).join('')}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium text-navy">{p.full_name}</p>
                    <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                      p.role === 'seller' ? 'border-navy/10 bg-navy/5 text-navy/60' : 'border-gold-300 bg-gold-50 text-gold-600')}>
                      {ROLE_LABELS[p.role]}
                    </span>
                    {!p.active && <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">Desativado</span>}
                  </div>
                  <div className="mt-1.5 space-y-0.5 text-sm text-navy/60">
                    <p className="flex items-center gap-2 truncate"><Mail className="h-3.5 w-3.5 shrink-0" />{p.email}</p>
                    {p.phone && <p className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 shrink-0" />{p.phone}</p>}
                    {p.address && <p className="flex items-center gap-2 truncate"><MapPin className="h-3.5 w-3.5 shrink-0" />{p.address}</p>}
                    {p.organization_id && <p className="flex items-center gap-2 truncate"><Building2 className="h-3.5 w-3.5 shrink-0" />{orgName(p.organization_id)}</p>}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-1 border-t border-navy/[0.06] pt-3">
                <Button size="sm" variant="ghost" onClick={() => setEditing(p)}><Pencil className="h-3.5 w-3.5" /> Editar</Button>
                <Button size="sm" variant="ghost" onClick={() => setResetting(p)}><KeyRound className="h-3.5 w-3.5" /> Redefinir senha</Button>
                {p.id !== me?.id && (
                  <Button size="sm" variant="ghost" className={p.active ? 'text-red-700 hover:bg-red-50' : ''} onClick={() => setToggling(p)}>
                    <Power className="h-3.5 w-3.5" /> {p.active ? 'Desativar' : 'Reativar'}
                  </Button>
                )}
              </div>
            </CardBody>
          </Card>
        ))}
        {list.length === 0 && <p className="py-10 text-center text-navy/50 md:col-span-2">Nenhum usuário encontrado.</p>}
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="Novo vendedor" size="lg">
        <UserForm orgs={orgs.data} onDone={done} onCancel={() => setCreating(false)} />
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Editar cadastro" size="lg">
        {editing && <UserForm initial={editing} orgs={orgs.data} onDone={done} onCancel={() => setEditing(null)} />}
      </Modal>
      <Modal open={!!resetting} onClose={() => setResetting(null)} title="Redefinir senha" size="sm">
        {resetting && <ResetPasswordForm user={resetting} onDone={done} onCancel={() => setResetting(null)} />}
      </Modal>
      <ConfirmDialog
        open={!!toggling}
        title={toggling?.active ? 'Desativar usuário' : 'Reativar usuário'}
        danger={toggling?.active}
        loading={toggleBusy}
        confirmLabel={toggling?.active ? 'Desativar' : 'Reativar'}
        message={toggling && (toggling.active
          ? <><strong>{toggling.full_name}</strong> não conseguirá mais entrar no sistema. As vendas dele(a) continuam nos relatórios.</>
          : <><strong>{toggling.full_name}</strong> voltará a ter acesso ao sistema.</>)}
        onConfirm={toggleActive}
        onCancel={() => setToggling(null)}
      />
    </>
  );
}

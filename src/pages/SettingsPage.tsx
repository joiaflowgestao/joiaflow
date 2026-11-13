import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { validatePassword } from '@/lib/password';
import { friendlyError, supabase } from '@/lib/supabase';
import { ROLE_LABELS } from '@/types/database';

export function SettingsPage() {
  const { profile, organization, refreshProfile } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(profile?.full_name ?? '');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const [current, setCurrent] = useState('');
  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [savingPwd, setSavingPwd] = useState(false);

  if (!profile) return null;

  async function saveName(e: FormEvent) {
    e.preventDefault();
    setNameError(null);
    const n = name.trim().replace(/\s+/g, ' ');
    if (n.length < 2 || n.length > 120) return setNameError('Informe um nome entre 2 e 120 caracteres.');
    setSavingName(true);
    const { error } = await supabase.from('profiles').update({ full_name: n }).eq('id', profile!.id);
    setSavingName(false);
    if (error) return setNameError(friendlyError(error));
    await refreshProfile();
    toast.success('Dados atualizados.');
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    setPwdError(null);
    const v = validatePassword(pwd);
    if (v) return setPwdError(v);
    if (pwd !== confirm) return setPwdError('As senhas não conferem.');
    setSavingPwd(true);
    // Confirma a senha atual antes de trocar
    const { error: authErr } = await supabase.auth.signInWithPassword({ email: profile!.email, password: current });
    if (authErr) { setSavingPwd(false); return setPwdError('Senha atual incorreta.'); }
    const { error } = await supabase.auth.updateUser({ password: pwd });
    setSavingPwd(false);
    if (error) return setPwdError(friendlyError(error));
    setCurrent(''); setPwd(''); setConfirm('');
    toast.success('Senha alterada com sucesso.');
  }

  return (
    <>
      <PageHeader title="Configurações" subtitle="Seus dados de acesso." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Meu perfil" subtitle={`${ROLE_LABELS[profile.role]}${organization ? ` · ${organization.name}` : ''}`} />
          <CardBody>
            <form onSubmit={saveName} className="space-y-4">
              {nameError && <Alert kind="error">{nameError}</Alert>}
              <Input label="Nome completo" value={name} onChange={(e) => setName(e.target.value)} />
              <Input label="E-mail" value={profile.email} disabled hint="Para alterar o e-mail, fale com o administrador." />
              <Button type="submit" loading={savingName}>Salvar</Button>
            </form>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Alterar senha" />
          <CardBody>
            <form onSubmit={savePassword} className="space-y-4">
              {pwdError && <Alert kind="error">{pwdError}</Alert>}
              <Input label="Senha atual" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
              <Input label="Nova senha" type="password" autoComplete="new-password" value={pwd} onChange={(e) => setPwd(e.target.value)} hint="Mínimo 8 caracteres, com letras e números." />
              <Input label="Confirmar nova senha" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              <Button type="submit" loading={savingPwd}>Alterar senha</Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

import { Lock } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { validatePassword } from '@/lib/password';
import { friendlyError, supabase } from '@/lib/supabase';
import { AuthShell } from './AuthShell';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [ready, setReady] = useState<'checking' | 'ok' | 'invalid'>('checking');
  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // O link de recuperação (PKCE) gera uma sessão temporária ao abrir a página.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) setReady('ok');
    });
    const t = setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      setReady((r) => (r === 'ok' || data.session ? 'ok' : 'invalid'));
    }, 1500);
    return () => { sub.subscription.unsubscribe(); clearTimeout(t); };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const v = validatePassword(pwd);
    if (v) return setError(v);
    if (pwd !== confirm) return setError('As senhas não conferem.');
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: pwd });
    setLoading(false);
    if (error) return setError(friendlyError(error));
    toast.success('Senha alterada com sucesso.');
    navigate('/', { replace: true });
  }

  return (
    <AuthShell title="Nova senha" subtitle="Crie uma senha com pelo menos 8 caracteres, letras e números.">
      {ready === 'checking' && <div className="flex justify-center py-8 text-gold-500"><Spinner className="h-7 w-7" /></div>}
      {ready === 'invalid' && (
        <div className="space-y-5">
          <Alert kind="error">Link inválido ou expirado. Solicite um novo link de recuperação.</Alert>
          <Link to="/esqueci-senha" className="block text-center text-sm text-navy/60 hover:text-navy">Solicitar novo link</Link>
        </div>
      )}
      {ready === 'ok' && (
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          {error && <Alert kind="error">{error}</Alert>}
          <Input label="Nova senha" type="password" autoComplete="new-password" value={pwd} onChange={(e) => setPwd(e.target.value)} leading={<Lock className="h-4 w-4" />} />
          <Input label="Confirmar senha" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} leading={<Lock className="h-4 w-4" />} />
          <Button type="submit" size="lg" className="w-full" loading={loading}>Salvar nova senha</Button>
        </form>
      )}
    </AuthShell>
  );
}

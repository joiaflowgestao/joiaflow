import { Lock, Mail } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { useAuth } from '@/contexts/AuthContext';
import { AuthShell } from './AuthShell';

export function LoginPage() {
  const { signIn, blockedReason } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email || !password) return setError('Informe e-mail e senha.');
    setLoading(true);
    try {
      await signIn(email, password);
      const from = (location.state as { from?: string } | null)?.from ?? '/';
      navigate(from, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title="Bem-vindo(a)" subtitle="Entre com o acesso fornecido pelo administrador.">
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {(error || blockedReason) && <Alert kind="error">{error ?? blockedReason}</Alert>}
        <Input label="E-mail" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} leading={<Mail className="h-4 w-4" />} placeholder="voce@empresa.com" />
        <Input label="Senha" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} leading={<Lock className="h-4 w-4" />} placeholder="••••••••" />
        <Button type="submit" size="lg" className="w-full" loading={loading}>Entrar</Button>
        <p className="text-center text-sm">
          <Link to="/esqueci-senha" className="text-navy/60 underline-offset-4 hover:text-navy hover:underline">Esqueci minha senha</Link>
        </p>
      </form>
    </AuthShell>
  );
}

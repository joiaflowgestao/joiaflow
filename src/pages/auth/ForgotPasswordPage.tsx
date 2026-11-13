import { Mail } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { friendlyError, supabase } from '@/lib/supabase';
import { AuthShell } from './AuthShell';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Informe um e-mail válido.');
    setLoading(true);
    const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}redefinir-senha`;
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo });
    setLoading(false);
    // Por segurança, a resposta é a mesma exista ou não a conta.
    if (error && /rate limit/i.test(error.message)) return setError(friendlyError(error));
    setSent(true);
  }

  return (
    <AuthShell title="Recuperar acesso" subtitle="Enviaremos um link seguro para você criar uma nova senha.">
      {sent ? (
        <div className="space-y-5">
          <Alert kind="success">Se este e-mail estiver cadastrado, você receberá o link em instantes. Confira também a caixa de spam.</Alert>
          <Link to="/login" className="block text-center text-sm text-navy/60 hover:text-navy">Voltar ao login</Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          {error && <Alert kind="error">{error}</Alert>}
          <Input label="E-mail" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} leading={<Mail className="h-4 w-4" />} />
          <Button type="submit" size="lg" className="w-full" loading={loading}>Enviar link</Button>
          <Link to="/login" className="block text-center text-sm text-navy/60 hover:text-navy">Voltar ao login</Link>
        </form>
      )}
    </AuthShell>
  );
}

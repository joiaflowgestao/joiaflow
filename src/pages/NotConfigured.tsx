import { Logo } from '@/components/ui/Logo';

export function NotConfigured() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ivory p-6">
      <div className="max-w-lg rounded-xl border border-gold-200 bg-white p-8 shadow-card">
        <Logo />
        <h1 className="mt-6 font-display text-2xl text-navy">Configuração pendente</h1>
        <p className="mt-2 text-sm text-navy/65">
          As variáveis <code className="rounded bg-ivory px-1">VITE_SUPABASE_URL</code> e{' '}
          <code className="rounded bg-ivory px-1">VITE_SUPABASE_ANON_KEY</code> não foram definidas.
          Copie <code className="rounded bg-ivory px-1">.env.example</code> para <code className="rounded bg-ivory px-1">.env.local</code> e preencha
          (ou configure os secrets no GitHub Actions).
        </p>
      </div>
    </div>
  );
}

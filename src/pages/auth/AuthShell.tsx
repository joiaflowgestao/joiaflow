import type { ReactNode } from 'react';
import { Logo } from '@/components/ui/Logo';

/** Moldura elegante das telas de acesso (login, recuperação). */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-navy">
      <div className="relative hidden flex-1 overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-14 bg-[radial-gradient(ellipse_at_bottom_left,_#21165F_0%,_#0D0737_65%)]">
        <Logo light />
        <div>
          <div className="mb-6 h-px w-24 bg-gold-400" />
          <p className="max-w-md font-display text-5xl font-medium leading-tight text-ivory">
            Cada venda, <span className="italic text-gold-400">uma joia</span> bem registrada.
          </p>
          <p className="mt-5 max-w-sm text-ivory/55">Gestão de vendas de semijoias com segurança, clareza e elegância.</p>
        </div>
        <p className="text-xs uppercase tracking-[0.25em] text-ivory/30">Acesso restrito</p>
        <div className="pointer-events-none absolute -right-32 top-1/3 h-96 w-96 rounded-full border border-gold-400/10" />
        <div className="pointer-events-none absolute -right-16 top-1/3 h-96 w-96 rounded-full border border-gold-400/10" />
      </div>
      <div className="flex w-full flex-col justify-center bg-ivory px-6 py-12 sm:px-12 lg:max-w-xl">
        <div className="mx-auto w-full max-w-sm">
          <Logo className="mb-10 lg:hidden" />
          <h1 className="font-display text-4xl font-semibold text-navy">{title}</h1>
          {subtitle && <p className="mt-2 text-navy/55">{subtitle}</p>}
          <div className="mb-8 mt-4 h-0.5 w-12 rounded bg-gold-400" />
          {children}
        </div>
      </div>
    </div>
  );
}

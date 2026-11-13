import type { ReactNode } from 'react';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-3xl font-semibold text-navy sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-navy/55">{subtitle}</p>}
        <div className="mt-3 h-0.5 w-12 rounded bg-gold-400" />
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

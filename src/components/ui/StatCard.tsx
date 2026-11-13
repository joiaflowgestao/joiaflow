import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function StatCard({ label, value, hint, icon: Icon, highlight }: { label: string; value: ReactNode; hint?: ReactNode; icon: LucideIcon; highlight?: boolean }) {
  return (
    <div className={cn(
      'relative overflow-hidden rounded-xl border p-4 shadow-card sm:p-5',
      highlight ? 'border-navy bg-navy text-ivory bg-[radial-gradient(ellipse_at_top_right,_#21165F_0%,_#0D0737_70%)]' : 'border-navy/[0.06] bg-white',
    )}>
      <div className="flex items-start justify-between gap-2">
        <p className={cn('text-[11px] font-semibold uppercase tracking-wider', highlight ? 'text-gold-300' : 'text-navy/50')}>{label}</p>
        <Icon className={cn('h-4 w-4', highlight ? 'text-gold-400' : 'text-gold-500')} />
      </div>
      <p className={cn('mt-2 truncate font-display text-2xl font-semibold sm:text-3xl', highlight ? 'text-ivory' : 'text-navy')}>{value}</p>
      {hint && <p className={cn('mt-1 truncate text-xs', highlight ? 'text-ivory/60' : 'text-navy/50')}>{hint}</p>}
    </div>
  );
}

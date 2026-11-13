import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

const styles = {
  error: { box: 'border-red-200 bg-red-50 text-red-800', Icon: AlertCircle },
  success: { box: 'border-emerald-200 bg-emerald-50 text-emerald-800', Icon: CheckCircle2 },
  info: { box: 'border-gold-200 bg-gold-50 text-navy', Icon: Info },
};

export function Alert({ kind = 'info', children, className }: { kind?: keyof typeof styles; children: ReactNode; className?: string }) {
  const { box, Icon } = styles[kind];
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={cn('flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm', box, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

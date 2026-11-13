import { cn } from '@/lib/cn';

/** Marca tipográfica do sistema (sem uso do logotipo da empresa). */
export function Logo({ className, light = false }: { className?: string; light?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden>
        <path d="M8 12h16l-8 13z" fill="none" stroke="#B8A66A" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M8 12l3.5-5h9L24 12M13 12l3 13 3-13" fill="none" stroke="#B8A66A" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
      <span className={cn('font-display text-2xl font-semibold tracking-wide', light ? 'text-ivory' : 'text-navy')}>
        Joia<span className="text-gold-400">Flow</span>
      </span>
    </div>
  );
}

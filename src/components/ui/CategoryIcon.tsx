import { Gem } from 'lucide-react';

/** Ícones de linha fina, desenhados para cada categoria de semijoia. */
const paths: Record<string, JSX.Element> = {
  anel: (<><circle cx="12" cy="14.5" r="6" /><path d="M9.5 6.5 12 3l2.5 3.5L12 9z" /></>),
  bracelete: (<><ellipse cx="12" cy="12" rx="9" ry="5" /><ellipse cx="12" cy="12" rx="6.2" ry="2.8" /></>),
  brinco: (<><path d="M12 2.5a2 2 0 0 1 2 2c0 1.3-2 2-2 3.5" /><path d="M12 8v2" /><path d="M12 10l-3.5 5.5a4 4 0 0 0 7 0z" /></>),
  conjunto: (<><path d="M4 4c0 6 3.6 9 8 9s8-3 8-9" /><path d="M12 13v2" /><path d="M10.5 15.5 12 18l1.5-2.5L12 15z" /><circle cx="4" cy="19" r="1.6" /><circle cx="20" cy="19" r="1.6" /></>),
  cordao: (<><path d="M3 3c0 7.5 4 12 9 12s9-4.5 9-12" strokeDasharray="1.6 1.6" /><path d="M12 15v1.5" /><circle cx="12" cy="19" r="2.4" /></>),
  pulseira: (<><circle cx="12" cy="11" r="7" strokeDasharray="2.2 1.6" /><path d="M12 18v1.2" /><path d="M12 19.2l-1.6 2.3h3.2z" /></>),
  tornozeleira: (<><path d="M9 2.5v8.5c0 1.6-1 2.6-2.4 3.6C5.2 15.6 4.5 17 4.5 18.5c0 1.2.8 2 2 2h11c1.1 0 1.6-1.4.6-2.1L14.5 16V2.5" /><ellipse cx="11.75" cy="10.5" rx="3.6" ry="1.3" strokeDasharray="1.6 1.2" /><path d="M11.75 11.8v1" /><circle cx="11.75" cy="13.6" r=".8" /></>),
  escapulario: (<><path d="M5 3c0 5 3 8 7 8s7-3 7-8" /><path d="M7 9.5v5M17 9.5v5" /><rect x="4.5" y="14.5" width="5" height="6" rx="1" /><rect x="14.5" y="14.5" width="5" height="6" rx="1" /></>),
};

export function CategoryIcon({ slug, className }: { slug: string; className?: string }) {
  const p = paths[slug];
  if (!p) return <Gem className={className} />;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {p}
    </svg>
  );
}

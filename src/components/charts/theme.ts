import { formatCents } from '@/lib/money';

export const CHART = {
  navy: '#0D0737',
  royal: '#21165F',
  gold: '#B8A66A',
  goldLight: '#DFD3AA',
  grid: 'rgba(13,7,55,0.07)',
  axis: 'rgba(13,7,55,0.45)',
  palette: ['#21165F', '#B8A66A', '#4B3FA0', '#8C7A45', '#7C72C8', '#D9CB98'],
};

/** R$ compacto para eixos: R$ 1,2 mil */
export function compactBRL(cents: number) {
  const v = cents / 100;
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (v >= 1_000) return `R$ ${(v / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
}

export const tooltipStyle = {
  contentStyle: { borderRadius: 12, border: '1px solid rgba(184,166,106,0.4)', boxShadow: '0 4px 16px rgba(13,7,55,0.08)', fontSize: 13 },
  labelStyle: { color: '#0D0737', fontWeight: 600 },
  formatter: (v: unknown) => [formatCents(Number(v) || 0), 'Total'] as [string, string],
};

import { commissionOf } from '@/lib/money';
import type { Exchange, Organization, SaleWithRelations } from '@/types/database';

export interface CommissionRow {
  date: string;             // ISO (data da venda ou da troca)
  kind: 'venda' | 'troca';
  customer: string;
  seller: string;
  value_cents: number;      // valor que conta no período
  percent: number;
  commission_cents: number;
  note?: string;
}

/**
 * Comissão venda a venda (mesma regra do banco):
 * - venda: conta no período em que foi feita, pelo valor original (sem as trocas);
 * - troca: conta no período em que foi feita, pela diferença.
 */
export function buildCommissionRows(sales: SaleWithRelations[], exchanges: Exchange[], orgs: Pick<Organization, 'id' | 'commission_percent'>[]): CommissionRow[] {
  const pctOf = (orgId?: string) => Number(orgs.find((o) => o.id === orgId)?.commission_percent ?? 30);
  const rows: CommissionRow[] = [];
  for (const s of sales) {
    const value = s.total_cents - (s.exchange_delta_cents ?? 0);
    const pct = pctOf(s.organization_id);
    rows.push({
      date: s.sold_at, kind: 'venda', customer: s.customer_name, seller: s.seller?.full_name ?? '',
      value_cents: value, percent: pct, commission_cents: commissionOf(value, pct),
      note: s.exchange_delta_cents ? 'Valor original (a troca conta na data da troca)' : undefined,
    });
  }
  for (const x of exchanges) {
    const pct = pctOf(x.organization_id);
    rows.push({
      date: x.created_at, kind: 'troca', customer: x.sale?.customer_name ?? '', seller: x.sale?.seller?.full_name ?? '',
      value_cents: x.difference_cents, percent: pct, commission_cents: commissionOf(x.difference_cents, pct),
      note: x.sale?.sold_at ? `Troca da venda de ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date(x.sale.sold_at))}` : 'Troca',
    });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

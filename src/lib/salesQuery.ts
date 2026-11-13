import { dateSpan, monthRange, yearRange } from '@/lib/datetime';
import { supabase } from '@/lib/supabase';
import type { SaleWithRelations } from '@/types/database';

export interface SalesFilters {
  from?: string;   // AAAA-MM-DD (tem prioridade sobre mês/ano)
  to?: string;
  month?: number;  // 1-12 (0/undefined = todos)
  year?: number;
  categoryId?: string;
  sellerId?: string;
  orgId?: string;
  search?: string;
}

export const SALES_SELECT =
  '*, category:categories(name, slug), seller:profiles!sales_seller_id_fkey(full_name), organization:organizations(name), installment_rows:installments(id, paid_at, due_date)';

/** Intervalo efetivo (sempre pela data da venda, sold_at). */
export function filtersRange(f: SalesFilters): { start: string; end: string } | null {
  if (f.from || f.to) return dateSpan(f.from || '2000-01-01', f.to || '2100-12-31');
  if (f.year && f.month) return monthRange(f.year, f.month);
  if (f.year) return yearRange(f.year);
  return null;
}

/** Escapa curingas do ILIKE digitados pelo usuário. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export function buildSalesQuery(f: SalesFilters, opts: { count?: boolean } = {}) {
  let q = supabase
    .from('sales')
    .select(SALES_SELECT, opts.count ? { count: 'exact' } : undefined)
    .is('deleted_at', null);
  const r = filtersRange(f);
  if (r) q = q.gte('sold_at', r.start).lt('sold_at', r.end);
  if (f.categoryId) q = q.eq('category_id', f.categoryId);
  if (f.sellerId) q = q.eq('seller_id', f.sellerId);
  if (f.orgId) q = q.eq('organization_id', f.orgId);
  const term = f.search?.trim();
  if (term) q = q.ilike('customer_name', `%${escapeLike(term)}%`);
  return q.order('sold_at', { ascending: false });
}

/** Busca todas as vendas do filtro (em lotes de 1000) — usado na exportação. */
export async function fetchAllSales(f: SalesFilters, max = 20000): Promise<SaleWithRelations[]> {
  const out: SaleWithRelations[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await buildSalesQuery(f).range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as unknown as SaleWithRelations[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export function paymentSummary(s: Pick<SaleWithRelations, 'installment_rows' | 'installments'>) {
  const rows = s.installment_rows ?? [];
  const paid = rows.filter((r) => r.paid_at).length;
  return { paid, total: rows.length || s.installments };
}

import { supabase } from '@/lib/supabase';
import type { Exchange, ExchangeItem } from '@/types/database';

export const EXCHANGE_SELECT =
  '*, user:profiles!exchanges_user_id_fkey(full_name), sale:sales!inner(id, customer_name, seller_id, organization_id, seller:profiles!sales_seller_id_fkey(full_name))';

/** "2x Brinco, 1x Anel" */
export const exchangeItemsLabel = (items: ExchangeItem[]) =>
  items.length ? items.map((i) => `${i.quantity}x ${i.name}`).join(', ') : '—';

/** Trocas de um período (data da troca), com filtros de empresa/vendedor. */
export async function fetchExchanges(range: { start: string; end: string }, f: { orgId?: string; sellerId?: string } = {}) {
  let q = supabase.from('exchanges').select(EXCHANGE_SELECT)
    .gte('created_at', range.start).lt('created_at', range.end)
    .order('created_at', { ascending: false }).limit(1000);
  if (f.orgId) q = q.eq('organization_id', f.orgId);
  if (f.sellerId) q = q.eq('sale.seller_id', f.sellerId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as Exchange[];
}

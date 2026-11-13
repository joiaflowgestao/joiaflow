import { useEffect, useState } from 'react';
import { friendlyError, supabase } from '@/lib/supabase';
import type { SalesSummary } from '@/types/database';

const EMPTY: SalesSummary = { total_cents: 0, count: 0, by_category: [], by_seller: [], by_day: [] };

export function useSalesSummary(range: { start: string; end: string }, orgId?: string, sellerId?: string, refreshKey = 0) {
  const [data, setData] = useState<SalesSummary>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    supabase.rpc('sales_summary', { p_start: range.start, p_end: range.end, p_org: orgId || null, p_seller: sellerId || null })
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) setError(friendlyError(error));
        else { setError(null); setData((data as SalesSummary) ?? EMPTY); }
        setLoading(false);
      });
    return () => { alive = false; };
  }, [range.start, range.end, orgId, sellerId, refreshKey]);
  return { data, loading, error };
}

export interface MonthTotal { month: string; total_cents: number; count: number }

export function useMonthlyTotals(range: { start: string; end: string }, orgId?: string, sellerId?: string) {
  const [data, setData] = useState<MonthTotal[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    supabase.rpc('sales_by_month', { p_start: range.start, p_end: range.end, p_org: orgId || null, p_seller: sellerId || null })
      .then(({ data }) => { if (alive) { setData((data ?? []) as MonthTotal[]); setLoading(false); } });
    return () => { alive = false; };
  }, [range.start, range.end, orgId, sellerId]);
  return { data, loading };
}

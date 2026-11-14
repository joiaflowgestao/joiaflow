import { useCallback, useEffect, useState } from 'react';
import { friendlyError, supabase } from '@/lib/supabase';
import type { Kit } from '@/types/database';

/** Maletas visíveis (vendedora: as dela; admin/gestor: da empresa). */
export function useKits(sellerId?: string) {
  const [data, setData] = useState<Kit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('kits').select('*, seller:profiles!kits_seller_id_fkey(full_name)')
      .order('returned_on', { ascending: false, nullsFirst: true }).order('received_on', { ascending: false }).limit(500);
    if (sellerId) q = q.eq('seller_id', sellerId);
    const { data, error } = await q;
    if (error) setError(friendlyError(error));
    else { setError(null); setData((data ?? []) as Kit[]); }
    setLoading(false);
  }, [sellerId]);
  useEffect(() => { reload(); }, [reload]);
  return { data, loading, error, reload };
}

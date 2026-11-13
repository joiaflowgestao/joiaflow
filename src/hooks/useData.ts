import { useCallback, useEffect, useState } from 'react';
import { friendlyError, supabase } from '@/lib/supabase';
import type { Category, Organization, Profile } from '@/types/database';

interface Loadable<T> { data: T; loading: boolean; error: string | null; reload: () => Promise<void> }

function useQuery<T>(fn: () => Promise<{ data: T | null; error: unknown }>, initial: T, deps: unknown[] = []): Loadable<T> {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const reload = useCallback(async () => {
    setLoading(true);
    const { data, error } = await run();
    if (error) setError(friendlyError(error));
    else { setError(null); setData((data ?? initial) as T); }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);
  useEffect(() => { reload(); }, [reload]);
  return { data, loading, error, reload };
}

export function useCategories() {
  return useQuery<Category[]>(
    async () => await supabase.from('categories').select('*').eq('active', true).order('sort_order'),
    [],
  );
}

/** Usuários visíveis pelo RLS (admin: todos; gestor: da empresa; vendedor: só ele). */
export function useProfiles() {
  return useQuery<Profile[]>(
    async () => await supabase.from('profiles').select('*').order('full_name'),
    [],
  );
}

export function useOrganizations() {
  return useQuery<Organization[]>(
    async () => await supabase.from('organizations').select('*').order('name'),
    [],
  );
}

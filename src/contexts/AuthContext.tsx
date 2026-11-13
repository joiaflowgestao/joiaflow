import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { friendlyError, supabase } from '@/lib/supabase';
import type { Organization, Profile } from '@/types/database';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  organization: Organization | null;
  loading: boolean;
  /** Mensagem exibida no login quando a sessão foi encerrada por bloqueio */
  blockedReason: string | null;
  isPlatformAdmin: boolean;
  isAdmin: boolean; // platform_admin ou org_admin
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      setOrganization(null);
      return;
    }
    const { data: p, error } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle();
    if (error || !p) {
      setBlockedReason('Seu usuário não possui perfil configurado. Fale com o administrador.');
      await supabase.auth.signOut();
      return;
    }
    if (!p.active) {
      setBlockedReason('Seu usuário está desativado. Fale com o administrador.');
      await supabase.auth.signOut();
      return;
    }
    let org: Organization | null = null;
    if (p.organization_id) {
      const { data: o } = await supabase.from('organizations').select('*').eq('id', p.organization_id).maybeSingle();
      org = o ?? null;
      if (p.role !== 'platform_admin' && (!org || !org.active)) {
        setBlockedReason('A empresa vinculada ao seu usuário está desativada.');
        await supabase.auth.signOut();
        return;
      }
    }
    setProfile(p as Profile);
    setOrganization(org);
  }, []);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      await loadProfile(data.session);
      if (mounted) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // Evita chamadas ao Supabase dentro do callback síncrono (recomendação oficial)
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'SIGNED_OUT') {
        setTimeout(() => loadProfile(s), 0);
      }
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    setBlockedReason(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw new Error(friendlyError(error));
    setSession(data.session);
    await loadProfile(data.session);
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setOrganization(null);
  }, []);

  const value = useMemo<AuthState>(() => ({
    session,
    profile,
    organization,
    loading,
    blockedReason,
    isPlatformAdmin: profile?.role === 'platform_admin',
    isAdmin: profile?.role === 'platform_admin' || profile?.role === 'org_admin',
    signIn,
    signOut,
    refreshProfile: () => loadProfile(session),
  }), [session, profile, organization, loading, blockedReason, signIn, signOut, loadProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>');
  return ctx;
}

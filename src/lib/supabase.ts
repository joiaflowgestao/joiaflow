import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

// A anon key é pública por design. Toda a proteção dos dados está no RLS.
export const supabase = createClient(url || 'http://localhost', anonKey || 'missing', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});

/** Traduz erros comuns do Supabase/PostgREST para mensagens claras. */
export function friendlyError(err: unknown): string {
  const e = err as { message?: string; code?: string; status?: number } | null;
  const msg = e?.message ?? '';
  if (/Invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (/Email not confirmed/i.test(msg)) return 'E-mail ainda não confirmado.';
  if (/banned|User is banned/i.test(msg)) return 'Usuário desativado. Fale com o administrador.';
  if (/rate limit|too many/i.test(msg)) return 'Muitas tentativas. Aguarde alguns minutos.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Sem conexão com o servidor. Verifique sua internet.';
  if (e?.code === '42501' || /row-level security/i.test(msg)) return msg && !/row-level/i.test(msg) ? msg : 'Você não tem permissão para esta operação.';
  if (/should be different/i.test(msg)) return 'A nova senha deve ser diferente da atual.';
  return msg || 'Ocorreu um erro inesperado. Tente novamente.';
}

/** Chamada autenticada à Edge Function de administração de usuários. */
export async function callAdminUsers<T = unknown>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body: payload });
  if (error) {
    // FunctionsHttpError carrega a resposta com { error }
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      const body = await ctx.json().catch(() => null);
      if (body?.error) throw new Error(body.error);
    }
    throw new Error(friendlyError(error));
  }
  return data as T;
}

import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { FullScreenLoader } from '@/components/ui/Spinner';
import { useAuth } from '@/contexts/AuthContext';

/** Exige sessão + perfil ativo. */
export function RequireAuth() {
  const { session, profile, loading } = useAuth();
  const location = useLocation();
  if (loading || (session && !profile)) return <FullScreenLoader />;
  if (!session || !profile) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

/** Áreas administrativas. A proteção REAL está no RLS/Edge Function; isto é só UX. */
export function RequireAdmin({ platformOnly = false }: { platformOnly?: boolean }) {
  const { isAdmin, isPlatformAdmin } = useAuth();
  if (platformOnly ? !isPlatformAdmin : !isAdmin) return <Navigate to="/" replace />;
  return <Outlet />;
}

/** Páginas públicas (login): se já logado, vai para o painel. */
export function PublicOnly() {
  const { session, profile, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (session && profile) return <Navigate to="/" replace />;
  return <Outlet />;
}

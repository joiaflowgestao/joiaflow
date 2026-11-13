import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { FullScreenLoader } from '@/components/ui/Spinner';
import { ToastProvider } from '@/components/ui/Toast';
import { AuthProvider } from '@/contexts/AuthContext';
import { isSupabaseConfigured } from '@/lib/supabase';
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage';
import { LoginPage } from '@/pages/auth/LoginPage';
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage';
import { NotConfigured } from '@/pages/NotConfigured';
import { NotFound } from '@/pages/NotFound';
import { SettingsPage } from '@/pages/SettingsPage';
import { StagePending } from '@/pages/StagePending';
import { PublicOnly, RequireAdmin, RequireAuth } from '@/routes/guards';

// Páginas carregadas sob demanda (o app abre mais rápido)
const DashboardPage = lazy(() => import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const NewSalePage = lazy(() => import('@/pages/sales/NewSalePage').then((m) => ({ default: m.NewSalePage })));
const HistoryPage = lazy(() => import('@/pages/sales/HistoryPage').then((m) => ({ default: m.HistoryPage })));
const ReportsPage = lazy(() => import('@/pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const FinancePage = lazy(() => import('@/pages/FinancePage').then((m) => ({ default: m.FinancePage })));
const SellersPage = lazy(() => import('@/pages/admin/SellersPage').then((m) => ({ default: m.SellersPage })));

// basename = base path do Vite (ex.: /joiaflow/) para funcionar no GitHub Pages
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

export default function App() {
  if (!isSupabaseConfigured) return <NotConfigured />;
  return (
    <BrowserRouter basename={basename}>
      <ToastProvider>
        <AuthProvider>
          <Suspense fallback={<FullScreenLoader />}>
          <Routes>
            <Route element={<PublicOnly />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/esqueci-senha" element={<ForgotPasswordPage />} />
            </Route>
            <Route path="/redefinir-senha" element={<ResetPasswordPage />} />

            <Route element={<RequireAuth />}>
              <Route element={<AppLayout />}>
                <Route index element={<DashboardPage />} />
                <Route path="nova-venda" element={<NewSalePage />} />
                <Route path="historico" element={<HistoryPage />} />
                <Route path="relatorios" element={<ReportsPage />} />
                <Route path="lancamentos" element={<FinancePage />} />
                <Route path="configuracoes" element={<SettingsPage />} />
                <Route element={<RequireAdmin />}>
                  <Route path="vendedores" element={<SellersPage />} />
                </Route>
                <Route element={<RequireAdmin platformOnly />}>
                  <Route path="empresas" element={<StagePending title="Empresas" description="Cadastro e gestão de várias empresas na mesma plataforma." />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Route>
            </Route>
          </Routes>
          </Suspense>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

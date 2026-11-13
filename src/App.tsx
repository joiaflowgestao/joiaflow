import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
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

// basename = base path do Vite (ex.: /joiaflow/) para funcionar no GitHub Pages
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

export default function App() {
  if (!isSupabaseConfigured) return <NotConfigured />;
  return (
    <BrowserRouter basename={basename}>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route element={<PublicOnly />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/esqueci-senha" element={<ForgotPasswordPage />} />
            </Route>
            <Route path="/redefinir-senha" element={<ResetPasswordPage />} />

            <Route element={<RequireAuth />}>
              <Route element={<AppLayout />}>
                <Route index element={<StagePending title="Dashboard" stage={5} description="Indicadores do mês, gráficos de evolução e vendas por categoria." />} />
                <Route path="nova-venda" element={<StagePending title="Nova venda" stage={6} description="Lançamento rápido com seletor visual de categoria e cálculo de parcelas." />} />
                <Route path="historico" element={<StagePending title="Histórico de vendas" stage={7} description="Listagem paginada, filtros, busca por cliente, edição e exclusão auditadas." />} />
                <Route path="relatorios" element={<StagePending title="Relatórios" stage={8} description="Relatórios mensais com comparativos e exportação em PDF e Excel." />} />
                <Route path="configuracoes" element={<SettingsPage />} />
                <Route element={<RequireAdmin />}>
                  <Route path="vendedores" element={<StagePending title="Vendedores" stage={9} description="Cadastro, edição, redefinição de senha e desativação de usuários." />} />
                </Route>
                <Route element={<RequireAdmin platformOnly />}>
                  <Route path="empresas" element={<StagePending title="Empresas" stage={9} description="Cadastro e gestão das empresas (tenants)." />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Route>
            </Route>
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

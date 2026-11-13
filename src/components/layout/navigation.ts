import { BarChart3, Building2, History, LayoutDashboard, NotebookPen, PlusCircle, Settings, Users, type LucideIcon } from 'lucide-react';
import type { UserRole } from '@/types/database';

export interface NavItem {
  to: string;
  label: string;
  short: string; // rótulo curto para a barra inferior do celular
  icon: LucideIcon;
  roles?: UserRole[]; // se definido, só esses perfis veem o item
  primary?: boolean; // aparece na barra inferior do celular
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', short: 'Início', icon: LayoutDashboard, primary: true },
  { to: '/nova-venda', label: 'Nova venda', short: 'Vender', icon: PlusCircle, primary: true },
  { to: '/historico', label: 'Histórico de vendas', short: 'Histórico', icon: History, primary: true },
  { to: '/relatorios', label: 'Relatórios', short: 'Relatórios', icon: BarChart3, primary: true },
  { to: '/lancamentos', label: 'Lançamentos financeiros', short: 'Finanças', icon: NotebookPen, primary: true },
  { to: '/vendedores', label: 'Vendedores', short: 'Vendedores', icon: Users, roles: ['platform_admin', 'org_admin'] },
  { to: '/empresas', label: 'Empresas', short: 'Empresas', icon: Building2, roles: ['platform_admin'] },
  { to: '/configuracoes', label: 'Configurações', short: 'Ajustes', icon: Settings },
];

export const visibleItems = (role: UserRole | undefined) =>
  NAV_ITEMS.filter((i) => !i.roles || (role && i.roles.includes(role)));

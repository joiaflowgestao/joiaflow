// Tipos espelhando o schema do Supabase (supabase/migrations).
// Podem ser regenerados com: npx supabase gen types typescript --linked
export type UserRole = 'platform_admin' | 'org_admin' | 'seller';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
  sellers_can_edit_sales: boolean;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  organization_id: string | null;
  full_name: string;
  email: string;
  role: UserRole;
  active: boolean;
  can_edit_own_sales: boolean;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  organization_id: string | null;
  name: string;
  slug: string;
  icon: string;
  sort_order: number;
  active: boolean;
}

export interface Sale {
  id: string;
  organization_id: string;
  seller_id: string;
  category_id: string;
  customer_name: string;
  sold_at: string;
  total_cents: number;
  installments: number;
  installment_cents: number;
  installment_remainder_cents: number;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
}

export interface AuditLog {
  id: string;
  organization_id: string | null;
  actor_id: string | null;
  table_name: string;
  record_id: string;
  action: 'insert' | 'update' | 'delete' | 'soft_delete' | 'restore';
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  platform_admin: 'Administrador da plataforma',
  org_admin: 'Gestor da empresa',
  seller: 'Vendedor',
};

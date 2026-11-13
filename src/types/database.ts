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
  phone: string | null;
  address: string | null;
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
  first_due_date: string;
  upfront_paid: boolean;
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

export interface SaleItem {
  id: string;
  sale_id: string;
  category_id: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
  position: number;
  category?: Pick<Category, 'name' | 'slug'> | null;
}

export interface Installment {
  id: string;
  sale_id: string;
  organization_id: string;
  number: number;
  due_date: string; // AAAA-MM-DD
  amount_cents: number;
  paid_at: string | null;
  paid_by: string | null;
}

/** Venda com dados relacionados (para listagens). */
export interface SaleWithRelations extends Sale {
  category: Pick<Category, 'name' | 'slug'> | null;
  seller: Pick<Profile, 'full_name'> | null;
  organization: Pick<Organization, 'name'> | null;
  installment_rows?: Pick<Installment, 'id' | 'paid_at' | 'due_date'>[];
  items?: SaleItem[];
}

/** Parcela com dados da venda (para alertas de vencimento). */
export interface InstallmentWithSale extends Installment {
  sale: {
    id: string;
    customer_name: string;
    installments: number;
    seller_id: string;
    seller: Pick<Profile, 'full_name'> | null;
  };
}

export interface SummaryItem { id: string; name: string; slug?: string; total_cents: number; count: number }
export interface SalesSummary {
  total_cents: number;
  count: number;
  items_count?: number;
  by_category: SummaryItem[];
  by_seller: SummaryItem[];
  by_day: { day: string; total_cents: number; count: number }[];
}

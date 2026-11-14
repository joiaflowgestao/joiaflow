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
  commission_percent?: number;
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
  down_payment_cents: number;     // valor pago no ato (entrada)
  exchange_delta_cents: number;   // soma das diferenças de trocas (contam no mês da troca)
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
  paid_cents: number;          // quanto já foi abatido desta parcela (pagamentos parciais)
  paid_at: string | null;      // preenchido quando a parcela fica totalmente paga
  paid_by: string | null;
}

/** Pagamento recebido da cliente (qualquer valor; abatido nas parcelas). */
export interface Payment {
  id: string;
  sale_id: string;
  organization_id: string;
  amount_cents: number;
  paid_on: string; // AAAA-MM-DD
  note: string | null;
  kind: 'payment' | 'down_payment';
  created_by: string | null;
  created_at: string;
  user?: Pick<Profile, 'full_name'> | null;
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
    total_cents?: number;
    seller_id: string;
    seller: Pick<Profile, 'full_name'> | null;
  };
}

export interface SummaryItem { id: string; name: string; slug?: string; total_cents: number; count: number; commission_percent?: number; commission_cents?: number }
export interface SalesSummary {
  total_cents: number;
  count: number;
  items_count?: number;
  commission_cents?: number;
  exchanges_count?: number;
  exchanges_cents?: number;
  by_category: SummaryItem[];
  by_seller: SummaryItem[];
  by_day: { day: string; total_cents: number; count: number }[];
}

/** Lançamento financeiro manual (controle pessoal, separado das vendas). */
export interface FinancialEntry {
  id: string;
  user_id: string;
  organization_id: string | null;
  entry_date: string; // AAAA-MM-DD
  kind: 'in' | 'out';
  description: string;
  amount_cents: number;
  created_at: string;
  updated_at: string;
  user?: Pick<Profile, 'full_name'> | null;
}

export interface ExchangeItem { category_id: string; name: string; quantity: number; unit_price_cents: number }

/** Troca registrada (altera a venda original). */
export interface Exchange {
  id: string;
  sale_id: string;
  organization_id: string;
  user_id: string | null;
  reason: string;
  returned_items: ExchangeItem[];
  new_items: ExchangeItem[];
  old_total_cents: number;
  new_total_cents: number;
  difference_cents: number;
  paid_cents: number;
  refund_cents: number;
  created_at: string;
  user?: Pick<Profile, 'full_name'> | null;
  sale?: { id: string; customer_name: string; seller_id: string; organization_id: string; sold_at?: string; seller: Pick<Profile, 'full_name'> | null } | null;
}

/** Maleta: período em que a vendedora fica com as semijoias da empresa. */
export interface Kit {
  id: string;
  organization_id: string;
  seller_id: string;
  received_on: string;        // AAAA-MM-DD
  returned_on: string | null; // AAAA-MM-DD (null = em aberto)
  notes: string | null;
  created_by: string | null;
  created_at: string;
  seller?: Pick<Profile, 'full_name'> | null;
}

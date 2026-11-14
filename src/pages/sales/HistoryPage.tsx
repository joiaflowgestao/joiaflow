import { ArrowLeftRight, ChevronLeft, ChevronRight, Pencil, Search, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExchangeForm, SaleExchanges } from '@/components/sales/ExchangeForm';
import { SaleForm } from '@/components/sales/SaleForm';
import { InstallmentList, StatusBadge, dueStatus } from '@/components/sales/installments';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { Input, Select } from '@/components/ui/Field';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { useCategories, useProfiles } from '@/hooks/useData';
import { cn } from '@/lib/cn';
import { currentYearMonth, formatDate, formatTime, MONTHS_PT, todayISO } from '@/lib/datetime';
import { formatCents } from '@/lib/money';
import { buildSalesQuery, itemsLabel, paymentSummary, saleItems, type SalesFilters } from '@/lib/salesQuery';
import { friendlyError, supabase } from '@/lib/supabase';
import type { SaleWithRelations } from '@/types/database';

const PAGE_SIZE = 20;

export function yearOptions() {
  const { year } = currentYearMonth();
  return Array.from({ length: year - 2023 }, (_, i) => year - i);
}

function PaymentBadge({ sale }: { sale: SaleWithRelations }) {
  const { paid, total } = paymentSummary(sale);
  if (paid === total) return <StatusBadge status="paid" />;
  const today = todayISO();
  const late = (sale.installment_rows ?? []).some((r) => dueStatus(r, today) === 'overdue');
  const dueToday = (sale.installment_rows ?? []).some((r) => dueStatus(r, today) === 'today');
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold',
      late ? 'border-red-200 bg-red-50 text-red-700' : dueToday ? 'border-gold-300 bg-gold-100 text-gold-600' : 'border-navy/10 bg-navy/5 text-navy/60')}>
      {paid}/{total} pagas{late ? ' · atraso' : dueToday ? ' · vence hoje' : ''}
    </span>
  );
}

export function HistoryPage() {
  const { profile, organization, isAdmin } = useAuth();
  const toast = useToast();
  const categories = useCategories();
  const profiles = useProfiles();
  const { year, month } = currentYearMonth();

  const [filters, setFilters] = useState<SalesFilters>({ year, month });
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<SaleWithRelations[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [detail, setDetail] = useState<SaleWithRelations | null>(null);
  const [editing, setEditing] = useState<SaleWithRelations | null>(null);
  const [deleting, setDeleting] = useState<SaleWithRelations | null>(null);
  const [exchanging, setExchanging] = useState<SaleWithRelations | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Busca com atraso para não consultar a cada tecla
  useEffect(() => {
    const t = setTimeout(() => { setFilters((f) => ({ ...f, search: searchText })); setPage(0); }, 350);
    return () => clearTimeout(t);
  }, [searchText]);

  const load = useCallback(async () => {
    setLoading(true);
    const from = page * PAGE_SIZE;
    const { data, error, count } = await buildSalesQuery(filters, { count: true }).range(from, from + PAGE_SIZE - 1);
    if (error) setError(friendlyError(error));
    else { setError(null); setRows((data ?? []) as unknown as SaleWithRelations[]); setCount(count ?? 0); }
    setLoading(false);
  }, [filters, page]);
  useEffect(() => { load(); }, [load]);

  const set = (patch: Partial<SalesFilters>) => { setFilters((f) => ({ ...f, ...patch })); setPage(0); };
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const sellers = useMemo(() => profiles.data.filter((p) => p.organization_id), [profiles.data]);

  const canExchange = (s: SaleWithRelations) => isAdmin || s.seller_id === profile?.id;
  const canEdit = (s: SaleWithRelations) =>
    isAdmin || (s.seller_id === profile?.id && !!profile?.can_edit_own_sales && !!organization?.sellers_can_edit_sales);

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    const { error } = await supabase.from('sales').update({ deleted_at: new Date().toISOString() }).eq('id', deleting.id);
    setDeleteBusy(false);
    if (error) return toast.error(friendlyError(error));
    toast.success('Venda excluída. O registro fica guardado no histórico de auditoria.');
    setDeleting(null); setDetail(null);
    load();
  }

  const usingRange = Boolean(filters.from || filters.to);

  return (
    <>
      <PageHeader title="Histórico de vendas" subtitle={loading ? 'Carregando…' : `${count} venda${count === 1 ? '' : 's'} encontrada${count === 1 ? '' : 's'}`} />

      <Card className="mb-6">
        <CardBody className="grid grid-cols-2 gap-3 pt-5 lg:grid-cols-4 sm:pt-6">
          <div className="col-span-2">
            <Input label="Buscar cliente" value={searchText} onChange={(e) => setSearchText(e.target.value)} leading={<Search className="h-4 w-4" />} placeholder="Nome do cliente" />
          </div>
          <Select label="Mês" value={filters.month ?? 0} disabled={usingRange} onChange={(e) => set({ month: Number(e.target.value) || undefined })}>
            <option value={0}>Todos os meses</option>
            {MONTHS_PT.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </Select>
          <Select label="Ano" value={filters.year ?? 0} disabled={usingRange} onChange={(e) => set({ year: Number(e.target.value) || undefined })}>
            <option value={0}>Todos os anos</option>
            {yearOptions().map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
          <Input label="Data inicial" type="date" value={filters.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} />
          <Input label="Data final" type="date" value={filters.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} />
          <Select label="Categoria" value={filters.categoryId ?? ''} onChange={(e) => set({ categoryId: e.target.value || undefined })}>
            <option value="">Todas</option>
            {categories.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          {isAdmin ? (
            <Select label="Vendedor" value={filters.sellerId ?? ''} onChange={(e) => set({ sellerId: e.target.value || undefined })}>
              <option value="">Todos</option>
              {sellers.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </Select>
          ) : <div className="hidden lg:block" />}
          {usingRange && (
            <div className="col-span-2 flex items-center gap-2 text-xs text-navy/55 lg:col-span-4">
              Filtrando pelo período de datas (mês/ano desativados).
              <button className="inline-flex items-center gap-1 font-medium text-navy underline-offset-2 hover:underline" onClick={() => set({ from: undefined, to: undefined })}>
                <X className="h-3 w-3" /> limpar datas
              </button>
            </div>
          )}
        </CardBody>
      </Card>

      {error && <Alert kind="error" className="mb-4">{error}</Alert>}

      {loading ? (
        <div className="flex justify-center py-16 text-gold-500"><Spinner className="h-7 w-7" /></div>
      ) : rows.length === 0 ? (
        <Card><CardBody className="py-14 text-center text-navy/55">Nenhuma venda encontrada com esses filtros.</CardBody></Card>
      ) : (
        <>
          {/* Desktop: tabela */}
          <Card className="hidden overflow-hidden md:block">
            <table className="w-full text-sm">
              <thead className="bg-ivory/60 text-left text-[11px] uppercase tracking-wider text-navy/50">
                <tr>
                  <th className="px-5 py-3 font-semibold">Data</th>
                  <th className="px-3 py-3 font-semibold">Cliente</th>
                  <th className="px-3 py-3 font-semibold">Itens</th>
                  <th className="px-3 py-3 text-right font-semibold">Valor</th>
                  <th className="px-3 py-3 font-semibold">Parcelas</th>
                  {isAdmin && <th className="px-3 py-3 font-semibold">Vendedor</th>}
                  <th className="px-3 py-3 font-semibold">Pagamento</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-navy/[0.06]">
                {rows.map((s) => (
                  <tr key={s.id} className="cursor-pointer hover:bg-gold-50/50" onClick={() => setDetail(s)}>
                    <td className="whitespace-nowrap px-5 py-3 text-navy">{formatDate(s.sold_at)} <span className="text-navy/45">{formatTime(s.sold_at)}</span></td>
                    <td className="max-w-[200px] truncate px-3 py-3 font-medium text-navy">{s.customer_name}</td>
                    <td className="max-w-[220px] px-3 py-3"><span className="flex items-center gap-1.5 text-navy/75" title={itemsLabel(s)}><CategoryIcon slug={s.category?.slug ?? ''} className="h-4 w-4 shrink-0 text-gold-500" /><span className="truncate">{itemsLabel(s)}</span></span></td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-navy">{formatCents(s.total_cents)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-navy/70">{s.installments === 1 ? 'À vista' : `${s.installments}x`}</td>
                    {isAdmin && <td className="max-w-[160px] truncate px-3 py-3 text-navy/70">{s.seller?.full_name}</td>}
                    <td className="px-3 py-3"><PaymentBadge sale={s} /></td>
                    <td className="whitespace-nowrap px-5 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      {canEdit(s) && <button className="rounded-lg p-2 text-navy/50 hover:bg-navy/5 hover:text-navy" title="Editar" onClick={() => setEditing(s)}><Pencil className="h-4 w-4" /></button>}
                      {isAdmin && <button className="rounded-lg p-2 text-navy/50 hover:bg-red-50 hover:text-red-700" title="Excluir" onClick={() => setDeleting(s)}><Trash2 className="h-4 w-4" /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Celular: cartões */}
          <div className="space-y-3 md:hidden">
            {rows.map((s) => (
              <button key={s.id} onClick={() => setDetail(s)} className="w-full rounded-xl border border-navy/[0.06] bg-white p-4 text-left shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-navy">{s.customer_name}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-navy/55">
                      <CategoryIcon slug={s.category?.slug ?? ''} className="h-3.5 w-3.5 text-gold-500" />
                      <span className="truncate">{itemsLabel(s)}</span> · {formatDate(s.sold_at)} {formatTime(s.sold_at)}
                    </p>
                    {isAdmin && <p className="mt-0.5 truncate text-xs text-navy/45">{s.seller?.full_name}</p>}
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-navy">{formatCents(s.total_cents)}</p>
                    <p className="text-xs text-navy/50">{s.installments === 1 ? 'À vista' : `${s.installments}x`}</p>
                  </div>
                </div>
                <div className="mt-2"><PaymentBadge sale={s} /></div>
              </button>
            ))}
          </div>

          <div className="mt-5 flex items-center justify-between text-sm text-navy/60">
            <span>Página {page + 1} de {pages}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /> Anterior</Button>
              <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Próxima <ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </>
      )}

      {/* Detalhe da venda + parcelas */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title="Detalhes da venda">
        {detail && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Info label="Cliente" value={detail.customer_name} />
              <Info label="Data" value={`${formatDate(detail.sold_at)} às ${formatTime(detail.sold_at)}`} />
              <Info label="Valor" value={formatCents(detail.total_cents)} />
              <Info label="Pagamento" value={detail.installments === 1 ? 'À vista' : `${detail.installments} parcelas`} />
              <Info label="Vendedor" value={detail.seller?.full_name} />
              {isAdmin && detail.organization && <Info label="Empresa" value={detail.organization.name} />}
            </div>
            <div>
              <p className="field-label">Itens</p>
              <ul className="divide-y divide-navy/[0.06] rounded-xl border border-navy/[0.08]">
                {saleItems(detail).map((it) => (
                  <li key={it.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <CategoryIcon slug={it.category?.slug ?? ''} className="h-5 w-5 text-gold-500" />
                    <span className="flex-1 text-navy">{it.quantity}x {it.category?.name}</span>
                    <span className="text-navy/55">{it.quantity > 1 ? `${formatCents(it.unit_price_cents)} cada` : ''}</span>
                    <span className="w-24 text-right font-medium text-navy">{formatCents(it.line_total_cents)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <SaleExchanges saleId={detail.id} />
            <div>
              <p className="field-label">Parcelas</p>
              <InstallmentList saleId={detail.id} customer={detail.customer_name} total={detail.total_cents} onChange={load} />
            </div>
            {(canEdit(detail) || isAdmin || canExchange(detail)) && (
              <div className="flex flex-wrap justify-end gap-2 border-t border-navy/[0.06] pt-4">
                {isAdmin && <Button variant="ghost" className="text-red-700 hover:bg-red-50" onClick={() => setDeleting(detail)}><Trash2 className="h-4 w-4" /> Excluir</Button>}
                {canExchange(detail) && <Button variant="gold" onClick={() => { setExchanging(detail); setDetail(null); }}><ArrowLeftRight className="h-4 w-4" /> Fazer troca</Button>}
                {canEdit(detail) && <Button variant="outline" onClick={() => { setEditing(detail); setDetail(null); }}><Pencil className="h-4 w-4" /> Editar</Button>}
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Editar venda" size="lg">
        {editing && (
          <SaleForm initial={editing} submitLabel="Salvar alterações" onCancel={() => setEditing(null)}
            onSaved={() => { setEditing(null); toast.success('Venda atualizada.'); load(); }} />
        )}
      </Modal>

      <Modal open={!!exchanging} onClose={() => setExchanging(null)} title="Fazer troca" size="lg">
        {exchanging && (
          <ExchangeForm saleId={exchanging.id} customer={exchanging.customer_name} onCancel={() => setExchanging(null)}
            onDone={() => { setExchanging(null); toast.success('Troca registrada e venda recalculada.'); load(); }} />
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Excluir venda"
        danger
        loading={deleteBusy}
        confirmLabel="Excluir"
        message={deleting && <>Excluir a venda de <strong>{deleting.customer_name}</strong> ({formatCents(deleting.total_cents)}, {formatDate(deleting.sold_at)})? Ela deixará de aparecer nos relatórios, mas o registro ficará guardado na auditoria.</>}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-navy/45">{label}</p>
      <p className="mt-0.5 text-navy">{value || '—'}</p>
    </div>
  );
}

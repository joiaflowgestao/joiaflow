import { AlertTriangle, BellRing, CalendarClock, CheckCircle2, HandCoins, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { addDaysISO, formatDateOnly, todayISO } from '@/lib/datetime';
import { formatCents, maskCentsInput } from '@/lib/money';
import { friendlyError, supabase } from '@/lib/supabase';
import type { Installment, InstallmentWithSale, Payment } from '@/types/database';

export type DueStatus = 'paid' | 'overdue' | 'today' | 'upcoming';

export function dueStatus(i: Pick<Installment, 'paid_at' | 'due_date'>, today = todayISO()): DueStatus {
  if (i.paid_at) return 'paid';
  if (i.due_date < today) return 'overdue';
  if (i.due_date === today) return 'today';
  return 'upcoming';
}

const statusStyle: Record<DueStatus, { label: string; cls: string }> = {
  paid: { label: 'Pago', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  overdue: { label: 'Atrasado', cls: 'bg-red-50 text-red-700 border-red-200' },
  today: { label: 'Vence hoje', cls: 'bg-gold-100 text-gold-600 border-gold-300' },
  upcoming: { label: 'A vencer', cls: 'bg-navy/5 text-navy/60 border-navy/10' },
};

export function StatusBadge({ status }: { status: DueStatus }) {
  const s = statusStyle[status];
  return <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold', s.cls)}>{s.label}</span>;
}

const remainingOf = (i: Pick<Installment, 'amount_cents' | 'paid_cents'>) => Math.max(i.amount_cents - (i.paid_cents ?? 0), 0);

/** Formulário de pagamento: valor LIVRE (não precisa ser o valor da parcela). */
export function PaymentForm({ saleId, customer, suggestedCents, owedCents, onDone, onCancel }: {
  saleId: string; customer: string; suggestedCents?: number; owedCents: number; onDone: () => void; onCancel: () => void;
}) {
  const toast = useToast();
  const [cents, setCents] = useState(suggestedCents ?? 0);
  const [text, setText] = useState(suggestedCents ? formatCents(suggestedCents, false) : '');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (cents <= 0) return setError('Informe quanto a cliente pagou.');
    if (cents > owedCents) return setError(`O valor é maior do que a cliente deve (${formatCents(owedCents)}).`);
    setSaving(true);
    const { error } = await supabase.rpc('register_payment', { p_sale_id: saleId, p_amount_cents: cents, p_paid_on: date, p_note: note.trim() || null });
    setSaving(false);
    if (error) return setError(friendlyError(error));
    toast.success(`Pagamento de ${formatCents(cents)} registrado.`);
    onDone();
  }

  const after = owedCents - cents;
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <p className="text-sm text-navy/70"><strong className="text-navy">{customer}</strong> deve hoje <strong className="text-navy">{formatCents(owedCents)}</strong>.</p>
      {error && <Alert kind="error">{error}</Alert>}
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <Input label="Valor recebido" inputMode="numeric" value={text} placeholder="0,00" autoFocus
          leading={<span className="text-sm font-semibold">R$</span>} className="text-lg font-semibold"
          hint="Qualquer valor, não precisa ser o da parcela"
          onChange={(e) => { const m = maskCentsInput(e.target.value); setCents(m.cents); setText(m.display); }} />
        <Input label="Data do pagamento" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
      </div>
      <Input label="Observação (opcional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Ex.: pix, dinheiro, cartão" />
      <div className="flex gap-2">
        <button type="button" className="rounded-lg border border-navy/15 px-3 py-1.5 text-xs font-medium text-navy/70 hover:border-gold-300"
          onClick={() => { setCents(owedCents); setText(formatCents(owedCents, false)); }}>
          Quitar tudo ({formatCents(owedCents)})
        </button>
      </div>
      {cents > 0 && cents <= owedCents && (
        <p className="rounded-lg bg-gold-50 px-3 py-2 text-sm text-navy">
          {after === 0 ? <>Com este pagamento a venda fica <strong>quitada</strong>.</> : <>Depois deste pagamento, ela ainda vai dever <strong>{formatCents(after)}</strong>.</>}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" variant="gold" loading={saving}><HandCoins className="h-4 w-4" /> Registrar pagamento</Button>
      </div>
    </form>
  );
}

/** Parcelas + pagamentos de uma venda (detalhe da venda). */
export function InstallmentList({ saleId, customer, total, hasDownPayment, onChange }: { saleId: string; customer: string; total: number; hasDownPayment?: boolean; onChange?: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<Installment[] | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paying, setPaying] = useState<{ suggested?: number } | null>(null);
  const [removing, setRemoving] = useState<Payment | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      supabase.from('installments').select('*').eq('sale_id', saleId).order('number'),
      supabase.from('payments').select('*, user:profiles!payments_created_by_fkey(full_name)').eq('sale_id', saleId).order('paid_on').order('created_at'),
    ]);
    setRows((a.data ?? []) as Installment[]);
    setPayments((b.data ?? []) as Payment[]);
  }, [saleId]);
  useEffect(() => { load(); }, [load]);
  const changed = () => { setPaying(null); load(); onChange?.(); };

  async function removePayment() {
    if (!removing) return;
    setBusy(true);
    const { error } = await supabase.rpc('delete_payment', { p_payment_id: removing.id });
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    toast.success('Pagamento excluído.');
    setRemoving(null);
    changed();
  }

  if (!rows) return <div className="flex justify-center py-6 text-gold-500"><Spinner /></div>;
  const paid = payments.reduce((a, p) => a + p.amount_cents, 0);
  const owed = Math.max(total - paid, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg bg-emerald-50 px-3 py-2"><p className="text-xs text-emerald-800/70">Recebido</p><p className="metric text-emerald-700">{formatCents(paid)}</p></div>
        <div className={cn('rounded-lg px-3 py-2', owed > 0 ? 'bg-gold-50' : 'bg-ivory')}>
          <p className="text-xs text-navy/55">Cliente ainda deve</p>
          <p className="metric text-navy">{owed > 0 ? formatCents(owed) : 'Nada — quitado'}</p>
        </div>
      </div>

      {owed > 0 && (
        <Button variant="gold" className="w-full" onClick={() => setPaying({})}><HandCoins className="h-4 w-4" /> Registrar pagamento</Button>
      )}

      <ul className="divide-y divide-navy/[0.06] rounded-xl border border-navy/[0.08]">
        {rows.map((r) => {
          const st = dueStatus(r);
          const rem = remainingOf(r);
          const partial = !r.paid_at && (r.paid_cents ?? 0) > 0;
          const label = hasDownPayment && r.number === 1 ? 'Entrada (pago no ato)' : `${hasDownPayment ? r.number - 1 : r.number}ª parcela`;
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-navy">{label} · {formatCents(r.amount_cents)}</p>
                <p className="text-xs text-navy/55">
                  Vencimento {formatDateOnly(r.due_date)}
                  {partial && <span className="text-gold-600"> · pago {formatCents(r.paid_cents)}, falta {formatCents(rem)}</span>}
                </p>
              </div>
              <StatusBadge status={st} />
              {!r.paid_at && (
                <Button size="sm" variant="outline" onClick={() => setPaying({ suggested: rem })}><HandCoins className="h-3.5 w-3.5" /> Receber</Button>
              )}
            </li>
          );
        })}
      </ul>

      {payments.length > 0 && (
        <div>
          <p className="field-label">Pagamentos recebidos</p>
          <ul className="divide-y divide-navy/[0.06] rounded-xl border border-navy/[0.08] bg-white">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="text-navy">{formatDateOnly(p.paid_on)} · <span className="metric text-emerald-700">{formatCents(p.amount_cents)}</span></p>
                  <p className="truncate text-xs text-navy/50">
                    {p.kind === 'down_payment' ? (p.note ?? 'Pago no ato') : p.note || 'Pagamento'}{p.user?.full_name ? ` · por ${p.user.full_name}` : ''}
                  </p>
                </div>
                {p.kind !== 'down_payment' && (
                  <button className="rounded-lg p-1.5 text-navy/40 hover:bg-red-50 hover:text-red-700" title="Excluir pagamento" onClick={() => setRemoving(p)}><Trash2 className="h-4 w-4" /></button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Modal open={!!paying} onClose={() => setPaying(null)} title="Registrar pagamento" size="sm">
        {paying && <PaymentForm saleId={saleId} customer={customer} suggestedCents={paying.suggested} owedCents={owed} onDone={changed} onCancel={() => setPaying(null)} />}
      </Modal>
      <ConfirmDialog open={!!removing} title="Excluir pagamento" danger loading={busy} confirmLabel="Excluir"
        message={removing && <>Excluir o pagamento de <strong>{formatCents(removing.amount_cents)}</strong> de {formatDateOnly(removing.paid_on)}? O valor volta a ficar em aberto.</>}
        onConfirm={removePayment} onCancel={() => setRemoving(null)} />
    </div>
  );
}

/** Painel do Dashboard: parcelas atrasadas, vencendo hoje e nos próximos 7 dias. */
export function DueInstallmentsPanel({ orgId, sellerId, onCounts }: { orgId?: string; sellerId?: string; onCounts?: (c: { overdue: number; today: number }) => void }) {
  const [rows, setRows] = useState<InstallmentWithSale[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<{ row: InstallmentWithSale; owed: number } | null>(null);
  const today = todayISO();

  const load = useCallback(async () => {
    let q = supabase.from('installments')
      .select('*, sale:sales!inner(id, customer_name, installments, seller_id, total_cents, deleted_at, seller:profiles!sales_seller_id_fkey(full_name))')
      .is('paid_at', null)
      .is('sale.deleted_at', null)
      .lte('due_date', addDaysISO(today, 7))
      .order('due_date')
      .limit(200);
    if (orgId) q = q.eq('organization_id', orgId);
    if (sellerId) q = q.eq('sale.seller_id', sellerId);
    const { data, error } = await q;
    if (error) setError(friendlyError(error));
    else {
      const list = (data ?? []) as unknown as InstallmentWithSale[];
      setRows(list);
      onCounts?.({ overdue: list.filter((r) => r.due_date < today).length, today: list.filter((r) => r.due_date === today).length });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, orgId, sellerId]);
  useEffect(() => { load(); }, [load]);

  async function openPay(row: InstallmentWithSale) {
    // saldo devedor real da venda (total − pagamentos)
    const { data } = await supabase.from('payments').select('amount_cents').eq('sale_id', row.sale_id);
    const paid = (data ?? []).reduce((a, p) => a + (p as { amount_cents: number }).amount_cents, 0);
    setPaying({ row, owed: Math.max((row.sale.total_cents ?? 0) - paid, 0) });
  }

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!rows) return <div className="flex justify-center py-8 text-gold-500"><Spinner /></div>;

  const overdue = rows.filter((r) => r.due_date < today);
  const dueToday = rows.filter((r) => r.due_date === today);
  const upcoming = rows.filter((r) => r.due_date > today);
  const sum = (l: InstallmentWithSale[]) => l.reduce((a, r) => a + remainingOf(r), 0);

  const Group = ({ title, icon: Icon, items, tone }: { title: string; icon: typeof BellRing; items: InstallmentWithSale[]; tone: string }) =>
    items.length === 0 ? null : (
      <div>
        <div className={cn('mb-2 flex items-center gap-2 text-sm font-semibold', tone)}>
          <Icon className="h-4 w-4" /> {title} · {items.length} · {formatCents(sum(items))}
        </div>
        <ul className="divide-y divide-navy/[0.06] rounded-xl border border-navy/[0.08] bg-white">
          {items.map((r) => {
            const partial = (r.paid_cents ?? 0) > 0;
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-navy">{r.sale.customer_name}</p>
                  <p className="text-xs text-navy/55">
                    Parcela {r.number}/{r.sale.installments} · vence {formatDateOnly(r.due_date)}
                    {partial && <span className="text-gold-600"> · já pagou {formatCents(r.paid_cents)}</span>}
                    {r.sale.seller?.full_name && ` · ${r.sale.seller.full_name}`}
                  </p>
                </div>
                <span className="metric text-sm text-navy">{formatCents(remainingOf(r))}</span>
                <Button size="sm" variant="gold" onClick={() => openPay(r)}><HandCoins className="h-3.5 w-3.5" /> Receber</Button>
              </li>
            );
          })}
        </ul>
      </div>
    );

  return (
    <div className="space-y-5">
      {rows.length === 0 ? (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="h-5 w-5" /> Nenhuma parcela atrasada ou vencendo nos próximos 7 dias.
        </div>
      ) : (
        <>
          <Group title="Atrasadas" icon={AlertTriangle} items={overdue} tone="text-red-700" />
          <Group title="Vencem hoje" icon={BellRing} items={dueToday} tone="text-gold-600" />
          <Group title="Próximos 7 dias" icon={CalendarClock} items={upcoming} tone="text-navy/70" />
        </>
      )}
      <Modal open={!!paying} onClose={() => setPaying(null)} title="Registrar pagamento" size="sm">
        {paying && (
          <PaymentForm saleId={paying.row.sale_id} customer={paying.row.sale.customer_name}
            suggestedCents={Math.min(remainingOf(paying.row), paying.owed)} owedCents={paying.owed}
            onDone={() => { setPaying(null); load(); }} onCancel={() => setPaying(null)} />
        )}
      </Modal>
    </div>
  );
}

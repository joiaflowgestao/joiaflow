import { AlertTriangle, BellRing, CalendarClock, Check, CheckCircle2, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { addDaysISO, formatDateOnly, formatDateTime, todayISO } from '@/lib/datetime';
import { formatCents } from '@/lib/money';
import { friendlyError, supabase } from '@/lib/supabase';
import type { Installment, InstallmentWithSale } from '@/types/database';

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

/** Marca/desmarca o pagamento de uma parcela, com confirmação. */
export function usePaymentAction(onDone: () => void) {
  const toast = useToast();
  const [target, setTarget] = useState<{ inst: Installment; label: string; pay: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  async function run() {
    if (!target) return;
    setSaving(true);
    const { error } = await supabase.from('installments')
      .update({ paid_at: target.pay ? new Date().toISOString() : null })
      .eq('id', target.inst.id);
    setSaving(false);
    if (error) return toast.error(friendlyError(error));
    toast.success(target.pay ? 'Pagamento confirmado.' : 'Confirmação desfeita.');
    setTarget(null);
    onDone();
  }

  const dialog = (
    <ConfirmDialog
      open={!!target}
      title={target?.pay ? 'Confirmar pagamento' : 'Desfazer pagamento'}
      message={target && (
        target.pay
          ? <>Confirmar o recebimento de <strong>{formatCents(target.inst.amount_cents)}</strong> — {target.label}?</>
          : <>A parcela voltará a constar como <strong>não paga</strong> — {target.label}.</>
      )}
      confirmLabel={target?.pay ? 'Confirmar pagamento' : 'Desfazer'}
      danger={!target?.pay}
      loading={saving}
      onConfirm={run}
      onCancel={() => setTarget(null)}
    />
  );
  return { ask: (inst: Installment, label: string, pay: boolean) => setTarget({ inst, label, pay }), dialog };
}

/** Lista de parcelas de uma venda, com botões de pagamento. */
export function InstallmentList({ saleId, customer, total, onChange }: { saleId: string; customer: string; total: number; onChange?: () => void }) {
  const [rows, setRows] = useState<Installment[] | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase.from('installments').select('*').eq('sale_id', saleId).order('number');
    setRows((data ?? []) as Installment[]);
  }, [saleId]);
  useEffect(() => { load(); }, [load]);
  const action = usePaymentAction(() => { load(); onChange?.(); });

  if (!rows) return <div className="flex justify-center py-6 text-gold-500"><Spinner /></div>;
  const paid = rows.filter((r) => r.paid_at).reduce((a, r) => a + r.amount_cents, 0);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="text-navy/60">Recebido</span>
        <span className="font-semibold text-navy">{formatCents(paid)} <span className="font-normal text-navy/50">de {formatCents(total)}</span></span>
      </div>
      <ul className="divide-y divide-navy/[0.06] rounded-xl border border-navy/[0.08]">
        {rows.map((r) => {
          const st = dueStatus(r);
          const label = `${customer}, parcela ${r.number}/${rows.length}`;
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-navy">{r.number}ª parcela · {formatCents(r.amount_cents)}</p>
                <p className="text-xs text-navy/55">
                  Vencimento {formatDateOnly(r.due_date)}{r.paid_at && ` · pago em ${formatDateTime(r.paid_at)}`}
                </p>
              </div>
              <StatusBadge status={st} />
              {r.paid_at ? (
                <Button size="sm" variant="ghost" onClick={() => action.ask(r, label, false)}><RotateCcw className="h-3.5 w-3.5" /> Desfazer</Button>
              ) : (
                <Button size="sm" variant="gold" onClick={() => action.ask(r, label, true)}><Check className="h-3.5 w-3.5" /> Confirmar pagamento</Button>
              )}
            </li>
          );
        })}
      </ul>
      {action.dialog}
    </div>
  );
}

/** Painel do Dashboard: parcelas atrasadas, vencendo hoje e nos próximos 7 dias. */
export function DueInstallmentsPanel({ orgId, sellerId, onCounts }: { orgId?: string; sellerId?: string; onCounts?: (c: { overdue: number; today: number }) => void }) {
  const [rows, setRows] = useState<InstallmentWithSale[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = todayISO();

  const load = useCallback(async () => {
    let q = supabase.from('installments')
      .select('*, sale:sales!inner(id, customer_name, installments, seller_id, deleted_at, seller:profiles!sales_seller_id_fkey(full_name))')
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
  const action = usePaymentAction(load);

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!rows) return <div className="flex justify-center py-8 text-gold-500"><Spinner /></div>;

  const overdue = rows.filter((r) => r.due_date < today);
  const dueToday = rows.filter((r) => r.due_date === today);
  const upcoming = rows.filter((r) => r.due_date > today);
  const sum = (l: InstallmentWithSale[]) => l.reduce((a, r) => a + r.amount_cents, 0);

  const Group = ({ title, icon: Icon, items, tone }: { title: string; icon: typeof BellRing; items: InstallmentWithSale[]; tone: string }) =>
    items.length === 0 ? null : (
      <div>
        <div className={cn('mb-2 flex items-center gap-2 text-sm font-semibold', tone)}>
          <Icon className="h-4 w-4" /> {title} · {items.length} · {formatCents(sum(items))}
        </div>
        <ul className="divide-y divide-navy/[0.06] rounded-xl border border-navy/[0.08] bg-white">
          {items.map((r) => {
            const label = `${r.sale.customer_name}, parcela ${r.number}/${r.sale.installments}`;
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-navy">{r.sale.customer_name}</p>
                  <p className="text-xs text-navy/55">
                    Parcela {r.number}/{r.sale.installments} · vence {formatDateOnly(r.due_date)}
                    {r.sale.seller?.full_name && ` · ${r.sale.seller.full_name}`}
                  </p>
                </div>
                <span className="text-sm font-semibold text-navy">{formatCents(r.amount_cents)}</span>
                <Button size="sm" variant="gold" onClick={() => action.ask(r, label, true)}><Check className="h-3.5 w-3.5" /> Recebido</Button>
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
      {action.dialog}
    </div>
  );
}


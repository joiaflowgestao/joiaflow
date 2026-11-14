import { ArrowLeftRight, Minus, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { Spinner } from '@/components/ui/Spinner';
import { useCategories } from '@/hooks/useData';
import { cn } from '@/lib/cn';
import { formatCents, maskCentsInput } from '@/lib/money';
import { friendlyError, supabase } from '@/lib/supabase';
import type { Exchange, Installment, SaleItem } from '@/types/database';

interface NewRow { key: number; category_id: string; quantity: number; unit_cents: number; unit_text: string }
let seq = 0;

function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="flex items-center rounded-lg border border-navy/15" aria-label={label}>
      <button type="button" className="p-2 text-navy/60 hover:text-navy disabled:opacity-30" disabled={value <= min} onClick={() => onChange(value - 1)} aria-label="Diminuir"><Minus className="h-3.5 w-3.5" /></button>
      <span className="w-7 text-center text-sm font-semibold text-navy">{value}</span>
      <button type="button" className="p-2 text-navy/60 hover:text-navy disabled:opacity-30" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label="Aumentar"><Plus className="h-3.5 w-3.5" /></button>
    </div>
  );
}

/** Troca: devolve itens, adiciona novos e recalcula a venda. */
export function ExchangeForm({ saleId, customer, onDone, onCancel }: { saleId: string; customer: string; onDone: (ex: Exchange) => void; onCancel: () => void }) {
  const categories = useCategories();
  const [items, setItems] = useState<SaleItem[] | null>(null);
  const [inst, setInst] = useState<Installment[]>([]);
  const [ret, setRet] = useState<Record<string, number>>({});
  const [rows, setRows] = useState<NewRow[]>([]);
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from('sale_items').select('*, category:categories(name, slug)').eq('sale_id', saleId).order('position'),
      supabase.from('installments').select('*').eq('sale_id', saleId).order('number'),
    ]).then(([a, b]) => { setItems((a.data ?? []) as SaleItem[]); setInst((b.data ?? []) as Installment[]); });
  }, [saleId]);

  const catById = useMemo(() => new Map(categories.data.map((c) => [c.id, c])), [categories.data]);
  const oldTotal = (items ?? []).reduce((a, i) => a + i.line_total_cents, 0);
  const returned = (items ?? []).reduce((a, i) => a + (ret[i.id] ?? 0) * i.unit_price_cents, 0);
  const added = rows.reduce((a, r) => a + r.quantity * r.unit_cents, 0);
  const newTotal = oldTotal - returned + added;
  const paid = inst.filter((i) => i.paid_at).reduce((a, i) => a + i.amount_cents, 0);
  const openCount = inst.filter((i) => !i.paid_at).length;
  const remaining = newTotal - paid;
  const remainingItems = (items ?? []).reduce((a, i) => a + i.quantity - (ret[i.id] ?? 0), 0) + rows.length;

  function addRow(categoryId: string) {
    const key = ++seq;
    setRows((l) => [...l, { key, category_id: categoryId, quantity: 1, unit_cents: 0, unit_text: '' }]);
    setFocusKey(key);
  }
  const upd = (key: number, p: Partial<NewRow>) => setRows((l) => l.map((r) => (r.key === key ? { ...r, ...p } : r)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const er: Record<string, string> = {};
    const anyReturn = Object.values(ret).some((q) => q > 0);
    if (!anyReturn && rows.length === 0) er.items = 'Marque o que foi devolvido e/ou adicione os itens novos.';
    else if (rows.some((r) => r.unit_cents <= 0)) er.items = 'Informe o valor de cada item novo.';
    else if (remainingItems <= 0) er.items = 'A venda precisa continuar com pelo menos um item.';
    if (reason.trim().length < 3) er.reason = 'Descreva o motivo da troca.';
    setErrors(er);
    if (Object.keys(er).length) return;

    setSaving(true);
    const { data, error } = await supabase.rpc('exchange_sale', {
      p_sale_id: saleId,
      p_reason: reason.trim(),
      p_return: Object.entries(ret).filter(([, q]) => q > 0).map(([item_id, quantity]) => ({ item_id, quantity })),
      p_new_items: rows.map((r) => ({ category_id: r.category_id, quantity: r.quantity, unit_price_cents: r.unit_cents })),
    });
    setSaving(false);
    if (error) return setFormError(friendlyError(error));
    onDone(data as Exchange);
  }

  if (!items || categories.loading) return <div className="flex justify-center py-12 text-gold-500"><Spinner className="h-7 w-7" /></div>;

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      {formError && <Alert kind="error">{formError}</Alert>}
      <p className="text-sm text-navy/65">Troca na venda de <strong className="text-navy">{customer}</strong> · total atual <strong className="text-navy">{formatCents(oldTotal)}</strong></p>

      <div>
        <p className="field-label">1. O que foi devolvido?</p>
        <ul className="divide-y divide-navy/[0.06] rounded-xl border border-navy/10">
          {items.map((it) => {
            const q = ret[it.id] ?? 0;
            return (
              <li key={it.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5', q > 0 && 'bg-red-50/60')}>
                <span className="flex min-w-0 flex-1 items-center gap-2 text-sm text-navy">
                  <CategoryIcon slug={it.category?.slug ?? ''} className="h-5 w-5 shrink-0 text-gold-500" />
                  <span className="truncate">{it.quantity}x {it.category?.name} <span className="text-navy/50">· {formatCents(it.unit_price_cents)} cada</span></span>
                </span>
                <span className="text-xs text-navy/55">Devolver</span>
                <Stepper value={q} min={0} max={it.quantity} label="Quantidade devolvida" onChange={(n) => setRet((r) => ({ ...r, [it.id]: n }))} />
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <p className="field-label">2. Itens novos que a cliente levou</p>
        <div className="grid grid-cols-4 gap-2">
          {categories.data.map((c) => {
            const qty = rows.filter((r) => r.category_id === c.id).reduce((a, r) => a + r.quantity, 0);
            return (
              <button key={c.id} type="button" onClick={() => addRow(c.id)}
                className={cn('relative flex flex-col items-center gap-1 rounded-xl border px-1 py-2.5 text-[11px] font-medium transition sm:text-xs',
                  qty ? 'border-gold-400 bg-navy text-ivory' : 'border-navy/10 bg-white text-navy/70 hover:border-gold-300 hover:bg-gold-50')}>
                {qty > 0 && <span className="absolute right-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-gold-400 px-1 text-[11px] font-bold text-navy">{qty}</span>}
                <CategoryIcon slug={c.slug} className={cn('h-6 w-6', qty ? 'text-gold-400' : 'text-navy/60')} />
                {c.name}
              </button>
            );
          })}
        </div>
        {rows.length > 0 && (
          <ul className="mt-3 divide-y divide-navy/[0.06] rounded-xl border border-navy/10">
            {rows.map((r) => {
              const cat = catById.get(r.category_id);
              return (
                <li key={r.key} className="flex flex-wrap items-center gap-x-2 gap-y-2 px-3 py-2.5 sm:flex-nowrap sm:gap-x-3">
                  <span className="flex min-w-0 flex-1 basis-[calc(100%-48px)] items-center gap-2 text-sm font-medium text-navy sm:basis-auto">
                    <CategoryIcon slug={cat?.slug ?? ''} className="h-5 w-5 shrink-0 text-gold-500" /><span className="truncate">{cat?.name}</span>
                  </span>
                  <div className="order-3 sm:order-none"><Stepper value={r.quantity} min={1} max={999} label="Quantidade" onChange={(n) => upd(r.key, { quantity: n })} /></div>
                  <div className="relative order-3 min-w-0 flex-1 sm:order-none sm:w-32 sm:flex-none">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs font-semibold text-navy/45">R$</span>
                    <input inputMode="numeric" placeholder="0,00" value={r.unit_text} autoFocus={focusKey === r.key} aria-label={`Valor de ${cat?.name ?? 'item'}`}
                      onChange={(e) => { const m = maskCentsInput(e.target.value); upd(r.key, { unit_cents: m.cents, unit_text: m.display }); }}
                      className="field-input py-2 pl-9 text-right font-semibold" />
                  </div>
                  <span className="order-3 w-20 text-right text-sm font-semibold text-navy sm:order-none sm:w-24">{formatCents(r.quantity * r.unit_cents)}</span>
                  <button type="button" onClick={() => setRows((l) => l.filter((x) => x.key !== r.key))} className="order-2 rounded-lg p-2 text-navy/40 hover:bg-red-50 hover:text-red-700 sm:order-none" aria-label="Remover item">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {errors.items && <p className="mt-1.5 text-sm text-red-700">{errors.items}</p>}
      </div>

      <div>
        <label htmlFor="exchange-reason" className="field-label">3. Motivo da troca</label>
        <textarea id="exchange-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="Ex.: Brinco com defeito no fecho; cliente preferiu trocar por uma pulseira."
          className={cn('field-input resize-y', errors.reason && 'border-red-600')} />
        {errors.reason && <p className="mt-1.5 text-sm text-red-700">{errors.reason}</p>}
      </div>

      <div className="rounded-xl border border-gold-200 bg-gold-50 p-4 text-sm">
        <Line label="Total atual" value={formatCents(oldTotal)} />
        <Line label="Devolvido" value={`− ${formatCents(returned)}`} tone="text-red-700" />
        <Line label="Itens novos" value={`+ ${formatCents(added)}`} tone="text-emerald-700" />
        <div className="my-2 h-px bg-gold-200" />
        <Line label="Novo total da venda" value={formatCents(Math.max(newTotal, 0))} strong />
        <Line label="Já pago pela cliente" value={formatCents(paid)} />
        <p className="mt-2 rounded-lg bg-white/70 px-3 py-2 text-navy">
          {remaining > 0
            ? openCount > 0
              ? <>Fica <strong>{formatCents(remaining)}</strong> a receber, dividido nas {openCount} parcela{openCount > 1 ? 's' : ''} em aberto.</>
              : <>A diferença de <strong>{formatCents(remaining)}</strong> vira uma nova parcela, vencendo hoje.</>
            : remaining < 0
              ? <>A cliente já pagou a mais: <strong className="text-red-700">devolver {formatCents(-remaining)}</strong> (ou deixar de crédito).</>
              : <>Venda quitada, nada a receber.</>}
        </p>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" loading={saving} size="lg"><ArrowLeftRight className="h-4 w-4" /> Confirmar troca</Button>
      </div>
    </form>
  );
}

function Line({ label, value, tone, strong }: { label: string; value: string; tone?: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className={cn('text-navy/65', strong && 'font-semibold text-navy')}>{label}</span>
      <span className={cn('metric', strong ? 'text-base text-navy' : 'text-sm', tone)}>{value}</span>
    </div>
  );
}

/** Lista das trocas de uma venda (detalhe da venda). */
export function SaleExchanges({ saleId, refreshKey }: { saleId: string; refreshKey?: number }) {
  const [rows, setRows] = useState<Exchange[] | null>(null);
  useEffect(() => {
    supabase.from('exchanges').select('*, user:profiles!exchanges_user_id_fkey(full_name)').eq('sale_id', saleId).order('created_at', { ascending: false })
      .then(({ data }) => setRows((data ?? []) as Exchange[]));
  }, [saleId, refreshKey]);
  if (!rows || rows.length === 0) return null;
  return (
    <div>
      <p className="field-label">Trocas</p>
      <ul className="space-y-2">
        {rows.map((x) => <ExchangeCard key={x.id} ex={x} />)}
      </ul>
    </div>
  );
}

export function ExchangeCard({ ex, showSale }: { ex: Exchange; showSale?: boolean }) {
  const label = (l: Exchange['returned_items']) => (l.length ? l.map((i) => `${i.quantity}x ${i.name}`).join(', ') : '—');
  return (
    <li className="rounded-xl border border-navy/[0.08] bg-white px-4 py-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium text-navy">
          {showSale && ex.sale ? <>{ex.sale.customer_name} · </> : null}
          {new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ex.created_at))}
        </p>
        <span className={cn('metric text-sm', ex.difference_cents > 0 ? 'text-emerald-700' : ex.difference_cents < 0 ? 'text-red-700' : 'text-navy/60')}>
          {ex.difference_cents > 0 ? '+' : ex.difference_cents < 0 ? '−' : ''}{formatCents(Math.abs(ex.difference_cents))}
        </span>
      </div>
      <p className="mt-1 text-navy/70"><span className="text-red-700">Devolveu:</span> {label(ex.returned_items)} · <span className="text-emerald-700">Levou:</span> {label(ex.new_items)}</p>
      <p className="mt-1 text-navy/70">Total {formatCents(ex.old_total_cents)} → <strong className="text-navy">{formatCents(ex.new_total_cents)}</strong>
        {ex.refund_cents > 0 && <> · <span className="text-red-700">devolver {formatCents(ex.refund_cents)}</span></>}</p>
      <p className="mt-1.5 rounded-lg bg-ivory px-3 py-2 italic text-navy/80">“{ex.reason}”</p>
      <p className="mt-1 text-xs text-navy/45">
        {showSale && ex.sale?.seller?.full_name ? `Vendedora: ${ex.sale.seller.full_name} · ` : ''}Troca registrada por {ex.user?.full_name ?? '—'}
      </p>
    </li>
  );
}

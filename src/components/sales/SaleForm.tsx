import { CalendarDays, Clock, Minus, Plus, Trash2, User } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { Input, Select } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth } from '@/contexts/AuthContext';
import { useCategories, useProfiles } from '@/hooks/useData';
import { cn } from '@/lib/cn';
import { addMonthsISO, dueSchedule, formatDateOnly, fromLocalInputs, toLocalInputs } from '@/lib/datetime';
import { describeInstallments, formatCents, maskCentsInput, splitInstallments } from '@/lib/money';
import { friendlyError, supabase } from '@/lib/supabase';
import type { Sale, SaleItem } from '@/types/database';

const MAX_CENTS = 100_000_000; // R$ 1.000.000,00

interface ItemRow { key: number; category_id: string; quantity: number; unit_cents: number; unit_text: string }
let rowSeq = 0;
const INSTALLMENT_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

export function SaleForm({ initial, onSaved, onCancel, submitLabel = 'Registrar venda' }: {
  initial?: Sale;
  onSaved: (sale: Sale) => void;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const { profile, isAdmin } = useAuth();
  const categories = useCategories();
  const profiles = useProfiles();

  const start = initial ? toLocalInputs(new Date(initial.sold_at)) : toLocalInputs();
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [customer, setCustomer] = useState(initial?.customer_name ?? '');
  const [items, setItems] = useState<ItemRow[]>([]);
  const [itemsLoading, setItemsLoading] = useState(Boolean(initial));
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const cents = items.reduce((a, i) => a + i.quantity * i.unit_cents, 0);

  // Edição: carrega os itens da venda
  useEffect(() => {
    if (!initial) return;
    supabase.from('sale_items').select('*').eq('sale_id', initial.id).order('position').then(({ data }) => {
      const rows = (data ?? []) as SaleItem[];
      setItems(rows.length
        ? rows.map((r) => ({ key: ++rowSeq, category_id: r.category_id, quantity: r.quantity, unit_cents: r.unit_price_cents, unit_text: formatCents(r.unit_price_cents, false) }))
        : [{ key: ++rowSeq, category_id: initial.category_id, quantity: 1, unit_cents: initial.total_cents, unit_text: formatCents(initial.total_cents, false) }]);
      setItemsLoading(false);
    });
  }, [initial]);

  function addItem(categoryId: string) {
    const key = ++rowSeq;
    setItems((l) => [...l, { key, category_id: categoryId, quantity: 1, unit_cents: 0, unit_text: '' }]);
    setFocusKey(key);
    setErrors((e) => ({ ...e, items: '' }));
  }
  const updateItem = (key: number, patch: Partial<ItemRow>) => setItems((l) => l.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const removeItem = (key: number) => setItems((l) => l.filter((i) => i.key !== key));
  const [installments, setInstallments] = useState(initial?.installments ?? 1);
  const [firstDue, setFirstDue] = useState(initial?.first_due_date ?? start.date);
  const [dueTouched, setDueTouched] = useState(Boolean(initial));
  const [upfrontPaid, setUpfrontPaid] = useState(initial ? initial.upfront_paid : true);
  const [sellerId, setSellerId] = useState(initial?.seller_id ?? (isAdmin ? '' : profile?.id ?? ''));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Vendedores que podem receber vendas (precisam ter empresa)
  const sellers = useMemo(
    () => profiles.data.filter((p) => p.organization_id && (p.active || p.id === initial?.seller_id)),
    [profiles.data, initial?.seller_id],
  );

  const plan = cents > 0 ? splitInstallments(cents, installments) : null;
  const schedule = firstDue ? dueSchedule(firstDue, installments) : [];

  /** Sugere o 1º vencimento: à vista = dia da venda; parcelado = 1 mês depois. */
  function suggestDue(n: number, saleDate: string) {
    if (!dueTouched && saleDate) setFirstDue(n === 1 ? saleDate : addMonthsISO(saleDate, 1));
  }
  function changeInstallments(n: number) {
    setInstallments(n);
    suggestDue(n, date);
    if (!initial) setUpfrontPaid(n === 1);
  }

  function validate() {
    const e: Record<string, string> = {};
    const name = customer.trim().replace(/\s+/g, ' ');
    if (name.length < 2) e.customer = 'Informe o nome do cliente.';
    else if (name.length > 120) e.customer = 'Nome muito longo.';
    if (items.length === 0) e.items = 'Adicione pelo menos um item tocando na categoria.';
    else if (items.some((i) => i.unit_cents <= 0)) e.items = 'Informe o valor de cada item.';
    else if (cents > MAX_CENTS) e.items = 'Valor acima do limite permitido.';
    if (!date || !time) e.date = 'Informe data e horário.';
    else if (new Date(fromLocalInputs(date, time)).getTime() > Date.now() + 5 * 60_000) e.date = 'A data da venda não pode estar no futuro.';
    if (!firstDue) e.due = 'Informe o vencimento da 1ª parcela.';
    else if (date && firstDue < date) e.due = 'O vencimento não pode ser antes da data da venda.';
    if (isAdmin && !sellerId) e.seller = 'Escolha o vendedor.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setFormError(null);
    if (!validate() || !profile) return;
    const seller = isAdmin ? sellers.find((s) => s.id === sellerId) : profile;
    if (!seller?.organization_id) return setFormError('O vendedor escolhido não está vinculado a uma empresa.');

    const payload = {
      customer_name: customer.trim().replace(/\s+/g, ' '),
      installments,
      sold_at: fromLocalInputs(date, time),
      first_due_date: firstDue,
      upfront_paid: upfrontPaid,
      seller_id: seller.id,
      organization_id: seller.organization_id,
      items: items.map((i) => ({ category_id: i.category_id, quantity: i.quantity, unit_price_cents: i.unit_cents })),
    };
    setSaving(true);
    // Venda + itens gravados juntos numa única transação no banco
    const { data, error } = await supabase.rpc('save_sale', { p_sale_id: initial?.id ?? null, p_data: payload });
    setSaving(false);
    if (error) return setFormError(friendlyError(error));
    onSaved(data as Sale);
  }

  const catById = useMemo(() => new Map(categories.data.map((c) => [c.id, c])), [categories.data]);

  if (categories.loading || profiles.loading || itemsLoading) {
    return <div className="flex justify-center py-16 text-gold-500"><Spinner className="h-7 w-7" /></div>;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      {(formError || categories.error) && <Alert kind="error">{formError ?? categories.error}</Alert>}

      {isAdmin && (
        <Select label="Vendedor" value={sellerId} onChange={(e) => setSellerId(e.target.value)} error={errors.seller}
          hint={sellers.length === 0 ? 'Cadastre um vendedor em "Vendedores" antes de lançar vendas.' : undefined}>
          <option value="">Selecione…</option>
          {sellers.map((s) => <option key={s.id} value={s.id}>{s.full_name}{s.active ? '' : ' (inativo)'}</option>)}
        </Select>
      )}

      <Input label="Cliente" value={customer} onChange={(e) => setCustomer(e.target.value)} error={errors.customer}
        leading={<User className="h-4 w-4" />} placeholder="Nome do cliente" autoComplete="off" maxLength={120} autoFocus={!initial} />

      <div>
        <span className="field-label">{items.length ? 'Adicionar mais itens' : 'Itens da venda'}</span>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label="Adicionar item por categoria">
          {categories.data.map((c) => {
            const qty = items.filter((i) => i.category_id === c.id).reduce((a, i) => a + i.quantity, 0);
            return (
              <button key={c.id} type="button" onClick={() => addItem(c.id)}
                className={cn(
                  'relative flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-medium transition',
                  qty ? 'border-gold-400 bg-navy text-ivory' : 'border-navy/10 bg-white text-navy/70 hover:border-gold-300 hover:bg-gold-50',
                )}>
                {qty > 0 && <span className="absolute right-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-gold-400 px-1 text-[11px] font-bold text-navy">{qty}</span>}
                <CategoryIcon slug={c.slug} className={cn('h-7 w-7', qty ? 'text-gold-400' : 'text-navy/60')} />
                {c.name}
                <Plus className={cn('absolute bottom-1.5 right-1.5 h-3 w-3', qty ? 'text-gold-300' : 'text-navy/30')} />
              </button>
            );
          })}
        </div>
        {items.length === 0 && !errors.items && <p className="mt-1.5 text-xs text-navy/50">Toque numa categoria para adicionar um item. Pode adicionar quantos quiser.</p>}

        {items.length > 0 && (
          <ul className="mt-3 divide-y divide-navy/[0.06] rounded-xl border border-navy/10 bg-white">
            {items.map((it) => {
              const cat = catById.get(it.category_id);
              return (
                <li key={it.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:flex-nowrap">
                  <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium text-navy">
                    <CategoryIcon slug={cat?.slug ?? ''} className="h-5 w-5 shrink-0 text-gold-500" />
                    <span className="truncate">{cat?.name}</span>
                  </span>
                  <div className="flex items-center rounded-lg border border-navy/15" aria-label="Quantidade">
                    <button type="button" className="p-2 text-navy/60 hover:text-navy disabled:opacity-30" disabled={it.quantity <= 1}
                      onClick={() => updateItem(it.key, { quantity: it.quantity - 1 })} aria-label="Diminuir"><Minus className="h-3.5 w-3.5" /></button>
                    <span className="w-7 text-center text-sm font-semibold text-navy">{it.quantity}</span>
                    <button type="button" className="p-2 text-navy/60 hover:text-navy disabled:opacity-30" disabled={it.quantity >= 999}
                      onClick={() => updateItem(it.key, { quantity: it.quantity + 1 })} aria-label="Aumentar"><Plus className="h-3.5 w-3.5" /></button>
                  </div>
                  <div className="relative w-32">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs font-semibold text-navy/45">R$</span>
                    <input inputMode="numeric" placeholder="0,00" value={it.unit_text} autoFocus={focusKey === it.key}
                      aria-label={`Valor unitário de ${cat?.name ?? 'item'}`}
                      onChange={(e) => { const m = maskCentsInput(e.target.value); updateItem(it.key, { unit_cents: m.cents, unit_text: m.display }); }}
                      className={cn('field-input py-2 pl-9 text-right font-semibold', it.unit_cents <= 0 && errors.items && 'border-red-600')} />
                  </div>
                  <span className="w-24 text-right text-sm font-semibold text-navy">{formatCents(it.quantity * it.unit_cents)}</span>
                  <button type="button" onClick={() => removeItem(it.key)} className="rounded-lg p-2 text-navy/40 hover:bg-red-50 hover:text-red-700" aria-label="Remover item">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
            <li className="flex items-center justify-between px-3 py-3">
              <span className="text-sm text-navy/60">{items.reduce((a, i) => a + i.quantity, 0)} peça(s)</span>
              <span className="text-lg font-semibold text-navy">Total {formatCents(cents)}</span>
            </li>
          </ul>
        )}
        {errors.items && <p className="mt-1.5 text-sm text-red-700">{errors.items}</p>}
      </div>

      <Select label="Parcelas" value={installments} onChange={(e) => changeInstallments(Number(e.target.value))}>
        {INSTALLMENT_OPTIONS.map((n) => (
          <option key={n} value={n}>{n === 1 ? 'À vista (1x)' : `${n}x`}{cents > 0 ? ` · ${formatCents(splitInstallments(cents, n).baseCents)}` : ''}</option>
        ))}
      </Select>

      <div className="grid grid-cols-2 gap-4">
        <Input label="Data da venda" type="date" value={date} onChange={(e) => { setDate(e.target.value); suggestDue(installments, e.target.value); }} error={errors.date} leading={<CalendarDays className="h-4 w-4" />} />
        <Input label="Horário" type="time" value={time} onChange={(e) => setTime(e.target.value)} leading={<Clock className="h-4 w-4" />} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={installments === 1 ? 'Vencimento' : 'Vencimento da 1ª parcela'} type="date" value={firstDue} error={errors.due}
          onChange={(e) => { setFirstDue(e.target.value); setDueTouched(true); }} leading={<CalendarDays className="h-4 w-4" />}
          hint={installments > 1 && firstDue ? `As demais vencem todo dia ${Number(firstDue.slice(8))}.` : undefined} />
        <label className="flex cursor-pointer items-center gap-3 self-end rounded-lg border border-navy/10 bg-white px-3.5 py-3 text-[15px] text-navy hover:border-gold-300">
          <input type="checkbox" checked={upfrontPaid} onChange={(e) => setUpfrontPaid(e.target.checked)} className="h-4 w-4 accent-[#21165F]" />
          {installments === 1 ? 'Pagamento recebido no ato' : '1ª parcela paga no ato (entrada)'}
        </label>
      </div>

      {plan && (
        <div className="rounded-xl border border-gold-200 bg-gold-50 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-navy/70">Valor por parcela</span>
            <span className="text-right font-semibold text-navy">{describeInstallments(cents, installments)}</span>
          </div>
          {installments > 1 && schedule.length > 0 && (
            <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-gold-200 pt-2 text-xs text-navy/70 sm:grid-cols-3">
              {schedule.map((d, i) => (
                <li key={d + i} className="flex justify-between gap-2">
                  <span>{i + 1}ª · {formatDateOnly(d)}</span>
                  <span className="font-medium text-navy">{formatCents(i === 0 ? plan.firstCents : plan.baseCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>}
        <Button type="submit" size="lg" loading={saving} className="sm:min-w-48">{submitLabel}</Button>
      </div>
    </form>
  );
}

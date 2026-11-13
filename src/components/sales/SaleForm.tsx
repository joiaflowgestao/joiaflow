import { CalendarDays, Clock, User } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
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
import type { Sale } from '@/types/database';

const MAX_CENTS = 100_000_000; // R$ 1.000.000,00
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
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? '');
  const [cents, setCents] = useState(initial?.total_cents ?? 0);
  const [amountText, setAmountText] = useState(initial ? formatCents(initial.total_cents, false) : '');
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
    if (!categoryId) e.category = 'Escolha a categoria.';
    if (cents <= 0) e.amount = 'Informe o valor da venda.';
    else if (cents > MAX_CENTS) e.amount = 'Valor acima do limite permitido.';
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
      category_id: categoryId,
      total_cents: cents,
      installments,
      sold_at: fromLocalInputs(date, time),
      first_due_date: firstDue,
      upfront_paid: upfrontPaid,
      seller_id: seller.id,
      organization_id: seller.organization_id,
    };
    setSaving(true);
    const q = initial
      ? supabase.from('sales').update(payload).eq('id', initial.id).select().single()
      : supabase.from('sales').insert(payload).select().single();
    const { data, error } = await q;
    setSaving(false);
    if (error) return setFormError(friendlyError(error));
    onSaved(data as Sale);
  }

  if (categories.loading || profiles.loading) {
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
        <span className="field-label">Categoria</span>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" role="radiogroup" aria-label="Categoria">
          {categories.data.map((c) => {
            const active = c.id === categoryId;
            return (
              <button key={c.id} type="button" role="radio" aria-checked={active} onClick={() => setCategoryId(c.id)}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-medium transition',
                  active ? 'border-gold-400 bg-navy text-ivory shadow-gold' : 'border-navy/10 bg-white text-navy/70 hover:border-gold-300 hover:bg-gold-50',
                )}>
                <CategoryIcon slug={c.slug} className={cn('h-7 w-7', active ? 'text-gold-400' : 'text-navy/60')} />
                {c.name}
              </button>
            );
          })}
        </div>
        {errors.category && <p className="mt-1.5 text-sm text-red-700">{errors.category}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Valor total" inputMode="numeric" value={amountText} error={errors.amount}
          leading={<span className="text-sm font-semibold">R$</span>} placeholder="0,00"
          onChange={(e) => { const m = maskCentsInput(e.target.value); setCents(m.cents); setAmountText(m.display); }}
          className="text-lg font-semibold" />
        <Select label="Parcelas" value={installments} onChange={(e) => changeInstallments(Number(e.target.value))}>
          {INSTALLMENT_OPTIONS.map((n) => (
            <option key={n} value={n}>{n === 1 ? 'À vista (1x)' : `${n}x`}{cents > 0 ? ` · ${formatCents(splitInstallments(cents, n).baseCents)}` : ''}</option>
          ))}
        </Select>
      </div>

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

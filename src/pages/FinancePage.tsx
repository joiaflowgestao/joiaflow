import { ArrowDownCircle, ArrowUpCircle, NotebookPen, Pencil, Scale, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Field';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { useProfiles } from '@/hooks/useData';
import { cn } from '@/lib/cn';
import { addMonthsISO, currentYearMonth, formatDateOnly, MONTHS_PT, todayISO } from '@/lib/datetime';
import { formatCents, maskCentsInput } from '@/lib/money';
import { friendlyError, supabase } from '@/lib/supabase';
import { yearOptions } from '@/pages/sales/HistoryPage';
import type { FinancialEntry } from '@/types/database';

const pad = (n: number) => String(n).padStart(2, '0');

/** Formulário de lançamento (novo ou edição). */
function EntryForm({ initial, onSaved, onCancel }: { initial?: FinancialEntry; onSaved: () => void; onCancel?: () => void }) {
  const toast = useToast();
  const [date, setDate] = useState(initial?.entry_date ?? todayISO());
  const [kind, setKind] = useState<'in' | 'out'>(initial?.kind ?? 'in');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [cents, setCents] = useState(initial?.amount_cents ?? 0);
  const [amountText, setAmountText] = useState(initial ? formatCents(initial.amount_cents, false) : '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const er: Record<string, string> = {};
    const desc = description.trim().replace(/\s+/g, ' ');
    if (desc.length < 2) er.description = 'Descreva o lançamento.';
    if (cents <= 0) er.amount = 'Informe o valor.';
    if (!date) er.date = 'Informe a data.';
    setErrors(er);
    if (Object.keys(er).length) return;

    setSaving(true);
    const payload = { entry_date: date, kind, description: desc, amount_cents: cents };
    const { error } = initial
      ? await supabase.from('financial_entries').update(payload).eq('id', initial.id)
      : await supabase.from('financial_entries').insert(payload);
    setSaving(false);
    if (error) return setFormError(friendlyError(error));
    toast.success(initial ? 'Lançamento atualizado.' : 'Lançamento salvo.');
    if (!initial) { setDescription(''); setCents(0); setAmountText(''); }
    onSaved();
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {formError && <Alert kind="error">{formError}</Alert>}
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo">
        {([['in', 'Entrada', 'Recebi', ArrowDownCircle], ['out', 'Saída', 'Paguei / gastei', ArrowUpCircle]] as const).map(([k, label, hint, Icon]) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
            className={cn('flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition',
              kind === k
                ? k === 'in' ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-red-400 bg-red-50 text-red-800'
                : 'border-navy/10 bg-white text-navy/60 hover:border-gold-300')}>
            <Icon className="h-5 w-5 shrink-0" />
            <span><span className="block text-sm font-semibold">{label}</span><span className="block text-xs opacity-70">{hint}</span></span>
          </button>
        ))}
      </div>
      <Input label="Descrição" value={description} onChange={(e) => setDescription(e.target.value)} error={errors.description}
        placeholder="Ex.: Recebi da Maria a 2ª parcela (pix)" maxLength={300} />
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <Input label="Valor" inputMode="numeric" value={amountText} error={errors.amount} placeholder="0,00"
          leading={<span className="text-sm font-semibold">R$</span>} className="font-semibold"
          onChange={(e) => { const m = maskCentsInput(e.target.value); setCents(m.cents); setAmountText(m.display); }} />
        <Input label="Data" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={errors.date} />
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>}
        <Button type="submit" loading={saving} className="sm:min-w-40">{initial ? 'Salvar alterações' : 'Salvar lançamento'}</Button>
      </div>
    </form>
  );
}

export function FinancePage() {
  const { profile, isAdmin } = useAuth();
  const toast = useToast();
  const profiles = useProfiles();
  const now = currentYearMonth();
  const [year, setYear] = useState(now.year);
  const [month, setMonth] = useState(now.month);
  const [userId, setUserId] = useState(''); // admin: filtrar por vendedora
  const [rows, setRows] = useState<FinancialEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<FinancialEntry | null>(null);
  const [deleting, setDeleting] = useState<FinancialEntry | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const start = `${year}-${pad(month)}-01`;
    let q = supabase.from('financial_entries')
      .select('*, user:profiles!financial_entries_user_id_fkey(full_name)')
      .gte('entry_date', start).lt('entry_date', addMonthsISO(start, 1))
      .order('entry_date', { ascending: false }).order('created_at', { ascending: false })
      .limit(1000);
    if (userId) q = q.eq('user_id', userId);
    const { data, error } = await q;
    if (error) setError(friendlyError(error));
    else { setError(null); setRows((data ?? []) as FinancialEntry[]); }
    setLoading(false);
  }, [year, month, userId]);
  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    const inc = rows.filter((r) => r.kind === 'in').reduce((a, r) => a + r.amount_cents, 0);
    const out = rows.filter((r) => r.kind === 'out').reduce((a, r) => a + r.amount_cents, 0);
    return { inc, out, balance: inc - out };
  }, [rows]);

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    const { error } = await supabase.from('financial_entries').delete().eq('id', deleting.id);
    setDeleteBusy(false);
    if (error) return toast.error(friendlyError(error));
    toast.success('Lançamento excluído.');
    setDeleting(null);
    load();
  }

  const people = profiles.data.filter((p) => p.active || rows.some((r) => r.user_id === p.id));
  const showOwner = isAdmin && !userId;

  return (
    <>
      <PageHeader title="Lançamentos financeiros" subtitle="Seu controle pessoal do que recebe e gasta. Não entra nos relatórios de vendas." />

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="min-w-0 lg:col-span-2 lg:self-start">
          <CardHeader title="Novo lançamento" />
          <CardBody><EntryForm onSaved={load} /></CardBody>
        </Card>

        <div className="min-w-0 space-y-4 lg:col-span-3">
          <Card>
            <CardBody className="grid grid-cols-2 gap-3 pt-5 sm:pt-6">
              <Select label="Mês" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {MONTHS_PT.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </Select>
              <Select label="Ano" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {yearOptions().map((y) => <option key={y} value={y}>{y}</option>)}
              </Select>
              {isAdmin && (
                <div className="col-span-2">
                  <Select label="Pessoa" value={userId} onChange={(e) => setUserId(e.target.value)}>
                    <option value="">Todas</option>
                    {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}{p.id === profile?.id ? ' (você)' : ''}</option>)}
                  </Select>
                </div>
              )}
            </CardBody>
          </Card>

          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <Total label="Entradas" value={totals.inc} icon={ArrowDownCircle} tone="text-emerald-700" />
            <Total label="Saídas" value={totals.out} icon={ArrowUpCircle} tone="text-red-700" />
            <Total label="Saldo" value={totals.balance} icon={Scale} tone={totals.balance < 0 ? 'text-red-700' : 'text-navy'} strong />
          </div>

          {error && <Alert kind="error">{error}</Alert>}

          <Card>
            {loading ? (
              <div className="flex justify-center py-14 text-gold-500"><Spinner /></div>
            ) : rows.length === 0 ? (
              <CardBody className="flex flex-col items-center py-14 text-center text-sm text-navy/55">
                <NotebookPen className="mb-2 h-7 w-7 text-gold-400" />
                Nenhum lançamento em {MONTHS_PT[month - 1]} de {year}.
              </CardBody>
            ) : (
              <ul className="divide-y divide-navy/[0.06]">
                {rows.map((r) => (
                  <li key={r.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                    <div className={cn('mt-0.5 rounded-full p-1.5', r.kind === 'in' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
                      {r.kind === 'in' ? <ArrowDownCircle className="h-4 w-4" /> : <ArrowUpCircle className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm text-navy">{r.description}</p>
                      <p className="mt-0.5 text-xs text-navy/50">
                        {formatDateOnly(r.entry_date)}{showOwner && r.user?.full_name ? ` · ${r.user.full_name}` : ''}
                      </p>
                    </div>
                    <span className={cn('metric whitespace-nowrap text-sm', r.kind === 'in' ? 'text-emerald-700' : 'text-red-700')}>
                      {r.kind === 'in' ? '+' : '−'} {formatCents(r.amount_cents)}
                    </span>
                    <div className="flex shrink-0">
                      <button className="rounded-lg p-1.5 text-navy/45 hover:bg-navy/5 hover:text-navy" title="Editar" onClick={() => setEditing(r)}><Pencil className="h-4 w-4" /></button>
                      <button className="rounded-lg p-1.5 text-navy/45 hover:bg-red-50 hover:text-red-700" title="Excluir" onClick={() => setDeleting(r)}><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Editar lançamento">
        {editing && <EntryForm initial={editing} onSaved={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />}
      </Modal>
      <ConfirmDialog
        open={!!deleting}
        title="Excluir lançamento"
        danger
        loading={deleteBusy}
        confirmLabel="Excluir"
        message={deleting && <>Excluir “{deleting.description}” ({formatCents(deleting.amount_cents)})?</>}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

function Total({ label, value, icon: Icon, tone, strong }: { label: string; value: number; icon: typeof Scale; tone: string; strong?: boolean }) {
  return (
    <div className={cn('rounded-xl border p-3 shadow-card sm:p-4', strong ? 'border-gold-300 bg-gold-50' : 'border-navy/[0.06] bg-white')}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-navy/50 sm:text-[11px]">{label}</p>
        <Icon className={cn('hidden h-4 w-4 sm:block', tone)} />
      </div>
      <p className={cn('metric mt-1 truncate text-base sm:text-xl', tone)}>{value < 0 ? '−' : ''}{formatCents(Math.abs(value))}</p>
    </div>
  );
}

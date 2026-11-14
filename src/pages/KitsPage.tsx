import { BarChart3, Briefcase, CalendarCheck, CalendarDays, PackageCheck, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Field';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { useProfiles } from '@/hooks/useData';
import { useKits } from '@/hooks/useKits';
import { cn } from '@/lib/cn';
import { formatDateOnly, todayISO } from '@/lib/datetime';
import { friendlyError, supabase } from '@/lib/supabase';
import type { Kit } from '@/types/database';

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Nova maleta ou edição das datas. */
function KitForm({ initial, onDone, onCancel }: { initial?: Kit; onDone: () => void; onCancel: () => void }) {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const profiles = useProfiles();
  const [sellerId, setSellerId] = useState(initial?.seller_id ?? '');
  const [received, setReceived] = useState(initial?.received_on ?? todayISO());
  const [returned, setReturned] = useState(initial?.returned_on ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const sellers = profiles.data.filter((p) => p.organization_id && p.active);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (isAdmin && !initial && !sellerId) return setError('Escolha a vendedora.');
    if (!received) return setError('Informe a data de recebimento.');
    if (returned && returned < received) return setError('A entrega não pode ser antes do recebimento.');
    setSaving(true);
    const payload = { received_on: received, returned_on: returned || null, notes: notes.trim() || null, ...(isAdmin && !initial ? { seller_id: sellerId } : {}) };
    const { error } = initial
      ? await supabase.from('kits').update(payload).eq('id', initial.id)
      : await supabase.from('kits').insert(payload);
    setSaving(false);
    if (error) {
      return setError(/uq_kits_open|duplicate/i.test(error.message) ? 'Esta vendedora já está com uma maleta em aberto. Registre a entrega dela primeiro.' : friendlyError(error));
    }
    toast.success(initial ? 'Maleta atualizada.' : 'Maleta registrada.');
    onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert kind="error">{error}</Alert>}
      {isAdmin && !initial && (
        <Select label="Vendedora" value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
          <option value="">Selecione…</option>
          {sellers.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </Select>
      )}
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <Input label="Recebida em" type="date" value={received} onChange={(e) => setReceived(e.target.value)} />
        <Input label="Entregue em" type="date" value={returned} onChange={(e) => setReturned(e.target.value)} hint="Vazio = ainda com ela" />
      </div>
      <div>
        <label htmlFor="kit-notes" className="field-label">Observação (opcional)</label>
        <textarea id="kit-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} className="field-input resize-y"
          placeholder="Ex.: maleta de verão, conferida no recebimento" />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" loading={saving}>{initial ? 'Salvar' : 'Registrar maleta'}</Button>
      </div>
    </form>
  );
}

/** Registrar a entrega (acerto). */
function ReturnForm({ kit, onDone, onCancel }: { kit: Kit; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [date, setDate] = useState(todayISO());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!date || date < kit.received_on) return setError('A entrega não pode ser antes do recebimento.');
    setSaving(true);
    const { error } = await supabase.from('kits').update({ returned_on: date }).eq('id', kit.id);
    setSaving(false);
    if (error) return setError(friendlyError(error));
    toast.success('Entrega registrada.');
    onDone();
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-navy/70">Maleta recebida em <strong>{formatDateOnly(kit.received_on)}</strong>{kit.seller?.full_name ? <> por <strong>{kit.seller.full_name}</strong></> : null}.</p>
      {error && <Alert kind="error">{error}</Alert>}
      <Input label="Data da entrega" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" variant="gold" loading={saving}><PackageCheck className="h-4 w-4" /> Registrar entrega</Button>
      </div>
    </form>
  );
}

export function KitsPage() {
  const { profile, isAdmin } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const profiles = useProfiles();
  const [sellerFilter, setSellerFilter] = useState('');
  const kits = useKits(sellerFilter || undefined);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Kit | null>(null);
  const [returning, setReturning] = useState<Kit | null>(null);
  const [deleting, setDeleting] = useState<Kit | null>(null);
  const [busy, setBusy] = useState(false);
  const today = todayISO();

  const open = useMemo(() => kits.data.filter((k) => !k.returned_on), [kits.data]);
  const closed = useMemo(() => kits.data.filter((k) => k.returned_on), [kits.data]);
  const myOpen = !isAdmin && open.length > 0;
  const done = () => { setCreating(false); setEditing(null); setReturning(null); kits.reload(); };

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    const { error } = await supabase.from('kits').delete().eq('id', deleting.id);
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    toast.success('Registro excluído.');
    setDeleting(null);
    kits.reload();
  }

  const KitRow = ({ k }: { k: Kit }) => {
    const end = k.returned_on ?? today;
    const days = daysBetween(k.received_on, end);
    return (
      <li className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
        <div className={cn('rounded-full p-2', k.returned_on ? 'bg-navy/5 text-navy/50' : 'bg-gold-100 text-gold-600')}><Briefcase className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          {isAdmin && <p className="truncate text-sm font-medium text-navy">{k.seller?.full_name}</p>}
          <p className={cn('text-sm', isAdmin ? 'text-navy/65' : 'font-medium text-navy')}>
            {formatDateOnly(k.received_on)} → {k.returned_on ? formatDateOnly(k.returned_on) : <span className="text-gold-600">em aberto</span>}
            <span className="text-navy/45"> · {days} dia{days === 1 ? '' : 's'}</span>
          </p>
          {k.notes && <p className="truncate text-xs text-navy/50">{k.notes}</p>}
        </div>
        <div className="flex flex-wrap gap-1">
          {!k.returned_on && <Button size="sm" variant="gold" onClick={() => setReturning(k)}><PackageCheck className="h-3.5 w-3.5" /> Entregar</Button>}
          <Button size="sm" variant="outline" onClick={() => navigate(`/relatorios?maleta=${k.id}`)}><BarChart3 className="h-3.5 w-3.5" /> Relatório</Button>
          <button className="rounded-lg p-2 text-navy/45 hover:bg-navy/5 hover:text-navy" title="Editar datas" onClick={() => setEditing(k)}><Pencil className="h-4 w-4" /></button>
          <button className="rounded-lg p-2 text-navy/45 hover:bg-red-50 hover:text-red-700" title="Excluir" onClick={() => setDeleting(k)}><Trash2 className="h-4 w-4" /></button>
        </div>
      </li>
    );
  };

  return (
    <>
      <PageHeader
        title="Maletas"
        subtitle="Controle de quando cada maleta foi recebida e entregue para o acerto."
        actions={(isAdmin || !myOpen) && <Button variant="gold" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> {isAdmin ? 'Entregar maleta' : 'Recebi uma maleta'}</Button>}
      />

      {!isAdmin && myOpen && (() => {
        const k = open[0];
        const days = daysBetween(k.received_on, today);
        return (
          <div className="mb-6 overflow-hidden rounded-xl border border-navy bg-navy bg-[radial-gradient(ellipse_at_top_right,_#21165F_0%,_#0D0737_70%)] p-5 text-ivory shadow-card">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gold-300">Maleta atual</p>
            <p className="metric mt-1 text-2xl">Desde {formatDateOnly(k.received_on)}</p>
            <p className="text-sm text-ivory/65">Com você há {days} dia{days === 1 ? '' : 's'}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="gold" onClick={() => navigate(`/relatorios?maleta=${k.id}`)}><BarChart3 className="h-4 w-4" /> Relatório da maleta</Button>
              <Button variant="outline" className="border-white/20 bg-transparent text-ivory hover:bg-white/10" onClick={() => setReturning(k)}><CalendarCheck className="h-4 w-4" /> Registrar entrega</Button>
            </div>
          </div>
        );
      })()}

      {isAdmin && (
        <div className="mb-5 max-w-sm">
          <Select label="Vendedora" value={sellerFilter} onChange={(e) => setSellerFilter(e.target.value)}>
            <option value="">Todas</option>
            {profiles.data.filter((p) => p.organization_id).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </Select>
        </div>
      )}

      {kits.error && <Alert kind="error" className="mb-4">{kits.error}</Alert>}

      {kits.loading ? (
        <div className="flex justify-center py-16 text-gold-500"><Spinner className="h-7 w-7" /></div>
      ) : kits.data.length === 0 ? (
        <Card><CardBody className="flex flex-col items-center py-14 text-center text-sm text-navy/55">
          <Briefcase className="mb-2 h-7 w-7 text-gold-400" />
          Nenhuma maleta registrada ainda.
          {profile && <span className="mt-1">{isAdmin ? 'Use "Entregar maleta" quando uma vendedora levar uma maleta.' : 'Use "Recebi uma maleta" quando pegar a sua.'}</span>}
        </CardBody></Card>
      ) : (
        <div className="space-y-6">
          {isAdmin && open.length > 0 && (
            <section>
              <h2 className="mb-2 flex items-center gap-2 font-display text-2xl font-semibold text-navy"><CalendarDays className="h-5 w-5 text-gold-500" /> Em aberto · {open.length}</h2>
              <Card><ul className="divide-y divide-navy/[0.06]">{open.map((k) => <KitRow key={k.id} k={k} />)}</ul></Card>
            </section>
          )}
          {closed.length > 0 && (
            <section>
              <h2 className="mb-2 font-display text-2xl font-semibold text-navy">Entregues</h2>
              <Card><ul className="divide-y divide-navy/[0.06]">{closed.map((k) => <KitRow key={k.id} k={k} />)}</ul></Card>
            </section>
          )}
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title={isAdmin ? 'Entregar maleta' : 'Recebi uma maleta'}>
        <KitForm onDone={done} onCancel={() => setCreating(false)} />
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Editar maleta">
        {editing && <KitForm initial={editing} onDone={done} onCancel={() => setEditing(null)} />}
      </Modal>
      <Modal open={!!returning} onClose={() => setReturning(null)} title="Registrar entrega" size="sm">
        {returning && <ReturnForm kit={returning} onDone={done} onCancel={() => setReturning(null)} />}
      </Modal>
      <ConfirmDialog open={!!deleting} title="Excluir registro da maleta" danger loading={busy} confirmLabel="Excluir"
        message={deleting && <>Excluir o registro da maleta recebida em {formatDateOnly(deleting.received_on)}? As vendas não são afetadas.</>}
        onConfirm={confirmDelete} onCancel={() => setDeleting(null)} />
    </>
  );
}

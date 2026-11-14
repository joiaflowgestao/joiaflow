import { ArrowLeftRight, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExchangeCard, ExchangeForm } from '@/components/sales/ExchangeForm';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { useProfiles } from '@/hooks/useData';
import { currentYearMonth, formatDate, MONTHS_PT, monthRange } from '@/lib/datetime';
import { fetchExchanges } from '@/lib/exchanges';
import { formatCents } from '@/lib/money';
import { buildSalesQuery, itemsLabel } from '@/lib/salesQuery';
import { friendlyError } from '@/lib/supabase';
import { yearOptions } from '@/pages/sales/HistoryPage';
import type { Exchange, SaleWithRelations } from '@/types/database';

export function ExchangesPage() {
  const { profile, isAdmin } = useAuth();
  const toast = useToast();
  const profiles = useProfiles();

  // Busca da venda
  const [search, setSearch] = useState('');
  const [sales, setSales] = useState<SaleWithRelations[]>([]);
  const [searching, setSearching] = useState(false);
  const [target, setTarget] = useState<SaleWithRelations | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      setSearching(true);
      const { data } = await buildSalesQuery({ search }).limit(search.trim() ? 20 : 8);
      setSales(((data ?? []) as unknown as SaleWithRelations[]).filter((s) => isAdmin || s.seller_id === profile?.id));
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [search, isAdmin, profile?.id]);

  // Trocas realizadas
  const now = currentYearMonth();
  const [year, setYear] = useState(now.year);
  const [month, setMonth] = useState(now.month);
  const [sellerId, setSellerId] = useState('');
  const [list, setList] = useState<Exchange[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const range = useMemo(() => monthRange(year, month), [year, month]);

  const load = useCallback(async () => {
    setList(null);
    try { setList(await fetchExchanges(range, { sellerId: sellerId || undefined })); setError(null); }
    catch (e) { setError(friendlyError(e)); setList([]); }
  }, [range, sellerId]);
  useEffect(() => { load(); }, [load]);

  const sellers = profiles.data.filter((p) => p.organization_id);
  const diffTotal = (list ?? []).reduce((a, x) => a + x.difference_cents, 0);

  return (
    <>
      <PageHeader title="Trocas" subtitle="Troque itens de uma venda: o valor e as parcelas são recalculados automaticamente." />

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="min-w-0 lg:col-span-2 lg:self-start">
          <CardHeader title="Nova troca" subtitle="Encontre a venda pelo nome da cliente" />
          <CardBody className="space-y-3">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome da cliente" leading={<Search className="h-4 w-4" />} />
            {searching ? (
              <div className="flex justify-center py-6 text-gold-500"><Spinner /></div>
            ) : sales.length === 0 ? (
              <p className="py-6 text-center text-sm text-navy/50">Nenhuma venda encontrada.</p>
            ) : (
              <ul className="divide-y divide-navy/[0.06] rounded-xl border border-navy/[0.08]">
                {!search.trim() && <li className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-navy/45">Vendas recentes</li>}
                {sales.map((s) => (
                  <li key={s.id} className="flex min-w-0 items-center gap-3 px-3 py-2.5">
                    <CategoryIcon slug={s.category?.slug ?? ''} className="h-5 w-5 shrink-0 text-gold-500" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-navy">{s.customer_name}</p>
                      <p className="truncate text-xs text-navy/55">{formatDate(s.sold_at)} · {formatCents(s.total_cents)} · {itemsLabel(s)}</p>
                    </div>
                    <Button size="sm" variant="gold" className="shrink-0" onClick={() => setTarget(s)}><ArrowLeftRight className="h-3.5 w-3.5" /> Trocar</Button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-navy/45">Você também pode fazer a troca pelo Histórico de vendas, abrindo a venda.</p>
          </CardBody>
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
                  <Select label="Vendedora" value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
                    <option value="">Todas</option>
                    {sellers.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                  </Select>
                </div>
              )}
            </CardBody>
          </Card>

          {error && <Alert kind="error">{error}</Alert>}

          <div className="flex items-baseline justify-between px-1">
            <h2 className="font-display text-2xl font-semibold text-navy">Trocas realizadas</h2>
            {list && list.length > 0 && (
              <span className="text-sm text-navy/60">{list.length} troca{list.length > 1 ? 's' : ''} · diferença <span className="metric text-navy">{diffTotal < 0 ? '−' : '+'}{formatCents(Math.abs(diffTotal))}</span></span>
            )}
          </div>

          {!list ? (
            <div className="flex justify-center py-12 text-gold-500"><Spinner /></div>
          ) : list.length === 0 ? (
            <Card><CardBody className="py-12 text-center text-sm text-navy/55">Nenhuma troca em {MONTHS_PT[month - 1]} de {year}.</CardBody></Card>
          ) : (
            <ul className="space-y-3">{list.map((x) => <ExchangeCard key={x.id} ex={x} showSale />)}</ul>
          )}
        </div>
      </div>

      <Modal open={!!target} onClose={() => setTarget(null)} title="Fazer troca" size="lg">
        {target && (
          <ExchangeForm saleId={target.id} customer={target.customer_name} onCancel={() => setTarget(null)}
            onDone={() => { setTarget(null); toast.success('Troca registrada e venda recalculada.'); load(); }} />
        )}
      </Modal>
    </>
  );
}

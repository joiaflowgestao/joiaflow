import { ArrowDownRight, ArrowUpRight, BadgePercent, Briefcase, CalendarRange, FileSpreadsheet, FileText, Receipt, TrendingUp, Wallet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART, compactBRL, tooltipStyle } from '@/components/charts/theme';
import { ExchangeCard } from '@/components/sales/ExchangeForm';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganizations, useProfiles } from '@/hooks/useData';
import { useKits } from '@/hooks/useKits';
import { useMonthlyTotals, useSalesSummary } from '@/hooks/useSummary';
import { cn } from '@/lib/cn';
import { buildCommissionRows, type CommissionRow } from '@/lib/commission';
import { currentYearMonth, dateSpan, formatDate, formatDateOnly, MONTHS_PT, MONTHS_SHORT_PT, monthRange, shiftMonth, todayISO } from '@/lib/datetime';
import { fetchExchanges } from '@/lib/exchanges';
import { formatCents } from '@/lib/money';
import { fetchAllSales, type SalesFilters } from '@/lib/salesQuery';
import { friendlyError } from '@/lib/supabase';
import { yearOptions } from '@/pages/sales/HistoryPage';
import type { Exchange, SaleWithRelations } from '@/types/database';

type Mode = 'month' | 'kit';
const ticket = (s: { total_cents: number; count: number }) => (s.count ? Math.round(s.total_cents / s.count) : 0);
const signed = (c: number) => `${c < 0 ? '− ' : ''}${formatCents(Math.abs(c))}`;

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (!prev) return <span className="text-navy/40">sem base no mês anterior</span>;
  const d = ((cur - prev) / prev) * 100;
  const up = d >= 0;
  return (
    <span className={cn('inline-flex items-center gap-0.5 font-medium', up ? 'text-emerald-700' : 'text-red-700')}>
      {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
      {Math.abs(d).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% vs mês anterior
    </span>
  );
}

export function ReportsPage() {
  const { isAdmin, isPlatformAdmin, profile } = useAuth();
  const toast = useToast();
  const orgs = useOrganizations();
  const profiles = useProfiles();
  const [params, setParams] = useSearchParams();
  const now = currentYearMonth();
  const today = todayISO();

  const [mode, setMode] = useState<Mode>(params.get('maleta') ? 'kit' : 'month');
  const [year, setYear] = useState(now.year);
  const [month, setMonth] = useState(now.month);
  const [orgId, setOrgId] = useState('');
  const [sellerId, setSellerId] = useState('');
  const [kitId, setKitId] = useState(params.get('maleta') ?? '');
  const [exporting, setExporting] = useState<'pdf' | 'xlsx' | null>(null);

  // Maletas (admin: da vendedora escolhida; vendedora: as dela)
  const kits = useKits(isAdmin ? (sellerId || undefined) : undefined);
  const kit = kits.data.find((k) => k.id === kitId) ?? (mode === 'kit' && !kitId ? kits.data.find((k) => !k.returned_on) ?? kits.data[0] : undefined);
  useEffect(() => { if (mode === 'kit' && kit && kit.id !== kitId) setKitId(kit.id); }, [mode, kit, kitId]);
  useEffect(() => { if (kit && isAdmin && !sellerId) setSellerId(kit.seller_id); }, [kit, isAdmin, sellerId]);

  const isKit = mode === 'kit';
  const kitEnd = kit?.returned_on ?? today;
  const range = useMemo(
    () => (isKit && kit ? dateSpan(kit.received_on, kitEnd) : monthRange(year, month)),
    [isKit, kit, kitEnd, year, month],
  );
  const effSeller = isKit ? kit?.seller_id ?? '' : sellerId;
  const effOrg = isKit ? '' : orgId;

  const prev = shiftMonth(year, month, -1);
  const prevRange = useMemo(() => monthRange(prev.year, prev.month), [prev.year, prev.month]);
  const first = shiftMonth(year, month, -5);
  const sixRange = useMemo(() => ({ start: monthRange(first.year, first.month).start, end: monthRange(year, month).end }), [first.year, first.month, year, month]);

  const cur = useSalesSummary(range, effOrg, effSeller);
  const before = useSalesSummary(isKit ? range : prevRange, effOrg, effSeller);
  const monthly = useMonthlyTotals(sixRange, orgId, sellerId);
  const s = cur.data;

  // Vendas e trocas do período (comissão detalhada)
  const filters: SalesFilters = useMemo(() => isKit && kit
    ? { from: kit.received_on, to: kitEnd, sellerId: kit.seller_id }
    : { year, month, orgId: orgId || undefined, sellerId: sellerId || undefined }, [isKit, kit, kitEnd, year, month, orgId, sellerId]);
  const [sales, setSales] = useState<SaleWithRelations[] | null>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  useEffect(() => {
    if (isKit && !kit) { setSales([]); setExchanges([]); return; }
    let alive = true;
    setSales(null);
    Promise.all([
      fetchAllSales(filters),
      fetchExchanges(range, { orgId: effOrg || undefined, sellerId: effSeller || undefined }),
    ]).then(([a, b]) => { if (alive) { setSales(a); setExchanges(b); } })
      .catch((e) => { if (alive) { toast.error(friendlyError(e)); setSales([]); setExchanges([]); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, range, effOrg, effSeller, isKit, kit]);

  const commissionRows: CommissionRow[] = useMemo(
    () => (sales ? buildCommissionRows(sales, exchanges, orgs.data) : []), [sales, exchanges, orgs.data]);

  const months = useMemo(() => Array.from({ length: 6 }, (_, i) => {
    const m = shiftMonth(first.year, first.month, i);
    const key = `${m.year}-${String(m.month).padStart(2, '0')}-01`;
    const found = monthly.data.find((x) => x.month === key);
    return { label: `${MONTHS_SHORT_PT[m.month - 1]}/${String(m.year).slice(2)}`, fullLabel: `${MONTHS_PT[m.month - 1]}/${m.year}`, total_cents: Number(found?.total_cents ?? 0), count: Number(found?.count ?? 0) };
  }), [monthly.data, first.year, first.month]);

  const sellers = profiles.data.filter((p) => p.organization_id && (!orgId || p.organization_id === orgId));
  const kitSellerName = kit?.seller?.full_name ?? profiles.data.find((p) => p.id === kit?.seller_id)?.full_name ?? profile?.full_name ?? '';
  const kitPeriod = kit ? `${formatDateOnly(kit.received_on)} a ${kit.returned_on ? formatDateOnly(kit.returned_on) : `${formatDateOnly(today)} (em aberto)`}` : '';
  const title = isKit ? `Relatório da maleta — ${kitPeriod}` : `Relatório de ${MONTHS_PT[month - 1]} de ${year}`;
  const scope = isKit
    ? kitSellerName
    : [
        isPlatformAdmin ? (orgs.data.find((o) => o.id === orgId)?.name ?? 'Todas as empresas') : null,
        isAdmin ? (sellers.find((p) => p.id === sellerId)?.full_name ?? 'Todos os vendedores') : 'Minhas vendas',
      ].filter(Boolean).join(' · ');

  const rates = [...new Set(s.by_seller.map((v) => Number(v.commission_percent ?? 30)))];
  const pct = rates.length === 1 ? rates[0] : rates.length === 0 ? Number(orgs.data[0]?.commission_percent ?? 30) : null;
  const pctLabel = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
  const commission = s.commission_cents ?? 0;
  const loading = cur.loading || (!isKit && before.loading);

  function switchMode(m: Mode) {
    setMode(m);
    if (m === 'month') { params.delete('maleta'); setParams(params, { replace: true }); }
  }
  function pickKit(id: string) {
    setKitId(id);
    params.set('maleta', id); setParams(params, { replace: true });
  }

  async function doExport(kind: 'pdf' | 'xlsx') {
    if (!sales) return;
    setExporting(kind);
    try {
      const mod = await import('@/lib/exportReport');
      const data = {
        title, scope, summary: s,
        previous: isKit ? null : before.data,
        months: isKit ? [] : months.map((m) => ({ ...m, label: m.fullLabel })),
        sales, exchanges, commissionRows, showSellers: isAdmin && !isKit,
        kit: isKit && kit ? { seller: kitSellerName, period: kitPeriod, notes: kit.notes } : null,
      };
      await (kind === 'pdf' ? mod.exportPDF(data) : mod.exportExcel(data));
      toast.success(kind === 'pdf' ? 'PDF gerado.' : 'Planilha Excel gerada.');
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setExporting(null);
    }
  }

  const noKit = isKit && !kits.loading && !kit;

  return (
    <>
      <PageHeader
        title="Relatórios"
        subtitle={noKit ? 'Relatório da maleta' : `${title} · ${scope}`}
        actions={!noKit && (
          <>
            <Button variant="outline" onClick={() => doExport('pdf')} loading={exporting === 'pdf'} disabled={loading || !sales || !!exporting}><FileText className="h-4 w-4" /> PDF</Button>
            <Button variant="outline" onClick={() => doExport('xlsx')} loading={exporting === 'xlsx'} disabled={loading || !sales || !!exporting}><FileSpreadsheet className="h-4 w-4" /> Excel</Button>
          </>
        )}
      />

      <div className="mb-4 inline-flex rounded-xl border border-navy/10 bg-white p-1 shadow-card" role="tablist">
        {([['month', 'Mensal', CalendarRange], ['kit', 'Maleta', Briefcase]] as const).map(([m, label, Icon]) => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => switchMode(m)}
            className={cn('flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition', mode === m ? 'bg-navy text-ivory' : 'text-navy/60 hover:text-navy')}>
            <Icon className={cn('h-4 w-4', mode === m && 'text-gold-400')} /> {label}
          </button>
        ))}
      </div>

      <Card className="mb-6">
        <CardBody className="grid grid-cols-2 gap-3 pt-5 lg:grid-cols-4 sm:pt-6">
          {!isKit ? (
            <>
              <Select label="Mês" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {MONTHS_PT.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </Select>
              <Select label="Ano" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {yearOptions().map((y) => <option key={y} value={y}>{y}</option>)}
              </Select>
              {isPlatformAdmin && (
                <Select label="Empresa" value={orgId} onChange={(e) => { setOrgId(e.target.value); setSellerId(''); }}>
                  <option value="">Todas</option>
                  {orgs.data.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </Select>
              )}
              {isAdmin && (
                <Select label="Vendedor" value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
                  <option value="">Todos</option>
                  {sellers.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </Select>
              )}
            </>
          ) : (
            <>
              {isAdmin && (
                <Select label="Vendedora" value={sellerId} onChange={(e) => { setSellerId(e.target.value); setKitId(''); }}>
                  <option value="">Selecione…</option>
                  {profiles.data.filter((p) => p.organization_id).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </Select>
              )}
              <div className={cn(isAdmin ? '' : 'col-span-2', 'lg:col-span-2')}>
                <Select label="Maleta" value={kit?.id ?? ''} onChange={(e) => pickKit(e.target.value)} disabled={kits.data.length === 0}>
                  {kits.data.length === 0 && <option value="">Nenhuma maleta</option>}
                  {kits.data.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.returned_on ? `${formatDateOnly(k.received_on)} a ${formatDateOnly(k.returned_on)}` : `Atual · desde ${formatDateOnly(k.received_on)}`}
                    </option>
                  ))}
                </Select>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      {noKit ? (
        <Card><CardBody className="flex flex-col items-center py-14 text-center text-sm text-navy/55">
          <Briefcase className="mb-2 h-7 w-7 text-gold-400" />
          {isAdmin && !sellerId ? 'Escolha a vendedora para ver as maletas dela.' : 'Nenhuma maleta registrada. Registre na aba Maletas.'}
        </CardBody></Card>
      ) : (
        <>
          {cur.error && <p className="mb-4 text-sm text-red-700">{cur.error}</p>}

          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
            <Kpi label="Faturamento" icon={Wallet} value={formatCents(s.total_cents)} loading={loading} highlight
              delta={isKit ? <span className="text-ivory/70">{kitPeriod}</span> : <Delta cur={s.total_cents} prev={before.data.total_cents} />} />
            <Kpi label="Quantidade de vendas" icon={Receipt} value={`${s.count}`} sub={`${s.items_count ?? 0} peças`} loading={loading}
              delta={isKit ? <span className="text-navy/50">{s.exchanges_count ? `${s.exchanges_count} troca(s) no período` : 'sem trocas no período'}</span> : <Delta cur={s.count} prev={before.data.count} />} />
            <Kpi label="Ticket médio" icon={TrendingUp} value={formatCents(ticket(s))} loading={loading}
              delta={isKit ? <span className="text-navy/50">por venda</span> : <Delta cur={ticket(s)} prev={ticket(before.data)} />} />
            <Kpi gold label={pct !== null ? `Comissão (${pctLabel(pct)})` : 'Comissão'} icon={BadgePercent} value={formatCents(commission)} loading={loading}
              delta={<span className="text-navy/55">{pct !== null ? `${pctLabel(pct)} sobre ${formatCents(s.total_cents)}` : 'percentuais diferentes por empresa'}</span>} />
          </div>

          {isKit && !loading && (
            <Card className="mt-6 border-gold-300">
              <CardHeader title="Acerto da maleta" subtitle={`${kitSellerName} · ${kitPeriod}`} />
              <CardBody className="grid gap-3 sm:grid-cols-3">
                <Settle label="Total vendido" value={formatCents(s.total_cents)} />
                <Settle label={`Comissão da vendedora${pct !== null ? ` (${pctLabel(pct)})` : ''}`} value={formatCents(commission)} tone="text-gold-600" />
                <Settle label="Parte da empresa" value={formatCents(s.total_cents - commission)} strong />
                {kit?.notes && <p className="text-sm italic text-navy/60 sm:col-span-3">“{kit.notes}”</p>}
              </CardBody>
            </Card>
          )}

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {!isKit && (
              <Card className="min-w-0">
                <CardHeader title="Comparativo mensal" subtitle="Faturamento dos últimos 6 meses" />
                <CardBody>
                  {monthly.loading ? <Loading /> : (
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={months} margin={{ top: 8, right: 8 }}>
                          <CartesianGrid stroke={CHART.grid} vertical={false} />
                          <XAxis dataKey="label" tick={{ fontSize: 11, fill: CHART.axis }} tickLine={false} axisLine={false} />
                          <YAxis tickFormatter={compactBRL} tick={{ fontSize: 11, fill: CHART.axis }} tickLine={false} axisLine={false} width={70} />
                          <Tooltip {...tooltipStyle} cursor={{ fill: 'rgba(184,166,106,0.08)' }} />
                          <Bar dataKey="total_cents" radius={[6, 6, 0, 0]} barSize={34}>
                            {months.map((_, i) => <Cell key={i} fill={i === months.length - 1 ? CHART.gold : CHART.royal} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </CardBody>
              </Card>
            )}

            <Card className={cn('min-w-0', isKit && 'lg:col-span-2')}>
              <CardHeader title="Vendas por categoria" />
              <CardBody>
                {loading ? <Loading /> : s.by_category.length === 0 ? <EmptyRow /> : (
                  <table className="w-full text-sm">
                    <thead className="text-left text-[11px] uppercase tracking-wider text-navy/45">
                      <tr><th className="pb-2 font-semibold">Categoria</th><th className="pb-2 text-right font-semibold">Peças</th><th className="pb-2 text-right font-semibold">Faturamento</th><th className="pb-2 text-right font-semibold">%</th></tr>
                    </thead>
                    <tbody className="divide-y divide-navy/[0.06]">
                      {s.by_category.map((c) => (
                        <tr key={c.id}>
                          <td className="py-2.5"><span className="inline-flex items-center gap-2 text-navy"><CategoryIcon slug={c.slug ?? ''} className="h-4 w-4 text-gold-500" />{c.name}</span></td>
                          <td className="py-2.5 text-right text-navy/70">{c.count}</td>
                          <td className="py-2.5 text-right font-medium text-navy">{signed(c.total_cents)}</td>
                          <td className="py-2.5 text-right text-navy/55">{s.total_cents ? ((c.total_cents / s.total_cents) * 100).toFixed(1).replace('.', ',') : 0}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardBody>
            </Card>
          </div>

          {isAdmin && !isKit && (
            <Card className="mt-6">
              <CardHeader title="Resultado por vendedor" />
              <CardBody>
                {loading ? <Loading /> : s.by_seller.length === 0 ? <EmptyRow /> : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-sm">
                      <thead className="text-left text-[11px] uppercase tracking-wider text-navy/45">
                        <tr><th className="pb-2 font-semibold">#</th><th className="pb-2 font-semibold">Vendedor</th><th className="pb-2 text-right font-semibold">Vendas</th><th className="pb-2 text-right font-semibold">Faturamento</th><th className="pb-2 text-right font-semibold">Ticket médio</th><th className="pb-2 text-right font-semibold">Comissão</th><th className="pb-2 text-right font-semibold">% do total</th></tr>
                      </thead>
                      <tbody className="divide-y divide-navy/[0.06]">
                        {s.by_seller.map((v, i) => (
                          <tr key={v.id}>
                            <td className="metric py-2.5 text-gold-500">{i + 1}</td>
                            <td className="py-2.5 font-medium text-navy">{v.name}</td>
                            <td className="py-2.5 text-right text-navy/70">{v.count}</td>
                            <td className="py-2.5 text-right font-medium text-navy">{formatCents(v.total_cents)}</td>
                            <td className="py-2.5 text-right text-navy/70">{formatCents(ticket(v))}</td>
                            <td className="py-2.5 text-right font-medium text-gold-600">{formatCents(v.commission_cents ?? 0)}</td>
                            <td className="py-2.5 text-right text-navy/55">{s.total_cents ? ((v.total_cents / s.total_cents) * 100).toFixed(1).replace('.', ',') : 0}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          <Card className="mt-6">
            <CardHeader title="Comissão detalhada" subtitle="Cada venda conta na data em que foi feita; cada troca conta na data da troca, pela diferença." />
            <CardBody>
              {!sales ? <Loading /> : commissionRows.length === 0 ? <EmptyRow /> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-sm">
                    <thead className="text-left text-[11px] uppercase tracking-wider text-navy/45">
                      <tr>
                        <th className="pb-2 font-semibold">Data</th><th className="pb-2 font-semibold">Tipo</th><th className="pb-2 font-semibold">Cliente</th>
                        {isAdmin && !isKit && <th className="pb-2 font-semibold">Vendedora</th>}
                        <th className="pb-2 text-right font-semibold">Valor</th><th className="pb-2 text-right font-semibold">Comissão</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-navy/[0.06]">
                      {commissionRows.map((r, i) => (
                        <tr key={i} className={r.kind === 'troca' ? 'bg-gold-50/50' : ''}>
                          <td className="whitespace-nowrap py-2.5 text-navy/70">{formatDate(r.date)}</td>
                          <td className="py-2.5">
                            <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-semibold', r.kind === 'troca' ? 'border-gold-300 bg-gold-100 text-gold-600' : 'border-navy/10 bg-navy/5 text-navy/60')}>
                              {r.kind === 'troca' ? 'Troca' : 'Venda'}
                            </span>
                          </td>
                          <td className="py-2.5 text-navy">{r.customer}{r.note && <span className="block text-xs text-navy/45">{r.note}</span>}</td>
                          {isAdmin && !isKit && <td className="py-2.5 text-navy/70">{r.seller}</td>}
                          <td className={cn('whitespace-nowrap py-2.5 text-right font-medium', r.value_cents < 0 ? 'text-red-700' : 'text-navy')}>{signed(r.value_cents)}</td>
                          <td className={cn('whitespace-nowrap py-2.5 text-right font-semibold', r.commission_cents < 0 ? 'text-red-700' : 'text-gold-600')}>{signed(r.commission_cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-navy/10">
                        <td colSpan={isAdmin && !isKit ? 4 : 3} className="pt-3 font-semibold text-navy">Total ({commissionRows.length} lançamento{commissionRows.length > 1 ? 's' : ''})</td>
                        <td className="metric pt-3 text-right text-navy">{signed(commissionRows.reduce((a, r) => a + r.value_cents, 0))}</td>
                        <td className="metric pt-3 text-right text-gold-600">{signed(commissionRows.reduce((a, r) => a + r.commission_cents, 0))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>

          {exchanges.length > 0 && (
            <Card className="mt-6">
              <CardHeader title="Trocas no período" subtitle={`${exchanges.length} troca${exchanges.length > 1 ? 's' : ''}`} />
              <CardBody><ul className="space-y-3">{exchanges.map((x) => <ExchangeCard key={x.id} ex={x} showSale />)}</ul></CardBody>
            </Card>
          )}
          <p className="mt-4 text-xs text-navy/45">Datas no fuso de Brasília. Vendas excluídas não entram nos totais. Trocas contam na data da troca, pela diferença de valor.</p>
        </>
      )}
    </>
  );
}

function Kpi({ label, value, sub, delta, icon: Icon, loading, highlight, gold }: { label: string; value: string; sub?: string; delta: React.ReactNode; icon: typeof Wallet; loading: boolean; highlight?: boolean; gold?: boolean }) {
  return (
    <div className={cn('rounded-xl border p-5 shadow-card', highlight ? 'border-navy bg-navy bg-[radial-gradient(ellipse_at_top_right,_#21165F_0%,_#0D0737_70%)] text-ivory' : gold ? 'border-gold-300 bg-gold-50' : 'border-navy/[0.06] bg-white')}>
      <div className="flex items-center justify-between">
        <p className={cn('text-[11px] font-semibold uppercase tracking-wider', highlight ? 'text-gold-300' : 'text-navy/50')}>{label}</p>
        <Icon className={cn('h-4 w-4', highlight ? 'text-gold-400' : 'text-gold-500')} />
      </div>
      <p className={cn('metric mt-2 text-[26px]', highlight ? 'text-ivory' : 'text-navy')}>{loading ? '…' : value}{sub && !loading && <span className="ml-2 font-sans text-sm font-normal text-navy/50">{sub}</span>}</p>
      <div className={cn('mt-1 text-xs', highlight && '[&_*]:!text-ivory/80')}>{!loading && delta}</div>
    </div>
  );
}
function Settle({ label, value, tone, strong }: { label: string; value: string; tone?: string; strong?: boolean }) {
  return (
    <div className={cn('rounded-lg px-4 py-3', strong ? 'bg-navy text-ivory' : 'bg-ivory')}>
      <p className={cn('text-xs', strong ? 'text-gold-300' : 'text-navy/55')}>{label}</p>
      <p className={cn('metric text-xl', strong ? 'text-ivory' : tone ?? 'text-navy')}>{value}</p>
    </div>
  );
}
function Loading() { return <div className="flex h-48 items-center justify-center text-gold-500"><Spinner /></div>; }
function EmptyRow() { return <p className="py-10 text-center text-sm text-navy/50">Nenhuma venda no período.</p>; }

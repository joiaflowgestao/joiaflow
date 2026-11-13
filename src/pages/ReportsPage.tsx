import { ArrowDownRight, ArrowUpRight, BadgePercent, FileSpreadsheet, FileText, Receipt, TrendingUp, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART, compactBRL, tooltipStyle } from '@/components/charts/theme';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganizations, useProfiles } from '@/hooks/useData';
import { useMonthlyTotals, useSalesSummary } from '@/hooks/useSummary';
import { cn } from '@/lib/cn';
import { currentYearMonth, MONTHS_PT, MONTHS_SHORT_PT, monthRange, shiftMonth } from '@/lib/datetime';
import { formatCents } from '@/lib/money';
import { fetchAllSales } from '@/lib/salesQuery';
import { friendlyError } from '@/lib/supabase';
import { yearOptions } from '@/pages/sales/HistoryPage';

const ticket = (s: { total_cents: number; count: number }) => (s.count ? Math.round(s.total_cents / s.count) : 0);

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
  const { isAdmin, isPlatformAdmin, organization } = useAuth();
  const toast = useToast();
  const orgs = useOrganizations();
  const profiles = useProfiles();
  const now = currentYearMonth();
  const [year, setYear] = useState(now.year);
  const [month, setMonth] = useState(now.month);
  const [orgId, setOrgId] = useState('');
  const [sellerId, setSellerId] = useState('');
  const [exporting, setExporting] = useState<'pdf' | 'xlsx' | null>(null);

  const range = useMemo(() => monthRange(year, month), [year, month]);
  const prev = shiftMonth(year, month, -1);
  const prevRange = useMemo(() => monthRange(prev.year, prev.month), [prev.year, prev.month]);
  const first = shiftMonth(year, month, -5);
  const sixRange = useMemo(() => ({ start: monthRange(first.year, first.month).start, end: range.end }), [first.year, first.month, range.end]);

  const cur = useSalesSummary(range, orgId, sellerId);
  const before = useSalesSummary(prevRange, orgId, sellerId);
  const monthly = useMonthlyTotals(sixRange, orgId, sellerId);
  const s = cur.data;

  const months = useMemo(() => Array.from({ length: 6 }, (_, i) => {
    const m = shiftMonth(first.year, first.month, i);
    const key = `${m.year}-${String(m.month).padStart(2, '0')}-01`;
    const found = monthly.data.find((x) => x.month === key);
    return { label: `${MONTHS_SHORT_PT[m.month - 1]}/${String(m.year).slice(2)}`, fullLabel: `${MONTHS_PT[m.month - 1]}/${m.year}`, total_cents: Number(found?.total_cents ?? 0), count: Number(found?.count ?? 0) };
  }), [monthly.data, first.year, first.month]);

  const sellers = profiles.data.filter((p) => p.organization_id && (!orgId || p.organization_id === orgId));
  const title = `Relatório de ${MONTHS_PT[month - 1]} de ${year}`;
  const scope = [
    isPlatformAdmin ? (orgs.data.find((o) => o.id === orgId)?.name ?? 'Todas as empresas') : null,
    isAdmin ? (sellers.find((p) => p.id === sellerId)?.full_name ?? 'Todos os vendedores') : 'Minhas vendas',
  ].filter(Boolean).join(' · ');

  async function doExport(kind: 'pdf' | 'xlsx') {
    setExporting(kind);
    try {
      const sales = await fetchAllSales({ year, month, orgId: orgId || undefined, sellerId: sellerId || undefined });
      const mod = await import('@/lib/exportReport');
      const data = { title, scope, summary: s, previous: before.data, months: months.map((m) => ({ ...m, label: m.fullLabel })), sales, showSellers: isAdmin };
      await (kind === 'pdf' ? mod.exportPDF(data) : mod.exportExcel(data));
      toast.success(kind === 'pdf' ? 'PDF gerado.' : 'Planilha Excel gerada.');
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setExporting(null);
    }
  }

  const loading = cur.loading || before.loading;
  // Percentual de comissão: o da empresa (padrão 30%)
  const rates = [...new Set(s.by_seller.map((v) => Number(v.commission_percent ?? 30)))];
  const pct = rates.length === 1 ? rates[0] : rates.length === 0 ? Number(organization?.commission_percent ?? orgs.data.find((o) => o.id === orgId)?.commission_percent ?? 30) : null;
  const pctLabel = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

  return (
    <>
      <PageHeader
        title="Relatórios"
        subtitle={`${title} · ${scope}`}
        actions={
          <>
            <Button variant="outline" onClick={() => doExport('pdf')} loading={exporting === 'pdf'} disabled={loading || !!exporting}><FileText className="h-4 w-4" /> PDF</Button>
            <Button variant="outline" onClick={() => doExport('xlsx')} loading={exporting === 'xlsx'} disabled={loading || !!exporting}><FileSpreadsheet className="h-4 w-4" /> Excel</Button>
          </>
        }
      />

      <Card className="mb-6">
        <CardBody className="grid grid-cols-2 gap-3 pt-5 lg:grid-cols-4 sm:pt-6">
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
        </CardBody>
      </Card>

      {cur.error && <p className="mb-4 text-sm text-red-700">{cur.error}</p>}

      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
        <Kpi label="Faturamento" icon={Wallet} value={formatCents(s.total_cents)} delta={<Delta cur={s.total_cents} prev={before.data.total_cents} />} loading={loading} highlight />
        <Kpi label="Quantidade de vendas" icon={Receipt} value={`${s.count}`} sub={`${s.items_count ?? 0} peças`} delta={<Delta cur={s.count} prev={before.data.count} />} loading={loading} />
        <Kpi label="Ticket médio" icon={TrendingUp} value={formatCents(ticket(s))} delta={<Delta cur={ticket(s)} prev={ticket(before.data)} />} loading={loading} />
        <Kpi gold label={pct !== null ? `Comissão (${pctLabel(pct)})` : 'Comissão'} icon={BadgePercent} value={formatCents(s.commission_cents ?? 0)}
          delta={<span className="text-navy/55">{pct !== null ? `${pctLabel(pct)} sobre ${formatCents(s.total_cents)}` : 'percentuais diferentes por empresa'}</span>} loading={loading} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
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

        <Card>
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
                      <td className="py-2.5 text-right font-medium text-navy">{formatCents(c.total_cents)}</td>
                      <td className="py-2.5 text-right text-navy/55">{s.total_cents ? ((c.total_cents / s.total_cents) * 100).toFixed(1).replace('.', ',') : 0}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>
      </div>

      {isAdmin && (
        <Card className="mt-6">
          <CardHeader title="Resultado por vendedor" />
          <CardBody>
            {loading ? <Loading /> : s.by_seller.length === 0 ? <EmptyRow /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
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
      <p className="mt-4 text-xs text-navy/45">Os relatórios consideram a data efetiva da venda (fuso de Brasília). Vendas excluídas não entram nos totais.</p>
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
function Loading() { return <div className="flex h-48 items-center justify-center text-gold-500"><Spinner /></div>; }
function EmptyRow() { return <p className="py-10 text-center text-sm text-navy/50">Nenhuma venda no período.</p>; }

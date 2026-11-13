import { AlertTriangle, CalendarDays, Crown, Gem, Plus, Receipt, TrendingUp, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART, compactBRL, tooltipStyle } from '@/components/charts/theme';
import { DueInstallmentsPanel } from '@/components/sales/installments';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/Spinner';
import { StatCard } from '@/components/ui/StatCard';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganizations } from '@/hooks/useData';
import { useSalesSummary } from '@/hooks/useSummary';
import { currentYearMonth, dayRange, daysInMonth, MONTHS_PT, monthRange, todayISO } from '@/lib/datetime';
import { formatCents } from '@/lib/money';

export function DashboardPage() {
  const { profile, isAdmin, isPlatformAdmin } = useAuth();
  const orgs = useOrganizations();
  const [orgId, setOrgId] = useState('');
  const [dueCounts, setDueCounts] = useState<{ overdue: number; today: number } | null>(null);

  const { year, month } = currentYearMonth();
  const mRange = useMemo(() => monthRange(year, month), [year, month]);
  const today = todayISO();
  const dRange = useMemo(() => dayRange(today), [today]);

  const monthData = useSalesSummary(mRange, orgId);
  const dayData = useSalesSummary(dRange, orgId);
  const m = monthData.data;

  const avg = m.count ? Math.round(m.total_cents / m.count) : 0;
  const topCat = m.by_category[0];

  // Série diária completa do mês (dias sem venda = 0)
  const series = useMemo(() => {
    const map = new Map(m.by_day.map((d) => [d.day, d.total_cents]));
    const lastDay = Number(today.slice(8));
    return Array.from({ length: Math.min(daysInMonth(year, month), lastDay) }, (_, i) => {
      const day = `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
      return { label: String(i + 1).padStart(2, '0'), total: map.get(day) ?? 0 };
    });
  }, [m.by_day, year, month, today]);

  const greeting = profile?.full_name.split(' ')[0];

  return (
    <>
      <PageHeader
        title={`Olá, ${greeting}`}
        subtitle={`${MONTHS_PT[month - 1]} de ${year} · ${isAdmin ? 'visão consolidada' : 'seus resultados'}`}
        actions={
          <>
            {isPlatformAdmin && orgs.data.length > 1 && (
              <Select value={orgId} onChange={(e) => setOrgId(e.target.value)} aria-label="Empresa" className="h-11 py-2">
                <option value="">Todas as empresas</option>
                {orgs.data.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            )}
            <Link to="/nova-venda"><Button variant="gold"><Plus className="h-4 w-4" /> Nova venda</Button></Link>
          </>
        }
      />

      {dueCounts && (dueCounts.overdue > 0 || dueCounts.today > 0) && (
        <a href="#parcelas" className="mb-6 flex items-center gap-3 rounded-xl border border-gold-300 bg-gold-50 px-4 py-3 text-sm text-navy hover:bg-gold-100">
          <AlertTriangle className="h-5 w-5 shrink-0 text-gold-600" />
          <span>
            <strong>Atenção:</strong>{' '}
            {dueCounts.today > 0 && <>{dueCounts.today} parcela{dueCounts.today > 1 ? 's vencem' : ' vence'} hoje</>}
            {dueCounts.today > 0 && dueCounts.overdue > 0 && ' e '}
            {dueCounts.overdue > 0 && <>{dueCounts.overdue} parcela{dueCounts.overdue > 1 ? 's estão atrasadas' : ' está atrasada'}</>}.
            <span className="ml-1 underline underline-offset-2">Ver parcelas</span>
          </span>
        </a>
      )}

      {monthData.error && <p className="mb-4 text-sm text-red-700">{monthData.error}</p>}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <div className="col-span-2 lg:col-span-1">
          <StatCard highlight label="Total do mês" icon={Wallet} value={monthData.loading ? '…' : formatCents(m.total_cents)} hint={`${m.count} venda${m.count === 1 ? '' : 's'} · ${m.items_count ?? 0} peça${(m.items_count ?? 0) === 1 ? '' : 's'}`} />
        </div>
        <StatCard label="Vendas no mês" icon={Receipt} value={monthData.loading ? '…' : m.count} />
        <StatCard label="Ticket médio" icon={TrendingUp} value={monthData.loading ? '…' : formatCents(avg)} />
        <StatCard label="Hoje" icon={CalendarDays} value={dayData.loading ? '…' : formatCents(dayData.data.total_cents)} hint={`${dayData.data.count} venda${dayData.data.count === 1 ? '' : 's'}`} />
        <StatCard label="Mais vendida" icon={Crown} value={topCat ? topCat.name : '—'} hint={topCat ? `${topCat.count} peça${topCat.count === 1 ? '' : 's'} · ${formatCents(topCat.total_cents)}` : 'Sem vendas no mês'} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Evolução das vendas" subtitle="Total vendido por dia no mês" />
          <CardBody>
            {monthData.loading ? <ChartLoading /> : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series} margin={{ left: 0, right: 8, top: 8 }}>
                    <defs>
                      <linearGradient id="goldFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART.gold} stopOpacity={0.45} />
                        <stop offset="100%" stopColor={CHART.gold} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={CHART.grid} vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: CHART.axis }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tickFormatter={compactBRL} tick={{ fontSize: 11, fill: CHART.axis }} tickLine={false} axisLine={false} width={70} />
                    <Tooltip {...tooltipStyle} labelFormatter={(l) => `Dia ${l}`} />
                    <Area type="monotone" dataKey="total" stroke={CHART.royal} strokeWidth={2} fill="url(#goldFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Por categoria" subtitle="Faturamento no mês" />
          <CardBody>
            {monthData.loading ? <ChartLoading /> : m.by_category.length === 0 ? <Empty /> : (
              <ul className="space-y-3">
                {m.by_category.map((c) => {
                  const pct = m.total_cents ? (c.total_cents / m.total_cents) * 100 : 0;
                  return (
                    <li key={c.id}>
                      <div className="mb-1 flex items-center gap-2 text-sm">
                        <CategoryIcon slug={c.slug ?? ''} className="h-4 w-4 text-gold-500" />
                        <span className="flex-1 text-navy">{c.name}</span>
                        <span className="font-medium text-navy">{formatCents(c.total_cents)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-navy/5">
                        <div className="h-1.5 rounded-full bg-gradient-to-r from-royal to-gold-400" style={{ width: `${Math.max(pct, 2)}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {isAdmin && (
        <Card className="mt-6">
          <CardHeader title="Comparativo entre vendedores" subtitle="Faturamento no mês" />
          <CardBody>
            {monthData.loading ? <ChartLoading /> : m.by_seller.length === 0 ? <Empty /> : (
              <div style={{ height: Math.max(160, m.by_seller.length * 44) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={m.by_seller} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid stroke={CHART.grid} horizontal={false} />
                    <XAxis type="number" tickFormatter={compactBRL} tick={{ fontSize: 11, fill: CHART.axis }} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12, fill: CHART.navy }} tickLine={false} axisLine={false} />
                    <Tooltip {...tooltipStyle} cursor={{ fill: 'rgba(184,166,106,0.08)' }} />
                    <Bar dataKey="total_cents" radius={[0, 6, 6, 0]} barSize={22}>
                      {m.by_seller.map((_, i) => <Cell key={i} fill={i === 0 ? CHART.gold : CHART.royal} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      <Card className="mt-6" id="parcelas">
        <CardHeader title="Parcelas a receber" subtitle="Atrasadas, vencendo hoje e nos próximos 7 dias" />
        <CardBody>
          <DueInstallmentsPanel orgId={orgId || undefined} onCounts={setDueCounts} />
        </CardBody>
      </Card>
    </>
  );
}

function ChartLoading() {
  return <div className="flex h-64 items-center justify-center text-gold-500"><Spinner /></div>;
}
function Empty() {
  return (
    <div className="flex h-40 flex-col items-center justify-center text-center text-sm text-navy/50">
      <Gem className="mb-2 h-6 w-6 text-gold-300" /> Nenhuma venda no período.
    </div>
  );
}

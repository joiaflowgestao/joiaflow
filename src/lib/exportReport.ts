// Exportação de relatórios em PDF (jsPDF) e Excel (SheetJS).
// As bibliotecas são carregadas sob demanda para não pesar o app.
import type { CommissionRow } from '@/lib/commission';
import { formatDate, formatTime } from '@/lib/datetime';
import { exchangeItemsLabel } from '@/lib/exchanges';
import { formatCents } from '@/lib/money';
import { itemsLabel, paymentSummary } from '@/lib/salesQuery';
import type { Exchange, SaleWithRelations, SalesSummary } from '@/types/database';

export interface ReportData {
  title: string;            // ex.: "Relatório de Novembro de 2026"
  scope: string;            // ex.: "Empresa X · Todos os vendedores"
  summary: SalesSummary;
  previous: SalesSummary | null;  // mês anterior (null no relatório de maleta)
  months: { label: string; total_cents: number; count: number }[];
  sales: SaleWithRelations[];
  exchanges: Exchange[];
  commissionRows: CommissionRow[];
  showSellers: boolean;
  kit: { seller: string; period: string; notes: string | null } | null;
}

const ticket = (s: { total_cents: number; count: number }) => (s.count ? Math.round(s.total_cents / s.count) : 0);
const pct = (part: number, total: number) => (total ? `${((part / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '0%');
const delta = (cur: number, prev: number) => (prev ? `${cur >= prev ? '+' : ''}${(((cur - prev) / prev) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '-');
const exDate = (iso: string) => `${formatDate(iso)} ${formatTime(iso)}`;
// PDF: só caracteres da fonte padrão (sem "→" ou "−" tipográfico)
const signed = (c: number) => `${c > 0 ? '+' : c < 0 ? '-' : ''}${formatCents(Math.abs(c))}`;
const plain = (c: number) => `${c < 0 ? '-' : ''}${formatCents(Math.abs(c))}`;
const fileName = (r: ReportData, ext: string) =>
  `${r.title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.${ext}`;

export async function exportPDF(r: ReportData) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const navy: [number, number, number] = [13, 7, 55];
  const gold: [number, number, number] = [184, 166, 106];
  const pdfTitle = r.title.replace(/—/g, '-');

  // Cabeçalho
  doc.setFillColor(...navy);
  doc.rect(0, 0, W, 86, 'F');
  doc.setTextColor(247, 244, 236);
  doc.setFont('times', 'bold'); doc.setFontSize(22);
  doc.text('JoiaFlow', 40, 42);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
  doc.text(pdfTitle, 40, 62);
  doc.setTextColor(...gold); doc.setFontSize(9);
  doc.text(r.scope, 40, 76);
  doc.text(`Gerado em ${formatDate(new Date())} ${formatTime(new Date())}`, W - 40, 76, { align: 'right' });

  const s = r.summary, p = r.previous;
  const commission = s.commission_cents ?? 0;
  const head = { fillColor: navy, textColor: [247, 244, 236] as [number, number, number], fontStyle: 'bold' as const };
  const base = { styles: { fontSize: 9, cellPadding: 5 }, headStyles: head, alternateRowStyles: { fillColor: [247, 244, 236] as [number, number, number] }, margin: { left: 40, right: 40 } };
  const next = () => ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 22);
  const section = (title: string, y0: number) => {
    let y = y0;
    // Título nunca fica sozinho no rodapé: se faltar espaço, começa na próxima página
    if (y > doc.internal.pageSize.getHeight() - 110) { doc.addPage(); y = 50; }
    doc.setTextColor(...navy); doc.setFont('times', 'bold'); doc.setFontSize(13); doc.text(title, 40, y); return y + 8;
  };

  // Resumo
  autoTable(doc, p ? {
    ...base, startY: 104,
    head: [['Indicador', 'Período', 'Mês anterior', 'Variação']],
    body: [
      ['Faturamento', formatCents(s.total_cents), formatCents(p.total_cents), delta(s.total_cents, p.total_cents)],
      ['Quantidade de vendas', String(s.count), String(p.count), delta(s.count, p.count)],
      ['Peças vendidas', String(s.items_count ?? 0), String(p.items_count ?? 0), delta(s.items_count ?? 0, p.items_count ?? 0)],
      ['Ticket médio', formatCents(ticket(s)), formatCents(ticket(p)), delta(ticket(s), ticket(p))],
      ['Comissão', formatCents(commission), formatCents(p.commission_cents ?? 0), delta(commission, p.commission_cents ?? 0)],
    ],
  } : {
    ...base, startY: 104,
    head: [['Indicador', 'Valor']],
    body: [
      ['Faturamento', formatCents(s.total_cents)],
      ['Quantidade de vendas', String(s.count)],
      ['Peças vendidas', String(s.items_count ?? 0)],
      ['Ticket médio', formatCents(ticket(s))],
      ['Trocas no período', `${s.exchanges_count ?? 0} (${signed(s.exchanges_cents ?? 0)})`],
    ],
  });

  // Acerto da maleta
  if (r.kit) {
    autoTable(doc, { ...base, startY: section('Acerto da maleta', next()),
      head: [['Vendedora', 'Período', 'Total vendido', 'Comissão', 'Parte da empresa']],
      body: [
        [r.kit.seller, r.kit.period, formatCents(s.total_cents), formatCents(commission), formatCents(s.total_cents - commission)],
        ...(r.kit.notes ? [[{ content: `Observação: ${r.kit.notes}`, colSpan: 5, styles: { fontStyle: 'italic' as const } }]] : []),
      ],
    });
  }

  autoTable(doc, { ...base, startY: section('Vendas por categoria', next()),
    head: [['Categoria', 'Peças', 'Faturamento', '% do total']],
    body: s.by_category.map((c) => [c.name, String(c.count), plain(c.total_cents), pct(c.total_cents, s.total_cents)]),
  });

  if (r.showSellers) {
    autoTable(doc, { ...base, startY: section('Resultado por vendedor', next()),
      head: [['Vendedor', 'Vendas', 'Faturamento', 'Ticket médio', 'Comissão', '% do total']],
      body: s.by_seller.map((v) => [v.name, String(v.count), formatCents(v.total_cents), formatCents(ticket(v)), `${formatCents(v.commission_cents ?? 0)} (${Number(v.commission_percent ?? 30).toLocaleString('pt-BR')}%)`, pct(v.total_cents, s.total_cents)]),
    });
  }

  // Comissão detalhada (venda a venda + trocas)
  autoTable(doc, { ...base, startY: section('Comissão detalhada', next()),
    styles: { fontSize: 8, cellPadding: 4, valign: 'top' },
    head: [['Data', 'Tipo', 'Cliente', ...(r.showSellers ? ['Vendedora'] : []), 'Valor', '%', 'Comissão']],
    body: [
      ...r.commissionRows.map((c) => [
        formatDate(c.date), c.kind === 'troca' ? 'Troca' : 'Venda',
        c.note ? `${c.customer}\n${c.note}` : c.customer,
        ...(r.showSellers ? [c.seller] : []),
        plain(c.value_cents), `${c.percent.toLocaleString('pt-BR')}%`, plain(c.commission_cents),
      ]),
      [{ content: 'Total', colSpan: r.showSellers ? 4 : 3, styles: { fontStyle: 'bold' as const } },
        { content: plain(r.commissionRows.reduce((a, c) => a + c.value_cents, 0)), styles: { fontStyle: 'bold' as const } }, '',
        { content: plain(r.commissionRows.reduce((a, c) => a + c.commission_cents, 0)), styles: { fontStyle: 'bold' as const } }],
    ],
  });

  if (r.months.length) {
    autoTable(doc, { ...base, startY: section('Comparativo com meses anteriores', next()),
      head: [['Mês', 'Vendas', 'Faturamento', 'Ticket médio']],
      body: r.months.map((m) => [m.label, String(m.count), formatCents(m.total_cents), formatCents(ticket(m))]),
    });
  }

  autoTable(doc, { ...base, startY: section('Vendas do período', next()),
    styles: { fontSize: 8, cellPadding: 4 },
    head: [['Data', 'Hora', 'Cliente', 'Itens', 'Valor atual', 'Pago no ato', ...(r.showSellers ? ['Vendedor'] : []), 'Pagas']],
    body: r.sales.map((x) => {
      const ps = paymentSummary(x);
      return [formatDate(x.sold_at), formatTime(x.sold_at), x.customer_name, itemsLabel(x), formatCents(x.total_cents),
        x.down_payment_cents ? formatCents(x.down_payment_cents) : '-', ...(r.showSellers ? [x.seller?.full_name ?? ''] : []), `${ps.paid}/${ps.total}`];
    }),
  });

  if (r.exchanges.length) {
    autoTable(doc, { ...base, startY: section('Trocas do período', next()),
      styles: { fontSize: 8, cellPadding: 4, valign: 'top' },
      columnStyles: { 5: { cellWidth: 150, fontStyle: 'italic' } },
      head: [['Data', 'Cliente', 'Devolveu', 'Levou', 'Valor da venda', 'Motivo da troca']],
      body: r.exchanges.map((x) => [
        exDate(x.created_at),
        `${x.sale?.customer_name ?? ''}${r.showSellers && x.sale?.seller?.full_name ? `\n(${x.sale.seller.full_name})` : ''}`,
        exchangeItemsLabel(x.returned_items),
        exchangeItemsLabel(x.new_items),
        `Antes: ${formatCents(x.old_total_cents)}\nDepois: ${formatCents(x.new_total_cents)}\nDiferença: ${signed(x.difference_cents)}${x.refund_cents > 0 ? `\nDevolver: ${formatCents(x.refund_cents)}` : ''}`,
        x.reason,
      ]),
    });
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120, 120, 140);
    doc.text(`Página ${i} de ${pages}`, W - 40, doc.internal.pageSize.getHeight() - 20, { align: 'right' });
  }
  doc.save(fileName(r, 'pdf'));
}

export async function exportExcel(r: ReportData) {
  const XLSX = await import('xlsx');
  const money = (c: number) => Math.round(c) / 100; // número real no Excel (formatável)
  const s = r.summary, p = r.previous;
  const commission = s.commission_cents ?? 0;
  const wb = XLSX.utils.book_new();

  const resumoRows: (string | number)[][] = [[r.title], [r.scope], []];
  if (p) {
    resumoRows.push(
      ['Indicador', 'Período', 'Mês anterior'],
      ['Faturamento (R$)', money(s.total_cents), money(p.total_cents)],
      ['Quantidade de vendas', s.count, p.count],
      ['Peças vendidas', s.items_count ?? 0, p.items_count ?? 0],
      ['Ticket médio (R$)', money(ticket(s)), money(ticket(p))],
      ['Comissão (R$)', money(commission), money(p.commission_cents ?? 0)],
    );
  } else {
    resumoRows.push(
      ['Indicador', 'Valor'],
      ['Faturamento (R$)', money(s.total_cents)],
      ['Quantidade de vendas', s.count],
      ['Peças vendidas', s.items_count ?? 0],
      ['Ticket médio (R$)', money(ticket(s))],
      ['Comissão (R$)', money(commission)],
    );
  }
  if (r.kit) {
    resumoRows.push([], ['Acerto da maleta'], ['Vendedora', r.kit.seller], ['Período', r.kit.period],
      ['Total vendido (R$)', money(s.total_cents)], ['Comissão (R$)', money(commission)], ['Parte da empresa (R$)', money(s.total_cents - commission)]);
    if (r.kit.notes) resumoRows.push(['Observação', r.kit.notes]);
  }
  const resumo = XLSX.utils.aoa_to_sheet(resumoRows);
  resumo['!cols'] = [{ wch: 26 }, { wch: 22 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, resumo, 'Resumo');

  const com = XLSX.utils.json_to_sheet([
    ...r.commissionRows.map((c) => ({
      Data: formatDate(c.date), Tipo: c.kind === 'troca' ? 'Troca' : 'Venda', Cliente: c.customer,
      ...(r.showSellers ? { Vendedora: c.seller } : {}),
      'Valor (R$)': money(c.value_cents), 'Comissão (%)': c.percent, 'Comissão (R$)': money(c.commission_cents), Observação: c.note ?? '',
    })),
    { Data: 'TOTAL', Tipo: '', Cliente: '', ...(r.showSellers ? { Vendedora: '' } : {}),
      'Valor (R$)': money(r.commissionRows.reduce((a, c) => a + c.value_cents, 0)), 'Comissão (%)': '',
      'Comissão (R$)': money(r.commissionRows.reduce((a, c) => a + c.commission_cents, 0)), Observação: '' },
  ]);
  com['!cols'] = [{ wch: 11 }, { wch: 7 }, { wch: 28 }, ...(r.showSellers ? [{ wch: 22 }] : []), { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 44 }];
  XLSX.utils.book_append_sheet(wb, com, 'Comissão detalhada');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    s.by_category.map((c) => ({ Categoria: c.name, Peças: c.count, 'Faturamento (R$)': money(c.total_cents) })),
  ), 'Por categoria');

  if (r.showSellers) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      s.by_seller.map((v) => ({ Vendedor: v.name, Vendas: v.count, 'Faturamento (R$)': money(v.total_cents), 'Ticket médio (R$)': money(ticket(v)), 'Comissão (%)': Number(v.commission_percent ?? 30), 'Comissão (R$)': money(v.commission_cents ?? 0) })),
    ), 'Por vendedor');
  }

  if (r.months.length) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      r.months.map((m) => ({ Mês: m.label, Vendas: m.count, 'Faturamento (R$)': money(m.total_cents) })),
    ), 'Meses anteriores');
  }

  const vendas = XLSX.utils.json_to_sheet(r.sales.map((x) => {
    const ps = paymentSummary(x);
    return {
      Data: formatDate(x.sold_at), Hora: formatTime(x.sold_at), Cliente: x.customer_name, Itens: itemsLabel(x),
      'Peças': (x.items ?? []).reduce((a, i) => a + i.quantity, 0) || 1, 'Valor atual (R$)': money(x.total_cents),
      'Pago no ato (R$)': money(x.down_payment_cents ?? 0), Parcelas: x.installments,
      ...(r.showSellers ? { Vendedor: x.seller?.full_name ?? '', Empresa: x.organization?.name ?? '' } : {}),
      'Parcelas pagas': `${ps.paid}/${ps.total}`,
    };
  }));
  vendas['!cols'] = [{ wch: 11 }, { wch: 7 }, { wch: 30 }, { wch: 30 }, { wch: 7 }, { wch: 15 }, { wch: 15 }, { wch: 9 }, { wch: 24 }, { wch: 20 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, vendas, 'Vendas');

  if (r.exchanges.length) {
    const trocas = XLSX.utils.json_to_sheet(r.exchanges.map((x) => ({
      Data: exDate(x.created_at), Cliente: x.sale?.customer_name ?? '',
      ...(r.showSellers ? { Vendedora: x.sale?.seller?.full_name ?? '' } : {}),
      Devolveu: exchangeItemsLabel(x.returned_items), Levou: exchangeItemsLabel(x.new_items),
      'Total antes (R$)': money(x.old_total_cents), 'Total depois (R$)': money(x.new_total_cents),
      'Diferença (R$)': money(x.difference_cents), 'A devolver (R$)': money(x.refund_cents), 'Motivo da troca': x.reason,
    })));
    trocas['!cols'] = [{ wch: 16 }, { wch: 24 }, ...(r.showSellers ? [{ wch: 22 }] : []), { wch: 24 }, { wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 13 }, { wch: 13 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, trocas, 'Trocas');
  }

  XLSX.writeFile(wb, fileName(r, 'xlsx'));
}

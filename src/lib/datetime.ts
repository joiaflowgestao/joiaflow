// Datas exibidas no padrão brasileiro e SEMPRE no fuso America/Sao_Paulo,
// independentemente do fuso do aparelho do usuário.
export const APP_TZ = 'America/Sao_Paulo';

const dateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: APP_TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: APP_TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export const formatDate = (iso: string | Date) => dateFmt.format(new Date(iso));
export const formatTime = (iso: string | Date) => timeFmt.format(new Date(iso));
export const formatDateTime = (iso: string | Date) => `${formatDate(iso)} ${formatTime(iso)}`;

function parts(d: Date) {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, s: +p.second };
}

/** Diferença (ms) entre o horário de São Paulo e UTC num instante. */
function tzOffsetMs(d: Date): number {
  const p = parts(d);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(d.getTime() / 1000) * 1000;
}

/** Valores para <input type="date"> e <input type="time"> no fuso de SP. */
export function toLocalInputs(d: Date = new Date()): { date: string; time: string } {
  const p = parts(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${p.y}-${pad(p.m)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.min)}` };
}

/** Converte data (AAAA-MM-DD) + hora (HH:mm) de São Paulo em ISO UTC. */
export function fromLocalInputs(date: string, time: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, min);
  const offset = tzOffsetMs(new Date(guess));
  return new Date(guess - offset).toISOString();
}

/** Intervalo [início, fim) de um mês em São Paulo, em ISO UTC (para filtros por sold_at). */
export function monthRange(year: number, month: number): { start: string; end: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  return {
    start: fromLocalInputs(`${year}-${pad(month)}-01`, '00:00'),
    end: fromLocalInputs(`${next.y}-${pad(next.m)}-01`, '00:00'),
  };
}

export const MONTHS_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Soma dias a uma data AAAA-MM-DD (sem fuso). */
export function addDaysISO(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** Intervalo [início, fim) de um dia em São Paulo. */
export function dayRange(date: string): { start: string; end: string } {
  return { start: fromLocalInputs(date, '00:00'), end: fromLocalInputs(addDaysISO(date, 1), '00:00') };
}

/** Intervalo [início, fim) entre duas datas AAAA-MM-DD (inclusivas) em São Paulo. */
export function dateSpan(from: string, to: string): { start: string; end: string } {
  return { start: fromLocalInputs(from, '00:00'), end: fromLocalInputs(addDaysISO(to, 1), '00:00') };
}

export function yearRange(year: number): { start: string; end: string } {
  return { start: fromLocalInputs(`${year}-01-01`, '00:00'), end: fromLocalInputs(`${year + 1}-01-01`, '00:00') };
}

/** Ano e mês atuais em São Paulo. */
export function currentYearMonth(): { year: number; month: number } {
  const { date } = toLocalInputs();
  const [y, m] = date.split('-').map(Number);
  return { year: y, month: m };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Mês anterior/seguinte (delta em meses). */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export const MONTHS_SHORT_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Soma meses mantendo o dia; se o mês não tiver o dia, usa o último (igual ao PostgreSQL). */
export function addMonthsISO(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const idx = y * 12 + (m - 1) + months;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  const day = Math.min(d, daysInMonth(ny, nm));
  return `${ny}-${pad2(nm)}-${pad2(day)}`;
}

/** Datas de vencimento de todas as parcelas. */
export function dueSchedule(firstDue: string, installments: number): string[] {
  return Array.from({ length: installments }, (_, i) => addMonthsISO(firstDue, i));
}

/** Formata AAAA-MM-DD (data pura, sem fuso) como DD/MM/AAAA. */
export function formatDateOnly(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

export const todayISO = () => toLocalInputs().date;

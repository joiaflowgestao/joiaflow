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

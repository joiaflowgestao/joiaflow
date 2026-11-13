import { describe, expect, it } from 'vitest';
import { formatDate, formatTime, fromLocalInputs, monthRange, toLocalInputs } from './datetime';

describe('datetime (America/Sao_Paulo)', () => {
  it('converte horário de SP para UTC (UTC-3)', () => {
    expect(fromLocalInputs('2026-11-13', '07:51')).toBe('2026-11-13T10:51:00.000Z');
  });
  it('ida e volta', () => {
    const iso = fromLocalInputs('2026-01-31', '23:59');
    expect(toLocalInputs(new Date(iso))).toEqual({ date: '2026-01-31', time: '23:59' });
  });
  it('formata DD/MM/AAAA e 24h', () => {
    expect(formatDate('2026-11-13T02:30:00Z')).toBe('12/11/2026'); // ainda dia 12 em SP
    expect(formatTime('2026-11-13T18:05:00Z')).toBe('15:05');
  });
  it('intervalo do mês considera o fuso de SP', () => {
    expect(monthRange(2026, 12)).toEqual({ start: '2026-12-01T03:00:00.000Z', end: '2027-01-01T03:00:00.000Z' });
  });
});

import { addDaysISO, dayRange, shiftMonth } from './datetime';
describe('datetime helpers', () => {
  it('soma dias atravessando mês/ano', () => {
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('dia em SP', () => {
    expect(dayRange('2026-11-13')).toEqual({ start: '2026-11-13T03:00:00.000Z', end: '2026-11-14T03:00:00.000Z' });
  });
  it('desloca meses', () => {
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 11, -5)).toEqual({ year: 2026, month: 6 });
  });
});

import { dueSchedule, formatDateOnly } from './datetime';
describe('vencimentos', () => {
  it('mesmo dia todo mês, ajustando meses curtos (igual ao banco)', () => {
    expect(dueSchedule('2026-01-31', 3)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(dueSchedule('2026-11-10', 3)).toEqual(['2026-11-10', '2026-12-10', '2027-01-10']);
  });
  it('formata data pura', () => expect(formatDateOnly('2026-12-10')).toBe('10/12/2026'));
});

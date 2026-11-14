import { describe, expect, it } from 'vitest';
import { describeInstallments, formatCents, maskCentsInput, parseBRLToCents, splitInstallments } from './money';

describe('money', () => {
  it('exemplo da especificação: R$ 300,00 em 3x = R$ 100,00', () => {
    const p = splitInstallments(30000, 3);
    expect(p.baseCents).toBe(10000);
    expect(p.remainderCents).toBe(0);
    expect(describeInstallments(30000, 3)).toBe('3x de R$ 100,00');
  });

  it('nunca perde centavos ao dividir', () => {
    for (const total of [1, 99, 10000, 12345, 99999, 1000001]) {
      for (let n = 1; n <= 24; n++) {
        const p = splitInstallments(total, n);
        expect(p.firstCents + p.baseCents * (n - 1)).toBe(total);
      }
    }
    expect(describeInstallments(10000, 3)).toBe('1x de R$ 33,34 + 2x de R$ 33,33');
  });

  it('à vista', () => {
    expect(describeInstallments(15990, 1)).toBe('À vista · R$ 159,90');
  });

  it('parse de valores digitados', () => {
    expect(parseBRLToCents('300')).toBe(30000);
    expect(parseBRLToCents('1.234,56')).toBe(123456);
    expect(parseBRLToCents('R$ 99,9')).toBe(9990);
    expect(parseBRLToCents('abc')).toBeNull();
    expect(parseBRLToCents('')).toBeNull();
  });

  it('máscara de digitação', () => {
    expect(maskCentsInput('30000')).toEqual({ cents: 30000, display: '300,00' });
    expect(maskCentsInput('5')).toEqual({ cents: 5, display: '0,05' });
    expect(maskCentsInput('')).toEqual({ cents: 0, display: '' });
    expect(formatCents(123456)).toBe('R$ 1.234,56');
  });
});

import { commissionOf, describePayment } from './money';
describe('entrada e comissão', () => {
  it('entrada + parcelas', () => {
    expect(describePayment(10000, 2, 5000)).toBe('Entrada R$ 50,00 + 2x de R$ 25,00');
    expect(describePayment(10000, 1, 10000)).toBe('Pago no ato · R$ 100,00');
    expect(describePayment(10000, 1, 4000)).toBe('Entrada R$ 40,00 + 1x de R$ 60,00');
  });
  it('comissão arredonda igual ao banco (inclusive negativa)', () => {
    expect(commissionOf(10000, 30)).toBe(3000);
    expect(commissionOf(12345, 30)).toBe(3704);  // 3703,5 → 3704
    expect(commissionOf(-12345, 30)).toBe(-3704);
  });
});

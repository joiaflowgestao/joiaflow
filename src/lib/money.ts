// Todo valor monetário trafega e é armazenado em CENTAVOS (inteiros).
// Isso elimina erros de ponto flutuante (0.1 + 0.2 !== 0.3).

/** Converte texto digitado ("1.234,56", "300", "R$ 99,9") em centavos. Retorna null se inválido. */
export function parseBRLToCents(input: string): number | null {
  const clean = input.replace(/[R$\s]/g, '').trim();
  if (!clean) return null;
  if (!/^\d{1,3}(\.\d{3})*(,\d{0,2})?$|^\d+(,\d{0,2})?$/.test(clean)) return null;
  const [intPart, decPart = ''] = clean.replace(/\./g, '').split(',');
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Máscara de digitação estilo caixa registradora: só dígitos → "1.234,56" */
export function maskCentsInput(raw: string): { cents: number; display: string } {
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '').slice(0, 10);
  const cents = digits ? Number(digits) : 0;
  return { cents, display: cents ? formatCents(cents, false) : '' };
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const plain = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatCents(cents: number, withSymbol = true): string {
  return (withSymbol ? brl : plain).format(cents / 100).replace(/ /g, ' ');
}

export interface InstallmentPlan {
  installments: number;
  /** Valor base de cada parcela */
  baseCents: number;
  /** Centavos que sobram e são somados à 1ª parcela */
  remainderCents: number;
  firstCents: number;
}

/**
 * Divide o total em parcelas SEM perder centavos.
 * Mesma regra do banco (colunas geradas installment_cents / installment_remainder_cents).
 * Ex.: 10000 em 3x → 1ª 3334, demais 3333 (soma = 10000).
 */
export function splitInstallments(totalCents: number, installments: number): InstallmentPlan {
  if (!Number.isInteger(totalCents) || totalCents < 0) throw new Error('Total inválido');
  if (!Number.isInteger(installments) || installments < 1) throw new Error('Parcelas inválidas');
  const baseCents = Math.floor(totalCents / installments);
  const remainderCents = totalCents % installments;
  return { installments, baseCents, remainderCents, firstCents: baseCents + remainderCents };
}

export function describeInstallments(totalCents: number, installments: number): string {
  if (installments === 1) return `À vista · ${formatCents(totalCents)}`;
  const p = splitInstallments(totalCents, installments);
  if (p.remainderCents === 0) return `${installments}x de ${formatCents(p.baseCents)}`;
  return `1x de ${formatCents(p.firstCents)} + ${installments - 1}x de ${formatCents(p.baseCents)}`;
}

/** Comissão de um valor (arredonda como o banco: metade para longe do zero). */
export function commissionOf(cents: number, percent: number): number {
  const raw = (Math.abs(cents) * percent) / 100;
  return Math.sign(cents) * Math.round(raw);
}

/** Descrição do pagamento com entrada: "Entrada R$ 50,00 + 2x de R$ 25,00" */
export function describePayment(totalCents: number, installments: number, downCents = 0): string {
  if (downCents <= 0) return describeInstallments(totalCents, installments);
  const rest = totalCents - Math.min(downCents, totalCents);
  if (rest <= 0) return `Pago no ato · ${formatCents(totalCents)}`;
  return `Entrada ${formatCents(downCents)} + ${describeInstallments(rest, installments).replace('À vista · ', '1x de ')}`;
}

import { describe, expect, it } from 'vitest';
import { maskPhone, slugify } from './phone';
describe('telefone e slug', () => {
  it('celular e fixo', () => {
    expect(maskPhone('11987654321')).toBe('(11) 98765-4321');
    expect(maskPhone('1134567890')).toBe('(11) 3456-7890');
  });
  it('slug', () => expect(slugify('Semijoias Áurea & Cia')).toBe('semijoias-aurea-cia'));
});

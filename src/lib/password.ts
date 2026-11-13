/** Mesma regra aplicada na Edge Function admin-users. */
export function validatePassword(pwd: string): string | null {
  if (pwd.length < 8) return 'A senha deve ter pelo menos 8 caracteres.';
  if (pwd.length > 72) return 'A senha deve ter no máximo 72 caracteres.';
  if (!/[A-Za-z]/.test(pwd) || !/\d/.test(pwd)) return 'A senha deve conter letras e números.';
  return null;
}

// Shared by contact forms, record validation and the WhatsApp sender.
export const whatsappInputMaxLength = 60;
export const whatsappFormatHint = 'Maroc : 0612345678 ou +212 6 12 34 56 78. Autres pays : indicatif + numéro.';
const invalidNumber = 'Numéro WhatsApp invalide. Utilisez 0612345678 ou +212 6 12 34 56 78 ; pour un autre pays, ajoutez son indicatif.';
const invalidMoroccanNumber = 'Numéro marocain invalide : 10 chiffres avec le 0 initial, ou 9 chiffres après +212.';
type ParsedNumber = { valid: true; number: string } | { valid: false; error: string };

/** Empty clears the contact. Local numbers belong to Morocco; other countries need an explicit code. */
export function parseWhatsappNumber(input: string): ParsedNumber {
  if (input.length > whatsappInputMaxLength) return { valid: false, error: invalidNumber };
  let number = input.normalize('NFKC').trim()
    .replace(/[\u0660-\u0669\u06f0-\u06f9]/g, digit => String(digit.charCodeAt(0) - (digit >= '\u06f0' ? 0x06f0 : 0x0660)))
    .replace(/[\s.()\-\u2010-\u2015\u200e\u200f\u061c]/g, '');
  if (!number) return { valid: true, number: '' };
  if (number.startsWith('00')) number = '+' + number.slice(2);
  else if (/^212\d+$/.test(number)) number = '+' + number;
  else if (/^0[1-9]\d*$/.test(number)) {
    if (!/^0[1-9]\d{8}$/.test(number)) return { valid: false, error: invalidMoroccanNumber };
    number = '+212' + number.slice(1);
  }
  // A written domestic trunk prefix is unambiguous; never shorten an overlong subscriber number.
  if (/^\+2120[1-9]\d{8}$/.test(number)) number = '+212' + number.slice(5);
  if (number.startsWith('+212') && !/^\+212[1-9]\d{8}$/.test(number)) return { valid: false, error: invalidMoroccanNumber };
  if (!/^\+[1-9]\d{7,14}$/.test(number)) return { valid: false, error: invalidNumber };
  return { valid: true, number };
}

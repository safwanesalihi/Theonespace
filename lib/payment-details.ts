// Where an agency sends its transfer (Plateforme → Site → Coordonnées de paiement). Never part of the public
// site: it is kept apart from the landing's content, edited by The One Core's owner only, and shown only to
// an agency's owner once they ask for a plan (features/plans/subscription-panel.tsx).
// Pure: shared by the browser and the server.
import { z } from 'zod';

const digits = (label: string, max: number) => z.string().trim().max(max, `${label} trop long.`).regex(/^[\d\s]*$/, `${label} : chiffres seulement.`).default('');

export const paymentDetailsSchema = z.object({
  beneficiary: z.string().trim().max(80, 'Bénéficiaire trop long (80 caractères au plus).').default(''),
  bank: z.string().trim().max(80, 'Nom de banque trop long (80 caractères au plus).').default(''),
  /** Moroccan RIB: 24 digits. */
  rib: digits('RIB', 40),
  iban: z.string().trim().max(40, 'IBAN trop long.').regex(/^[A-Za-z0-9\s]*$/, 'IBAN : lettres et chiffres seulement.').default(''),
  ice: digits('ICE', 20),
  note: z.string().trim().max(200, 'Note trop longue (200 caractères au plus).').default(''),
}).strict();
export type PaymentDetails = z.infer<typeof paymentDetailsSchema>;
export const emptyPaymentDetails: PaymentDetails = { beneficiary: '', bank: '', rib: '', iban: '', ice: '', note: '' };

/** Worth showing to an agency: who to pay and where. */
export const paymentReady = (d: PaymentDetails) => !!d.beneficiary && !!(d.rib || d.iban);

export function readPaymentDetails(stored: unknown): PaymentDetails {
  const value = typeof stored === 'string' ? (() => { try { return JSON.parse(stored); } catch { return null; } })() : stored;
  const parsed = paymentDetailsSchema.safeParse(value);
  return parsed.success ? parsed.data : emptyPaymentDetails;
}

/** The details as labelled lines, to read on screen or paste into a message. */
export function paymentLines(d: PaymentDetails, label: (text: string) => string = (text) => text): [string, string][] {
  const rows: [string, string][] = [
    [label('Bénéficiaire'), d.beneficiary], [label('Banque'), d.bank], [label('RIB'), d.rib], [label('IBAN'), d.iban], [label('ICE'), d.ice], [label('Note'), d.note],
  ];
  return rows.filter(([, value]) => value);
}

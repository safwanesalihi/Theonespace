// The public site's key information, edited by the platform owner on Plateforme → Site and read by the
// landing (GET /api/site, or lib/site-content-server.ts on the server): a banner for news, the pilot offer,
// the prices shown, and how to reach The One Core. Pure: the shape, its rules and the values used until
// the owner saves a first version.
import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max, `${max} caractères au plus.`);
// An address the site can link to: empty, a web address, or a page of the site itself.
const link = z.string().trim().max(300).refine((v) => !v || /^https:\/\/\S+$/.test(v) || /^\/[^\s/][^\s]*$|^\/$/.test(v) || /^#[\w-]+$/.test(v),
  'Un lien commence par https://, par / (une page du site) ou par # (une section).');
const price = z.number().int('Un prix est un nombre entier de dirhams.').min(0).max(100_000);

export const siteContentSchema = z.object({
  announcement: z.object({ on: z.boolean(), text: text(140), link, linkLabel: text(40) }).strict(),
  pilot: z.object({ on: z.boolean(), title: text(80), text: text(280), seatsLeft: z.number().int().min(0).max(100), deadline: z.string().trim().refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Date au format AAAA-MM-JJ.') }).strict(),
  prices: z.object({ show: z.boolean(), starter: price, pro: price, agency: price, note: text(160) }).strict(),
  contact: z.object({
    email: z.string().trim().max(120).refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Adresse e-mail invalide.'),
    whatsapp: z.string().trim().max(30).refine((v) => !v || /^\+?[\d\s.-]{8,20}$/.test(v), 'Numéro WhatsApp invalide (ex. +212 6 12 34 56 78).'),
    city: text(60), hours: text(80),
  }).strict(),
  social: z.object({ instagram: link, linkedin: link }).strict(),
}).strict().superRefine((c, ctx) => {
  if (c.announcement.on && !c.announcement.text) ctx.addIssue({ code: 'custom', path: ['announcement', 'text'], message: 'Écrivez le texte du bandeau, ou désactivez-le.' });
  if (c.announcement.link && !c.announcement.linkLabel) ctx.addIssue({ code: 'custom', path: ['announcement', 'linkLabel'], message: 'Donnez un libellé au lien du bandeau.' });
  if (c.pilot.on && !c.pilot.title) ctx.addIssue({ code: 'custom', path: ['pilot', 'title'], message: 'Donnez un titre à l’offre pilote, ou désactivez-la.' });
});
export type SiteContent = z.infer<typeof siteContentSchema>;
/** What the site reads: the content, and when and by whom it was last saved (null before the first save). */
export type SiteContentState = { content: SiteContent; updatedAt: string | null; updatedBy: string | null };

/** Until the owner saves: the decisions of 2026-10-31 (prices, pilot offer), the prices hidden. */
export const defaultSiteContent: SiteContent = {
  announcement: { on: false, text: '', link: '', linkLabel: '' },
  pilot: { on: true, title: 'Devenez agence pilote', text: 'Deux mois offerts sur le plan Agence, puis −30 % pendant douze mois, en échange de vos retours chaque semaine.', seatsLeft: 0, deadline: '' },
  prices: { show: true, starter: 299, pro: 699, agency: 1499, note: 'Prix par agence et par mois, hors taxes. Payé à l’année : 12 mois pour le prix de 10.' },
  contact: { email: '', whatsapp: '', city: 'Casablanca', hours: '' },
  social: { instagram: '', linkedin: '' },
};

/** A stored value read back: anything missing or no longer valid falls back to the default, field by field. */
export function readSiteContent(stored: unknown): SiteContent {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Record<string, Record<string, unknown>>;
  const merged = Object.fromEntries(Object.entries(defaultSiteContent).map(([group, values]) => [group, { ...values, ...(s[group] && typeof s[group] === 'object' ? s[group] : {}) }]));
  const parsed = siteContentSchema.safeParse(merged);
  return parsed.success ? parsed.data : defaultSiteContent;
}

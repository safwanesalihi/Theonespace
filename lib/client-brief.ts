import { z } from 'zod';

const copy = z.string().trim().max(5000);
const id = z.string().trim().min(1).max(80);
const uniqueIds = <T extends { id: string }>(items: T[]) => new Set(items.map((item) => item.id)).size === items.length;
const httpUrl = z.string().trim().max(2000).refine((value) => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !!url.hostname; }
  catch { return false; }
}, 'Utilisez un lien http:// ou https://.');

/** One portable, bounded format for the visual board, JSON editor and records API. */
export const clientBriefSchema = z.object({
  version: z.literal(1),
  overview: z.string().trim().max(15000),
  audience: copy,
  voice: copy,
  identity: z.object({
    colors: z.array(z.object({ name: z.string().trim().min(1).max(80), value: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur invalide : utilisez #RRGGBB.') }).strict()).max(8),
    typography: z.string().trim().max(500),
    direction: copy,
    dos: copy,
    donts: copy,
  }).strict(),
  goals: z.array(z.object({ id, title: z.string().trim().min(1).max(300), measure: z.string().trim().max(500) }).strict()).max(20).refine(uniqueIds, 'Chaque objectif doit avoir un identifiant unique.'),
  requirements: z.array(z.object({ id, text: z.string().trim().min(1).max(1000), priority: z.enum(['must', 'prefer']) }).strict()).max(30).refine(uniqueIds, 'Chaque exigence doit avoir un identifiant unique.'),
  references: z.array(z.object({ id, label: z.string().trim().min(1).max(160), url: httpUrl }).strict()).max(20).refine(uniqueIds, 'Chaque référence doit avoir un identifiant unique.'),
}).strict();

export type ClientBrief = z.infer<typeof clientBriefSchema>;
export type BriefSection = 'overview' | 'identity' | 'goals' | 'audience' | 'requirements' | 'references';
export const briefSections: BriefSection[] = ['overview', 'identity', 'goals', 'audience', 'requirements', 'references'];
export const briefSectionLabels: Record<BriefSection, string> = {
  overview: 'La marque', identity: 'Identité visuelle', goals: 'Objectifs', audience: 'Audience & ton', requirements: 'Exigences', references: 'Références',
};
export function emptyBrief(overview = ''): ClientBrief {
  return { version: 1, overview, audience: '', voice: '', identity: { colors: [], typography: '', direction: '', dos: '', donts: '' }, goals: [], requirements: [], references: [] };
}
export function briefHasContent(brief: ClientBrief, section: BriefSection) {
  if (section === 'identity') return !!(brief.identity.colors.length || brief.identity.typography || brief.identity.direction || brief.identity.dos || brief.identity.donts);
  if (section === 'audience') return !!(brief.audience || brief.voice);
  if (section === 'overview') return !!brief.overview;
  return brief[section].length > 0;
}
export function parseBriefFile(input: unknown): { brief: ClientBrief } | { error: string; path: string } {
  const result = clientBriefSchema.safeParse(input);
  if (result.success) return { brief: result.data };
  const issue = result.error.issues[0];
  return { error: `Brief JSON invalide (${issue.path.join('.') || 'brief'}) : ${issue.message}`, path: issue.path.join('.') || 'brief' };
}

// The CRM: the studio's prospects before they become clients — where each stands (new, contacted,
// meeting, proposal sent, then won or lost), who to call, when to follow up, what it may be worth each
// month. Won, a prospect becomes a client in one step (the owner's, as for any new client) and the
// client pipeline (quote, contract, brief) takes over. The owner and administrators only.
// Pure rules here: the stages, what a prospect holds, the board's numbers and the analysis.
import { isDay, shiftDay } from '@/lib/flow';
import type { RecordItem } from '@/lib/model';
import { isManager, type WorkspaceRole } from '@/lib/workspace';

export const prospectStages = ['new', 'contacted', 'meeting', 'proposal', 'won', 'lost'] as const;
export type ProspectStage = (typeof prospectStages)[number];
export const prospectStageLabels: Record<ProspectStage, string> = {
  new: 'Nouveau', contacted: 'Contacté', meeting: 'Rendez-vous', proposal: 'Proposition envoyée', won: 'Gagné', lost: 'Perdu',
};
/** The stages still in play; won and lost close a prospect. */
export const openStages: ProspectStage[] = ['new', 'contacted', 'meeting', 'proposal'];
export const prospectSources = ['Instagram', 'Recommandation', 'Site web', 'Appel entrant', 'Salon / événement', 'Prospection', 'Autre'] as const;
/** Why a prospect is lost: a short list, so the analysis can count them; the detail goes in lostNote. */
export const prospectLostReasons = ['Budget trop serré', 'A choisi une autre agence', 'Pas le bon moment', 'Plus de réponse', 'Hors de notre offre', 'Autre'] as const;
export const prospectLimits = { name: 160, contact: 150, notes: 4000, lostNote: 500, value: 10_000_000, perWorkspace: 2000 };

/** Who works the CRM: the owner and the administrators. */
export const canUseCrm = (role: WorkspaceRole) => isManager(role);
export const isProspectStage = (value: unknown): value is ProspectStage => typeof value === 'string' && (prospectStages as readonly string[]).includes(value);

export type ProspectInput = {
  name: string; contact: string; email: string; whatsapp: string; city: string; sector: string; source: string;
  estimatedValue: number | null; due: string; description: string; prospectStage: ProspectStage; lostReason: string; lostNote: string;
};

/** Checks what the prospect form sent. Returns the clean fields, or the reason it can't be saved. */
export function prospectFields(data: unknown): ProspectInput | { error: string } {
  const d = (typeof data === 'object' && data ? data : {}) as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const name = text(d.name, prospectLimits.name);
  if (!name) return { error: 'Donnez le nom de l’entreprise ou de la personne.' };
  const email = text(d.email, 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Adresse e-mail invalide.' };
  const due = text(d.due, 10);
  if (due && !isDay(due)) return { error: 'Date de relance invalide.' };
  const rawValue = d.estimatedValue;
  const estimatedValue = rawValue === null || rawValue === undefined || rawValue === '' ? null : Number(rawValue);
  if (estimatedValue !== null && (!Number.isFinite(estimatedValue) || estimatedValue < 0 || estimatedValue > prospectLimits.value)) return { error: 'Valeur mensuelle invalide.' };
  const stage = d.prospectStage ?? 'new';
  if (!isProspectStage(stage)) return { error: 'Étape inconnue.' };
  const lostReason = stage === 'lost' ? text(d.lostReason, 80) : '';
  if (lostReason && !(prospectLostReasons as readonly string[]).includes(lostReason)) return { error: 'Raison de perte inconnue.' };
  return {
    name, contact: text(d.contact, prospectLimits.contact), email, whatsapp: text(d.whatsapp, 60), city: text(d.city, 100), sector: text(d.sector, 120),
    source: text(d.source, 80), estimatedValue: estimatedValue === null ? null : Math.round(estimatedValue), due, description: text(d.description, prospectLimits.notes),
    prospectStage: stage, lostReason, lostNote: stage === 'lost' ? text(d.lostNote, prospectLimits.lostNote) : '',
  };
}

/** The board's three numbers: what the open prospects may bring each month, follow-ups due, prospects won this month. */
export function crmSummary(prospects: RecordItem[], today: string) {
  const open = prospects.filter((p) => !p.archived && openStages.includes((p.prospectStage ?? 'new') as ProspectStage));
  const month = today.slice(0, 7);
  return {
    pipelineValue: open.reduce((total, p) => total + (p.estimatedValue ?? 0), 0),
    followUpsDue: open.filter((p) => !!p.due && p.due <= today).length,
    wonThisMonth: prospects.filter((p) => p.prospectStage === 'won' && (p.closedAt ?? '').slice(0, 7) === month).length,
  };
}

/** The analysis covers the prospects that arrived over the last quarter, the last year, or since the start. */
export const insightPeriods = { quarter: 90, year: 365, all: 0 } as const;
export type InsightPeriod = keyof typeof insightPeriods;
export type SourceInsight = { source: string; prospects: number; won: number; lost: number; winRate: number | null; wonValue: number };
export type LostInsight = { reason: string; count: number; share: number };

/**
 * What the CRM teaches, over the prospects that arrived in the period: how many of the closed ones were
 * won, what a won client is worth each month on average, which sources bring clients (not just
 * contacts), and why the others were lost. An empty source or reason reads as '' (« non précisée »).
 */
export function crmInsights(prospects: RecordItem[], today: string, period: InsightPeriod) {
  const days = insightPeriods[period];
  const since = days ? shiftDay(today, -days) : '';
  const cohort = prospects.filter((p) => p.kind === 'prospect' && !p.archived && (p.createdAt ?? '').slice(0, 10) >= since);
  const won = cohort.filter((p) => p.prospectStage === 'won');
  const lost = cohort.filter((p) => p.prospectStage === 'lost');
  const closed = won.length + lost.length;
  const valued = won.filter((p) => (p.estimatedValue ?? 0) > 0);
  const wonValue = valued.reduce((total, p) => total + (p.estimatedValue ?? 0), 0);
  const rate = (w: number, l: number) => (w + l ? w / (w + l) : null);

  const bySource = new Map<string, SourceInsight>();
  for (const p of cohort) {
    const source = p.source ?? '';
    const row = bySource.get(source) ?? { source, prospects: 0, won: 0, lost: 0, winRate: null, wonValue: 0 };
    row.prospects++;
    if (p.prospectStage === 'won') { row.won++; row.wonValue += p.estimatedValue ?? 0; }
    if (p.prospectStage === 'lost') row.lost++;
    bySource.set(source, row);
  }
  const sources = [...bySource.values()].map((row) => ({ ...row, winRate: rate(row.won, row.lost) }))
    .sort((a, b) => Number(!a.source) - Number(!b.source) || b.wonValue - a.wonValue || b.won - a.won || b.prospects - a.prospects || a.source.localeCompare(b.source));

  const byReason = new Map<string, number>();
  for (const p of lost) byReason.set(p.lostReason ?? '', (byReason.get(p.lostReason ?? '') ?? 0) + 1);
  const lostReasons: LostInsight[] = [...byReason].map(([reason, count]) => ({ reason, count, share: count / lost.length }))
    .sort((a, b) => Number(!a.reason) - Number(!b.reason) || b.count - a.count || a.reason.localeCompare(b.reason));
  const recentLost = [...lost].sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? '')).slice(0, 5);

  return {
    prospects: cohort.length, open: cohort.length - closed, won: won.length, lost: lost.length, closed,
    winRate: rate(won.length, lost.length), averageDeal: valued.length ? Math.round(wonValue / valued.length) : null, wonValue,
    sources, lostReasons, recentLost,
  };
}

/** The client a won prospect becomes: the same name and contact details. */
export const clientFromProspect = (prospect: RecordItem, now: string): RecordItem => ({
  id: crypto.randomUUID(), kind: 'client', revision: 1, name: prospect.name, createdAt: now,
  ...(prospect.contact ? { contact: prospect.contact } : {}), ...(prospect.email ? { email: prospect.email } : {}),
  ...(prospect.whatsapp ? { whatsapp: prospect.whatsapp } : {}), ...(prospect.city ? { city: prospect.city } : {}),
  ...(prospect.sector ? { sector: prospect.sector } : {}),
  history: [{ text: `Client créé depuis le CRM (prospect « ${prospect.name} »)`, date: now }],
});

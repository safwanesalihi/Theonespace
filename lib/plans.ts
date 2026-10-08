// Plans for the companies that sign up (lib/signup.ts): a free trial, then a paid plan. The One Core's
// own workspaces (the studio, print) have no plan and no limit. Pure: used by the server
// (lib/subscription.ts) and the browser (features/plans/subscription-panel.tsx, features/platform/platform-page.tsx).
//
// Payment is not taken in the app yet: a company asks for a plan, The One Core is told by e-mail,
// collects the payment (transfer, card link…) and marks the workspace paid on the Plateforme page.

export const planIds = ['trial', 'starter', 'pro', 'agency'] as const;
export type PlanId = (typeof planIds)[number];
export type PaidPlanId = Exclude<PlanId, 'trial'>;
export const paidPlanIds: PaidPlanId[] = ['starter', 'pro', 'agency'];

/** members: team seats, owner included (client contacts don't count); storageMb: uploaded files. */
export type PlanLimits = { members: number; clients: number; storageMb: number; aiPerMonth: number };
export type Plan = { id: PlanId; name: string; priceMad: number; limits: PlanLimits };

export const trialDays = 14;
/** Days a paid workspace keeps working after its paid period, while the payment arrives. */
export const graceDays = 7;

export const plans: Record<PlanId, Plan> = {
  trial: { id: 'trial', name: 'Essai', priceMad: 0, limits: { members: 3, clients: 5, storageMb: 500, aiPerMonth: 50 } },
  starter: { id: 'starter', name: 'Starter', priceMad: 299, limits: { members: 3, clients: 10, storageMb: 2_048, aiPerMonth: 300 } },
  pro: { id: 'pro', name: 'Pro', priceMad: 699, limits: { members: 10, clients: 50, storageMb: 10_240, aiPerMonth: 1_500 } },
  agency: { id: 'agency', name: 'Agence', priceMad: 1_499, limits: { members: 25, clients: 200, storageMb: 51_200, aiPerMonth: 5_000 } },
};
export const isPlanId = (value: unknown): value is PlanId => planIds.includes(value as PlanId);
export const isPaidPlanId = (value: unknown): value is PaidPlanId => paidPlanIds.includes(value as PaidPlanId);

/** What is stored per company workspace (dates as ISO strings). */
export type Subscription = {
  plan: PlanId;
  trialEndsAt: string;
  paidUntil?: string | null;
  canceled?: boolean;
  requestedPlan?: PaidPlanId | null;
  requestedAt?: string | null;
};
export type Usage = { members: number; clients: number; storageMb: number; aiThisMonth: number };
export type Limit = keyof PlanLimits;

/** Where the workspace stands today: whether it can still create and change things, and until when. */
export type SubscriptionState = {
  plan: PlanId;
  limits: PlanLimits;
  active: boolean;
  /** 'trial' (running), 'paid', 'grace' (paid period over, grace days left), or why it stopped. */
  phase: 'trial' | 'paid' | 'grace' | 'trial-ended' | 'expired' | 'canceled';
  /** The day it stops (end of trial, or end of the grace days). */
  endsAt: string | null;
  daysLeft: number | null;
};

const day = 86_400_000;
const daysUntil = (iso: string, now: number) => Math.max(0, Math.ceil((Date.parse(iso) - now) / day));

export function subscriptionState(sub: Subscription, now = Date.now()): SubscriptionState {
  const base = { plan: sub.plan, limits: plans[sub.plan].limits };
  if (sub.canceled) return { ...base, active: false, phase: 'canceled', endsAt: null, daysLeft: null };
  if (sub.plan === 'trial') {
    const running = Date.parse(sub.trialEndsAt) > now;
    return { ...base, active: running, phase: running ? 'trial' : 'trial-ended', endsAt: sub.trialEndsAt, daysLeft: running ? daysUntil(sub.trialEndsAt, now) : 0 };
  }
  const paidUntil = sub.paidUntil ? Date.parse(sub.paidUntil) : 0;
  if (paidUntil > now) return { ...base, active: true, phase: 'paid', endsAt: sub.paidUntil!, daysLeft: daysUntil(sub.paidUntil!, now) };
  const graceEnd = new Date(paidUntil + graceDays * day).toISOString();
  if (paidUntil && paidUntil + graceDays * day > now) return { ...base, active: true, phase: 'grace', endsAt: graceEnd, daysLeft: daysUntil(graceEnd, now) };
  return { ...base, active: false, phase: 'expired', endsAt: paidUntil ? graceEnd : null, daysLeft: 0 };
}

/** The first limit an addition would cross (`adding` of `limit`), else null. */
export function overLimit(limits: PlanLimits, usage: Usage, limit: Limit, adding = 1): Limit | null {
  const used = limit === 'aiPerMonth' ? usage.aiThisMonth : usage[limit];
  return used + adding > limits[limit] ? limit : null;
}

/** The message shown when a limit is reached (French key, translated in the browser). */
export const limitMessages: Record<Limit, string> = {
  members: 'Votre plan ne permet pas plus de membres dans l’équipe : passez à un plan supérieur.',
  clients: 'Votre plan ne permet pas plus de clients : passez à un plan supérieur.',
  storageMb: 'L’espace de stockage de votre plan est plein : supprimez des fichiers ou passez à un plan supérieur.',
  aiPerMonth: 'Les demandes à l’IA de votre plan sont épuisées pour ce mois : passez à un plan supérieur.',
};
export const inactiveMessage = (phase: SubscriptionState['phase']) =>
  phase === 'trial-ended' ? 'Votre période d’essai est terminée : choisissez un plan pour continuer à modifier votre espace.'
  : phase === 'canceled' ? 'Cet espace est suspendu : contactez The One Core pour le réactiver.'
  : 'Votre abonnement a expiré : renouvelez-le pour continuer à modifier votre espace.';

/** A new paid period: from today, or from the end of the current one if it is still running. */
export function extendPaid(sub: Subscription, months: number, now = Date.now()): string {
  const from = Math.max(now, sub.paidUntil ? Date.parse(sub.paidUntil) : 0);
  const next = new Date(from);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next.toISOString();
}

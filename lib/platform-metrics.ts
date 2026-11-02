// The Plateforme page's numbers (features/platform): what each company brings in, what its use of our paid
// services costs us this month, and the platform's overview. Pure: shared by the server and the browser.
// Unit costs are estimates in dirhams ($1 ≈ 10 MAD), from the providers' public prices (docs/saas-audit,
// phase 7): WhatsApp utility messages in Morocco ≈ $0.023, Daily ≈ $0.004 per participant-minute,
// an Instagram analysis on Apify ≈ 50 results ≈ $0.115, an AI answer a fraction of a cent.
import { plans, type Subscription, type SubscriptionState, type Usage } from '@/lib/plans';

export const unitCostsMad = { whatsapp: 0.23, callMinute: 0.04, igAnalysis: 1.15, ai: 0.01 } as const;

export type ServiceCost = { whatsapp: number; calls: number; instagram: number; ai: number; total: number };
const round = (n: number) => Math.round(n * 100) / 100;

/** This month's estimated cost of a company's metered services, in MAD. */
export function serviceCost(usage: Usage): ServiceCost {
  const whatsapp = usage.whatsappThisMonth * unitCostsMad.whatsapp;
  const calls = usage.meetingMinutesThisMonth * unitCostsMad.callMinute;
  const instagram = usage.igThisMonth * unitCostsMad.igAnalysis;
  const ai = usage.aiThisMonth * unitCostsMad.ai;
  return { whatsapp: round(whatsapp), calls: round(calls), instagram: round(instagram), ai: round(ai), total: round(whatsapp + calls + instagram + ai) };
}

export type PlatformCompany = { id: string; name: string; createdAt: string; subscription: Subscription; state: SubscriptionState; usage: Usage };

/** What a company pays each month: its plan's price while a paid plan runs (grace included), else nothing. */
export const monthlyRevenue = (c: PlatformCompany) =>
  c.subscription.plan !== 'trial' && (c.state.phase === 'paid' || c.state.phase === 'grace') ? plans[c.subscription.plan].priceMad : 0;

/** Cost against price: under 0.5 healthy, up to 0.8 to watch, above that the company costs more than it should. */
export type CostLevel = 'ok' | 'watch' | 'high';
export function costLevel(c: PlatformCompany): CostLevel {
  const cost = serviceCost(c.usage).total;
  const price = monthlyRevenue(c);
  if (!price) return cost >= 100 ? 'high' : cost >= 40 ? 'watch' : 'ok'; // a trial has no price: absolute thresholds
  const ratio = cost / price;
  return ratio > 0.8 ? 'high' : ratio > 0.5 ? 'watch' : 'ok';
}

export type Attention = { kind: 'request' | 'trial-ending' | 'grace' | 'cost'; id: string; name: string; days?: number | null; amount?: number };

export type PlatformOverview = {
  companies: number; paying: number; trials: number; stopped: number; requests: number;
  mrr: number; arr: number; serviceCost: number; margin: number; marginRate: number | null;
  planMix: { trial: number; starter: number; pro: number; agency: number };
  signups: { week: string; count: number }[];
  attention: Attention[];
};

const day = 86_400_000;
/** Monday 00:00 UTC of the week holding `time`, as YYYY-MM-DD. */
function weekOf(time: number) {
  const d = new Date(time);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** The overview: revenue, cost, margin, the mix of plans, sign-ups over 8 weeks and what needs the owner. */
export function platformOverview(companies: PlatformCompany[], now = Date.now()): PlatformOverview {
  const paying = companies.filter((c) => monthlyRevenue(c) > 0);
  const mrr = paying.reduce((sum, c) => sum + monthlyRevenue(c), 0);
  const cost = round(companies.reduce((sum, c) => sum + serviceCost(c.usage).total, 0));
  const planMix = { trial: 0, starter: 0, pro: 0, agency: 0 };
  for (const c of companies) if (c.state.active) planMix[c.subscription.plan]++;
  const thisWeek = weekOf(now);
  const signups = Array.from({ length: 8 }, (_, i) => {
    const week = weekOf(Date.parse(thisWeek) - (7 - i) * 7 * day);
    return { week, count: companies.filter((c) => weekOf(Date.parse(c.createdAt)) === week).length };
  });
  const attention: Attention[] = [
    ...companies.filter((c) => c.subscription.requestedPlan).map((c) => ({ kind: 'request' as const, id: c.id, name: c.name })),
    ...companies.filter((c) => c.state.phase === 'grace').map((c) => ({ kind: 'grace' as const, id: c.id, name: c.name, days: c.state.daysLeft })),
    ...companies.filter((c) => c.state.phase === 'trial' && (c.state.daysLeft ?? 99) <= 3).map((c) => ({ kind: 'trial-ending' as const, id: c.id, name: c.name, days: c.state.daysLeft })),
    ...companies.filter((c) => costLevel(c) === 'high').map((c) => ({ kind: 'cost' as const, id: c.id, name: c.name, amount: serviceCost(c.usage).total })),
  ];
  return {
    companies: companies.length,
    paying: paying.length,
    trials: companies.filter((c) => c.state.phase === 'trial').length,
    stopped: companies.filter((c) => !c.state.active).length,
    requests: companies.filter((c) => c.subscription.requestedPlan).length,
    mrr, arr: mrr * 12, serviceCost: cost, margin: round(mrr - cost), marginRate: mrr ? round((mrr - cost) / mrr) : null,
    planMix, signups, attention,
  };
}

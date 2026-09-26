// The Social report for a period: what went out, what it reached, what it earned, which posts worked,
// and how the audience grew — from the numbers lib/social-insights.ts reads. Pure: shared by the studio's
// Statistiques view, the client portal, the CSV export and the tests.
import type { PostStats, RecordItem } from '@/lib/model';
import { captionFor, networkLabels, networks, targetsOf, type Network } from '@/lib/social';

export type FollowerHistory = { clientId: string; network: Network; history: { day: string; followers: number }[] };
export type ReportPeriod = { from: string; to: string }; // YYYY-MM-DD, both included

export type Totals = {
  posts: number;
  views: number; reach: number; likes: number; comments: number; shares: number; saves: number;
  interactions: number;
  /** Interactions over reach (or views where the network has no reach); null when nothing was measured. */
  engagement: number | null;
};
export type NetworkRow = Totals & { network: Network; followers: number | null; followersDelta: number | null };
export type TopPost = {
  postId: string; name: string; network: Network; day: string; url?: string; caption: string;
  views: number; reach: number; interactions: number; engagement: number | null;
};
export type SocialReport = {
  period: ReportPeriod;
  totals: Totals & { followers: number | null; followersDelta: number | null };
  byNetwork: NetworkRow[];
  weekly: { week: string; label: string; views: number; interactions: number }[];
  top: TopPost[];
  /** Published posts whose numbers couldn't be read (account to reconnect, post deleted…). */
  unread: { name: string; network: Network; error: string }[];
  measuredAt: string | null;
};

const empty = (): Totals => ({ posts: 0, views: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, interactions: 0, engagement: null });
export const interactionsOf = (s?: Partial<PostStats>) => (s?.likes ?? 0) + (s?.comments ?? 0) + (s?.shares ?? 0) + (s?.saves ?? 0);
/** The audience a post reached: its reach where the network counts people, its views otherwise. */
export const audienceOf = (s?: Partial<PostStats>) => s?.reach ?? s?.views ?? 0;
const rate = (interactions: number, audience: number) => (audience > 0 ? interactions / audience : null);
const add = (t: Totals, s: Partial<PostStats>) => {
  t.views += s.views ?? 0; t.reach += s.reach ?? 0; t.likes += s.likes ?? 0; t.comments += s.comments ?? 0;
  t.shares += s.shares ?? 0; t.saves += s.saves ?? 0; t.interactions += interactionsOf(s);
};
const finish = (t: Totals, audience: number) => { t.engagement = rate(t.interactions, audience); return t; };

/** Monday of the week of `day` (YYYY-MM-DD). */
function weekOf(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Followers at a day: the last count read on or before it (the first one after, when none before). */
function followersAt(history: FollowerHistory['history'], day: string): number | null {
  const before = history.filter((h) => h.day <= day);
  if (before.length) return before[before.length - 1].followers;
  return history[0]?.followers ?? null;
}

export function socialReport(posts: RecordItem[], histories: FollowerHistory[], period: ReportPeriod, { clientId, locale = 'fr-FR' }: { clientId?: string; locale?: string } = {}): SocialReport {
  const totals = empty();
  const byNetwork = new Map<Network, Totals & { audience: number }>();
  const weeks = new Map<string, { views: number; interactions: number }>();
  const top: TopPost[] = [];
  const unread: SocialReport['unread'] = [];
  let audience = 0;
  let measuredAt: string | null = null;
  const postIds = new Set<string>();

  for (const post of posts) {
    if (post.kind !== 'editorial_post' || post.archived || (clientId && post.clientId !== clientId)) continue;
    for (const target of targetsOf(post)) {
      const result = post.publishResults?.[target.network];
      if (!result?.ok) continue;
      const day = result.at.slice(0, 10);
      if (day < period.from || day > period.to) continue;
      const stats = post.stats?.[target.network];
      postIds.add(post.id);
      const row = byNetwork.get(target.network) ?? { ...empty(), audience: 0 };
      row.posts++;
      if (stats) {
        add(totals, stats); add(row, stats);
        const a = audienceOf(stats);
        audience += a; row.audience += a;
        if (!measuredAt || stats.at > measuredAt) measuredAt = stats.at;
        const week = weeks.get(weekOf(day)) ?? { views: 0, interactions: 0 };
        week.views += stats.views ?? stats.reach ?? 0; week.interactions += interactionsOf(stats);
        weeks.set(weekOf(day), week);
        if (stats.error) unread.push({ name: post.name, network: target.network, error: stats.error });
        top.push({
          postId: post.id, name: post.name, network: target.network, day, url: result.url, caption: captionFor(post, target).slice(0, 160),
          views: stats.views ?? 0, reach: stats.reach ?? 0, interactions: interactionsOf(stats), engagement: rate(interactionsOf(stats), a),
        });
      } else if (!result.manual) {
        unread.push({ name: post.name, network: target.network, error: 'pas encore mesuré' });
      }
      byNetwork.set(target.network, row);
    }
  }
  totals.posts = postIds.size;
  finish(totals, audience);

  // Followers per network, summed over the clients in scope.
  const scoped = histories.filter((h) => !clientId || h.clientId === clientId);
  const followerRow = (network?: Network) => {
    const list = scoped.filter((h) => !network || h.network === network).filter((h) => h.history.length);
    if (!list.length) return { followers: null, followersDelta: null };
    let end = 0, start = 0;
    for (const h of list) { end += followersAt(h.history, period.to) ?? 0; start += followersAt(h.history, period.from) ?? 0; }
    return { followers: end, followersDelta: end - start };
  };

  const networkRows: NetworkRow[] = networks
    .filter((n) => byNetwork.has(n) || scoped.some((h) => h.network === n && h.history.length))
    .map((network) => {
      const row = byNetwork.get(network) ?? { ...empty(), audience: 0 };
      const { audience: a, ...rest } = row;
      return { network, ...finish(rest, a), ...followerRow(network) };
    });

  // Every week of the period, even quiet ones, so the chart shows the rhythm.
  const weekly: SocialReport['weekly'] = [];
  for (let w = weekOf(period.from); w <= period.to; ) {
    const v = weeks.get(w) ?? { views: 0, interactions: 0 };
    weekly.push({ week: w, label: new Date(`${w}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short' }), ...v });
    const next = new Date(`${w}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 7); w = next.toISOString().slice(0, 10);
  }

  return {
    period,
    totals: { ...totals, ...followerRow() },
    byNetwork: networkRows,
    weekly,
    top: top.sort((a, b) => b.interactions - a.interactions || b.views - a.views).slice(0, 10),
    unread,
    measuredAt,
  };
}

// ---------------------------------------------------------------- periods

export type PeriodKey = 'month' | 'last-month' | '30' | '90';
export const periodLabels: Record<PeriodKey, string> = { month: 'Ce mois-ci', 'last-month': 'Le mois dernier', '30': '30 derniers jours', '90': '90 derniers jours' };

/** The dates of a period, from today's date (YYYY-MM-DD, studio time). */
export function periodFor(key: PeriodKey, today: string): ReportPeriod {
  const [y, m] = today.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  if (key === 'month') return { from: `${y}-${pad(m)}-01`, to: today };
  if (key === 'last-month') {
    const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
    return { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(lastDay(py, pm))}` };
  }
  const from = new Date(`${today}T12:00:00Z`); from.setUTCDate(from.getUTCDate() - Number(key) + 1);
  return { from: from.toISOString().slice(0, 10), to: today };
}

// ---------------------------------------------------------------- CSV

/** One line per published post and network, for a spreadsheet (semicolons, as Excel in French expects). */
export function reportCsv(posts: RecordItem[], period: ReportPeriod, clientName: (id?: string) => string, clientId?: string) {
  const header = ['Date', 'Client', 'Publication', 'Réseau', 'Vues', 'Portée', "J'aime", 'Commentaires', 'Partages', 'Enregistrements', 'Interactions', 'Taux d’engagement', 'Lien'];
  const lines: string[][] = [];
  for (const post of posts) {
    if (post.kind !== 'editorial_post' || post.archived || (clientId && post.clientId !== clientId)) continue;
    for (const target of targetsOf(post)) {
      const result = post.publishResults?.[target.network];
      if (!result?.ok) continue;
      const day = result.at.slice(0, 10);
      if (day < period.from || day > period.to) continue;
      const s = post.stats?.[target.network];
      const eng = rate(interactionsOf(s), audienceOf(s));
      lines.push([day, clientName(post.clientId), post.name, networkLabels[target.network], s?.views ?? '', s?.reach ?? '', s?.likes ?? '', s?.comments ?? '', s?.shares ?? '', s?.saves ?? '',
        s ? interactionsOf(s) : '', eng === null ? '' : (eng * 100).toFixed(1).replace('.', ',') + ' %', result.url ?? ''].map(String));
    }
  }
  const cell = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? "'" + v : v).replaceAll('"', '""')}"`;
  return '﻿' + [header, ...lines.sort((a, b) => a[0].localeCompare(b[0]))].map((r) => r.map(cell).join(';')).join('\r\n');
}

// IG Analyzer — the numbers behind the dashboard, computed in the browser so days and hours follow the
// viewer's own time zone. Pure: no network, no React.
//
// "score" = a post's engagement ÷ this account's median post engagement, so 1.0× is a typical post for
// *that* account, and 2×+ counts as viral. Reels also get a views score; a post's "perf" is the higher.
import type { IgAccount, IgPost, IgPostType } from '@/lib/ig-analyzer/scraper';

export const median = (arr: (number | null | undefined)[]) => {
  const s = arr.filter((v): v is number => v != null && !Number.isNaN(v)).sort((a, b) => a - b);
  const n = s.length;
  if (!n) return 0;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const mean = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

export const TYPE_LABEL: Record<IgPostType, string> = { REEL: 'Reels', CAROUSEL: 'Carrousels', IMAGE: 'Photos', VIDEO: 'Vidéos' };
export const TYPE_ONE: Record<IgPostType, string> = { REEL: 'Reel', CAROUSEL: 'Carrousel', IMAGE: 'Photo', VIDEO: 'Vidéo' };
export const DAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
export const BLOCKS = ['0–3h', '3–6h', '6–9h', '9–12h', '12–15h', '15–18h', '18–21h', '21–24h'];

/** The first non-empty line of a caption: what people read before « … plus ». */
export const hook = (caption: string) => (caption.split('\n').find((l) => l.trim()) || '').trim();
export const hashtags = (caption: string) => [...new Set((caption.match(/#[\p{L}\p{N}_]+/gu) || []).map((t) => t.toLowerCase()))];

export type AnalyzedPost = IgPost & { date: Date; pubEng: number; eng: number; er: number; score: number; viewScore: number | null; perf: number; viral: boolean };
export type Scored = { label: string; n: number; score: number };
export type Format = { type: IgPostType; label: string; count: number; share: number; medScore: number; avgER: number; medViews: number };
export type Analysis = ReturnType<typeof analyzeAccount>;

export function analyzeAccount(account: IgAccount) {
  const followers = account.profile.followers_count || 1;
  const posts: AnalyzedPost[] = account.posts.map((p) => {
    const pubEng = (p.likes ?? 0) + (p.comments ?? 0);
    return { ...p, date: new Date(p.timestamp), pubEng, eng: pubEng, er: (pubEng / followers) * 100, score: 0, viewScore: null, perf: 0, viral: false };
  });
  const medEng = median(posts.map((p) => p.eng)) || 1;
  const reelViews = posts.filter((p) => p.type === 'REEL' && p.views != null).map((p) => p.views as number);
  const medViews = median(reelViews) || null;
  for (const p of posts) {
    p.score = p.eng / medEng;
    p.viewScore = p.type === 'REEL' && p.views != null && medViews ? p.views / medViews : null;
    p.perf = Math.max(p.score, p.viewScore ?? 0);
    p.viral = posts.length >= 5 && p.perf >= 2;
  }
  posts.sort((a, b) => b.date.getTime() - a.date.getTime());

  // Cadence: posts per week over the span the fetched posts cover.
  const spanDays = posts.length > 1 ? (posts[0].date.getTime() - posts[posts.length - 1].date.getTime()) / 86400e3 : 7;
  const postsPerWeek = posts.length > 1 ? (posts.length - 1) / Math.max(spanDays / 7, 1 / 7) : posts.length;

  const formats: Format[] = (Object.keys(TYPE_LABEL) as IgPostType[])
    .map((type) => {
      const list = posts.filter((p) => p.type === type);
      return { type, label: TYPE_LABEL[type], count: list.length, share: list.length / (posts.length || 1), medScore: median(list.map((p) => p.score)), avgER: mean(list.map((p) => p.er)), medViews: median(list.map((p) => p.views)) };
    })
    .filter((f) => f.count > 0);

  // Timing grid: day × 3-hour block, median score.
  const grid = DAYS.map(() => BLOCKS.map(() => [] as number[]));
  for (const p of posts) grid[p.date.getDay()][Math.floor(p.date.getHours() / 3)].push(p.score);
  const timing = grid.map((row) => row.map((cell) => ({ n: cell.length, score: cell.length ? median(cell) : null })));
  const byDay: Scored[] = DAYS.map((d, i) => { const s = posts.filter((p) => p.date.getDay() === i).map((p) => p.score); return { label: d, n: s.length, score: median(s) }; });
  const byBlock: Scored[] = BLOCKS.map((b, i) => { const s = posts.filter((p) => Math.floor(p.date.getHours() / 3) === i).map((p) => p.score); return { label: b, n: s.length, score: median(s) }; });

  const tagMap = new Map<string, number[]>();
  for (const p of posts) for (const t of hashtags(p.caption)) tagMap.set(t, [...(tagMap.get(t) ?? []), p.score]);
  const tags = [...tagMap.entries()].map(([tag, scores]) => ({ tag, count: scores.length, score: median(scores) })).sort((a, b) => b.count - a.count || b.score - a.score);

  const buckets: Scored[] = [
    { label: 'Courtes (<60)', test: (n: number) => n < 60 },
    { label: 'Moyennes (60–150)', test: (n: number) => n >= 60 && n < 150 },
    { label: 'Longues (150–400)', test: (n: number) => n >= 150 && n < 400 },
    { label: 'Très longues (400+)', test: (n: number) => n >= 400 },
  ].map((b) => { const s = posts.filter((p) => b.test(p.caption.replace(/#[\p{L}\p{N}_]+/gu, '').trim().length)).map((p) => p.score); return { label: b.label, n: s.length, score: median(s) }; });

  const reels = posts.filter((p) => p.type === 'REEL');
  const durations: Scored[] = [
    { label: 'Moins de 15 s', test: (d: number) => d < 15 },
    { label: '15–30 s', test: (d: number) => d >= 15 && d < 30 },
    { label: '30–60 s', test: (d: number) => d >= 30 && d < 60 },
    { label: '60 s et +', test: (d: number) => d >= 60 },
  ].map((b) => { const s = reels.filter((p) => p.duration != null && b.test(p.duration)).map((p) => p.viewScore ?? p.score); return { label: b.label, n: s.length, score: median(s) }; });

  return {
    profile: account.profile, fetchedAt: account.fetchedAt, posts, followers, postsPerWeek,
    avgER: mean(posts.map((p) => p.er)), medEng, medViews, viewsPerFollower: medViews ? medViews / followers : null,
    reelCount: reels.length, durations, viralCount: posts.filter((p) => p.viral).length, formats, timing, byDay, byBlock, tags, buckets,
  };
}

/** A recommendation as a French template and its values, so the page can translate it like the rest of the app. */
export type Rec = { title: [string, Record<string, string | number>?]; body: [string, Record<string, string | number>?] };
const fx = (v: number) => `${v.toFixed(1)}×`;
const lower = (s: string) => s.toLowerCase();

/** Plain-language, data-backed recommendations; each needs enough posts to mean something. */
export function recommendations(me: Analysis, competitors: Analysis[] = []): Rec[] {
  const recs: Rec[] = [];
  const f = me.formats.filter((x) => x.count >= 3).sort((a, b) => b.medScore - a.medScore);
  if (f.length >= 2 && f[0].medScore > f[f.length - 1].medScore * 1.2) {
    const best = f[0], worst = f[f.length - 1];
    recs.push({
      title: ['Publiez plus de {format}', { format: lower(best.label) }],
      body: ['Vos {best} obtiennent {x} l’engagement de vos {worst}, mais ne représentent que {share} % de vos publications.', { best: lower(best.label), x: fx(best.medScore / (worst.medScore || 1)), worst: lower(worst.label), share: Math.round(best.share * 100) }],
    });
  }
  const days = me.byDay.filter((d) => d.n >= 2).sort((a, b) => b.score - a.score);
  const blocks = me.byBlock.filter((d) => d.n >= 2).sort((a, b) => b.score - a.score);
  if (days.length >= 3 && blocks.length >= 2) {
    recs.push({
      title: ['Meilleur moment pour publier : {day}, {block}', { day: days[0].label, block: blocks[0].label }],
      body: ['Le {day}, les publications font {dx} une publication habituelle ; le créneau {block} fait {bx}. Le plus faible : {worst} ({wx}).', { day: days[0].label, dx: fx(days[0].score), block: blocks[0].label, bx: fx(blocks[0].score), worst: blocks[blocks.length - 1].label, wx: fx(blocks[blocks.length - 1].score) }],
    });
  }
  const goodTags = me.tags.filter((t) => t.count >= 3 && t.score >= 1.2).slice(0, 3);
  const badTags = me.tags.filter((t) => t.count >= 3 && t.score <= 0.85).slice(0, 3);
  if (goodTags.length) {
    recs.push({
      title: ['Hashtags liés aux meilleures publications'],
      body: [badTags.length ? '{good}. Les publications avec {bad} font souvent moins bien. C’est une corrélation : testez avant de vous y fier.' : '{good}. C’est une corrélation : testez avant de vous y fier.', { good: goodTags.map((t) => `${t.tag} (${fx(t.score)})`).join(', '), bad: badTags.map((t) => t.tag).join(', ') }],
    });
  }
  const d = me.durations.filter((x) => x.n >= 3).sort((a, b) => b.score - a.score);
  if (d.length >= 2 && d[0].score > d[d.length - 1].score * 1.2) {
    recs.push({ title: ['Durée des reels : {best} fonctionne le mieux', { best: d[0].label }], body: ['Les reels de {best} font {bx} les vues habituelles, contre {wx} pour {worst}.', { best: d[0].label, bx: fx(d[0].score), wx: fx(d[d.length - 1].score), worst: d[d.length - 1].label }] });
  }
  const b = me.buckets.filter((x) => x.n >= 3).sort((a, b2) => b2.score - a.score);
  if (b.length >= 2 && b[0].score > b[b.length - 1].score * 1.15) {
    recs.push({ title: ['Légendes : les {best} fonctionnent le mieux', { best: lower(b[0].label.split(' (')[0]) }], body: ['Les légendes {best} font {bx}, contre {wx} pour les {worst}.', { best: lower(b[0].label), bx: fx(b[0].score), wx: fx(b[b.length - 1].score), worst: lower(b[b.length - 1].label) }] });
  }
  if (competitors.length) {
    const compPpw = median(competitors.map((c) => c.postsPerWeek));
    if (compPpw > me.postsPerWeek * 1.25) recs.push({ title: ['Publiez plus souvent'], body: ['Les autres comptes suivis publient environ {them} fois par semaine, contre {me} ici.', { them: compPpw.toFixed(1), me: me.postsPerWeek.toFixed(1) }] });
    const compReel = median(competitors.map((c) => c.formats.find((x) => x.type === 'REEL')?.share || 0));
    const myReel = me.formats.find((x) => x.type === 'REEL')?.share || 0;
    if (compReel > myReel + 0.15) recs.push({ title: ['Les comptes suivis misent davantage sur les reels'], body: ['Les reels font {them} % de leurs publications, contre {me} % ici.', { them: Math.round(compReel * 100), me: Math.round(myReel * 100) }] });
  }
  const viral = me.posts.filter((p) => p.viral);
  if (viral.length) {
    const types = viral.reduce((m, p) => ((m[p.type] = (m[p.type] || 0) + 1), m), {} as Record<string, number>);
    const top = Object.entries(types).sort((a, b2) => b2[1] - a[1])[0][0] as IgPostType;
    recs.push({ title: ['Refaites les publications virales'], body: ['{n} des {total} dernières publications ont fait 2× et plus, surtout des {type}. Reprenez leurs accroches sous un nouvel angle : « {hook} ».', { n: viral.length, total: me.posts.length, type: lower(TYPE_LABEL[top]), hook: hook(viral[0].caption).slice(0, 90) }] });
  }
  return recs;
}

// IG Analyzer — reads any public Instagram profile through Apify's official Instagram actors
// (apify/instagram-profile-scraper for the profile, apify/instagram-scraper for recent posts and
// reels). Server-only: APIFY_TOKEN never leaves lib/env.
import { env } from '@/lib/env';

const APIFY = 'https://api.apify.com/v2';
export const apifyConfigured = () => !!env.APIFY_TOKEN;
export const postsLimit = () => Math.min(Math.max(Number(env.IG_POSTS_LIMIT) || 50, 12), 200);

export type IgPostType = 'REEL' | 'CAROUSEL' | 'IMAGE' | 'VIDEO';
export type IgPost = {
  id: string; type: IgPostType; caption: string; timestamp: string; permalink: string | null; thumb: string | null;
  likes: number | null; comments: number; views: number | null; duration: number | null; isPinned: boolean;
};
export type IgProfile = {
  username: string; name: string; biography: string; followers_count: number; follows_count: number; media_count: number;
  profile_picture_url: string | null; verified: boolean; category: string | null; externalUrl: string | null;
};
export type IgAccount = { profile: IgProfile; posts: IgPost[]; fetchedAt: string };

export class IgError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** Accepts "name", "@name", "instagram.com/name", "https://www.instagram.com/name/?hl=en". */
export function parseUsername(input: unknown): string | null {
  let s = String(input ?? '').trim();
  if (!s) return null;
  if (/instagram\.com/i.test(s) || s.startsWith('http')) {
    let url: URL;
    try { url = new URL(s.startsWith('http') ? s : `https://${s}`); } catch { return null; }
    const seg = url.pathname.split('/').filter(Boolean);
    if (!seg.length || ['p', 'reel', 'reels', 'tv', 'stories', 'explore'].includes(seg[0].toLowerCase())) {
      throw new IgError('C’est le lien d’une publication. Collez plutôt le lien du profil (instagram.com/nom).', 400);
    }
    s = seg[0];
  }
  s = s.replace(/^@/, '').toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(s) ? s : null;
}

async function runActor(actor: string, input: unknown, timeoutSecs = 240): Promise<Record<string, unknown>[]> {
  let res: Response;
  try {
    res = await fetch(`${APIFY}/acts/${actor}/run-sync-get-dataset-items?timeout=${timeoutSecs}&clean=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.APIFY_TOKEN}` },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout((timeoutSecs + 20) * 1000),
    });
  } catch {
    throw new IgError('Apify ne répond pas pour le moment. Réessayez dans un instant.', 502);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new IgError(res.status === 401 ? 'Clé Apify refusée (APIFY_TOKEN).' : body.error?.message || `Apify a répondu ${res.status}.`, 502);
  }
  return (await res.json()) as Record<string, unknown>[];
}

type RawPost = Record<string, unknown> & { id?: string; productType?: string; type?: string; caption?: string; timestamp?: string; url?: string; shortCode?: string; displayUrl?: string; likesCount?: number; commentsCount?: number; videoPlayCount?: number; videoViewCount?: number; videoDuration?: number; isPinned?: boolean; ownerUsername?: string; error?: unknown };

function normalizePost(p: RawPost): IgPost {
  const type: IgPostType = p.productType === 'clips' ? 'REEL' : p.type === 'Sidecar' ? 'CAROUSEL' : p.type === 'Video' ? 'VIDEO' : 'IMAGE';
  return {
    id: String(p.id), type, caption: p.caption || '', timestamp: String(p.timestamp ?? ''),
    permalink: p.url || (p.shortCode ? `https://www.instagram.com/p/${p.shortCode}/` : null),
    thumb: p.displayUrl || null,
    likes: p.likesCount != null && p.likesCount >= 0 ? p.likesCount : null, // -1 / missing when likes are hidden
    comments: p.commentsCount ?? 0,
    views: p.videoPlayCount ?? p.videoViewCount ?? null,
    duration: p.videoDuration ?? null,
    isPinned: !!p.isPinned,
  };
}

export async function scrapeAccount(username: string): Promise<IgAccount> {
  const [profiles, rawPosts] = await Promise.all([
    runActor('apify~instagram-profile-scraper', { usernames: [username] }),
    runActor('apify~instagram-scraper', { directUrls: [`https://www.instagram.com/${username}/`], resultsType: 'posts', resultsLimit: postsLimit() }),
  ]);
  const found = profiles as (Record<string, unknown> & { username?: string; error?: unknown; private?: boolean })[];
  const p = found.find((x) => x.username?.toLowerCase() === username) || found[0];
  if (!p || p.error || !p.username) throw new IgError('Compte introuvable. Vérifiez l’orthographe.', 404);
  if (p.private) throw new IgError('C’est un compte privé : seuls les comptes publics peuvent être analysés.', 403);
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const n = (v: unknown) => (typeof v === 'number' ? v : 0);
  const profile: IgProfile = {
    username: p.username.toLowerCase(), name: str(p.fullName) || p.username, biography: str(p.biography),
    followers_count: n(p.followersCount), follows_count: n(p.followsCount), media_count: n(p.postsCount),
    profile_picture_url: str(p.profilePicUrlHD) || str(p.profilePicUrl) || null, verified: !!p.verified,
    category: str(p.businessCategoryName) || null, externalUrl: str(p.externalUrl) || null,
  };
  const seen = new Set<string>();
  const posts = (rawPosts as RawPost[])
    .filter((x) => x.id && !x.error && (x.ownerUsername || username).toLowerCase() === username)
    .filter((x) => !seen.has(String(x.id)) && !!seen.add(String(x.id)))
    .map(normalizePost);
  return { profile, posts, fetchedAt: new Date().toISOString() };
}

/** Instagram's own image hosts — the only ones the picture proxy fetches from. */
export const isInstagramImage = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i.test(u.hostname);
  } catch { return false; }
};

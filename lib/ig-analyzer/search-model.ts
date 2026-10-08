// Instagram search, beside the IG Analyzer — the pure part, shared by the server and the page: the
// profile schema, the influencer tiers, the engagement rate over the latest posts, which accounts are
// kept (public, active, above the threshold) and why the others are not, and the CSV export.
// tests/ig-search.mjs. The Apify runs are in lib/ig-analyzer/search.ts.
export type Tier = 'nano' | 'micro' | 'mid' | 'macro' | 'mega';
export type SkipReason = 'not_found' | 'private' | 'low_followers' | 'no_posts';
export type FoundPost = { url: string | null; type: string | null; likes: number | null; comments: number | null; views: number | null; timestamp: string | null; thumb: string | null };
export type FoundProfile = {
  username: string; full_name: string; bio: string; followers: number; following: number; posts_count: number;
  is_verified: boolean; is_business: boolean; business_category: string | null; influencer_tier: Tier;
  category: string | null; location: string | null; external_url: string | null; profile_url: string; profile_pic: string | null;
  post_engagement: FoundPost[]; avg_likes: number | null; avg_comments: number | null; engagement_rate: number | null;
  /** Discovery only: the bio or the name says the city (Instagram's search matches words, not places). */
  says_location?: boolean;
  search_term: string | null;
};
export type Search = {
  id: string; mode: 'discover' | 'profiles'; at: string; location: string | null; category: string | null; terms: string[];
  minFollowers: number; fetched: number; profiles: FoundProfile[]; skipped: Partial<Record<SkipReason, string[]>>; costCapUsd: number;
};

export const searchLimits = { terms: 5, perTerm: 10, usernames: 30, thumbnails: 6, minFollowers: 1000 };
/** Apify bills about $0.0027 per profile; a run is capped a little above that. */
export const usdPerProfile = 0.0027;

export function influencerTier(followers: number): Tier {
  return followers < 1_000 ? 'nano' : followers < 10_000 ? 'micro' : followers < 100_000 ? 'mid' : followers <= 1_000_000 ? 'macro' : 'mega';
}

/** Three searches for a city and a theme, the ways people write them in names and bios. */
export function defaultTerms(location: string, category: string): string[] {
  const l = location.trim(), c = category.trim();
  if (!l || !c) return [l || c].filter(Boolean);
  return [`${c} ${l}`, `${l} ${c}`, `${c}${l}`.toLowerCase().replace(/\s+/g, '')];
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
/** Instagram reports hidden counts as -1 or null. */
const count = (v: unknown) => (typeof v === 'number' && v >= 0 ? v : null);
const text = (v: unknown) => (typeof v === 'string' && v !== 'None' ? v : '');
type Raw = Record<string, unknown>;

export function normalizeProfile(item: Raw, labels: { category?: string | null; location?: string | null; discover?: boolean }): FoundProfile {
  const username = text(item.username).toLowerCase();
  const followers = count(item.followersCount) ?? 0;
  const posts = (Array.isArray(item.latestPosts) ? item.latestPosts : []) as Raw[];
  const post_engagement: FoundPost[] = posts.map((p) => ({
    url: text(p.url) || null, type: text(p.type) || null, likes: count(p.likesCount), comments: count(p.commentsCount),
    views: count(p.videoViewCount) ?? count(p.videoPlayCount), timestamp: text(p.timestamp) || null, thumb: text(p.displayUrl) || null,
  }));
  const likes = post_engagement.map((e) => e.likes).filter((v): v is number => v !== null);
  const comments = post_engagement.map((e) => e.comments).filter((v): v is number => v !== null);
  const avg_likes = likes.length ? Math.round(likes.reduce((a, b) => a + b, 0) / likes.length) : null;
  const avg_comments = comments.length ? Math.round(comments.reduce((a, b) => a + b, 0) / comments.length) : null;
  const engagement_rate = followers && avg_likes !== null ? Math.round(((avg_likes + (avg_comments ?? 0)) / followers) * 10_000) / 100 : null;
  const business_category = text(item.businessCategoryName) || null;
  const bio = text(item.biography), full_name = text(item.fullName);
  const location = labels.location?.trim() || null;
  return {
    username, full_name, bio, followers, following: count(item.followsCount) ?? 0, posts_count: count(item.postsCount) ?? 0,
    is_verified: !!item.verified, is_business: !!item.isBusinessAccount, business_category, influencer_tier: influencerTier(followers),
    category: labels.category?.trim() || business_category, location, external_url: text(item.externalUrl) || null,
    profile_url: text(item.url) || `https://www.instagram.com/${username}/`,
    profile_pic: text(item.profilePicUrlHD) || text(item.profilePicUrl) || null,
    post_engagement, avg_likes, avg_comments, engagement_rate,
    ...(labels.discover && location ? { says_location: fold(`${bio} ${full_name}`).includes(fold(location)) } : {}),
    search_term: text(item.searchTerm) || null,
  };
}

/** Keeps the public, active accounts above the threshold, once each, biggest first; the rest by reason. */
export function sortOut(items: Raw[], options: { minFollowers: number; category?: string | null; location?: string | null; discover?: boolean }) {
  const profiles: FoundProfile[] = [];
  const skipped: Partial<Record<SkipReason, string[]>> = {};
  const seen = new Set<string>();
  for (const item of items) {
    const username = text(item.username).toLowerCase();
    if (username && seen.has(username)) continue;
    if (username) seen.add(username);
    const reason: SkipReason | null = !username || item.error ? 'not_found'
      : item.private ? 'private'
      : (count(item.followersCount) ?? 0) < options.minFollowers ? 'low_followers'
      : !count(item.postsCount) ? 'no_posts' : null;
    if (reason) { (skipped[reason] ??= []).push(username || text(item.inputUrl) || text(item.input) || '?'); continue; }
    profiles.push(normalizeProfile(item, options));
  }
  profiles.sort((a, b) => b.followers - a.followers);
  return { profiles, skipped };
}

/** What the page offers to download: the skill's CSV columns, one row per kept profile. */
export const csvFields = [
  'username', 'full_name', 'bio', 'followers', 'following', 'posts_count', 'is_verified', 'is_business', 'business_category',
  'influencer_tier', 'category', 'location', 'says_location', 'external_url', 'profile_url', 'avg_likes', 'avg_comments', 'engagement_rate',
  'profile_pic', 'content_thumbnails',
] as const;
export function toCsv(profiles: FoundProfile[]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = profiles.map((p) => csvFields.map((f) => cell(f === 'content_thumbnails'
    ? p.post_engagement.slice(0, searchLimits.thumbnails).map((e) => e.thumb).filter(Boolean).join('|')
    : (p as Record<string, unknown>)[f])).join(','));
  return [csvFields.join(','), ...rows].join('\r\n');
}

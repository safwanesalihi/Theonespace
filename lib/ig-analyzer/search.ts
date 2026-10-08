// Instagram search, beside the IG Analyzer: find public profiles by city and theme (influencer
// discovery), or read a list of accounts, through Apify's official actors — apify/instagram-search-
// scraper (searchType user: the full profile and its latest posts in one go) and apify/instagram-
// profile-scraper. Server-only (Apify's key); the scoring is in lib/ig-analyzer/search-model.ts.
import { parseUsername, runActor } from '@/lib/ig-analyzer/scraper';
import { searchLimits, sortOut, type Search } from '@/lib/ig-analyzer/search-model';

const capFor = (profiles: number) => Math.max(0.05, Math.ceil(profiles * 0.004 * 100) / 100);
const text = (v: unknown) => (typeof v === 'string' && v !== 'None' ? v : '');

/** Usernames from pasted text: @names, names, or profile links, one per line or separated by commas. */
export function parseUsernames(input: string): { usernames: string[]; invalid: string[] } {
  const usernames: string[] = [], invalid: string[] = [];
  for (const part of input.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)) {
    let name: string | null = null;
    try { name = parseUsername(part); } catch { name = null; }
    if (!name) invalid.push(part);
    else if (!usernames.includes(name)) usernames.push(name);
  }
  return { usernames, invalid };
}

const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function discover(o: { location: string; category: string; terms: string[]; minFollowers: number }): Promise<Search> {
  const expected = o.terms.length * searchLimits.perTerm;
  const costCapUsd = capFor(expected);
  const items = await runActor('apify~instagram-search-scraper', { search: o.terms.join(', '), searchType: 'user', searchLimit: searchLimits.perTerm }, 240, costCapUsd);
  return {
    id: newId(), mode: 'discover', at: new Date().toISOString(), location: o.location || null, category: o.category || null, terms: o.terms,
    minFollowers: o.minFollowers, fetched: items.length, costCapUsd,
    ...sortOut(items, { minFollowers: o.minFollowers, category: o.category, location: o.location, discover: true }),
  };
}

export async function readProfiles(o: { usernames: string[]; minFollowers: number; category?: string; location?: string }): Promise<Search> {
  const costCapUsd = capFor(o.usernames.length);
  const items = await runActor('apify~instagram-profile-scraper', { usernames: o.usernames }, 240, costCapUsd);
  // Accounts Apify returned nothing for are not found.
  const returned = new Set(items.map((i) => text(i.username).toLowerCase()).filter(Boolean));
  const missing = o.usernames.filter((u) => !returned.has(u)).map((u) => ({ input: u, error: 'not_found' }));
  return {
    id: newId(), mode: 'profiles', at: new Date().toISOString(), location: o.location || null, category: o.category || null, terms: [],
    minFollowers: o.minFollowers, fetched: items.length, costCapUsd,
    ...sortOut([...items, ...missing], { minFollowers: o.minFollowers, category: o.category, location: o.location }),
  };
}


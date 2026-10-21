// Instagram search (lib/ig-analyzer/search.ts), beside the IG Analyzer, for the owner and admins.
// GET: whether Apify is set up, today's budget, and the searches kept (48 h each, like the analyses).
// POST { action: 'discover', location, category, terms?, minFollowers? } finds profiles by city and
// theme; { action: 'profiles', usernames, minFollowers? } reads a pasted list; { action: 'remove', id }.
// Each search is one Apify run, capped in cost, and counted against the workspace's daily budget.
import { planRefusal } from '@/lib/subscription';
import { sameOrigin } from '@/lib/auth-settings';
import { json } from '@/lib/editorial-access';
import { igAccess } from '@/lib/ig-analyzer/access';
import { igSearchRefusal } from '@/lib/integration-notices';
import { apifyConfigured, IgError } from '@/lib/ig-analyzer/scraper';
import { discover, parseUsernames, readProfiles } from '@/lib/ig-analyzer/search';
import { defaultTerms, searchLimits } from '@/lib/ig-analyzer/search-model';
import { listSearches, removeSearch, reserveSearch, saveSearch, searchesPerDay, searchesToday } from '@/lib/ig-analyzer/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const words = (v: unknown, max = 60) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const threshold = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(Math.round(v), 0), 10_000_000) : searchLimits.minFollowers);
const state = async (ws: string) => ({ searches: await listSearches(ws), left: Math.max(0, searchesPerDay - (await searchesToday(ws))), perDay: searchesPerDay });

export async function GET(req: Request) {
  const access = await igAccess(req);
  if ('error' in access) return json({ error: access.error }, access.status);
  return json({ configured: apifyConfigured(), ...(await state(access.workspaceId)) });
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'Origine non autorisée.' }, 403);
  const access = await igAccess(req);
  if ('error' in access) return json({ error: access.error }, access.status);
  const ws = access.workspaceId;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.action === 'remove') {
    if (typeof body.id !== 'string') return json({ error: 'Recherche introuvable.' }, 404);
    await removeSearch(ws, body.id);
    return json(await state(ws));
  }
  if (body.action !== 'discover' && body.action !== 'profiles') return json({ error: 'Action inconnue.' }, 400);
  const refusal = await planRefusal(ws);
  if (refusal) return json(refusal, refusal.status);
  const minFollowers = threshold(body.minFollowers);

  // Everything is checked before Apify is called, so a typo never costs a run.
  let run: () => ReturnType<typeof discover>;
  if (body.action === 'discover') {
    const location = words(body.location), category = words(body.category);
    if (!location && !category) return json({ error: 'Indiquez une ville, un thème, ou les deux.' }, 400);
    const given = Array.isArray(body.terms) ? body.terms.map((t) => words(t)).filter(Boolean) : [];
    const terms = [...new Set(given.length ? given : defaultTerms(location, category))].slice(0, searchLimits.terms);
    run = () => discover({ location, category, terms, minFollowers });
  } else {
    const { usernames, invalid } = parseUsernames(typeof body.usernames === 'string' ? body.usernames.slice(0, 5000) : Array.isArray(body.usernames) ? body.usernames.join('\n').slice(0, 5000) : '');
    if (invalid.length) return json({ error: `Pas un compte Instagram : ${invalid.slice(0, 3).join(', ')}.` }, 400);
    if (!usernames.length) return json({ error: 'Collez des @noms ou des liens de profils Instagram.' }, 400);
    if (usernames.length > searchLimits.usernames) return json({ error: `${searchLimits.usernames} comptes au plus par recherche.` }, 400);
    run = () => readProfiles({ usernames, minFollowers, category: words(body.category), location: words(body.location) });
  }
  if (!apifyConfigured()) return json({ error: igSearchRefusal(ws) }, 503);
  if (!(await reserveSearch(ws))) return json({ error: 'Limite quotidienne de recherches atteinte pour cet espace. Réessayez demain.' }, 429);
  try {
    const search = await run();
    await saveSearch(ws, search);
    return json({ search, ...(await state(ws)) });
  } catch (e) {
    if (!(e instanceof IgError)) console.error('ig search', (e as Error).message);
    return json({ error: e instanceof IgError ? e.message : 'La recherche a échoué. Réessayez.' }, e instanceof IgError ? e.status : 502);
  }
}

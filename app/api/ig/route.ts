// IG Analyzer (lib/ig-analyzer) for the owner and admins. GET reads what the workspace already has:
// ?view=status | accounts | history | account&username=… (the last reading, never a new one).
// POST { action: 'scan', username, refresh? } reads Instagram through Apify (30–90 s), keeps the reading
// and the day's follower count; { action: 'set-me' | 'remove', username } manages the list — the page
// removes an account once its PDF is exported. An analysis older than two days is deleted on the way
// (purgeExpired; the daily sweep does it too), and each account comes with its `expiresAt`.
import { planRefusal } from '@/lib/subscription';
import { sameOrigin } from '@/lib/auth-settings';
import { json } from '@/lib/editorial-access';
import { igAccess } from '@/lib/ig-analyzer/access';
import { apifyConfigured, IgError, parseUsername, postsLimit, scrapeAccount } from '@/lib/ig-analyzer/scraper';
import { histories, purgeExpired, readCached, reserveScan, saveReading, setMe, track, untrack } from '@/lib/ig-analyzer/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** The accounts still kept, with when each one goes. */
const kept = async (ws: string) => (await purgeExpired(ws)).accounts;

// A fresh reading costs Apify credits: an account read in the last 10 minutes is served from the cache.
const freshFor = 10 * 60_000;

export async function GET(req: Request) {
  const access = await igAccess(req);
  if ('error' in access) return json({ error: access.error }, access.status);
  const params = new URL(req.url).searchParams;
  const view = params.get('view');
  if (view === 'status') return json({ configured: apifyConfigured(), postsLimit: postsLimit() });
  if (view === 'accounts') return json({ accounts: await kept(access.workspaceId) });
  if (view === 'history') return json({ history: await histories(access.workspaceId) });
  if (view === 'account') {
    const username = parseSafe(params.get('username'));
    if (!username) return json({ error: 'Nom d’utilisateur invalide.' }, 400);
    const cached = await readCached(access.workspaceId, username);
    return cached ? json(cached) : json({ error: 'Pas encore analysé.' }, 404);
  }
  return json({ error: 'Requête inconnue.' }, 400);
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'Origine non autorisée.' }, 403);
  const access = await igAccess(req);
  if ('error' in access) return json({ error: access.error }, access.status);
  const refusal = await planRefusal(access.workspaceId);
  if (refusal) return json(refusal, refusal.status);
  const body = (await req.json().catch(() => ({}))) as { action?: string; username?: unknown; refresh?: boolean };
  let username: string | null;
  try { username = parseUsername(body.username); } catch (e) { return json({ error: (e as Error).message }, 400); }
  if (!username) return json({ error: 'Collez un nom d’utilisateur Instagram (@nom) ou le lien du profil.' }, 400);
  const ws = access.workspaceId;
  if (body.action === 'set-me') { await setMe(ws, username); return json({ accounts: await kept(ws) }); }
  if (body.action === 'remove') { await untrack(ws, username); return json({ accounts: await kept(ws) }); }
  if (body.action !== 'scan') return json({ error: 'Action inconnue.' }, 400);

  // An expired reading is not served from the cache: it is gone, and read again.
  await purgeExpired(ws);

  const cached = await readCached(ws, username);
  if (cached && (!body.refresh || Date.now() - Date.parse(cached.fetchedAt) < freshFor)) {
    await track(ws, username);
    return json({ account: cached, accounts: await kept(ws), history: await histories(ws), cached: true });
  }
  if (!apifyConfigured()) return json({ error: 'L’analyse Instagram n’est pas encore activée : ajoutez APIFY_TOKEN dans Vercel.' }, 503);
  if (!(await reserveScan(ws))) return json({ error: 'Limite quotidienne d’analyses atteinte pour cet espace. Réessayez demain.' }, 429);
  try {
    const account = await scrapeAccount(username);
    await saveReading(ws, account);
    await track(ws, account.profile.username);
    return json({ account, accounts: await kept(ws), history: await histories(ws) });
  } catch (e) {
    const status = e instanceof IgError ? e.status : 502;
    if (!(e instanceof IgError)) console.error('ig scan', (e as Error).message);
    return json({ error: e instanceof IgError ? e.message : 'L’analyse a échoué. Réessayez.' }, status);
  }
}

function parseSafe(v: string | null) {
  try { return parseUsername(v); } catch { return null; }
}

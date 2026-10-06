// One publish run for one social post: every network it targets that the app posts to itself and
// that isn't done yet. Called by « Publier maintenant » (app/api/editorial/publish) and by the scheduled
// run (app/api/editorial/publish-due). Both go through the same claim, so two clicks — or a click and
// the scheduler at the same minute — can never publish the same post twice.
import { isCompanyWorkspaceId } from '@/lib/workspace';
import { database } from '@/lib/database';
import { env } from '@/lib/env';
import { insertRecord, loadRecords } from '@/lib/flow-server';
import { remainingTargets } from '@/lib/editorial-queue';
import { continueInstagram, publishToFacebook, publishToInstagram, type Outcome, type PostMedia } from '@/lib/meta-publish';
import { getAccount, updateTokens } from '@/lib/social-accounts';
import { refreshGoogle, refreshTiktok } from '@/lib/social-oauth';
import { finishTiktok, startTiktok } from '@/lib/tiktok-publish';
import { publishToYoutube } from '@/lib/youtube-publish';
import { fileUrl } from '@/lib/social-file';
import type { PublishResult, RecordItem } from '@/lib/model';
import { awaitingClient, captionFor, mediaOf, networkLabels, problemsFor, targetsOf, type SocialTarget } from '@/lib/social';

export const publishing = {
  claimMinutes: 10,          // a run that died mid-way stops holding the post after this long
  pendingGiveUpMinutes: 60,  // Instagram still "processing" after this long is reported as a failure
};

export type Account = { accountId: string; token?: string; username?: string } | { error: string };

const connectHint = (network: SocialTarget['network'], internal: boolean) =>
  internal ? `Connectez le compte ${networkLabels[network]} du studio (Social → Comptes → Agence).` : `Connectez le compte ${networkLabels[network]} de ce client (onglet Social → Comptes).`;

/**
 * The account a network posts to: the one connected with « Connecter » (its token refreshed when it
 * is about to expire), else — Facebook and Instagram only — the older setup by ids and a system token.
 */
export async function accountFor(workspaceId: string, target: SocialTarget, post: RecordItem, client: RecordItem | undefined, now: Date): Promise<Account> {
  const clientId = post.clientId || 'internal';
  const connected = await getAccount(workspaceId, clientId, target.network).catch(() => null);
  if (connected) {
    const soon = connected.expiresAt && Date.parse(connected.expiresAt) - now.getTime() < 5 * 60_000;
    if (!soon) return { accountId: connected.externalId, token: connected.token, username: connected.username };
    if (!connected.refreshToken || connected.refreshToken === 'undefined' || (connected.refreshExpiresAt && Date.parse(connected.refreshExpiresAt) < now.getTime())) {
      return { error: `La connexion ${networkLabels[target.network]} de ce client a expiré : reconnectez-la (onglet Social → Comptes).` };
    }
    try {
      const fresh = target.network === 'tiktok' ? await refreshTiktok(connected.refreshToken) : await refreshGoogle(connected.refreshToken);
      await updateTokens(workspaceId, connected, fresh);
      return { accountId: connected.externalId, token: fresh.token, username: connected.username };
    } catch (error) {
      return { error: `${networkLabels[target.network]} refuse de prolonger la connexion (${(error as Error).message}) : reconnectez le compte.` };
    }
  }
  const internal = post.clientId === 'internal';
  // The studio's system token belongs to the studio's own workspaces. A company that signed up
  // (ws:org:*) types its own page ids, so it must never act through that shared credential.
  const systemToken = env.META_PUBLISH_TOKEN && !isCompanyWorkspaceId(workspaceId);
  if (systemToken && target.network === 'facebook') {
    const id = internal ? env.META_STUDIO_FACEBOOK_PAGE_ID : client?.facebookPageId;
    if (id) return { accountId: id };
  }
  if (systemToken && target.network === 'instagram') {
    const id = internal ? env.META_STUDIO_INSTAGRAM_ID : client?.instagramId;
    if (id) return { accountId: id };
  }
  return { error: connectHint(target.network, internal) };
}

export type RunResult =
  | { status: 'done'; post: RecordItem; results: Record<string, PublishResult & { platform: string }> }
  | { status: 'busy' }
  | { status: 'error'; error: string; code: number };

export async function publishPost(
  workspaceId: string,
  postId: string,
  { now = new Date(), waitMs = 20_000, manual = false }: { now?: Date; waitMs?: number; manual?: boolean } = {},
): Promise<RunResult> {
  const db = database();
  const rows = await loadRecords(workspaceId);
  const post = rows.find((r) => r.id === postId && r.kind === 'editorial_post');
  if (!post || post.archived) return { status: 'error', error: 'Post introuvable.', code: 404 };
  if (post.repeat && !post.publishedAt) return { status: 'error', error: 'Publication répétée : elle part d’elle-même chaque jour prévu. Pour publier tout de suite, faites une publication simple.', code: 400 };
  const client = rows.find((r) => r.kind === 'client' && r.id === post.clientId);
  const platforms = rows.filter((r) => r.kind === 'platform');
  const targets = targetsOf(post, platforms);
  if (!targets.length) return { status: 'error', error: 'Choisissez au moins un réseau.', code: 400 };
  if (awaitingClient(post, client)) return { status: 'error', error: 'Cette publication attend la validation du client.', code: 409 };
  // A click publishes what's left right away; the scheduler respects the retry delay after an error.
  const todo = remainingTargets(post, now, { ignoreRetryDelay: manual, platforms });
  if (!todo.length) return { status: 'done', post, results: {} };
  // What isn't publishable as it stands is refused up front, with the reason, before touching Meta.
  const blocked = todo.flatMap((t) => (post.publishResults?.[t.network]?.pending ? [] : problemsFor(post, t).map((p) => `${networkLabels[t.network]} : ${p}`)));
  if (blocked.length) return { status: 'error', error: blocked[0], code: 400 };

  // Claim the post: only the run whose write lands on this exact revision goes on to talk to Meta.
  const nowIso = now.toISOString();
  const heldBySomeoneElse = post.publishingAt && now.getTime() - Date.parse(post.publishingAt) < publishing.claimMinutes * 60_000;
  if (heldBySomeoneElse) return { status: 'busy' };
  const claimed = await db.query(
    `UPDATE records SET data = jsonb_set(data, '{publishingAt}', to_jsonb($1::text)), revision = revision + 1
     WHERE id = $2 AND workspace_id = $3 AND revision = $4 RETURNING id`,
    [nowIso, post.id, workspaceId, post.revision],
  );
  if (!claimed.length) return { status: 'busy' };

  const items = mediaOf(post).map((m) => ({ url: m.url, type: m.type }));
  const results: Record<string, PublishResult & { platform: string }> = {};
  const history: { text: string; date: string }[] = [];

  const origin = (env.AUTH_URL || '').replace(/\/$/, '');
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (const target of todo) {
    const name = networkLabels[target.network];
    const account = await accountFor(workspaceId, target, post, client, now);
    const media: PostMedia = { items, caption: captionFor(post, target), format: target.format };
    const previous = post.publishResults?.[target.network];
    let outcome: Outcome;
    if ('error' in account) outcome = { ok: false, error: account.error };
    else if (target.network === 'facebook') outcome = await publishToFacebook(account.accountId, media, account.token);
    else if (target.network === 'instagram') {
      if (previous?.pending && (previous.containerId || previous.childIds?.length)) {
        outcome = await continueInstagram(account.accountId, previous, media.caption, account.token);
        const stuck = 'pending' in outcome && now.getTime() - Date.parse(previous.at) > publishing.pendingGiveUpMinutes * 60_000;
        if (stuck) outcome = { ok: false, error: 'Instagram traite encore la vidéo après une heure : relancez la publication.' };
      } else {
        outcome = await publishToInstagram(account.accountId, media, waitMs, account.token);
      }
    } else if (target.network === 'tiktok') {
      const token = account.token!;
      if (previous?.pending && previous.containerId) outcome = await finishTiktok(token, previous.containerId, account.username);
      else if (target.format === 'photos' && !origin) outcome = { ok: false, error: 'TikTok Photos : adresse de l’application inconnue (AUTH_URL).' };
      else outcome = await startTiktok(token, target.format, items, media.caption, (url) => fileUrl(origin, url));
      // TikTok takes a moment; a click waits a little for it, the scheduler finishes it next time.
      const deadline = Date.now() + waitMs;
      while ('pending' in outcome && outcome.containerId && Date.now() + 3000 < deadline) {
        await pause(3000);
        outcome = await finishTiktok(token, outcome.containerId, account.username);
      }
      const stuck = 'pending' in outcome && previous?.pending && now.getTime() - Date.parse(previous.at) > publishing.pendingGiveUpMinutes * 60_000;
      if (stuck) outcome = { ok: false, error: 'TikTok traite encore la publication après une heure : vérifiez dans l’application TikTok.' };
    } else {
      const video = items.find((m) => m.type === 'video');
      outcome = video ? await publishToYoutube(account.token!, target.format, video.url, target.title || post.name, media.caption) : { ok: false, error: 'YouTube : une seule vidéo.' };
    }
    const at = 'pending' in outcome && previous?.pending ? previous.at : nowIso;
    const result: PublishResult = 'pending' in outcome
      ? { ok: false, at, pending: true, ...(outcome.containerId ? { containerId: outcome.containerId } : {}), ...(outcome.childIds ? { childIds: outcome.childIds } : {}) }
      : outcome.ok
        ? { ok: true, at: nowIso, externalId: outcome.externalId, ...(outcome.url ? { url: outcome.url } : {}) }
        : { ok: false, at: nowIso, error: outcome.error };
    results[target.network] = { ...result, platform: name };
    if (!result.pending) history.push({ text: result.ok ? `Publié sur ${name}` : `Échec sur ${name} : ${result.error}`, date: nowIso });
  }

  const publishResults: Record<string, PublishResult> = { ...post.publishResults };
  for (const [key, { platform, ...result }] of Object.entries(results)) { void platform; publishResults[key] = result; }
  const allDone = targets.every((t) => publishResults[t.network]?.ok);
  const patch = { publishResults, ...(allDone ? { publishedAt: nowIso } : {}) };
  // Merged onto whatever is stored now, and the claim released in the same write: an edit made in the
  // app while Meta was answering keeps its changes, and the history keeps both.
  await db.query(
    `UPDATE records SET data = jsonb_set((data - 'publishingAt') || $1::jsonb, '{history}', COALESCE(data->'history', '[]'::jsonb) || $2::jsonb),
            revision = revision + 1
     WHERE id = $3 AND workspace_id = $4`,
    [JSON.stringify(patch), JSON.stringify(history), post.id, workspaceId],
  );

  // The studio's activity feed hears about every outcome, pending ones excepted.
  const lines = Object.values(results).filter((r) => !r.pending)
    .map((r) => (r.ok ? `publié sur ${r.platform}` : `échec sur ${r.platform} (${r.error})`));
  if (lines.length) {
    const failed = Object.values(results).some((r) => !r.ok && !r.pending);
    const event = insertRecord({
      id: `evt:${post.id}:publish:${nowIso}`, kind: 'event', revision: 1, type: 'post', audience: 'studio', postId: post.id,
      name: `${failed ? '⚠ ' : ''}« ${post.name} » : ${lines.join(' · ')}.`, clientId: post.clientId, createdAt: nowIso,
    }, 'system', workspaceId, true);
    await db.query(event.text, event.params);
  }
  const fresh = (await loadRecords(workspaceId)).find((r) => r.id === post.id) ?? post;
  return { status: 'done', post: fresh, results };
}

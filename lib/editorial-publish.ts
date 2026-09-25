// One publish run for one editorial post: every platform it targets that isn't done yet.
// Called by the "Publier maintenant" button (app/api/editorial/publish) and by the scheduled run
// (app/api/editorial/publish-due). Both go through the same claim, so two clicks — or a click and the
// scheduler at the same minute — can never publish the same post twice.
import { database } from '@/lib/database';
import { env } from '@/lib/env';
import { insertRecord, loadRecords } from '@/lib/flow-server';
import { remainingPlatforms } from '@/lib/editorial-queue';
import { finishInstagram, metaPublishingConfigured, publishToFacebook, publishToInstagram, type Outcome, type PostMedia } from '@/lib/meta-publish';
import type { PublishResult, RecordItem } from '@/lib/model';

export const publishing = {
  claimMinutes: 10,          // a run that died mid-way stops holding the post after this long
  pendingGiveUpMinutes: 60,  // Instagram still "processing" after this long is reported as a failure
};

type Target = { kind: 'facebook' | 'instagram'; accountId: string } | { error: string };

function targetFor(platformName: string, post: RecordItem, client: RecordItem | undefined): Target {
  const name = platformName.trim().toLowerCase();
  const internal = post.clientId === 'internal';
  if (name === 'facebook') {
    const id = internal ? env.META_STUDIO_FACEBOOK_PAGE_ID : client?.facebookPageId;
    return id ? { kind: 'facebook', accountId: id }
      : { error: internal ? 'Page Facebook du studio non configurée (META_STUDIO_FACEBOOK_PAGE_ID).' : 'Ajoutez l’identifiant de la Page Facebook sur la fiche du client.' };
  }
  if (name === 'instagram') {
    const id = internal ? env.META_STUDIO_INSTAGRAM_ID : client?.instagramId;
    return id ? { kind: 'instagram', accountId: id }
      : { error: internal ? 'Compte Instagram du studio non configuré (META_STUDIO_INSTAGRAM_ID).' : 'Ajoutez l’identifiant du compte Instagram sur la fiche du client.' };
  }
  return { error: `${platformName} : publication automatique non prise en charge (Facebook et Instagram seulement).` };
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
  if (!metaPublishingConfigured()) return { status: 'error', error: 'La publication n’est pas configurée (META_PUBLISH_TOKEN).', code: 503 };
  const db = database();
  const rows = await loadRecords(workspaceId);
  const post = rows.find((r) => r.id === postId && r.kind === 'editorial_post');
  if (!post || post.archived) return { status: 'error', error: 'Post introuvable.', code: 404 };
  if (!post.mediaUrl || !post.mediaType) return { status: 'error', error: 'Ajoutez une photo ou une vidéo avant de publier.', code: 400 };
  if (!post.channels?.length) return { status: 'error', error: 'Choisissez au moins une plateforme.', code: 400 };
  // A click publishes what's left right away; the scheduler respects the retry delay after an error.
  const todo = remainingPlatforms(post, now, { ignoreRetryDelay: manual });
  if (!todo.length) return { status: 'done', post, results: {} };

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

  const client = rows.find((r) => r.kind === 'client' && r.id === post.clientId);
  const platforms = new Map(rows.filter((r) => r.kind === 'platform').map((r) => [r.id, r.name]));
  const media: PostMedia = { url: post.mediaUrl, type: post.mediaType, caption: post.description || '', postType: post.postType || undefined };
  const results: Record<string, PublishResult & { platform: string }> = {};
  const history: { text: string; date: string }[] = [];

  for (const platformId of todo) {
    const platform = platforms.get(platformId) || 'Plateforme supprimée';
    const target = targetFor(platform, post, client);
    let outcome: Outcome;
    if ('error' in target) outcome = { ok: false, error: target.error };
    else if (target.kind === 'facebook') outcome = await publishToFacebook(target.accountId, media);
    else {
      const previous = post.publishResults?.[platformId];
      if (previous?.pending && previous.containerId) {
        outcome = await finishInstagram(target.accountId, previous.containerId);
        const stuck = 'pending' in outcome && now.getTime() - Date.parse(previous.at) > publishing.pendingGiveUpMinutes * 60_000;
        if (stuck) outcome = { ok: false, error: 'Instagram traite encore la vidéo après une heure : relancez la publication.' };
      } else {
        outcome = await publishToInstagram(target.accountId, media, waitMs);
      }
    }
    const at = 'pending' in outcome && post.publishResults?.[platformId]?.pending ? post.publishResults[platformId].at : nowIso;
    const result: PublishResult = 'pending' in outcome
      ? { ok: false, at, pending: true, containerId: outcome.containerId }
      : outcome.ok
        ? { ok: true, at: nowIso, externalId: outcome.externalId, ...(outcome.url ? { url: outcome.url } : {}) }
        : { ok: false, at: nowIso, error: outcome.error };
    results[platformId] = { ...result, platform };
    if (!result.pending) history.push({ text: result.ok ? `Publié sur ${platform}` : `Échec sur ${platform} : ${result.error}`, date: nowIso });
  }

  const publishResults: Record<string, PublishResult> = { ...post.publishResults };
  for (const [id, { platform, ...result }] of Object.entries(results)) { void platform; publishResults[id] = result; }
  const allDone = post.channels.every((id) => publishResults[id]?.ok);
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
      id: `evt:${post.id}:publish:${nowIso}`, kind: 'event', revision: 1, type: 'decision', audience: 'studio',
      name: `${failed ? '⚠ ' : ''}« ${post.name} » : ${lines.join(' · ')}.`, clientId: post.clientId, createdAt: nowIso,
    }, 'system', workspaceId, true);
    await db.query(event.text, event.params);
  }
  const fresh = (await loadRecords(workspaceId)).find((r) => r.id === post.id) ?? post;
  return { status: 'done', post: fresh, results };
}

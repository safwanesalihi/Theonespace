// The posting calendar (editorial posts): a lightweight plan, not tied to the task workflow. Posts can
// repeat, wait for the client's approval, and be marked published by hand on networks the app doesn't
// post to itself.
import { can } from '@/lib/roles';
import { env } from '@/lib/env';
import { insertRecord } from '@/lib/flow-server';
import { isMediaSource } from '@/lib/media-source';
import { removeMedia } from '@/lib/media-storage';
import { safeLink, type RecordItem } from '@/lib/model';
import { mediaOf, networkLabels, targetsOf } from '@/lib/social';
import { nextRepeatDay, normalizeRepeat, repeatsOn } from '@/lib/social-repeat';
import { editorialPostFields } from '@/lib/validation';
import type { ActionStep } from '../context';
import { response } from '../http';
import { updateAtRevision } from '../store';

const socialOnly = () => response({ error: 'Le Social est réservé au propriétaire, aux administrateurs et aux social media managers.' }, 403);

export const saveEditorialPost: ActionStep = {
  actions: ['create', 'update'],
  when: ({ body }) => body.kind === 'editorial_post',
  async run({ body, workspace, rows, db, owner, actor, now, insert, result }) {
    if (!can(workspace, 'social')) return socialOnly();
    const existing = body.action === 'update' ? rows.find((r) => r.id === body.id && r.kind === 'editorial_post') : undefined;
    if (body.action === 'update' && !existing) return response({ error: 'Post introuvable.' }, 404);
    const parsed = editorialPostFields.safeParse(body.data);
    if (!parsed.success) return response({ error: parsed.error.issues[0].message }, 400);
    let client: RecordItem | undefined;
    if (parsed.data.clientId !== 'internal') {
      client = rows.find((r) => r.kind === 'client' && r.id === parsed.data.clientId);
      if (!client || client.archived) return response({ error: 'Sélectionnez un client actif.' }, 400);
    }
    // An optional multi-value tag shouldn't block saving the rest of the post: drop anything
    // that no longer matches a real platform instead of rejecting the whole submission.
    const validPlatformIds = new Set(rows.filter((r) => r.kind === 'platform').map((r) => r.id));
    const channels = (parsed.data.channels || []).filter((id) => validPlatformIds.has(id));
    // Photos and videos: the list when sent, else the single media of a pre-hub post, else unchanged.
    // A storage path is only kept inside this workspace's folder: a post can never point at, and so
    // delete, another workspace's file.
    const { mediaType, mediaPath, mediaUrl, targets, media, socialState, repeat, ...fields } = parsed.data;
    const folder = `${workspace.id.replace(/[^a-zA-Z0-9-]/g, '_')}/`;
    const ownPath = (path?: string) => (path && path.startsWith(folder) ? { path } : {});
    // Storage-hosted files must live in this workspace's folder (same rule as lib/post-media-analysis.ts).
    const storageBase = env.SUPABASE_URL ? `${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${env.SUPABASE_MEDIA_BUCKET || 'editorial-media'}/` : '';
    const mediaList = media
      ? media.map((m) => m.source === 'drive'
        ? { url: m.url, type: m.type, source: 'drive' as const, ...(m.thumb ? { thumb: m.thumb } : {}), ...(m.mime ? { mime: m.mime } : {}), ...(m.name ? { name: m.name } : {}) }
        : { url: m.url, type: m.type, ...ownPath(m.path) })
      : mediaType && mediaUrl ? [{ url: mediaUrl, type: mediaType, ...ownPath(mediaPath) }]
      : existing ? mediaOf(existing) : [];
    // Photos and videos come from the app's storage or Google Drive, nowhere else: the server
    // downloads them to publish, so any other address is refused (lib/media-source.ts).
    if ((media || mediaUrl) && mediaList.some((m) => !isMediaSource(m.url)
      || (storageBase && m.url.startsWith(storageBase) && !m.url.startsWith(`${storageBase}${folder}`))
      || ('thumb' in m && m.thumb && (!isMediaSource(m.thumb) || (storageBase && m.thumb.startsWith(storageBase) && !m.thumb.startsWith(`${storageBase}${folder}`)))))) {
      return response({ error: 'Ajoutez les photos et vidéos depuis l’ordinateur ou avec un lien Google Drive.' }, 400);
    }
    const item: RecordItem = {
      ...existing, ...fields, channels, id: existing?.id || crypto.randomUUID(), kind: 'editorial_post', revision: existing?.revision ?? 1,
      targets: targets ?? existing?.targets ?? [], media: mediaList, socialState: socialState ?? existing?.socialState ?? 'draft',
      author: existing?.author || actor, createdAt: existing?.createdAt || now,
      history: [...(existing?.history || []), { text: existing ? `Modifié par ${actor}` : `Créé par ${actor}`, date: now }].slice(-100),
    };
    delete item.mediaType; delete item.mediaUrl; delete item.mediaPath;
    // Repeating (lib/social-repeat.ts): the rule is tidied, and the date moves to the first day the
    // series goes out. A day's copy of a series doesn't repeat itself.
    if (repeat !== undefined) {
      const rule = item.repeatOf ? undefined : normalizeRepeat(repeat, item.due!);
      if (rule) item.repeat = rule; else delete item.repeat;
    }
    if (item.repeat && !item.publishedAt) {
      const first = nextRepeatDay(item.repeat, item.due!);
      if (!first) return response({ error: 'La date de fin de la répétition est avant la première publication.' }, 400);
      item.due = first;
    }
    delete (item as Record<string, unknown>).aiCaption; // the old n8n AI-caption switch, gone with n8n
    // Client approval: a scheduled post of a client who approves posts waits for them. Any change to
    // what goes out (text, media, networks, date) asks again; a draft needs no answer.
    const content = (p?: RecordItem) => p ? JSON.stringify([p.due, p.time || '', p.description || '', targetsOf(p), mediaOf(p).map((m) => m.url), p.repeat ?? null]) : '';
    let askClient = false;
    if (item.socialState !== 'scheduled' || item.publishedAt) {
      if (item.socialState !== 'scheduled') delete item.approval;
    } else if (client?.postApproval && (!item.approval || content(existing) !== content(item))) {
      item.approval = { state: 'pending', at: now };
      askClient = existing?.approval?.state !== 'pending' || content(existing) !== content(item);
    }
    if (existing) {
      if (body.revision !== existing.revision) return response({ error: 'Ce post a changé. Actualisez avant de réessayer.' }, 409);
      if (!(await updateAtRevision(db, workspace.id, existing.id, body.revision, item))) return response({ error: 'Modification simultanée. Actualisez votre espace.' }, 409);
      // Photos or videos taken off the post leave storage with it.
      const kept = new Set(mediaOf(item).map((m) => m.path).filter(Boolean));
      await removeMedia(mediaOf(existing).map((m) => m.path).filter((p): p is string => !!p && !kept.has(p)));
    } else {
      await insert(item);
    }
    if (askClient && client) {
      const note = insertRecord({
        id: `evt:${item.id}:approval:${now}`, kind: 'event', revision: 1, type: 'post', audience: 'client', postId: item.id, clientId: client.id,
        name: `Nouvelle publication à valider : « ${item.name} »`, createdAt: now,
      }, owner, workspace.id, true);
      await db.query(note.text, note.params);
    }
    return result({ id: item.id });
  },
};

/** One date of a repeating series: skipped, or with its own title and text (lib/social-repeat.ts). */
export const seriesDate: ActionStep = {
  actions: ['series-date'],
  async run({ body, workspace, rows, db, owner, actor, now, result }) {
    if (!can(workspace, 'social')) return socialOnly();
    const series = rows.find((r) => r.kind === 'editorial_post' && r.id === body.id && !r.archived);
    if (!series?.repeat || series.publishedAt) return response({ error: 'Série introuvable.' }, 404);
    const day = typeof body.day === 'string' ? body.day : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < (series.due ?? '') || !repeatsOn(series.repeat, day)) return response({ error: 'Cette date ne fait pas partie de la série.' }, 400);
    if (body.revision !== series.revision) return response({ error: 'Ce post a changé. Actualisez avant de réessayer.' }, 409);
    const raw = body.exception as { skip?: unknown; name?: unknown; description?: unknown } | null | undefined;
    const exceptions = { ...(series.repeatExceptions ?? {}) };
    const label = new Date(`${day}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
    let note: string;
    let newText = false;
    if (!raw) {
      delete exceptions[day];
      note = `Date du ${label} rétablie comme la série`;
    } else if (raw.skip === true) {
      exceptions[day] = { skip: true };
      note = `Date du ${label} sautée`;
    } else {
      const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 160) : undefined;
      const description = typeof raw.description === 'string' ? raw.description.slice(0, 5000) : undefined;
      if (name === '') return response({ error: 'Donnez un titre à cette date.' }, 400);
      const own = { ...(name !== undefined && name !== series.name ? { name } : {}), ...(description !== undefined && description !== (series.description ?? '') ? { description } : {}) };
      if (Object.keys(own).length) { exceptions[day] = own; newText = true; } else delete exceptions[day];
      note = `Date du ${label} modifiée`;
    }
    const updated: RecordItem = { ...series, repeatExceptions: exceptions, history: [...(series.history || []), { text: `${note} par ${actor}`, date: now }].slice(-100) };
    if (!Object.keys(exceptions).length) delete updated.repeatExceptions;
    // A client who approves posts sees the new text of that date before it goes out.
    const client = rows.find((r) => r.kind === 'client' && r.id === series.clientId);
    const askClient = newText && !!client?.postApproval && series.socialState === 'scheduled';
    if (askClient) updated.approval = { state: 'pending', at: now };
    if (!(await updateAtRevision(db, workspace.id, series.id, series.revision, updated))) return response({ error: 'Ce post a changé. Actualisez avant de réessayer.' }, 409);
    if (askClient && client) {
      const event = insertRecord({
        id: `evt:${series.id}:approval:${now}`, kind: 'event', revision: 1, type: 'post', audience: 'client', postId: series.id, clientId: client.id,
        name: `Publication du ${label} modifiée, à valider : « ${series.name} »`, createdAt: now,
      }, owner, workspace.id, true);
      await db.query(event.text, event.params);
    }
    return result({ id: series.id });
  },
};

/** The client's answer on a post (portal), or the studio recording it for them. */
export const postDecision: ActionStep = {
  actions: ['post-approve', 'post-changes'],
  async run({ body, workspace, rows, db, owner, actor, now, result }) {
    const post = rows.find((r) => r.kind === 'editorial_post' && r.id === body.postId && !r.archived);
    const asClient = workspace.role === 'client';
    if (!post || (asClient && post.clientId !== workspace.clientId)) return response({ error: 'Publication introuvable.' }, 404);
    if (!asClient && !can(workspace, 'social')) return response({ error: 'Accès non autorisé.' }, 403);
    if (post.socialState !== 'scheduled' || post.publishedAt || post.approval?.state !== 'pending') {
      return response({ error: 'Cette publication n’attend pas de validation.' }, 409);
    }
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 2000) : '';
    if (body.action === 'post-changes' && !text) return response({ error: 'Dites ce qu’il faut modifier.' }, 400);
    const by = asClient ? actor : `${actor} (pour le client)`;
    const approval = body.action === 'post-approve' ? { state: 'approved' as const, at: now, by } : { state: 'changes' as const, at: now, by, note: text };
    const answered: RecordItem = { ...post, approval, history: [...(post.history || []), { text: body.action === 'post-approve' ? `Validé par ${by}` : `Modifications demandées par ${by} : ${text}`, date: now }].slice(-100) };
    if (!(await updateAtRevision(db, workspace.id, post.id, post.revision, answered))) return response({ error: 'Cette publication a changé. Actualisez avant de réessayer.' }, 409);
    const note = insertRecord({
      id: `evt:${post.id}:${body.action}:${now}`, kind: 'event', revision: 1, type: 'post', audience: 'studio', postId: post.id, clientId: post.clientId,
      name: body.action === 'post-approve' ? `« ${post.name} » validé par ${by}.` : `${by} demande des modifications sur « ${post.name} » : ${text}`,
      createdAt: now,
    }, owner, workspace.id, true);
    await db.query(note.text, note.params);
    return result({ id: post.id });
  },
};

/** A network the app doesn't post to itself (TikTok, YouTube for now): marked done by hand. */
export const postMarkPublished: ActionStep = {
  actions: ['post-mark-published'],
  async run({ body, workspace, rows, db, actor, now, result }) {
    if (!can(workspace, 'social')) return response({ error: 'Accès non autorisé.' }, 403);
    const post = rows.find((r) => r.kind === 'editorial_post' && r.id === body.postId);
    if (!post) return response({ error: 'Publication introuvable.' }, 404);
    // Published some other way (the app, a connection that failed…): recorded by hand, with its link.
    const target = targetsOf(post).find((t) => t.network === body.network);
    if (!target || post.publishResults?.[target.network]?.ok) return response({ error: 'Réseau introuvable sur cette publication.' }, 400);
    const link = typeof body.url === 'string' && safeLink(body.url) ? safeLink(body.url) : '';
    const publishResults = { ...post.publishResults, [target.network]: { ok: true, at: now, manual: true, by: actor, ...(link ? { url: link } : {}) } };
    const allDone = targetsOf(post).every((t) => publishResults[t.network]?.ok);
    const marked: RecordItem = {
      ...post, publishResults, ...(allDone ? { publishedAt: now } : {}),
      history: [...(post.history || []), { text: `Publié sur ${networkLabels[target.network]} (à la main, ${actor})`, date: now }].slice(-100),
    };
    if (!(await updateAtRevision(db, workspace.id, post.id, post.revision, marked))) return response({ error: 'Cette publication a changé. Actualisez avant de réessayer.' }, 409);
    return result({ id: post.id });
  },
};

// The library (shared team resources: prompts, assets, plugins, presets — never the client) and the
// platforms list a post's channels are picked from.
import { canManageEntry, cleanTags, linkKey } from '@/lib/library';
import type { RecordItem } from '@/lib/model';
import { libraryFields, platformFields } from '@/lib/validation';
import { isStudioRole } from '@/lib/workspace';
import type { ActionContext, ActionStep } from '../context';
import { response } from '../http';
import { deleteAtRevision, updateAtRevision } from '../store';

const studioWriter = ({ workspace }: ActionContext) => isStudioRole(workspace.role) && workspace.role !== 'viewer';
const changedMeanwhile = () => response({ error: 'Cet élément a changé. Actualisez avant de réessayer.' }, 409);

export const deleteLibraryItem: ActionStep = {
  actions: ['delete'],
  when: ({ body }) => body.kind === 'library',
  async run(ctx) {
    const { body, workspace, rows, owner, actor, result } = ctx;
    if (!studioWriter(ctx)) return response({ error: 'Votre rôle ne peut pas modifier la bibliothèque.' }, 403);
    const item = rows.find((r) => r.id === body.id && r.kind === 'library');
    if (!item) return response({ error: 'Élément introuvable.' }, 404);
    if (!canManageEntry(item, { userId: owner, name: actor, role: workspace.role })) return response({ error: 'Seuls son auteur, le propriétaire et les administrateurs peuvent supprimer cette ressource.' }, 403);
    if (body.revision !== item.revision) return changedMeanwhile();
    if (!(await deleteAtRevision(ctx.db, ctx.workspace.id, item.id, item.revision))) return changedMeanwhile();
    return result();
  },
};

export const deletePlatform: ActionStep = {
  actions: ['delete'],
  when: ({ body }) => body.kind === 'platform',
  async run(ctx) {
    const { body, rows, result } = ctx;
    if (!studioWriter(ctx)) return response({ error: 'Votre rôle ne peut pas modifier les plateformes.' }, 403);
    const item = rows.find((r) => r.id === body.id && r.kind === 'platform');
    if (!item) return response({ error: 'Plateforme introuvable.' }, 404);
    if (body.revision !== item.revision) return changedMeanwhile();
    if (!(await deleteAtRevision(ctx.db, ctx.workspace.id, item.id, item.revision))) return changedMeanwhile();
    return result();
  },
};

/**
 * A star is personal; « used » counts a copy or an opening (no revision: it never conflicts with an
 * edit). Only studio roles: anyone else falls through to « Action invalide ».
 */
export const libraryInteraction: ActionStep = {
  actions: ['library-favorite', 'library-used'],
  when: ({ workspace }) => isStudioRole(workspace.role),
  async run({ body, workspace, rows, db, owner, result }) {
    // « used » is a plain counter anyone reading the library may bump; a star is a write.
    if (body.action === 'library-favorite' && workspace.role === 'viewer') return response({ error: 'Votre rôle ne peut pas modifier la bibliothèque.' }, 403);
    const item = rows.find((r) => r.id === body.id && r.kind === 'library');
    if (!item) return response({ error: 'Élément introuvable.' }, 404);
    if (body.action === 'library-used') {
      await db.query(
        "UPDATE records SET data = jsonb_set(data, '{copies}', to_jsonb(COALESCE((data->>'copies')::int, 0) + 1)) WHERE id = $1 AND workspace_id = $2 AND kind = 'library'",
        [item.id, workspace.id],
      );
      return response({ ok: true });
    }
    await db.query(
      `UPDATE records SET data = jsonb_set(data, '{favoriteBy}', COALESCE((
           SELECT jsonb_agg(DISTINCT v) FROM jsonb_array_elements_text(COALESCE(data->'favoriteBy', '[]'::jsonb) || CASE WHEN $3 THEN to_jsonb(ARRAY[$4::text]) ELSE '[]'::jsonb END) v
           WHERE $3 OR v <> $4), '[]'::jsonb)) WHERE id = $1 AND workspace_id = $2 AND kind = 'library'`,
      [item.id, workspace.id, body.on === true, owner],
    );
    return result();
  },
};

export const saveLibraryItem: ActionStep = {
  actions: ['create', 'update'],
  when: ({ body }) => body.kind === 'library',
  async run(ctx) {
    const { body, workspace, rows, db, owner, actor, now, insert, result } = ctx;
    if (!studioWriter(ctx)) {
      return response({ error: 'Votre rôle ne peut pas modifier la bibliothèque.' }, 403);
    }
    const existing = body.action === 'update' ? rows.find((r) => r.id === body.id && r.kind === 'library') : undefined;
    if (body.action === 'update' && !existing) return response({ error: 'Élément introuvable.' }, 404);
    if (existing && !canManageEntry(existing, { userId: owner, name: actor, role: workspace.role })) {
      return response({ error: 'Seuls son auteur, le propriétaire et les administrateurs peuvent modifier cette ressource.' }, 403);
    }
    const parsed = libraryFields.safeParse(body.data);
    if (!parsed.success) return response({ error: parsed.error.issues[0].message }, 400);
    const data = { ...parsed.data, tags: cleanTags(parsed.data.tags) };
    // A prompt keeps its text, a link its address: the other one is dropped when the category changes.
    const prompt = data.category === 'prompt';
    // The same link twice is almost always a mistake: said, unless the person confirms.
    const key = !prompt ? linkKey(data.link) : '';
    const twin = key ? rows.find((r) => r.kind === 'library' && r.id !== existing?.id && linkKey(r.link) === key) : undefined;
    if (twin && body.allowDuplicate !== true) return response({ error: `Ce lien existe déjà dans la bibliothèque : « ${twin.name} ».`, code: 'duplicate', id: twin.id }, 409);
    const item: RecordItem = {
      ...existing, ...data,
      content: prompt ? data.content : undefined, link: prompt ? undefined : data.link,
      tool: prompt ? data.tool || undefined : undefined, example: prompt ? data.example || undefined : undefined,
      icon: prompt ? undefined : data.icon || (existing?.link && linkKey(existing.link) === key ? existing.icon : undefined),
      // The library is the studio's, not a client's.
      clientId: undefined, tags: data.tags.length ? data.tags : undefined,
      id: existing?.id || crypto.randomUUID(), kind: 'library', revision: existing?.revision ?? 1,
      author: existing?.author || actor, authorId: existing ? existing.authorId : owner, createdAt: existing?.createdAt || now,
      history: [...(existing?.history || []), { text: existing ? `Modifié par ${actor}` : `Ajouté par ${actor}`, date: now }].slice(-100),
    };
    if (existing) {
      if (body.revision !== existing.revision) return changedMeanwhile();
      if (!(await updateAtRevision(db, workspace.id, existing.id, body.revision, item))) return response({ error: 'Modification simultanée. Actualisez votre espace.' }, 409);
    } else {
      await insert(item);
    }
    return result({ id: item.id });
  },
};

/** Platforms: the editable list a post's "channels" are picked from — shared, any studio writer. */
export const savePlatform: ActionStep = {
  actions: ['create', 'update'],
  when: ({ body }) => body.kind === 'platform',
  async run(ctx) {
    const { body, workspace, rows, db, now, insert, result } = ctx;
    if (!studioWriter(ctx)) {
      return response({ error: 'Votre rôle ne peut pas modifier les plateformes.' }, 403);
    }
    const existing = body.action === 'update' ? rows.find((r) => r.id === body.id && r.kind === 'platform') : undefined;
    if (body.action === 'update' && !existing) return response({ error: 'Plateforme introuvable.' }, 404);
    const parsed = platformFields.safeParse(body.data);
    if (!parsed.success) return response({ error: parsed.error.issues[0].message }, 400);
    // "instagram" and "Instagram" are the same platform: creating a duplicate just returns the one already there.
    const same = rows.find((r) => r.kind === 'platform' && r.id !== existing?.id && r.name.trim().toLowerCase() === parsed.data.name.toLowerCase());
    if (same && !existing) return result({ id: same.id });
    if (same) return response({ error: 'Cette plateforme existe déjà.' }, 409);
    const item: RecordItem = {
      ...existing, ...parsed.data, id: existing?.id || crypto.randomUUID(), kind: 'platform', revision: existing?.revision ?? 1,
      createdAt: existing?.createdAt || now,
    };
    if (existing) {
      if (body.revision !== existing.revision) return changedMeanwhile();
      if (!(await updateAtRevision(db, workspace.id, existing.id, body.revision, item))) return response({ error: 'Modification simultanée. Actualisez votre espace.' }, 409);
    } else {
      await insert(item);
    }
    return result({ id: item.id });
  },
};

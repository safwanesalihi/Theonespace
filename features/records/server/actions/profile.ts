// The person's own profile and notifications, and the e-mail a manager sends a client about pending work.
import type { AppUser } from '@/lib/auth';
import { batch, type Statement } from '@/lib/database';
import { isEventRecipient, isEventUnreadFor } from '@/lib/flow';
import { mailConfigured, sendClientNotice } from '@/lib/mail';
import { isManager } from '@/lib/workspace';
import { behaviourOf } from '@/lib/process';
import type { ActionStep } from '../context';
import { response } from '../http';
import { identitiesOf, payload, visibleTo } from '../payload';

/** Own profile: the display name used in greetings, comments and receipts, and the picture. */
export const updateProfile: ActionStep = {
  actions: ['update-profile'],
  async run({ body, workspace, user, db }) {
    // Name and/or picture. The picture is an uploaded 'avatar' asset id (null removes it); replaced pictures are dropped.
    const wantsName = body.name !== undefined, wantsAvatar = body.avatar !== undefined;
    const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
    if (wantsName && (name.length < 2 || name.length > 80)) return response({ error: 'Indiquez un nom (2 à 80 caractères).' }, 400);
    const avatar = body.avatar === null || body.avatar === '' ? null : typeof body.avatar === 'string' && /^[0-9a-f-]{36}$/.test(body.avatar) ? body.avatar : undefined;
    if (wantsAvatar && avatar === undefined) return response({ error: 'Image introuvable.' }, 400);
    if (!wantsName && !wantsAvatar) return response({ error: 'Requête invalide.' }, 400);
    const current = (await db.query<{ avatar: string | null }>('SELECT avatar FROM users WHERE id = $1', [user.userId]))[0];
    if (wantsAvatar && avatar) {
      const owned = (await db.query<{ id: string }>("SELECT id FROM assets WHERE id = $1 AND kind = 'avatar' AND created_by = $2", [avatar, user.userId]))[0];
      if (!owned) return response({ error: 'Image introuvable.' }, 400);
    }
    await db.transaction(async (tx) => {
      if (wantsName) {
        // The person's tasks follow the new name: by id, or a legacy name/e-mail match nobody else shares.
        await tx.query(
          `UPDATE records r SET data = jsonb_set(jsonb_set(r.data, '{assigneeId}', to_jsonb($1::text)), '{assignee}', to_jsonb($2::text)), revision = revision + 1
             WHERE kind = 'task' AND (data->>'assigneeId' = $1 OR (
               data->>'assigneeId' IS NULL AND lower(trim(data->>'assignee')) = ANY($3::text[])
               AND EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = r.workspace_id AND wm.user_id = $1)
               AND NOT EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = r.workspace_id AND wm.user_id <> $1
                 AND lower(trim(data->>'assignee')) IN (lower(trim(wm.name)), lower(trim(wm.email))))))`,
          [user.userId, name, identitiesOf(user).map((v) => v.trim().toLowerCase()).filter(Boolean)],
        );
        await tx.query('UPDATE users SET name = $2 WHERE id = $1', [user.userId, name]);
        await tx.query('UPDATE workspace_members SET name = $2 WHERE user_id = $1', [user.userId, name]);
      }
      if (wantsAvatar) {
        await tx.query('UPDATE users SET avatar = $2 WHERE id = $1', [user.userId, avatar]);
        if (current?.avatar && current.avatar !== avatar) await tx.query('DELETE FROM assets WHERE id = $1', [current.avatar]);
      }
    });
    const fresh: AppUser = { ...user, fullName: wantsName ? name : user.fullName, displayName: wantsName ? name : user.displayName, avatar: wantsAvatar ? avatar! : current?.avatar ?? null };
    return response({ ...(await payload(workspace, fresh)), user: { id: fresh.userId, name: fresh.fullName || fresh.displayName, email: fresh.email, avatar: fresh.avatar } });
  },
};

export const markRead: ActionStep = {
  actions: ['mark-read'],
  async run({ body, workspace, user, rows, db, result }) {
    const ids = Array.isArray(body.ids) ? body.ids.filter((id: unknown): id is string => typeof id === 'string' && id.startsWith('evt:')).slice(0, 200) : [];
    const events = visibleTo(workspace, rows, user).filter((r) => r.kind === 'event' && (body.all === true
      ? (!r.recipients || isEventRecipient(r, user.userId)) && isEventUnreadFor(r, user.userId)
      : ids.includes(r.id)));
    // Read state is per user for every event (targeted or broadcast): a race-safe append of the user
    // to `readBy`. Broadcast events (no `recipients`) never flip a flag shared by everyone.
    const readable = events.filter((e) => !e.recipients || isEventRecipient(e, user.userId));
    const statements: Statement[] = readable.length ? [{
      text: `UPDATE records SET data = jsonb_set(data, '{readBy}', COALESCE(data->'readBy','[]'::jsonb) || to_jsonb($1::text))
               WHERE id = ANY($2::text[]) AND workspace_id = $3 AND kind = 'event'
                 AND (NOT (data ? 'recipients') OR COALESCE(data->'recipients','[]'::jsonb) ? $1::text)
                 AND NOT (COALESCE(data->'readBy','[]'::jsonb) ? $1::text)`,
      params: [user.userId, readable.map((e) => e.id), workspace.id],
    }] : [];
    if (statements.length) await batch(db, statements);
    return result();
  },
};

export const notifyClient: ActionStep = {
  actions: ['notify-client'],
  async run({ body, workspace, rows, db, signInUrl, result, studioProcess }) {
    if (!isManager(workspace.role)) return response({ error: 'Seuls le propriétaire et les administrateurs peuvent notifier un client.' }, 403);
    const client = rows.find((r) => r.kind === 'client' && r.id === body.clientId && !r.archived);
    if (!client) return response({ error: 'Client introuvable.' }, 404);
    if (!mailConfigured()) return response({ error: 'L’envoi d’e-mail n’est pas configuré.' }, 400);
    const news = typeof body.news === 'string' ? body.news.trim().slice(0, 2000) : '';
    const pendingTasks = rows
      .filter((r) => r.kind === 'task' && r.clientId === client.id && !r.archived && behaviourOf(r.status, studioProcess) === 'client')
      .map((t) => t.name);
    if (!pendingTasks.length && !news) return response({ error: 'Rien à envoyer : ajoutez une actualité ou attendez un élément à valider.' }, 400);
    // Portal contacts actually receive the account; the fiche's own address is only a fallback
    // for a client with no portal login yet.
    const portalEmails = (await db.query<{ email: string | null }>(
      'SELECT email FROM workspace_members WHERE workspace_id = $1 AND role = $2 AND client_id = $3',
      [workspace.id, 'client', client.id],
    )).map((m) => m.email).filter((e): e is string => !!e?.trim());
    const emails = portalEmails.length ? [...new Set(portalEmails)] : (client.email?.trim() ? [client.email.trim()] : []);
    if (!emails.length) return response({ error: 'Aucune adresse e-mail pour ce client.' }, 400);
    const mail = await sendClientNotice({ to: emails, clientName: client.name, studio: workspace.name, url: signInUrl, pendingTasks, news });
    if (!mail.sent) return response({ error: mail.error || 'Envoi impossible.' }, 502);
    return result({ sent: true, emailCount: emails.length });
  },
};

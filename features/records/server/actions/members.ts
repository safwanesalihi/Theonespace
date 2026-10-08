// The team: invitations, renewals, roles, removal, job titles, WhatsApp numbers and print access.
import { sendInvitation, mailConfigured } from '@/lib/mail';
import { storeMemberWhatsapp } from '@/lib/member-whatsapp';
import { isOwnerEmail, provisionAccount } from '@/lib/password-auth';
import { planRefusal } from '@/lib/subscription';
import { inviteFields, whatsappNumber } from '@/lib/validation';
import {
  canManageMembers, cleanTitles, invitableRolesFor, isCompanyWorkspaceId, isManager, isPrintWorkspaceId, isWorkspaceRole, roleLabels, titleLimits,
  type WorkspaceMember, type WorkspaceRole,
} from '@/lib/workspace';
import type { ActionContext, ActionStep } from '../context';
import { response } from '../http';
import { payload } from '../payload';
import { one } from '../store';
import { brandLogoPng, brandOf, ensurePrintWorkspace, members, storeTitles, titlesId, workspaceFor } from '../workspace-access';

/**
 * A client-portal member's profile picture always mirrors their client's logo. The logo's bytes are
 * copied into a fresh 'avatar' asset per member rather than shared, so replacing or clearing the
 * client's logo later (which drops that old asset) never orphans a member's avatar.
 */
export async function syncMemberAvatar({ db, workspace }: ActionContext, userId: string, logoAssetId: string | null | undefined) {
  const current = (await db.query<{ avatar: string | null }>('SELECT avatar FROM users WHERE id = $1', [userId]))[0];
  let avatarId: string | null = null;
  if (logoAssetId) {
    avatarId = crypto.randomUUID();
    const inserted = await db.query(
      `INSERT INTO assets (id, workspace_id, kind, content_type, size, bytes, created_by)
           SELECT $1, workspace_id, 'avatar', content_type, size, bytes, created_by FROM assets WHERE id = $2
           RETURNING id`,
      [avatarId, logoAssetId],
    );
    if (!inserted.length) avatarId = null;
  }
  await db.query('UPDATE users SET avatar = $2 WHERE id = $1', [userId, avatarId]);
  if (current?.avatar) await db.query('DELETE FROM assets WHERE id = $1 AND workspace_id = $2 AND kind = $3', [current.avatar, workspace.id, 'avatar']);
}

/** Mirrors a client's logo onto every client-portal member tied to that client. */
export async function syncClientAvatars(ctx: ActionContext, clientId: string, logoAssetId: string | null | undefined) {
  const linked = await ctx.db.query<{ userId: string }>(
    'SELECT user_id AS "userId" FROM workspace_members WHERE workspace_id = $1 AND role = $2 AND client_id = $3',
    [ctx.workspace.id, 'client', clientId],
  );
  for (const { userId } of linked) await syncMemberAvatar(ctx, userId, logoAssetId);
}

/**
 * E-mails an invitation (or a renewal). The canonical address (AUTH_URL) if set, otherwise whichever
 * origin served this request — returned to the caller too, so the on-screen address and the PDF match
 * what the e-mail says rather than drifting to whatever domain the studio's browser happens to be on.
 */
async function deliver({ workspace, signInUrl }: ActionContext, email: string, name: string, roleLabel: string, temporaryPassword: string, renewal: boolean) {
  const url = signInUrl;
  const brand = await brandOf(workspace);
  const logoPng = await brandLogoPng(brand, workspace.id);
  const mail = await sendInvitation({ to: email, name, temporaryPassword, studio: workspace.name, url, roleLabel, renewal, ...(logoPng || isCompanyWorkspaceId(workspace.id) ? { logoPng } : {}) });
  // The temporary password is returned only when the studio has to pass it on by hand.
  return { email, sent: mail.sent, error: mail.error, temporaryPassword: mail.sent ? undefined : temporaryPassword, url };
}

const teamAnswer = async ({ workspace, user }: ActionContext, extra: Record<string, unknown> = {}) =>
  response({ workspace, members: await members(workspace.id, true, user.userId), ...extra });

export const inviteMember: ActionStep = {
  actions: ['invite-member'],
  async run(ctx) {
    const { body, workspace, rows, db, owner, now } = ctx;
    if (!canManageMembers(workspace.role)) return response({ error: 'Seuls le propriétaire et les administrateurs peuvent inviter.' }, 403);
    const parsed = inviteFields.safeParse(body);
    if (!parsed.success) return response({ error: parsed.error.issues[0].message }, 400);
    const { email, role, name } = parsed.data;
    if (isOwnerEmail(email)) return response({ error: 'Cette adresse est celle du propriétaire.' }, 400);
    if (!invitableRolesFor(workspace.id).includes(role)) return response({ error: 'Ce rôle n’est pas proposé dans cet espace.' }, 400);
    // Trades can be picked right in the invitation; a client access never carries any.
    const inviteTitles = role === 'client' ? [] : cleanTitles(body.titles ?? []);
    if (!inviteTitles) return response({ error: `Jusqu’à ${titleLimits.count} métiers de ${titleLimits.length} caractères au plus.` }, 400);
    let clientId: string | null = null;
    let clientLogo: string | undefined;
    if (role === 'client') {
      const client = rows.find((r) => r.kind === 'client' && r.id === parsed.data.clientId && !r.archived);
      if (!client) return response({ error: 'Choisissez un client actif pour cet accès portail.' }, 400);
      clientId = client.id;
      clientLogo = client.logo;
    }
    const duplicate = await one<{ userId: string }>(
      'SELECT user_id AS "userId" FROM workspace_members WHERE workspace_id = $1 AND lower(email) = $2', [workspace.id, email],
    );
    if (duplicate) return response({ error: 'Cette adresse est déjà membre de l’espace. Utilisez « Renvoyer l’invitation » pour un nouveau mot de passe temporaire.' }, 409);
    if (role !== 'client') {
      const full = await planRefusal(workspace.id, 'members');
      if (full) return response(full, full.status);
    }
    const attachMembership = (userId: string) => db.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, name, email, client_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role, client_id = EXCLUDED.client_id, name = COALESCE(EXCLUDED.name, workspace_members.name)`,
      [workspace.id, userId, role, name || null, email, clientId, now],
    );
    // Someone who already has an account (e.g. via another workspace, like a designer gaining
    // print-operator access too) just gets attached here — provisioning a fresh temporary password
    // would silently reset the one they already use and sign them out everywhere, which is exactly
    // wrong for a person who already knows how to log in.
    const existingAccount = await one<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
    if (existingAccount) {
      await attachMembership(existingAccount.id);
      if (inviteTitles.length) await storeTitles(workspace.id, existingAccount.id, inviteTitles, owner);
      if (role !== 'client' && parsed.data.whatsapp) await storeMemberWhatsapp(workspace.id, existingAccount.id, parsed.data.whatsapp, owner);
      if (role === 'client' && clientLogo) await syncMemberAvatar(ctx, existingAccount.id, clientLogo);
      return teamAnswer(ctx, { invitation: { email, sent: false, url: ctx.signInUrl } });
    }
    const account = await provisionAccount(db, email, name ?? '');
    await attachMembership(account.userId);
    if (inviteTitles.length) await storeTitles(workspace.id, account.userId, inviteTitles, owner);
    if (role !== 'client' && parsed.data.whatsapp) await storeMemberWhatsapp(workspace.id, account.userId, parsed.data.whatsapp, owner);
    if (role === 'client' && clientLogo) await syncMemberAvatar(ctx, account.userId, clientLogo);
    const invitation = await deliver(ctx, email, name ?? '', roleLabels[role], account.temporaryPassword, false);
    return teamAnswer(ctx, { invitation });
  },
};

export const createPrintWorkspace: ActionStep = {
  actions: ['create-print-workspace'],
  async run({ user, owner }) {
    if (!isOwnerEmail(user.email)) return response({ error: 'Seul le propriétaire peut créer l’espace Impression.' }, 403);
    const printWorkspace = await ensurePrintWorkspace(owner, 'The One Print');
    // Full payload scoped to the new workspace (not the current request's context) — same shape
    // `result()` returns, so the client can drop straight into it, already switched.
    return response(await payload(printWorkspace, user));
  },
};

export const renewInvitation: ActionStep = {
  actions: ['renew-invitation'],
  async run(ctx) {
    const { body, workspace, user, db } = ctx;
    if (!canManageMembers(workspace.role)) return response({ error: 'Seuls le propriétaire et les administrateurs peuvent renvoyer une invitation.' }, 403);
    const target = await one<WorkspaceMember>('SELECT user_id AS "userId", role, name, email FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspace.id, body.userId]);
    if (!target || !target.email) return response({ error: 'Membre introuvable.' }, 404);
    if (target.role === 'owner' || target.userId === user.userId) return response({ error: 'Le propriétaire change son mot de passe depuis son compte.' }, 400);
    // Renewing resets the person's password. An administrator can't do that to another
    // administrator, and never sees the temporary password: only the owner may be handed one to
    // pass on — otherwise the administrator could sign in as someone else.
    // Accounts are global: never reset the credential of someone who also belongs to another
    // workspace (the studio and its print twin excepted) — a manager here has no authority over them.
    const base = workspace.id.replace(/:print$/, '');
    const elsewhere = await one<{ workspaceId: string }>(
      'SELECT workspace_id AS "workspaceId" FROM workspace_members WHERE user_id = $1 AND workspace_id NOT IN ($2, $3) LIMIT 1',
      [target.userId, base, `${base}:print`],
    );
    if (elsewhere) return response({ error: 'Cette personne a un compte dans un autre espace : elle doit utiliser « Mot de passe oublié ».' }, 403);
    const byOwner = workspace.role === 'owner';
    if (!byOwner && target.role === 'admin') return response({ error: 'Seul le propriétaire peut renouveler l’accès d’un administrateur.' }, 403);
    if (!byOwner && !mailConfigured()) return response({ error: 'L’e-mail n’est pas configuré : seul le propriétaire peut renouveler un accès et transmettre le mot de passe temporaire.' }, 403);
    const account = await provisionAccount(db, target.email.toLowerCase(), target.name ?? '');
    const delivered = await deliver(ctx, target.email.toLowerCase(), target.name ?? '', roleLabels[target.role], account.temporaryPassword, true);
    const invitation = byOwner || delivered.sent ? delivered
      : { ...delivered, temporaryPassword: undefined, error: `${delivered.error ?? 'E-mail non envoyé.'} Demandez au propriétaire de renouveler l’accès.` };
    return teamAnswer(ctx, { invitation });
  },
};

export const setMemberWhatsapp: ActionStep = {
  actions: ['set-member-whatsapp'],
  async run({ body, workspace, user, owner, result }) {
    if (!canManageMembers(workspace.role) && (body.userId !== user.userId || workspace.role === 'client')) return response({ error: 'Seuls les responsables peuvent modifier le numéro d’un autre membre.' }, 403);
    if (typeof body.userId !== 'string' || !body.userId || body.userId.length > 200) return response({ error: 'Identifiant de membre invalide.' }, 400);
    const number = whatsappNumber.safeParse(body.whatsapp);
    if (!number.success) return response({ error: number.error.issues[0].message }, 400);
    const target = await one<{ role: string }>('SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspace.id, body.userId]);
    if (!target) return response({ error: 'Membre introuvable.' }, 404);
    if (target.role === 'client') return response({ error: 'Le numéro WhatsApp du client se modifie depuis sa fiche client.' }, 400);
    await storeMemberWhatsapp(workspace.id, body.userId, number.data, owner);
    return result();
  },
};

export const setMemberTitles: ActionStep = {
  actions: ['set-member-titles'],
  async run(ctx) {
    const { body, workspace, owner } = ctx;
    if (!canManageMembers(workspace.role)) {
      return response({ error: 'Seuls le propriétaire et les administrateurs peuvent attribuer les métiers.' }, 403);
    }
    if (typeof body.userId !== 'string' || !body.userId || body.userId.length > 200) return response({ error: 'Identifiant de membre invalide.' }, 400);
    const titles = cleanTitles(body.titles);
    if (!titles) return response({ error: `Jusqu’à ${titleLimits.count} métiers de ${titleLimits.length} caractères au plus.` }, 400);
    const target = await one<Pick<WorkspaceMember, 'role'>>(
      'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspace.id, body.userId],
    );
    if (!target) return response({ error: 'Membre introuvable.' }, 404);
    if (target.role === 'client') return response({ error: 'Un accès client n’a pas de métier.' }, 400);
    await storeTitles(workspace.id, body.userId, titles, owner);
    return teamAnswer(ctx);
  },
};

/**
 * « Accès Impression »: a person already in the studio gets a role in the print workspace (or loses
 * it) without a new invitation — same account, same password, one more workspace in their switcher.
 */
export const setPrintAccess: ActionStep = {
  actions: ['set-print-access'],
  async run(ctx) {
    const { body, workspace, user, db, owner, now } = ctx;
    if (isPrintWorkspaceId(workspace.id) || !canManageMembers(workspace.role)) {
      return response({ error: 'Seuls le propriétaire et les administrateurs peuvent gérer les accès.' }, 403);
    }
    if (typeof body.userId !== 'string' || !body.userId || body.userId.length > 200) return response({ error: 'Identifiant de membre invalide.' }, 400);
    const printRole = body.role === null ? null : body.role === 'print_operator' || body.role === 'admin' ? body.role as WorkspaceRole : undefined;
    if (printRole === undefined) return response({ error: 'Rôle invalide.' }, 400);
    const printId = `${workspace.id}:print`;
    if (!(await one('SELECT 1 FROM workspaces WHERE id = $1', [printId]))) return response({ error: 'L’espace Impression n’existe pas encore.' }, 404);
    const actorPrint = await one<{ role: string }>('SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [printId, user.userId]);
    if (!actorPrint || !isWorkspaceRole(actorPrint.role) || !isManager(actorPrint.role)) {
      return response({ error: 'Seuls les responsables de l’espace Impression donnent cet accès.' }, 403);
    }
    const target = await one<{ role: string; name: string | null; email: string | null }>(
      'SELECT role, name, email FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspace.id, body.userId],
    );
    if (!target) return response({ error: 'Membre introuvable.' }, 404);
    if (target.role === 'client') return response({ error: 'Un accès client ne peut pas recevoir l’accès Impression.' }, 400);
    if (target.role === 'owner' || body.userId === user.userId) return response({ error: 'Vous ne pouvez pas modifier cet accès.' }, 400);
    const current = await one<{ role: string }>('SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [printId, body.userId]);
    if (current?.role === 'owner') return response({ error: 'Le propriétaire ne peut pas être modifié ou retiré.' }, 400);
    if (printRole) {
      await db.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, name, email, client_id, created_at) VALUES ($1, $2, $3, $4, $5, NULL, $6)
           ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role, client_id = NULL`,
        [printId, body.userId, printRole, target.name, target.email, now],
      );
    } else {
      await db.query('DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND role != $3', [printId, body.userId, 'owner']);
      await db.query("DELETE FROM records WHERE id = $1 AND workspace_id = $2 AND kind = 'meta'", [titlesId(printId, body.userId), printId]);
      await storeMemberWhatsapp(printId, body.userId, '', owner);
    }
    return teamAnswer(ctx);
  },
};

/** A member's role changes, or they leave the workspace. */
export const changeMember: ActionStep = {
  actions: ['set-member-role', 'remove-member'],
  async run(ctx) {
    const { body, workspace, user, rows, db, owner } = ctx;
    if (!canManageMembers(workspace.role)) {
      return response({ error: 'Seuls le propriétaire et les administrateurs peuvent gérer les membres.' }, 403);
    }
    if (typeof body.userId !== 'string' || !body.userId || body.userId !== body.userId.trim() || body.userId.length > 200) {
      return response({ error: 'Identifiant de membre invalide.' }, 400);
    }
    if (body.action === 'set-member-role' && (!isWorkspaceRole(body.role) || body.role === 'owner')) {
      return response({ error: 'Rôle invalide.' }, 400);
    }
    if (body.action === 'set-member-role' && !invitableRolesFor(workspace.id).includes(body.role) && body.role !== 'viewer') {
      return response({ error: 'Ce rôle n’est pas proposé dans cet espace.' }, 400);
    }
    if (!isWorkspaceRole(body.expectedRole)) return response({ error: 'Actualisez la liste des membres avant de réessayer.' }, 400);
    let clientId: string | null = null;
    let clientLogo: string | undefined;
    if (body.action === 'set-member-role' && body.role === 'client') {
      const client = rows.find((r) => r.kind === 'client' && r.id === body.clientId && !r.archived);
      if (!client) return response({ error: 'Choisissez un client actif pour cet accès portail.' }, 400);
      clientId = client.id;
      clientLogo = client.logo;
    }
    const existing = await one<Pick<WorkspaceMember, 'role'>>(
      'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspace.id, body.userId],
    );
    if (!existing) return response({ error: 'Membre introuvable.' }, 404);
    if (existing.role === 'owner') return response({ error: 'Le propriétaire ne peut pas être modifié ou retiré.' }, 400);
    if (body.userId === user.userId) return response({ error: 'Vous ne pouvez pas modifier votre propre accès.' }, 400);
    // An administrator can't change or remove another administrator: only the owner may.
    if (workspace.role !== 'owner' && existing.role === 'admin') return response({ error: 'Seul le propriétaire peut modifier ou retirer un administrateur.' }, 403);
    if (body.action === 'set-member-role' && existing.role === 'client' && body.role !== 'client') {
      const full = await planRefusal(workspace.id, 'members');
      if (full) return response(full, full.status);
    }
    // Check both the target's current role and the actor's authority in the write itself.
    const condition = `workspace_id = $1 AND user_id = $2 AND role = $3 AND role != 'owner'
        AND EXISTS (SELECT 1 FROM workspace_members actor
                    WHERE actor.workspace_id = $1 AND actor.user_id = $4 AND actor.role IN ('owner','admin'))`;
    const values = [workspace.id, body.userId, body.expectedRole, user.userId];
    const changed = body.action === 'set-member-role'
      ? await db.query(`UPDATE workspace_members SET role = $5, client_id = $6 WHERE ${condition} RETURNING user_id`, [...values, body.role, clientId])
      : await db.query(`DELETE FROM workspace_members WHERE ${condition} RETURNING user_id`, values);
    if (!changed.length) return response({ error: 'Les accès ont changé. Actualisez la liste avant de réessayer.' }, 409);
    // Job titles belong to studio members: they go with the person, and with a switch to a client access.
    if (body.action === 'remove-member' || body.role === 'client') {
      await db.query("DELETE FROM records WHERE id = $1 AND workspace_id = $2 AND kind = 'meta'", [titlesId(workspace.id, body.userId), workspace.id]);
      await storeMemberWhatsapp(workspace.id, body.userId, '', owner);
    }
    if (body.action === 'set-member-role' && body.role === 'client' && clientLogo) await syncMemberAvatar(ctx, body.userId, clientLogo);
    // A client access never works in the print workspace: one given from here goes with the switch.
    // Removing someone from the studio also removes them from its print twin.
    if ((body.action === 'remove-member' || (body.action === 'set-member-role' && body.role === 'client')) && !isPrintWorkspaceId(workspace.id)) {
      await db.query("DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND role != 'owner'", [`${workspace.id}:print`, body.userId]);
    }
    const refreshedWorkspace = await workspaceFor(user, workspace.id);
    return response({ workspace: refreshedWorkspace, members: await members(workspace.id, true, user.userId) });
  },
};

// The team: invitations, renewals, roles, removal, job titles and WhatsApp numbers.
import { sendInvitation, mailConfigured } from '@/lib/mail';
import { storeMemberWhatsapp } from '@/lib/member-whatsapp';
import { isOwnerEmail, provisionAccount } from '@/lib/password-auth';
import { planRefusal } from '@/lib/subscription';
import { can, permissionsOf, studioRoleOf } from '@/lib/roles';
import { inviteFields, whatsappNumber } from '@/lib/validation';
import {
  cleanTitles, invitableRoles, isCompanyWorkspaceId, isManager, isWorkspaceRole, roleLabels, titleLimits,
  type WorkspaceMember, type WorkspaceRole,
} from '@/lib/workspace';
import type { ActionContext, ActionStep } from '../context';
import { response } from '../http';
import { payload } from '../payload';
import { one, upsertMeta } from '../store';
import { brandLogoPng, brandOf, memberRoleId, members, storeTitles, titlesId, workspaceFor } from '../workspace-access';

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
  response({ workspace, members: await members(workspace.id, true), ...extra });

export const inviteMember: ActionStep = {
  actions: ['invite-member'],
  async run(ctx) {
    const { body, workspace, rows, db, owner, now } = ctx;
    if (!can(workspace, 'team')) return response({ error: 'Seuls le propriétaire et les administrateurs peuvent inviter.' }, 403);
    const parsed = inviteFields.safeParse(body);
    if (!parsed.success) return response({ error: parsed.error.issues[0].message }, 400);
    const { email, role, name } = parsed.data;
    if (isOwnerEmail(email)) return response({ error: 'Cette adresse est celle du propriétaire.' }, 400);
    if (!invitableRoles.includes(role)) return response({ error: 'Ce rôle n’est pas proposé dans cet espace.' }, 400);
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
    // Someone who already has an account (e.g. via another workspace) just gets attached here — provisioning a fresh temporary password
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

export const renewInvitation: ActionStep = {
  actions: ['renew-invitation'],
  async run(ctx) {
    const { body, workspace, user, db } = ctx;
    if (!can(workspace, 'team')) return response({ error: 'Seuls le propriétaire et les administrateurs peuvent renvoyer une invitation.' }, 403);
    const target = await one<WorkspaceMember>('SELECT user_id AS "userId", role, name, email FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspace.id, body.userId]);
    if (!target || !target.email) return response({ error: 'Membre introuvable.' }, 404);
    if (target.role === 'owner' || target.userId === user.userId) return response({ error: 'Le propriétaire change son mot de passe depuis son compte.' }, 400);
    // Renewing resets the person's password. An administrator can't do that to another
    // administrator, and never sees the temporary password: only the owner may be handed one to
    // pass on — otherwise the administrator could sign in as someone else.
    // Accounts are global: never reset the credential of someone who also belongs to another
    // workspace — a manager here has no authority over them. A membership left in the studio's
    // retired print twin (« …:print ») is still the studio's own and does not count.
    const base = workspace.id;
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
    if (!can(workspace, 'team') && (body.userId !== user.userId || workspace.role === 'client')) return response({ error: 'Seuls les responsables peuvent modifier le numéro d’un autre membre.' }, 403);
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
    if (!can(workspace, 'team')) {
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
 * Gives a member one of the studio's own roles (lib/roles.ts), or takes it back (`roleId` null). The
 * role must start from the member's built-in role: a creative takes a creative-based role, never one
 * built on Administrator. Only those who manage the team decide, and never for the owner or a client.
 */
export const setMemberStudioRole: ActionStep = {
  actions: ['set-member-studio-role'],
  async run(ctx) {
    const { body, workspace, owner, studioProcess } = ctx;
    if (!can(workspace, 'team')) return response({ error: 'Seuls le propriétaire et les administrateurs attribuent les rôles.' }, 403);
    if (typeof body.userId !== 'string' || !body.userId || body.userId.length > 200) return response({ error: 'Identifiant de membre invalide.' }, 400);
    const target = await one<Pick<WorkspaceMember, 'role'>>('SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspace.id, body.userId]);
    if (!target) return response({ error: 'Membre introuvable.' }, 404);
    if (target.role === 'owner' || target.role === 'client') return response({ error: 'Le propriétaire et les accès client n’ont pas de rôle de studio.' }, 400);
    const id = memberRoleId(workspace.id, body.userId);
    if (body.roleId === null || body.roleId === '') {
      await ctx.db.query("DELETE FROM records WHERE id = $1 AND workspace_id = $2 AND kind = 'meta'", [id, workspace.id]);
      return teamAnswer(ctx);
    }
    const role = studioRoleOf(studioProcess.roles, typeof body.roleId === 'string' ? body.roleId : null);
    if (!role) return response({ error: 'Rôle inconnu dans ce studio.' }, 400);
    if (role.base !== target.role) return response({ error: `« ${role.label} » part du rôle « ${roleLabels[role.base]} » : changez d’abord l’accès de ce membre.` }, 400);
    // An administrator can't hand out a role that reaches further than their own permissions.
    if (workspace.role !== 'owner' && [...permissionsOf(role.base, role)].some((p) => !can(workspace, p))) {
      return response({ error: 'Ce rôle donne des droits que vous n’avez pas.' }, 403);
    }
    await upsertMeta(ctx.db, id, owner, workspace.id, { userId: body.userId, roleId: role.id });
    return teamAnswer(ctx);
  },
};

/** A member's role changes, or they leave the workspace. */
export const changeMember: ActionStep = {
  actions: ['set-member-role', 'remove-member'],
  async run(ctx) {
    const { body, workspace, user, rows, db, owner } = ctx;
    if (!can(workspace, 'team')) {
      return response({ error: 'Seuls le propriétaire et les administrateurs peuvent gérer les membres.' }, 403);
    }
    if (typeof body.userId !== 'string' || !body.userId || body.userId !== body.userId.trim() || body.userId.length > 200) {
      return response({ error: 'Identifiant de membre invalide.' }, 400);
    }
    if (body.action === 'set-member-role' && (!isWorkspaceRole(body.role) || body.role === 'owner')) {
      return response({ error: 'Rôle invalide.' }, 400);
    }
    if (body.action === 'set-member-role' && !invitableRoles.includes(body.role) && body.role !== 'viewer') {
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
    const refreshedWorkspace = await workspaceFor(user, workspace.id);
    return response({ workspace: refreshedWorkspace, members: await members(workspace.id, true) });
  },
};

// A studio's own roles (« Account manager », « Media buyer », « Freelance »…) on top of the six built-in
// ones. A built-in role stays the security base: it decides what a person reads (a client only their
// portal, a creative their own tasks, everyone else the studio). A studio role starts from a base and
// adds or removes permissions, the decisions the app checks before acting. Pure: shared by the browser
// and the server. Stored in the studio's process (lib/process.ts `roles`); who holds which studio role
// is a `member-role:<workspace>:<user>` meta row (features/records/server/workspace-access.ts).
import { z } from 'zod';
import type { WorkspaceRole } from '@/lib/workspace';

export const permissions = ['tasks.create', 'tasks.all', 'review', 'send', 'social', 'meetings', 'clients', 'team', 'money'] as const;
export type Permission = (typeof permissions)[number];
/** What each permission lets a person do, as the owner reads it when building a role. */
export const permissionLabels: Record<Permission, string> = {
  'tasks.create': 'Créer des tâches',
  'tasks.all': 'Voir toutes les tâches',
  review: 'Valider en interne',
  send: 'Envoyer au client',
  social: 'Publier sur les réseaux',
  meetings: 'Planifier des réunions',
  clients: 'Gérer les fiches clients',
  team: 'Gérer l’équipe',
  money: 'Voir devis, factures et contrats',
};

/** The built-in roles a studio role may start from (never the owner, never a client). */
export const roleBases = ['admin', 'creative', 'social', 'viewer'] as const;
export type RoleBase = (typeof roleBases)[number];

/** What each built-in role may do, exactly as the app has always allowed it. */
export const basePermissions: Record<WorkspaceRole, readonly Permission[]> = {
  owner: permissions,
  admin: ['tasks.create', 'tasks.all', 'review', 'send', 'social', 'meetings', 'clients', 'team'],
  social: ['social', 'meetings'],
  creative: [],
  viewer: ['tasks.all'],
  client: [],
};
/** Permissions only a role based on « Administrateur » may hold: they reach people and money. */
export const adminOnly: readonly Permission[] = ['team', 'money'];

export type StudioRole = { id: string; label: string; base: RoleBase; grant?: Permission[]; revoke?: Permission[] };

export const studioRoleSchema = z.object({
  id: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1, 'Donnez un nom à chaque rôle.').max(40, 'Nom de rôle trop long (40 caractères au plus).'),
  base: z.enum(roleBases),
  grant: z.array(z.enum(permissions)).max(permissions.length).optional(),
  revoke: z.array(z.enum(permissions)).max(permissions.length).optional(),
}).strict();

/** The rules a studio's roles keep: unique names and ids, team and money for administrator-based roles only. */
export function checkRoles(roles: StudioRole[], issue: (message: string) => void) {
  const ids = new Set<string>(), names = new Set<string>();
  for (const r of roles) {
    if (ids.has(r.id)) issue('Deux rôles portent le même identifiant.');
    ids.add(r.id);
    const name = r.label.trim().toLowerCase();
    if (names.has(name)) issue('Deux rôles portent le même nom.');
    names.add(name);
    if (r.base !== 'admin' && r.grant?.some((p) => adminOnly.includes(p))) issue(`« ${r.label} » : gérer l’équipe et voir l’argent sont réservés aux rôles basés sur Administrateur.`);
    if (r.base === 'viewer' && r.grant?.length) issue(`« ${r.label} » est en lecture seule : il ne peut rien recevoir de plus.`);
  }
}

/**
 * What a person may do: their built-in role's permissions, changed by their studio role when they hold
 * one whose base is that built-in role (a stale assignment after a role change counts for nothing).
 * The owner and clients never take a studio role.
 */
export function permissionsOf(role: WorkspaceRole, studioRole?: StudioRole | null): Set<Permission> {
  const own = new Set<Permission>(basePermissions[role]);
  if (!studioRole || role === 'owner' || role === 'client' || studioRole.base !== role) return own;
  for (const p of studioRole.grant ?? []) if (role === 'admin' || !adminOnly.includes(p)) own.add(p);
  for (const p of studioRole.revoke ?? []) own.delete(p);
  return own;
}

/** The studio role a member holds, if it still exists. */
export const studioRoleOf = (roles: StudioRole[] | undefined, id: string | null | undefined) =>
  (id && roles?.find((r) => r.id === id)) || null;

/** A fresh id for a role the owner adds. */
export const newRoleId = () => `role-${crypto.randomUUID().slice(0, 8)}`;

/**
 * Whether this person may do this: the permissions resolved for their membership
 * (features/records/server/workspace-access.ts), else their built-in role's.
 */
export const can = (who: { role: WorkspaceRole; permissions?: readonly Permission[] }, permission: Permission) =>
  (who.permissions ?? basePermissions[who.role]).includes(permission);

/**
 * Whether this person passes this internal check: someone allowed to review, and — when the check names
 * its reviewers (« Check DA » for art directors) — holding one of those studio roles. The owner always may.
 */
export const passesCheck = (who: { role: WorkspaceRole; permissions?: readonly Permission[]; studioRoleId?: string | null }, reviewers?: string[]) =>
  who.role === 'owner' || (can(who, 'review') && (!reviewers?.length || (!!who.studioRoleId && reviewers.includes(who.studioRoleId))));

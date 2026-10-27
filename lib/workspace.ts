import type { Permission } from '@/lib/roles';

export const workspaceRoles = ['owner', 'admin', 'creative', 'social', 'viewer', 'client'] as const;
export type WorkspaceRole = (typeof workspaceRoles)[number];
export type EditableRole = Exclude<WorkspaceRole, 'owner'>;
/**
 * One person in one workspace. `studioRoleId` and `permissions` (lib/roles.ts) are resolved with the
 * membership: what this person may do, their built-in role changed by the studio role they hold.
 */
export type WorkspaceContext = { id: string; name: string; role: WorkspaceRole; clientId?: string | null; studioRoleId?: string | null; permissions?: Permission[] };
export type WorkspaceSummary = { id: string; name: string; role: WorkspaceRole };
export type WorkspaceMember = {
  whatsapp?: string | null; // workspace contact: managers and the member themselves only
  studioRoleId?: string | null; // the studio role they hold (lib/roles.ts), if any
  userId: string;
  role: WorkspaceRole;
  name: string | null;
  email: string | null;
  avatar?: string | null;         // profile picture asset id
  clientId?: string | null;
  pending?: boolean | null;       // managers only: invited, never signed in yet
  lastLoginAt?: string | null;    // managers only
  titles?: string[];              // what the person does (Designer, Monteur…); several allowed, studio members only
  createdAt: string;
};
export type Invitation = { email: string; sent: boolean; error?: string; temporaryPassword?: string; url: string; existingAccount?: boolean };
export type MemberChange =
  | { action: 'set-member-whatsapp'; userId: string; whatsapp: string }
  | { action: 'set-member-role'; userId: string; expectedRole: WorkspaceRole; role: EditableRole; clientId?: string }
  | { action: 'remove-member'; userId: string; expectedRole: WorkspaceRole }
  | { action: 'invite-member'; email: string; name?: string; role: EditableRole; clientId?: string; titles?: string[]; whatsapp?: string }
  | { action: 'renew-invitation'; userId: string }
  | { action: 'set-member-titles'; userId: string; titles: string[] };

// A person's trade, shown next to their name. Independent of the access role above: a "Membre" can be
// Designer and Monteur at once. These are offered as presets; any other label can be typed in.
export const jobTitles = ['Designer', 'Monteur', 'Motion designer', 'Community manager', 'Photographe', 'Vidéaste', 'Rédacteur', 'Directeur artistique', 'Chef de projet', 'Développeur'] as const;
export const titleLimits = { count: 8, length: 40 };
/** Trims, collapses spaces and drops duplicates (case-insensitively). `null` when the input isn't a valid list. */
export function cleanTitles(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > titleLimits.count * 2) return null;
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') return null;
    const title = raw.replace(/\s+/g, ' ').trim();
    if (!title) continue;
    if (title.length > titleLimits.length) return null;
    const key = title.toLocaleLowerCase('fr');
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
  }
  return titles.length > titleLimits.count ? null : titles;
}

export const roleLabels: Record<WorkspaceRole, string> = {
  owner: 'Propriétaire',
  admin: 'Administrateur',
  creative: 'Membre',
  social: 'Social media manager',
  viewer: 'Observateur',
  client: 'Client',
};
export const roleDescriptions: Record<WorkspaceRole, string> = {
  owner: 'Unique. Tout l’espace, le tableau de bord et la gestion des membres.',
  admin: 'Gère les clients existants, projets, tâches, archivage, verrou J−7, tableau de bord et invitations. La création de clients est réservée au propriétaire.',
  creative: 'Fait avancer ses tâches ou celles à prendre, commente et gère les sous-projets. Équipe en lecture seule. Ni création ni modification de clients, ni création de tâches, ni validation client, ni archivage, ni tableau de bord.',
  social: 'Gère le Social pour tous les clients : calendrier, publications, programmation et statistiques. Pour les tâches, les mêmes droits qu’un Membre. Ni invitations, ni devis ou factures.',
  viewer: 'Lecture seule de tout l’espace, sans modification ni commentaire.',
  client: 'Portail client uniquement : ses livrables, validation, retours, demandes et calendrier. Rien d’autre.',
};
/** Roles offered when inviting someone. */
export const invitableRoles: EditableRole[] = ['creative', 'social', 'admin', 'client'];
export const isManager = (role: WorkspaceRole) => role === 'owner' || role === 'admin';
/** Only workspace administrators can change the assistant's lasting knowledge. */
export const canTeachAssistant = (role: string) => role === 'owner' || role === 'admin';
export const isWorkspaceRole = (value: unknown): value is WorkspaceRole =>
  typeof value === 'string' && workspaceRoles.some((role) => role === value);
export const canManageMembers = (role: WorkspaceRole) => role === 'owner' || role === 'admin';
export const isStudioRole = (role: WorkspaceRole) => role !== 'client';
/** The operational "does the work" roles — same permissions, a different label. */
export const isMemberRole = (role: WorkspaceRole) => role === 'creative' || role === 'social';
/** Who runs the Social hub: plans, schedules and publishes posts, and reads their statistics. */
export const canSocial = (role: WorkspaceRole) => role === 'owner' || role === 'admin' || role === 'social';
/** A company's own workspace, created through public sign-up (lib/signup.ts): it keeps its own name. */
export const isCompanyWorkspaceId = (id: string) => id.startsWith('ws:org:');
/**
 * The print workspace (« …:print ») was retired. One made before keeps its rows in the database, but
 * access refuses it (lib/membership.ts, the records API's workspace lookup) and the scheduled jobs that
 * walk every workspace skip it.
 */
export const isRetiredWorkspaceId = (id: string) => id.endsWith(':print');
export const memberName = (member: WorkspaceMember) => member.name || member.email || 'Membre de l’équipe';

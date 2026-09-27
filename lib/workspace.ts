export const workspaceRoles = ['owner', 'admin', 'creative', 'social', 'print_operator', 'viewer', 'client'] as const;
export type WorkspaceRole = (typeof workspaceRoles)[number];
export type EditableRole = Exclude<WorkspaceRole, 'owner'>;
export type WorkspaceContext = { id: string; name: string; role: WorkspaceRole; clientId?: string | null };
export type WorkspaceSummary = { id: string; name: string; role: WorkspaceRole };
export type WorkspaceMember = {
  userId: string;
  role: WorkspaceRole;
  name: string | null;
  email: string | null;
  avatar?: string | null;         // profile picture asset id
  clientId?: string | null;
  pending?: boolean | null;       // managers only: invited, never signed in yet
  lastLoginAt?: string | null;    // managers only
  titles?: string[];              // what the person does (Designer, Monteur…); several allowed, studio members only
  printRole?: WorkspaceRole | null; // their role in the print workspace (null: none); only sent to whoever manages both
  createdAt: string;
};
export type Invitation = { email: string; sent: boolean; error?: string; temporaryPassword?: string; url: string; existingAccount?: boolean };
export type MemberChange =
  | { action: 'set-member-role'; userId: string; expectedRole: WorkspaceRole; role: EditableRole; clientId?: string }
  | { action: 'remove-member'; userId: string; expectedRole: WorkspaceRole }
  | { action: 'invite-member'; email: string; name?: string; role: EditableRole; clientId?: string; titles?: string[] }
  | { action: 'renew-invitation'; userId: string }
  | { action: 'set-member-titles'; userId: string; titles: string[] }
  | { action: 'set-print-access'; userId: string; role: PrintAccessRole | null };
/** What a studio member can be given in the print workspace from the studio's Équipe page. */
export const printAccessRoles = ['print_operator', 'admin'] as const;
export type PrintAccessRole = (typeof printAccessRoles)[number];

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
  print_operator: 'Opérateur impression',
  viewer: 'Observateur',
  client: 'Client',
};
export const roleDescriptions: Record<WorkspaceRole, string> = {
  owner: 'Unique. Tout l’espace, le tableau de bord et la gestion des membres.',
  admin: 'Gère les clients existants, projets, tâches, archivage, verrou J−7, tableau de bord et invitations. La création de clients est réservée au propriétaire.',
  creative: 'Fait avancer ses tâches ou celles à prendre, commente et gère les sous-projets. Équipe en lecture seule. Ni création ni modification de clients, ni création de tâches, ni validation client, ni archivage, ni tableau de bord.',
  social: 'Gère le Social pour tous les clients : calendrier, publications, programmation et statistiques. Pour les tâches, les mêmes droits qu’un Membre. Ni invitations, ni devis ou factures.',
  print_operator: 'Suit ses tâches d’impression ou celles à prendre, met à jour leur statut et suit son temps. Voit les commandes liées sans montants. Équipe en lecture seule. Aucun accès aux comptes ni au studio sans invitation séparée.',
  viewer: 'Lecture seule de tout l’espace, sans modification ni commentaire.',
  client: 'Portail client uniquement : ses livrables, validation, retours, demandes et calendrier. Rien d’autre.',
};
/** Roles offered when inviting into a normal (content) workspace; the print workspace uses `invitableRolesFor` instead. */
const contentInvitableRoles: EditableRole[] = ['creative', 'social', 'admin', 'client'];
/** Roles offered when inviting into the print workspace — no client portal there in v1. */
const printInvitableRoles: EditableRole[] = ['print_operator', 'admin'];
export const isManager = (role: WorkspaceRole) => role === 'owner' || role === 'admin';
export const isWorkspaceRole = (value: unknown): value is WorkspaceRole =>
  typeof value === 'string' && workspaceRoles.some((role) => role === value);
export const canManageMembers = (role: WorkspaceRole) => role === 'owner' || role === 'admin';
export const isStudioRole = (role: WorkspaceRole) => role !== 'client';
/** The operational "does the work" roles — same permissions everywhere, just scoped to a different workspace/role label. */
export const isMemberRole = (role: WorkspaceRole) => role === 'creative' || role === 'social' || role === 'print_operator';
/** Who runs the Social hub: plans, schedules and publishes posts, and reads their statistics. */
export const canSocial = (role: WorkspaceRole) => role === 'owner' || role === 'admin' || role === 'social';
/** A workspace id ending in `:print` is the print workspace — see `printWorkspaceIdFor` in the records API. */
/** A company's own workspace, created through public sign-up (lib/signup.ts): it keeps its own name. */
export const isCompanyWorkspaceId = (id: string) => id.startsWith('ws:org:');
export const isPrintWorkspaceId = (id: string) => id.endsWith(':print');
export const invitableRolesFor = (workspaceId: string): EditableRole[] =>
  isPrintWorkspaceId(workspaceId) ? printInvitableRoles : contentInvitableRoles;
export const memberName = (member: WorkspaceMember) => member.name || member.email || 'Membre de l’équipe';

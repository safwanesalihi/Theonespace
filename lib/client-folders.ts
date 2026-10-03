import { z } from 'zod';

export const folderMime = 'application/vnd.google-apps.folder';
export const driveIdSchema = z.string().regex(/^[\w-]{1,200}$/);
export const folderNameSchema = z.string().trim().min(1).max(160).refine((v) => !/[\u0000-\u001f/\\]/.test(v) && !['.', '..'].includes(v), 'Nom de dossier invalide.');
const nodeSchema = z.object({ id: z.string().regex(/^[\w-]{1,60}$/), parentId: z.string().regex(/^[\w-]{1,60}$/).nullable(), name: folderNameSchema, purpose: z.string().trim().max(500) }).strict();
export const folderBlueprintSchema = z.object({ version: z.literal(1), title: folderNameSchema, summary: z.string().trim().max(2000), nodes: z.array(nodeSchema).min(1).max(60) }).strict().superRefine((tree, ctx) => {
  const bad = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (new Set(tree.nodes.map((n) => n.id)).size !== tree.nodes.length) return bad('Les identifiants des dossiers doivent être uniques.');
  if (tree.nodes.filter((n) => n.parentId === null).length !== 1) return bad('Un seul dossier principal est requis.');
  const siblings = new Set<string>();
  for (const node of tree.nodes) {
    const key = `${node.parentId}:${node.name.normalize('NFKC').toLowerCase()}`;
    if (siblings.has(key)) return bad('Deux dossiers du même niveau ont le même nom.');
    siblings.add(key);
    let current = node; const seen = new Set<string>();
    while (current.parentId !== null) {
      if (seen.has(current.id)) return bad('L’arborescence contient une boucle.');
      seen.add(current.id);
      const parent = tree.nodes.find((n) => n.id === current.parentId);
      if (!parent) return bad('Un dossier parent est introuvable.');
      if (seen.size > 6) return bad('Limitez l’arborescence à 7 niveaux.');
      current = parent;
    }
  }
});
export type FolderBlueprint = z.infer<typeof folderBlueprintSchema>;
export type FolderNode = FolderBlueprint['nodes'][number];
export type ClientFolderPlan = { blueprint: FolderBlueprint; generatedAt: string; binding?: { accountId: string; parentId: string }; fileIds: Record<string, string>; done: string[]; lease?: { id: string; until: number }; revision: number };
export type DriveConnectionView = { configured: boolean; pickerConfigured: boolean; connected: boolean; account?: { id: string; name: string; email: string }; root?: { id: string; name: string; driveId?: string }; connectedAt?: string };
export type DriveFile = { id: string; name: string; mimeType: string; parents?: string[]; size?: string; modifiedTime?: string; trashed?: boolean; driveId?: string; appProperties?: Record<string, string>; capabilities?: { canAddChildren?: boolean; canEdit?: boolean; canTrash?: boolean; canUntrash?: boolean; canDownload?: boolean }; webViewLink?: string };
export function orderedFolders(tree: FolderBlueprint): FolderNode[] {
  const out: FolderNode[] = [];
  function walk(parent: string | null) { for (const node of tree.nodes.filter((n) => n.parentId === parent)) { out.push(node); walk(node.id); } }
  walk(null); return out;
}
export function rootFolderId(plan: ClientFolderPlan | null) {
  const root = plan?.blueprint.nodes.find((n) => n.parentId === null);
  return root && plan?.done.includes(root.id) ? plan.fileIds[root.id] : undefined;
}

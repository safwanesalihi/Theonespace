import { z } from 'zod';
import { driveAccess, driveClient, driveFailure, driveJson } from '@/lib/drive-access';
import { connection, connectionView, DriveError, readPlan } from '@/lib/drive-store';
import { folderBlueprintSchema } from '@/lib/client-folders';
import { generateFolderDraft, saveFolderDraft } from '@/lib/drive-planner';
import { provisionFolders } from '@/lib/drive-provision';

export const maxDuration = 300;
export async function GET(req: Request) {
  try {
    const a = await driveAccess(req); const clientId = new URL(req.url).searchParams.get('clientId') ?? '';
    await driveClient(a.workspaceId, clientId);
    const plan = await readPlan(a.workspaceId, clientId); const { lease: _lease, ...publicPlan } = plan ?? {}; void _lease;
    return driveJson({ plan: plan ? publicPlan : null, connection: connectionView(await connection(a.workspaceId)) });
  } catch (e) { return driveFailure(e); }
}
const schema = z.object({ action: z.enum(['save', 'generate', 'create']), clientId: z.string().min(1).max(200), revision: z.number().int().min(0), blueprint: folderBlueprintSchema.optional(), language: z.enum(['fr', 'en', 'ar']).optional() }).strict();
export async function POST(req: Request) {
  try {
    const a = await driveAccess(req); const parsed = schema.safeParse(await req.json());
    if (!parsed.success) throw new DriveError(parsed.error.issues[0]?.message || 'Plan invalide.');
    const b = parsed.data;
    const plan = b.action === 'generate' ? await generateFolderDraft(a.workspaceId, b.clientId, b.revision, b.language, req.signal)
      : b.action === 'create' ? await provisionFolders(a.workspaceId, b.clientId, b.revision)
      : b.blueprint ? await saveFolderDraft(a.workspaceId, b.clientId, b.blueprint, b.revision) : null;
    if (!plan) throw new DriveError('Arborescence requise.');
    const latest = b.action === 'create' ? (await readPlan(a.workspaceId, b.clientId))! : plan;
    const { lease: _lease, ...publicPlan } = latest; void _lease;
    return driveJson({ plan: publicPlan });
  } catch (e) { return driveFailure(e); }
}

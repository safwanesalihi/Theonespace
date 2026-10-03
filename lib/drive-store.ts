// Server-only metadata. loadRecords excludes kind=meta, so tokens never enter client records.
import { database } from '@/lib/database';
import { seal, open } from '@/lib/secret-box';
import { env } from '@/lib/env';
import type { ClientFolderPlan, DriveConnectionView } from '@/lib/client-folders';

export class DriveError extends Error {
  constructor(message: string, public status = 400, public code = 'drive-error') { super(message); }
}
export type DriveTokens = { accessToken: string; refreshToken: string; expiresAt: number };
export type DriveConnection = { account: { id: string; name: string; email: string }; root?: { id: string; name: string; driveId?: string }; connectedAt: string; tokens: string };
export const connectionKey = (w: string) => `drive-connection:${w}`;
export const planKey = (w: string, c: string) => `drive-plan:${w}:${c}`;
export async function readMeta<T>(w: string, id: string): Promise<{ data: T; revision: number } | null> {
  return (await database().query<{ data: T; revision: number }>('SELECT data, revision FROM records WHERE id=$1 AND workspace_id=$2 AND kind=\'meta\'', [id, w]))[0] ?? null;
}
/** Compare-and-swap across serverless instances; revision=0 means insert only. */
export async function writeMeta<T>(w: string, id: string, data: T, revision: number): Promise<number> {
  const rows = revision === 0
    ? await database().query<{ revision: number }>("INSERT INTO records(id,owner,workspace_id,kind,data,revision) VALUES($1,'system',$2,'meta',$3::jsonb,1) ON CONFLICT(id) DO NOTHING RETURNING revision", [id, w, JSON.stringify(data)])
    : await database().query<{ revision: number }>("UPDATE records SET data=$3::jsonb, revision=revision+1 WHERE id=$1 AND workspace_id=$2 AND kind='meta' AND revision=$4 RETURNING revision", [id, w, JSON.stringify(data), revision]);
  if (!rows[0]) throw new DriveError('Ce dossier a été modifié ailleurs. Actualisez puis réessayez.', 409, 'conflict');
  return rows[0].revision;
}
export async function removeMeta(w: string, id: string) { await database().query("DELETE FROM records WHERE id=$1 AND workspace_id=$2 AND kind='meta'", [id, w]); }
export async function connection(w: string) { return (await readMeta<DriveConnection>(w, connectionKey(w)))?.data ?? null; }
export function tokenContents(c: DriveConnection): DriveTokens { return JSON.parse(open(c.tokens)); }
export function sealedTokens(tokens: DriveTokens) { return seal(JSON.stringify(tokens)); }
export function driveConfigured() { return !!(env.GOOGLE_DRIVE_CLIENT_ID && env.GOOGLE_DRIVE_CLIENT_SECRET && (env.AUTH_SECRET?.length ?? 0) >= 32); }
export function connectionView(c: DriveConnection | null): DriveConnectionView {
  return { configured: driveConfigured(), pickerConfigured: !!(env.GOOGLE_DRIVE_PICKER_KEY && env.GOOGLE_DRIVE_PROJECT_NUMBER), connected: !!c, ...(c ? { account: c.account, root: c.root, connectedAt: c.connectedAt } : {}) };
}
export async function readPlan(w: string, clientId: string): Promise<ClientFolderPlan | null> {
  const row = await readMeta<Omit<ClientFolderPlan, 'revision'>>(w, planKey(w, clientId));
  return row ? { ...row.data, revision: row.revision } : null;
}
export async function writePlan(w: string, clientId: string, plan: ClientFolderPlan) {
  const { revision, ...data } = plan;
  return { ...data, revision: await writeMeta(w, planKey(w, clientId), data, revision) };
}

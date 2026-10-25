// A workspace's process (lib/process.ts), read from its `meta` record. No record — every studio made
// before processes existed — is the One Core's process, so nothing changes for them.
import { database, type Db } from '@/lib/database';
import { readProcess, type Process } from '@/lib/process';

export const processKey = (workspaceId: string) => `process:${workspaceId}`;

export async function loadProcessState(workspaceId: string, db: Pick<Db, 'query'> = database()): Promise<{ process: Process; revision: number }> {
  const rows = await db.query<{ data: unknown; revision: number }>("SELECT data, revision FROM records WHERE workspace_id = $1 AND id = $2 AND kind = 'meta'", [workspaceId, processKey(workspaceId)]);
  return { process: readProcess(rows[0]?.data), revision: rows[0]?.revision ?? 0 };
}
export async function loadProcess(workspaceId: string, db?: Pick<Db, 'query'>): Promise<Process> {
  return (await loadProcessState(workspaceId, db)).process;
}

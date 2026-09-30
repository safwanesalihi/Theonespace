// What the studio taught the assistant: short facts (« le client X veut toujours du vert », « Sara fait
// les reels ») kept per workspace in one meta row and sent with every studio question. Taught in the
// chat (« retiens que… ») or from the assistant's « Mémoire » panel; the owner, admins and the social
// media manager teach and forget, everyone in the studio benefits. Clients never see it.
import { database } from '@/lib/database';
import type { WorkspaceRole } from '@/lib/workspace';

export type Fact = { id: string; text: string; by: string; at: string };
export const memoryLimits = { facts: 80, text: 400 };
const rowId = (workspaceId: string) => `assistant-memory:${workspaceId}`;

export const canTeach = (role: WorkspaceRole) => role === 'owner' || role === 'admin' || role === 'social';

export async function readMemory(workspaceId: string): Promise<Fact[]> {
  const row = (await database().query<{ data: unknown }>(
    "SELECT data FROM records WHERE id = $1 AND workspace_id = $2 AND kind = 'meta'", [rowId(workspaceId), workspaceId],
  ))[0];
  const data = typeof row?.data === 'string' ? JSON.parse(row.data) : row?.data;
  const facts = (data as { facts?: unknown } | undefined)?.facts;
  return Array.isArray(facts) ? facts.filter((f): f is Fact => !!f && typeof f.id === 'string' && typeof f.text === 'string') : [];
}

async function write(workspaceId: string, owner: string, facts: Fact[]) {
  await database().query(
    `INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, $2, $3, 'meta', $4::jsonb, 1)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, revision = records.revision + 1 WHERE records.workspace_id = EXCLUDED.workspace_id`,
    [rowId(workspaceId), owner, workspaceId, JSON.stringify({ facts })],
  );
}

/** Adds a fact (the same text twice is kept once); the oldest go when the list is full. */
export async function remember(workspaceId: string, text: string, by: { userId: string; name: string }): Promise<{ fact: Fact } | { error: string }> {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return { error: 'Rien à retenir.' };
  if (clean.length > memoryLimits.text) return { error: `Une note de ${memoryLimits.text} caractères au plus.` };
  const facts = await readMemory(workspaceId);
  const same = facts.find((f) => f.text.toLowerCase() === clean.toLowerCase());
  if (same) return { fact: same };
  const fact: Fact = { id: crypto.randomUUID().slice(0, 8), text: clean, by: by.name, at: new Date().toISOString() };
  await write(workspaceId, by.userId, [...facts, fact].slice(-memoryLimits.facts));
  return { fact };
}

export async function forget(workspaceId: string, id: string, userId: string): Promise<{ fact: Fact } | { error: string }> {
  const facts = await readMemory(workspaceId);
  const fact = facts.find((f) => f.id === id);
  if (!fact) return { error: 'Note introuvable.' };
  await write(workspaceId, userId, facts.filter((f) => f.id !== id));
  return { fact };
}

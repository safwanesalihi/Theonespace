// The floating assistant (lib/assistant.ts): answers anyone signed in — clients, the team, the print
// team — about The One Core and the app, in their language. It sees only the conversation, never the
// workspace's data. Each person gets a handful of questions a minute.
import { getAppUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/auth-settings';
import { aiConfigured, gemini, type Turn } from '@/lib/ai';
import { assistantPrompt } from '@/lib/assistant';
import { database } from '@/lib/database';
import { json } from '@/lib/editorial-access';
import { loadRecords } from '@/lib/flow-server';
import { isPrintWorkspaceId, isWorkspaceRole } from '@/lib/workspace';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const limits = { turns: 20, turnLength: 4000, total: 24_000, perMinute: 15 };
const recent = new Map<string, number[]>();
function allow(userId: string, now = Date.now()) {
  const calls = (recent.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (calls.length >= limits.perMinute) return false;
  recent.set(userId, [...calls, now]);
  return true;
}

export async function POST(req: Request) {
  const user = await getAppUser(req);
  if (!user) return json({ error: 'Connexion requise.' }, 401);
  if (user.mustChangePassword) return json({ error: 'Choisissez votre mot de passe pour continuer.', code: 'password-change-required' }, 403);
  if (!sameOrigin(req)) return json({ error: 'Origine non autorisée.' }, 403);
  const workspaceId = req.headers.get('X-Workspace-Id');
  if (!workspaceId) return json({ error: 'Espace inconnu.' }, 400);
  const member = (await database().query<{ role: string; client_id: string | null }>(
    'SELECT role, client_id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspaceId, user.userId],
  ))[0];
  if (!member || !isWorkspaceRole(member.role)) return json({ error: 'Vous n’avez pas accès à cet espace.' }, 403);
  if (!aiConfigured()) return json({ error: 'L’assistant n’est pas encore activé par le studio.' }, 503);

  let body: { messages?: unknown; page?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'Requête invalide.' }, 400); }
  const turns = (Array.isArray(body.messages) ? body.messages : [])
    .flatMap((m: { role?: unknown; text?: unknown }) => ((m?.role === 'user' || m?.role === 'model') && typeof m.text === 'string' && m.text.trim()
      ? [{ role: m.role as Turn['role'], text: m.text.trim().slice(0, limits.turnLength) }] : []))
    .slice(-limits.turns);
  // The conversation starts with the person and ends with their question.
  while (turns.length && turns[0].role !== 'user') turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== 'user') return json({ error: 'Posez votre question.' }, 400);
  while (turns.reduce((n, t) => n + t.text.length, 0) > limits.total && turns.length > 2) turns.splice(0, 2);
  if (!allow(user.userId)) return json({ error: 'Trop de questions : patientez une minute.' }, 429);

  const client = member.role === 'client' && member.client_id
    ? (await loadRecords(workspaceId)).find((r) => r.kind === 'client' && r.id === member.client_id)?.name
    : undefined;
  const system = assistantPrompt({
    role: member.role, print: isPrintWorkspaceId(workspaceId), name: user.fullName || user.displayName.split('@')[0], client,
    page: typeof body.page === 'string' ? body.page.slice(0, 40) : undefined,
  });
  const answer = await gemini(system, turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })), { maxOutputTokens: 4096 });
  return answer.ok ? json({ reply: answer.data }) : json({ error: answer.error }, 502);
}

// The floating assistant « One » (lib/assistant.ts): answers anyone signed in — clients, the team, the
// print team — about The One Core, the app and their own work, in their language. It gets the workspace
// exactly as the person sees it in the app (the same filters as /api/records), never more. Each person
// gets a handful of questions a minute.
import { countAiCall, planRefusal } from '@/lib/subscription';
import { getAppUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/auth-settings';
import { aiConfigured, chat } from '@/lib/ai';
import { assistantData, assistantPrompt } from '@/lib/assistant';
import { database } from '@/lib/database';
import { json } from '@/lib/editorial-access';
import { memberView, portalView } from '@/lib/flow';
import { loadRecords } from '@/lib/flow-server';
import type { RecordItem } from '@/lib/model';
import { printVisible } from '@/lib/printing';
import { isCompanyWorkspaceId, isMemberRole, isPrintWorkspaceId, isWorkspaceRole, type WorkspaceRole } from '@/lib/workspace';

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
  const quota = await planRefusal(workspaceId, 'aiPerMonth');
  if (quota) return json(quota, quota.status);

  let body: { messages?: unknown; page?: unknown; locale?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'Requête invalide.' }, 400); }
  const turns = (Array.isArray(body.messages) ? body.messages : [])
    .flatMap((m: { role?: unknown; text?: unknown }) => ((m?.role === 'user' || m?.role === 'model') && typeof m.text === 'string' && m.text.trim()
      ? [{ role: m.role as 'user' | 'model', text: m.text.trim().slice(0, limits.turnLength) }] : []))
    .slice(-limits.turns);
  // The conversation starts with the person and ends with their question.
  while (turns.length && turns[0].role !== 'user') turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== 'user') return json({ error: 'Posez votre question.' }, 400);
  while (turns.reduce((n, t) => n + t.text.length, 0) > limits.total && turns.length > 2) turns.splice(0, 2);
  if (!allow(user.userId)) return json({ error: 'Trop de questions : patientez une minute.' }, 429);

  const role = member.role;
  const print = isPrintWorkspaceId(workspaceId);
  const identities = [user.fullName ?? '', user.displayName, user.email];
  const rows = await loadRecords(workspaceId);
  const visible = seenBy(rows, { workspaceId, role, clientId: member.client_id, userId: user.userId, identities, print });
  const client = role === 'client' ? visible.find((r) => r.kind === 'client')?.name : undefined;
  // A company's own workspace: the assistant speaks for that company, not for The One Core.
  const company = isCompanyWorkspaceId(workspaceId)
    ? (await database().query<{ name: string }>('SELECT name FROM workspaces WHERE id = $1', [workspaceId]))[0]?.name
    : undefined;
  const system = assistantPrompt({
    role, print, company, name: user.fullName || user.displayName.split('@')[0], client,
    page: typeof body.page === 'string' ? body.page.slice(0, 40) : undefined,
    locale: body.locale === 'fr' || body.locale === 'en' || body.locale === 'ar' ? body.locale : undefined,
    data: assistantData(visible, { role, print, userId: user.userId, now: new Date() }),
  });
  // The page stores the assistant's turns as 'model'; Groq calls them 'assistant'.
  await countAiCall(workspaceId);
  const answer = await chat([{ role: 'system', content: system }, ...turns.map((t) => ({ role: t.role === 'model' ? 'assistant' as const : 'user' as const, content: t.text }))]);
  return answer.ok ? json({ reply: answer.data }) : json({ error: answer.error }, 502);
}

/** What the person sees in the app — the same slices /api/records sends them. */
function seenBy(rows: RecordItem[], { workspaceId, role, clientId, userId, identities, print }: {
  workspaceId: string; role: WorkspaceRole; clientId: string | null; userId: string; identities: string[]; print: boolean;
}) {
  if (print) return printVisible({ id: workspaceId, name: '', role, clientId }, rows, userId);
  if (role === 'client') return clientId ? portalView(rows, clientId) : [];
  if (isMemberRole(role)) return memberView(rows, identities, userId, role === 'social');
  // Devis/factures/contrats are owner + client only.
  return role === 'owner' ? rows : rows.filter((r) => r.kind !== 'document');
}

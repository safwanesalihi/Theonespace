// The floating assistant « One » (lib/assistant.ts): answers anyone signed in — clients, the team, the
// print team — about The One Core, the app and their own work, in their language. It gets the workspace
// exactly as the person sees it in the app (the same filters as /api/records), never more.
// On Gemini (lib/agent.ts) the answer streams as it is written — one JSON event per line — and the
// studio's assistant acts with tools (lib/assistant-tools.ts): every change is a call to /api/records
// on the person's own session, so it follows exactly the same rules as their clicks. What the studio
// taught it (lib/assistant-memory.ts) is read here too: GET lists it, POST remember/forget edits it.
// Without GEMINI_API_KEY it answers through Groq, in one piece, without tools.
import { loadWorkflowSettings } from '@/lib/workflow-settings-server';
import { countAiCall, planRefusal } from '@/lib/subscription';
import { getAppUser, type AppUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/auth-settings';
import { aiConfigured, chat } from '@/lib/ai';
import { geminiConfigured, keyRefused, runAgent } from '@/lib/agent';
import { assistantData, assistantPrompt } from '@/lib/assistant';
import { canTeach, forget, readMemory, remember } from '@/lib/assistant-memory';
import { toolRunner, toolsFor, type AgentAction } from '@/lib/assistant-tools';
import { database } from '@/lib/database';
import { json } from '@/lib/editorial-access';
import { memberView, portalView } from '@/lib/flow';
import { loadRecords } from '@/lib/flow-server';
import type { RecordItem } from '@/lib/model';
import { printVisible } from '@/lib/printing';
import { POST as saveRecord } from '@/app/api/records/route';
import { isCompanyWorkspaceId, isMemberRole, isPrintWorkspaceId, isWorkspaceRole, type WorkspaceRole } from '@/lib/workspace';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const limits = { turns: 30, turnLength: 6000, total: 40_000 };

/** The person, their role in the workspace, or the refusal. */
async function access(req: Request): Promise<{ user: AppUser; workspaceId: string; role: WorkspaceRole; clientId: string | null } | Response> {
  const user = await getAppUser(req);
  if (!user) return json({ error: 'Connexion requise.' }, 401);
  if (user.mustChangePassword) return json({ error: 'Choisissez votre mot de passe pour continuer.', code: 'password-change-required' }, 403);
  const workspaceId = req.headers.get('X-Workspace-Id');
  if (!workspaceId) return json({ error: 'Espace inconnu.' }, 400);
  const member = (await database().query<{ role: string; client_id: string | null }>(
    'SELECT role, client_id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspaceId, user.userId],
  ))[0];
  if (!member || !isWorkspaceRole(member.role)) return json({ error: 'Vous n’avez pas accès à cet espace.' }, 403);
  return { user, workspaceId, role: member.role, clientId: member.client_id };
}

/** The assistant's memory, for the studio. */
export async function GET(req: Request) {
  const who = await access(req);
  if (who instanceof Response) return who;
  if (who.role === 'client') return json({ error: 'Réservé au studio.' }, 403);
  return json({ facts: await readMemory(who.workspaceId), canTeach: canTeach(who.role) });
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'Origine non autorisée.' }, 403);
  const who = await access(req);
  if (who instanceof Response) return who;
  const { user, workspaceId, role } = who;
  const userName = user.fullName || user.displayName;

  let body: { messages?: unknown; page?: unknown; locale?: unknown; action?: unknown; text?: unknown; id?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'Requête invalide.' }, 400); }

  // The « Mémoire » panel.
  if (body.action === 'remember' || body.action === 'forget') {
    if (!canTeach(role)) return json({ error: 'Seuls le propriétaire et les administrateurs enseignent à l’assistant.' }, 403);
    const r = body.action === 'remember'
      ? await remember(workspaceId, typeof body.text === 'string' ? body.text : '', { userId: user.userId, name: userName })
      : await forget(workspaceId, typeof body.id === 'string' ? body.id : '', user.userId);
    if ('error' in r) return json(r, 400);
    return json({ facts: await readMemory(workspaceId) });
  }

  const gemini = geminiConfigured();
  if (!gemini && !aiConfigured()) return json({ error: 'L’assistant n’est pas encore activé par le studio.' }, 503);
  const turns = (Array.isArray(body.messages) ? body.messages : [])
    .flatMap((m: { role?: unknown; text?: unknown }) => ((m?.role === 'user' || m?.role === 'model') && typeof m.text === 'string' && m.text.trim()
      ? [{ role: m.role as 'user' | 'model', text: m.text.trim().slice(0, limits.turnLength) }] : []))
    .slice(-limits.turns);
  // The conversation starts with the person and ends with their question.
  while (turns.length && turns[0].role !== 'user') turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== 'user') return json({ error: 'Posez votre question.' }, 400);
  while (turns.reduce((n, t) => n + t.text.length, 0) > limits.total && turns.length > 2) turns.splice(0, 2);

  const print = isPrintWorkspaceId(workspaceId);
  const identities = [user.fullName ?? '', user.displayName, user.email];
  // Everything the answer needs, read at once rather than one after the other.
  const [quota, rows, memory, company, team, settings] = await Promise.all([
    planRefusal(workspaceId, 'aiPerMonth'),
    loadRecords(workspaceId),
    role === 'client' ? Promise.resolve([]) : readMemory(workspaceId),
    // A company's own workspace: the assistant speaks for that company, not for The One Core.
    isCompanyWorkspaceId(workspaceId)
      ? database().query<{ name: string }>('SELECT name FROM workspaces WHERE id = $1', [workspaceId]).then((r) => r[0]?.name)
      : Promise.resolve(undefined),
    !gemini || role === 'client' || print ? Promise.resolve([]) : database().query<{ name: string | null; email: string | null; role: string }>(
      "SELECT name, email, role FROM workspace_members WHERE workspace_id = $1 AND role <> 'client' ORDER BY created_at", [workspaceId],
    ),
    loadWorkflowSettings(workspaceId),
  ]);
  if (quota) return json(quota, quota.status);
  const visible = seenBy(rows, { workspaceId, role, clientId: who.clientId, userId: user.userId, identities, print });
  const client = role === 'client' ? visible.find((r) => r.kind === 'client')?.name : undefined;
  const tools = gemini ? toolsFor(role, print) : [];
  const promptInput = {
    role, print, company, name: user.fullName || user.displayName.split('@')[0], client,
    page: typeof body.page === 'string' ? body.page.slice(0, 40) : undefined,
    locale: body.locale === 'fr' || body.locale === 'en' || body.locale === 'ar' ? body.locale : undefined,
    settings: role === 'client' ? visible.find(r => r.kind === 'client')?.effectiveWorkflow ?? settings : settings,
    data: assistantData(visible, { role, print, userId: user.userId, now: new Date() }),
    memory,
  };
  const system = assistantPrompt({ ...promptInput, tools: tools.map((t) => t.name) });
  // Counted alongside the answer, not before it.
  const counted = countAiCall(workspaceId).catch((error) => console.error('assistant count', (error as Error).message));

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => { try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); } catch { /* the reader left */ } };
      let changed = false;
      try {
        if (!gemini) {
          // The page stores the assistant's turns as 'model'; Groq calls them 'assistant'.
          const answer = await chat([{ role: 'system', content: system }, ...turns.map((t) => ({ role: t.role === 'model' ? 'assistant' as const : 'user' as const, content: t.text }))]);
          send(answer.ok ? { type: 'text', text: answer.data } : { type: 'error', error: answer.error });
        } else {
          const run = toolRunner({
            role, userId: user.userId, userName, workspaceId, visible, team,
            generateFolders: async (clientId, language, replaceDraft) => {
              const { readPlan, DriveError } = await import('@/lib/drive-store');
              const { generateFolderDraft } = await import('@/lib/drive-planner');
              const old = await readPlan(workspaceId, clientId);
              if (old && !replaceDraft) throw new DriveError('Un plan existe déjà. Demandez au responsable s’il veut remplacer le brouillon.');
              const plan = await generateFolderDraft(workspaceId, clientId, old?.revision ?? 0, language, req.signal);
              return { plan: plan.blueprint, previewUrl: `/#client/${encodeURIComponent(clientId)}/files`, createdInDrive: false };
            },
            onAction: (action: AgentAction) => { if (action.kind !== 'failed') changed = true; send({ type: 'action', ...action }); },
            // The person's own request, replayed on /api/records: their cookie, origin and workspace.
            save: async (payload) => {
              const headers = new Headers(req.headers);
              headers.set('content-type', 'application/json');
              headers.delete('content-length');
              const r = await saveRecord(new Request(req.url, { method: 'POST', headers, body: JSON.stringify(payload) }));
              const data = (await r.json().catch(() => ({}))) as { id?: string; error?: string; code?: string; whatsapp?: { sent: boolean; error?: string } };
              return { status: r.status, data: { id: data.id, error: data.error, code: data.code, whatsapp: data.whatsapp } };
            },
          });
          const result = await runAgent({
            system, tools,
            contents: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
            run, onText: (text) => send({ type: 'text', text }), onTool: (name) => send({ type: 'tool', name }),
          });
          // Gemini down or overloaded: Groq still answers (without actions) rather than an error.
          if (!result.ok && result.error !== keyRefused && aiConfigured()) {
            const fallback = assistantPrompt({ ...promptInput, tools: [] });
            const answer = await chat([{ role: 'system', content: fallback }, ...turns.map((t) => ({ role: t.role === 'model' ? 'assistant' as const : 'user' as const, content: t.text }))]);
            send(answer.ok ? { type: 'text', text: answer.data } : { type: 'error', error: result.error });
          } else if (!result.ok) send({ type: 'error', error: result.error });
        }
      } catch (error) {
        console.error('assistant', (error as Error).message);
        send({ type: 'error', error: 'L’IA ne répond pas pour le moment. Réessayez.' });
      }
      await counted;
      send({ type: 'done', changed });
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' } });
}

/** What the person sees in the app — the same slices /api/records sends them. */
function seenBy(rows: RecordItem[], { workspaceId, role, clientId, userId, identities, print }: {
  workspaceId: string; role: WorkspaceRole; clientId: string | null; userId: string; identities: string[]; print: boolean;
}) {
  if (print) return printVisible({ id: workspaceId, name: '', role, clientId }, rows, userId);
  if (role === 'client') return clientId ? portalView(rows, clientId, userId) : [];
  if (isMemberRole(role)) return memberView(rows, identities, userId, role === 'social');
  // Devis/factures/contrats are owner + client only.
  return role === 'owner' ? rows : rows.filter((r) => r.kind !== 'document');
}

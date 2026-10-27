// /api/records: the workspace's data (GET) and every change to it (POST). The boundary checks run in a
// fixed order before any action sees the request; see docs/architecture.md for the full sequence.
import { loadProcess } from '@/lib/process-server';
import { sameOrigin } from '@/lib/auth-settings';
import { database } from '@/lib/database';
import { dayIn } from '@/lib/flow';
import { planRefusal } from '@/lib/subscription';
import { loadTaskThread } from '@/lib/task-chat-server';
import { taskMentionCandidates } from '@/lib/task-mentions';
import { actionChain } from './actions';
import { createActionContext, type ActionBody, type ActionContext } from './context';
import { CommercialError, NoWorkspaceError, WorkspaceAccessError, conditionalResponse, isObject, response } from './http';
import { changeStamp, clientContextValid, payload, rowsFor, upkeepDue, visibleTo } from './payload';
import { identity, members, workspaceFor } from './workspace-access';

const noWorkspace = () => response({ error: 'Aucun espace ne vous est attribué. Demandez une invitation au studio.', code: 'no-workspace' }, 403);
const accessLost = () => response({ error: 'Vous n’avez plus accès à cet espace.' }, 403);
const passwordChangeRequired = () => response({ error: 'Choisissez votre mot de passe pour continuer.', code: 'password-change-required' }, 403);
const clientAccessEnded = () => response({ error: 'Votre accès client n’est plus actif. Contactez le studio.' }, 403);

/** The largest body accepted; above 25 000 characters only a client brief or a service scope. */
const maxBody = 300000;
const maxPlainBody = 25000;
/** What a read-only company (past its trial or paid period) may still do (lib/subscription.ts). */
const allowedWhenReadOnly = ['update-profile', 'stop-timer', 'meeting-end', 'request-plan', 'chat-receipt'];

/**
 * The page's payload (polled every few seconds, answered 304 when unchanged), or one task's
 * conversation: `threadTaskId` returns its messages, `chatTaskId` the people who can be mentioned.
 */
export async function getRecords(req: Request) {
  try {
    const user = await identity(req);
    if (!user) return response({ error: 'Connectez-vous pour accéder à votre espace.' }, 401);
    if (user.mustChangePassword) return passwordChangeRequired();
    const workspace = await workspaceFor(user, req?.headers.get('X-Workspace-Id'));
    const params = new URL(req.url).searchParams;
    const chatTaskId = params.get('chatTaskId');
    const threadTaskId = params.get('threadTaskId');
    const conversationId = threadTaskId ?? chatTaskId;
    if (conversationId !== null && (!conversationId || conversationId.length > 200)) return response({ error: 'Tâche introuvable.' }, 404);
    if (conversationId === null) return await pageLoad(req, workspace, user);
    const rows = await loadTaskThread(workspace.id, conversationId, workspace.clientId);
    if (!clientContextValid(workspace, rows)) return clientAccessEnded();
    const visible = visibleTo(workspace, rows, user);
    const task = visible.find((r) => r.id === conversationId && (r.kind === 'task' || r.kind === 'plan_item'));
    if (!task || task.archived || rows.some((r) => (r.id === task.clientId || r.id === task.projectId) && r.archived)) {
      return response({ error: 'Tâche introuvable.' }, 404);
    }
    if (threadTaskId !== null) return conditionalResponse(req, { messages: visible.filter((r) => r.kind === 'comment' && r.taskId === task.id) });
    // Only this task's people; the client portal never receives the workspace directory.
    return response({ people: taskMentionCandidates(rows.find((r) => r.id === task.id)!, await members(workspace.id)) });
  } catch (error) {
    if (error instanceof NoWorkspaceError) return noWorkspace();
    if (error instanceof WorkspaceAccessError) return accessLost();
    console.error('load records', error);
    return response({ error: 'Impossible de charger votre espace. Réessayez.' }, 503);
  }
}

/**
 * The page's payload. Every open tab polls it every 5 seconds, so an unchanged poll must stay cheap: the
 * due clocks run at most once a minute (payload.ts upkeepDue), then a small query (changeStamp) decides.
 * When the browser already holds that version, a 304 with no body, and the workspace is never read. The
 * stamp is taken before the rows are read, so a change made meanwhile can only cause one extra load,
 * never a stale page.
 */
async function pageLoad(req: Request, workspace: Awaited<ReturnType<typeof workspaceFor>>, user: NonNullable<Awaited<ReturnType<typeof identity>>>) {
  const known = req.headers.get('if-none-match');
  if (known && upkeepDue(workspace)) {
    const swept = await rowsFor(workspace);
    if (!clientContextValid(workspace, swept)) return clientAccessEnded();
  }
  const stamp = await changeStamp(workspace, user);
  if (known === stamp) return conditionalResponse(req, null, stamp);
  const rows = await rowsFor(workspace);
  upkeepDue(workspace); // this load ran the clocks: the next poll needn't
  if (!clientContextValid(workspace, rows)) return clientAccessEnded();
  return conditionalResponse(req, await payload(workspace, user, rows), stamp);
}

/**
 * A change. In order: session, password set, same origin, JSON, size, a JSON object, the workspace,
 * its rows, the client's access, the company's plan — then the first action of the chain that
 * answers it (features/records/server/actions/index.ts), else « Action invalide ».
 */
export async function postRecords(req: Request) {
  try {
    const user = await identity(req);
    if (!user) return response({ error: 'Connexion requise.' }, 401);
    if (user.mustChangePassword) return passwordChangeRequired();

    // Same rule as the sign-in routes: the browser's Origin must be present and must be the origin
    // this request was served on. A missing header used to pass, which left the door open to any
    // caller that can suppress it while the session cookie rides along.
    if (!sameOrigin(req)) {
      return response({ error: 'Origine non autorisée.' }, 403);
    }
    if (!req.headers.get('content-type')?.includes('application/json')) {
      return response({ error: 'Format invalide.' }, 415);
    }

    const raw = await req.text();
    if (raw.length > maxBody) return response({ error: 'Le contenu est trop long.' }, 413);
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(raw);
    } catch {
      return response({ error: 'Requête invalide.' }, 400);
    }
    if (!isObject(parsedBody)) return response({ error: 'Requête invalide.' }, 400);
    const body = parsedBody as ActionBody;
    // A structured client brief contains several bounded sections; other mutations keep their cap.
    if (raw.length > maxPlainBody && !(['create', 'update'].includes(body.action) && ['client', 'document'].includes(body.kind) && isObject(body.data) && (isObject(body.data.brief) || isObject(body.data.serviceScope)))) {
      return response({ error: 'Le contenu est trop long.' }, 413);
    }

    const db = database();
    const workspace = await workspaceFor(user, req.headers.get('X-Workspace-Id'));
    const now = new Date().toISOString();
    const today = dayIn(new Date());

    // A chat message or receipt only needs its task's thread, not the whole workspace.
    const compactComment = body.action === 'comment' && body.chatOnly === true;
    const compactChat = compactComment || body.action === 'chat-receipt';
    if (compactChat && (typeof body.taskId !== 'string' || !body.taskId || body.taskId.length > 200)) return response({ error: 'Tâche introuvable.' }, 404);
    const [rows, studioProcess] = await Promise.all([compactChat ? loadTaskThread(workspace.id, body.taskId, workspace.clientId) : rowsFor(workspace), loadProcess(workspace.id, db)]);
    if (!clientContextValid(workspace, rows)) return clientAccessEnded();

    // A company past its trial or paid period is read-only: it can still look, export, stop a
    // running clock, update its own profile and ask for a plan (lib/subscription.ts).
    if (!allowedWhenReadOnly.includes(body.action)) {
      const refusal = await planRefusal(workspace.id);
      if (refusal) return response(refusal, refusal.status);
    }

    return await runActions(createActionContext({ req, body, user, workspace, db, now, today, rows, compactComment, studioProcess }));
  } catch (error) {
    if (error instanceof CommercialError) return response({ error: error.message }, error.status);
    if (error instanceof NoWorkspaceError) return noWorkspace();
    if (error instanceof WorkspaceAccessError) return accessLost();
    console.error('save record', error);
    return response({ error: 'Enregistrement impossible. Vos saisies sont conservées ; réessayez.' }, 503);
  }
}

/** Tries each step of the chain in order; the first answer wins. */
export async function runActions(ctx: ActionContext, chain = actionChain): Promise<Response> {
  for (const step of chain) {
    if (step.actions && !step.actions.includes(ctx.body.action)) continue;
    if (step.when && !step.when(ctx)) continue;
    const answer = await step.run(ctx);
    if (answer) return answer;
  }
  return response({ error: 'Action invalide.' }, 400);
}

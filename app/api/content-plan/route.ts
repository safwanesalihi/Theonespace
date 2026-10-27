// Plan Éditorial API (lib/content-plan*.ts): a hand-built mind map per client and month. The studio's
// owner, administrators and social media managers create the month, its branches and its nodes, edit,
// share, duplicate and archive; the rest of the team reads. A client reads only the plans shared with
// them, for their own client file, and comments on the nodes through the usual task thread
// (/api/records « comment »). No AI here.
import { portalStatuses } from '@/lib/flow';
import { behaviourOf, oneCoreProcess, rulesOf, statusByName, type Process } from '@/lib/process';
import { loadProcess } from '@/lib/process-server';
import { getAppUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/auth-settings';
import { database } from '@/lib/database';
import { membershipOf } from '@/lib/membership';
import { insertRecord, loadRecords } from '@/lib/flow-server';
import { isDay, isItemType, isMonth, parsePlanFile, text } from '@/lib/content-plan';
import {
  addItem, createPlan, deleteItem, deletePlan, importPlan, pushItems, replaceFromFile, duplicateToNextMonth, getPlan, isPlanItem, listPlans, planItems, PlanError, removeBranch,
  setArchived, setShared, updateItem, updatePlan, type ItemPatch, type PlanItem, type PlanPatch,
} from '@/lib/content-plan-server';
import { planRefusal } from '@/lib/subscription';
import { dayIn, lockApplies } from '@/lib/flow';
import { can } from '@/lib/roles';
import { isWorkspaceRole, memberName, type WorkspaceRole } from '@/lib/workspace';
import { notifyTaskApproval, notifyTaskAssignment } from '@/lib/task-whatsapp';
import { notifyOwnerOfApproval } from '@/lib/approval-notice';
import { reviewersOf, reviewRequestEvent } from '@/lib/internal-review';
import { after } from 'next/server';
import { safeLink } from '@/lib/model';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Internal review (lib/internal-review.ts): only the owner or an administrator sends a content to the client. */
const sendRefusal = 'Seuls le propriétaire ou un administrateur envoient un contenu au client. Passez-le en « Validation interne ».';

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

async function access(req: Request) {
  const user = await getAppUser(req);
  if (!user) return { error: json({ error: 'Connexion requise.' }, 401) };
  if (user.mustChangePassword) return { error: json({ error: 'Choisissez votre mot de passe pour continuer.', code: 'password-change-required' }, 403) };
  const workspaceId = req.headers.get('X-Workspace-Id');
  if (!workspaceId) return { error: json({ error: 'Espace inconnu.' }, 400) };
  const member = await membershipOf(workspaceId, user.userId);
  if (!member || !isWorkspaceRole(member.role)) return { error: json({ error: 'Vous n’avez pas accès à cet espace.' }, 403) };
  return { user, workspaceId, role: member.role as WorkspaceRole, permissions: member.permissions, clientId: member.client_id };
}

/** What a client may read of a node: the published side, never the assignee or the internal link. */
const forClient = (i: PlanItem, studioProcess: Process) => ({
  id: i.id, name: i.name, due: i.due, status: portalStatuses[behaviourOf(i.status, studioProcess)], planBranch: i.planBranch, planType: i.planType, planContent: i.planContent, revision: i.revision,
});

export async function GET(req: Request) {
  const a = await access(req);
  const studioProcess = 'error' in a ? oneCoreProcess : await loadProcess(a.workspaceId);
  if ('error' in a) return a.error;
  const url = new URL(req.url);
  const client = a.role === 'client';
  const planId = url.searchParams.get('planId');
  if (planId) {
    const plan = await getPlan(a.workspaceId, planId);
    if (!plan || (client && (!plan.shared || plan.clientId !== a.clientId || plan.archived))) return json({ error: 'Plan introuvable.' }, 404);
    const rows = await loadRecords(a.workspaceId);
    const items = (await planItems(a.workspaceId, planId, rows)).filter((i) => !i.archived || (plan.archived && (i as PlanItem & { archivedWithPlan?: boolean }).archivedWithPlan));
    const ids = new Set(items.map((i) => i.id));
    const comments = rows.filter((r) => r.kind === 'comment' && r.taskId && ids.has(r.taskId) && !r.deletedAt).map((c) => ({ taskId: c.taskId }));
    if (client) {
      const { id, clientId, month, branches, notes, shared } = plan;
      return json({ plan: { id, clientId, month, branches, notes, shared }, items: items.map((i) => forClient(i, studioProcess)), comments });
    }
    const members = await database().query<{ userId: string; name: string | null; email: string | null; role: string }>(
      "SELECT user_id AS \"userId\", name, email, role FROM workspace_members WHERE workspace_id = $1 AND role NOT IN ('client', 'viewer')", [a.workspaceId],
    );
    return json({
      plan, items, comments,
      members: members.map((m) => ({ userId: m.userId, name: memberName(m as never) })),
      canEdit: can(a, 'social'),
      // The studio's status names (lib/process.ts), for pages outside the app such as the print view.
      statuses: studioProcess.statuses.map(({ id, label }) => ({ id, label })),
    });
  }
  const clientId = client ? a.clientId : url.searchParams.get('clientId');
  if (!clientId) return json({ error: 'Client inconnu.' }, 400);
  const plans = (await listPlans(a.workspaceId, clientId)).filter((p) => !client || (p.shared && !p.archived));
  const rows = await loadRecords(a.workspaceId);
  const withCounts = await Promise.all(plans.map(async (p) => {
    const items = (await planItems(a.workspaceId, p.id, rows)).filter((i) => !i.archived);
    return { id: p.id, month: p.month, shared: p.shared, archived: p.archived, branches: p.branches.length, items: items.length };
  }));
  return json({ plans: withCounts, canEdit: !client && can(a, 'social') });
}

export async function POST(req: Request) {
  const a = await access(req);
  const studioProcess = 'error' in a ? oneCoreProcess : await loadProcess(a.workspaceId);
  // What a status a person names does (lib/process.ts), and the names a plan file may use.
  const does = (status?: string) => behaviourOf(statusByName(studioProcess, status) ?? status, studioProcess);
  const statusNames = [...new Set(studioProcess.statuses.flatMap((st) => [st.label, st.id]))];
  // The studio's own freeze before publishing (lib/process.ts rulesOf).
  const lockDays = rulesOf(studioProcess).lockDays;
  if ('error' in a) return a.error;
  if (!sameOrigin(req)) return json({ error: 'Origine non autorisée.' }, 403);
  if (!can(a, 'social')) return json({ error: 'Le Plan Éditorial est géré par le propriétaire, les administrateurs et les social media managers.' }, 403);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const actor = a.user.fullName || a.user.displayName;
  const refusal = await planRefusal(a.workspaceId);
  if (refusal) return json(refusal, refusal.status);

  // The client file must belong to this workspace and be active.
  const clientOk = async (clientId: unknown) => typeof clientId === 'string'
    && (await loadRecords(a.workspaceId)).some((r) => r.kind === 'client' && r.id === clientId && !r.archived);
  const planOf = async (id: unknown) => (typeof id === 'string' ? getPlan(a.workspaceId, id) : null);

  try {
    switch (body.action) {
      case 'create': {
        if (!(await clientOk(body.clientId))) return json({ error: 'Client introuvable.' }, 404);
        if (!isMonth(body.month)) return json({ error: 'Choisissez un mois.' }, 400);
        const plan = await createPlan(a.workspaceId, actor, body.clientId as string, body.month, body.copyBranches === true);
        return json({ plan });
      }
      case 'import': {
        if (!(await clientOk(body.clientId))) return json({ error: 'Client introuvable.' }, 404);
        const parsed = parsePlanFile(body.file, statusNames);
        if ('errors' in parsed) return json({ error: 'Le fichier n’est pas valide.', problems: parsed.errors }, 400);
        // Same rule as the task path (/api/records): only the owner or an administrator can validate,
        // and the locked week stays locked without their override.
        if (!can(a, 'send')) {
          const today = dayIn(new Date());
          for (const b of parsed.plan.branches) for (const it of b.items) {
            if (it.status && does(it.status) === 'done') return json({ error: 'Seuls le propriétaire ou un administrateur peuvent valider un contenu.' }, 403);
            if (it.status && does(it.status) === 'client') return json({ error: sendRefusal }, 403);
            if (it.status && does(it.status) === 'internal' && !it.deliverable) return json({ error: 'Ajoutez le lien du livrable avant la validation interne.' }, 400);
            if (it.due && lockApplies(undefined, it.due, today, lockDays)) return json({ error: 'Cette date est dans la période verrouillée : un administrateur doit la confirmer.' }, 403);
          }
        }
        for (const b of parsed.plan.branches) for (const it of b.items) {
          if (it.deliverable) { const link = safeLink(it.deliverable); if (!link) return json({ error: 'Le fichier n’est pas valide.', problems: [`« ${it.name} » : lien Drive invalide.`] }, 400); it.deliverable = link; }
        }
        const done = await importPlan(a.workspaceId, a.user.userId, actor, body.clientId as string, parsed.plan, typeof body.planId === 'string' ? body.planId : undefined);
        return json({ plan: done.plan, notice: 'Plan importé : {n} contenus.', count: done.items });
      }
      case 'replace': {
        const plan = await planOf(body.planId);
        if (!plan || plan.archived) return json({ error: 'Plan introuvable.' }, 404);
        const parsed = parsePlanFile(body.file, statusNames);
        if ('errors' in parsed) return json({ error: 'Le fichier n’est pas valide.', problems: parsed.errors }, 400);
        // Same rule as the task path (/api/records): only the owner or an administrator can validate,
        // and the locked week stays locked without their override.
        if (!can(a, 'send')) {
          const today = dayIn(new Date());
          const before = new Map((await planItems(a.workspaceId, plan.id)).map((i) => [i.id, i.status]));
          for (const b of parsed.plan.branches) for (const it of b.items) {
            if (it.status && does(it.status) === 'done') return json({ error: 'Seuls le propriétaire ou un administrateur peuvent valider un contenu.' }, 403);
            if (it.status && does(it.status) === 'client' && does(before.get(it.id ?? '')) !== 'client') return json({ error: sendRefusal }, 403);
            if (it.status && does(it.status) === 'internal' && !it.deliverable) return json({ error: 'Ajoutez le lien du livrable avant la validation interne.' }, 400);
            if (it.due && lockApplies(undefined, it.due, today, lockDays)) return json({ error: 'Cette date est dans la période verrouillée : un administrateur doit la confirmer.' }, 403);
          }
        }
        for (const b of parsed.plan.branches) for (const it of b.items) {
          if (it.deliverable) { const link = safeLink(it.deliverable); if (!link) return json({ error: 'Le fichier n’est pas valide.', problems: [`« ${it.name} » : lien Drive invalide.`] }, 400); it.deliverable = link; }
        }
        const done = await replaceFromFile(a.workspaceId, a.user.userId, plan.id, parsed.plan, { name: actor, email: a.user.email });
        return json(done);
      }
      case 'push': {
        const plan = await planOf(body.planId);
        if (!plan || plan.archived) return json({ error: 'Plan introuvable.' }, 404);
        const ids = Array.isArray(body.itemIds) ? body.itemIds.filter((x): x is string => typeof x === 'string').slice(0, 500) : undefined;
        const count = await pushItems(a.workspaceId, plan.id, ids, { name: actor, email: a.user.email });
        return json({ count });
      }
      case 'delete-item': {
        await deleteItem(a.workspaceId, String(body.itemId ?? ''));
        return json({ ok: true, notice: 'Contenu supprimé.' });
      }
      case 'delete-plan': {
        const plan = await planOf(body.planId);
        if (!plan) return json({ error: 'Plan introuvable.' }, 404);
        await deletePlan(a.workspaceId, plan.id);
        return json({ ok: true, notice: 'Mois supprimé.' });
      }
      case 'update-plan': {
        const plan = await planOf(body.planId);
        if (!plan || plan.archived) return json({ error: 'Plan introuvable.' }, 404);
        const p = (body.patch ?? {}) as Record<string, unknown>;
        const patch: PlanPatch = {};
        if (Array.isArray(p.branches)) patch.branches = p.branches as PlanPatch['branches'];
        if (typeof p.notes === 'string') patch.notes = p.notes;
        return json({ plan: await updatePlan(a.workspaceId, plan.id, patch, Number(body.revision)) });
      }
      case 'remove-branch': {
        const plan = await planOf(body.planId);
        if (!plan || plan.archived) return json({ error: 'Plan introuvable.' }, 404);
        const archived = await removeBranch(a.workspaceId, plan.id, String(body.branchId ?? ''));
        return json({ archived });
      }
      case 'add-item': {
        const plan = await planOf(body.planId);
        if (!plan || plan.archived) return json({ error: 'Plan introuvable.' }, 404);
        const name = text(body.name, 160);
        if (!name) return json({ error: 'Le titre est obligatoire.' }, 400);
        if (!isItemType(body.planType)) return json({ error: 'Choisissez Reel, Post ou Story.' }, 400);
        if (body.due !== undefined && body.due !== '' && !isDay(body.due)) return json({ error: 'Date invalide.' }, 400);
        if (!can(a, 'send') && body.due && lockApplies(undefined, body.due as string, dayIn(new Date()), lockDays)) return json({ error: 'Cette date est dans la période verrouillée : un administrateur doit la confirmer.' }, 403);
        const item = await addItem(a.workspaceId, a.user.userId, plan.id, { name, planType: body.planType, planBranch: String(body.planBranch ?? ''), due: (body.due as string) || undefined });
        return json({ item });
      }
      case 'update-item': {
        const item = (await loadRecords(a.workspaceId)).find((r) => r.id === body.itemId && isPlanItem(r)) as PlanItem | undefined;
        if (!item) return json({ error: 'Élément introuvable.' }, 404);
        const p = (body.patch ?? {}) as Record<string, unknown>;
        const patch: ItemPatch = {};
        if (p.name !== undefined) { patch.name = text(p.name, 160); if (!patch.name) return json({ error: 'Le titre est obligatoire.' }, 400); }
        if (p.planContent !== undefined) patch.planContent = text(p.planContent, 3000);
        if (p.planType !== undefined) { if (!isItemType(p.planType)) return json({ error: 'Choisissez Reel, Post ou Story.' }, 400); patch.planType = p.planType; }
        if (p.planBranch !== undefined) patch.planBranch = String(p.planBranch);
        if (p.due !== undefined) { if (p.due !== '' && !isDay(p.due)) return json({ error: 'Date invalide.' }, 400); patch.due = p.due as string; }
        if (p.status !== undefined) { const id = statusByName(studioProcess, typeof p.status === 'string' ? p.status : undefined); if (!id) return json({ error: 'Statut invalide.' }, 400); patch.status = id; }
        if (typeof p.archived === 'boolean') patch.archived = p.archived;
        if (p.deliverable !== undefined) {
          const link = typeof p.deliverable === 'string' ? p.deliverable.trim() : '';
          if (link && !safeLink(link)) return json({ error: 'Lien Drive invalide (https://…).' }, 400);
          patch.deliverable = link ? safeLink(link) : '';
        }
        if (!can(a, 'send')) {
          if (patch.status && does(patch.status) === 'done' && patch.status !== item.status) return json({ error: 'Seuls le propriétaire ou un administrateur peuvent valider un contenu.' }, 403);
          if (patch.status && does(patch.status) === 'client' && does(item.status) !== 'client') return json({ error: sendRefusal }, 403);
          if (patch.status && does(patch.status) === 'internal' && !(patch.deliverable ?? item.deliverable)) return json({ error: 'Ajoutez le lien du livrable avant la validation interne.' }, 400);
          if (patch.due !== undefined && lockApplies(item.due, patch.due || undefined, dayIn(new Date()), lockDays)) return json({ error: 'Cette date est dans la période verrouillée : un administrateur doit la confirmer.' }, 403);
        }
        let assignee: { name: string; userId: string } | null | undefined;
        if (p.assigneeId !== undefined) {
          patch.assigneeId = typeof p.assigneeId === 'string' && p.assigneeId ? p.assigneeId : null;
          if (patch.assigneeId) {
            const m = (await database().query<{ userId: string; name: string | null; email: string | null; role: string }>(
              "SELECT user_id AS \"userId\", name, email, role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND role NOT IN ('client', 'viewer')", [a.workspaceId, patch.assigneeId],
            ))[0];
            if (!m) return json({ error: 'Assignez un membre de l’équipe.' }, 400);
            assignee = { name: memberName(m as never), userId: m.userId };
          } else assignee = null;
        }
        const next = await updateItem(a.workspaceId, item.id, patch, Number(body.revision), assignee, { name: actor, email: a.user.email });
        if (does(next.status) === 'internal' && does(item.status) !== 'internal') {
          const notice = reviewRequestEvent(next, await reviewersOf(a.workspaceId, a.user.userId), actor, new Date().toISOString());
          if (notice) { const insert = insertRecord(notice, 'system', a.workspaceId, true); await database().query(insert.text, insert.params); }
        }
        if (next.kind === 'task' && does(next.status) === 'done' && does(item.status) !== 'done') after(() => notifyOwnerOfApproval(a.workspaceId, next, new URL(req.url).origin, undefined, studioProcess));
        const assignmentWhatsapp = await notifyTaskAssignment(a.workspaceId, next, item, a.user.userId, actor, new URL(req.url).origin);
        const whatsapp = next.kind === 'task' && does(next.status) === 'client' && does(item.status) !== 'client'
          ? await notifyTaskApproval(a.workspaceId, next, await loadRecords(a.workspaceId), new URL(req.url).origin) : undefined;
        return json({ item: next, assignmentWhatsapp, whatsapp });
      }
      case 'share':
      case 'unshare': {
        const plan = await planOf(body.planId);
        if (!plan || plan.archived) return json({ error: 'Plan introuvable.' }, 404);
        await setShared(a.workspaceId, plan.id, body.action === 'share');
        return json({ plan: await getPlan(a.workspaceId, plan.id) });
      }
      case 'archive':
      case 'unarchive': {
        const plan = await planOf(body.planId);
        if (!plan) return json({ error: 'Plan introuvable.' }, 404);
        await setArchived(a.workspaceId, plan.id, body.action === 'archive');
        return json({ plan: await getPlan(a.workspaceId, plan.id) });
      }
      case 'duplicate': {
        const plan = await planOf(body.planId);
        if (!plan) return json({ error: 'Plan introuvable.' }, 404);
        const next = await duplicateToNextMonth(a.workspaceId, a.user.userId, actor, plan.id);
        return json({ plan: next, notice: 'Plan copié vers le mois suivant.' });
      }
      default:
        return json({ error: 'Action inconnue.' }, 400);
    }
  } catch (error) {
    if (error instanceof PlanError) return json({ error: error.message }, error.status);
    console.error('content plan', (error as Error).message);
    return json({ error: 'Le Plan Éditorial n’a pas pu être enregistré. Réessayez.' }, 500);
  }
}

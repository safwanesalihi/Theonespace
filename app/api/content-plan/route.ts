// Plan Éditorial API (lib/content-plan*.ts). The studio's owner, administrators and social media managers
// fill the client's content profile, generate a month, edit, lock, regenerate, share, duplicate and
// archive; the rest of the team reads. A client reads only the plans shared with them, for their own
// client file, and comments on the items through the usual task thread (/api/records « comment »).
import { getAppUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/auth-settings';
import { database } from '@/lib/database';
import { loadRecords } from '@/lib/flow-server';
import { isMonth, profileGaps } from '@/lib/content-plan';
import { planAiConfigured } from '@/lib/content-plan-ai';
import {
  duplicateToNextMonth, generatePlan, getPlan, isPlanItem, listPlans, planItems, PlanError, readProfile, regenerate,
  saveProfile, setArchived, setShared, updateItem, updatePlan, type ItemPatch, type PlanItem, type PlanPatch,
} from '@/lib/content-plan-server';
import { countAiCall, planRefusal } from '@/lib/subscription';
import { canSocial, isPrintWorkspaceId, isWorkspaceRole, memberName, type WorkspaceRole } from '@/lib/workspace';
import { statuses, safeLink } from '@/lib/model';

export const dynamic = 'force-dynamic';
// A whole month from the AI can take a minute or two.
export const maxDuration = 180;

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

async function access(req: Request) {
  const user = await getAppUser(req);
  if (!user) return { error: json({ error: 'Connexion requise.' }, 401) };
  if (user.mustChangePassword) return { error: json({ error: 'Choisissez votre mot de passe pour continuer.', code: 'password-change-required' }, 403) };
  const workspaceId = req.headers.get('X-Workspace-Id');
  if (!workspaceId || isPrintWorkspaceId(workspaceId)) return { error: json({ error: 'Espace inconnu.' }, 400) };
  const member = (await database().query<{ role: string; client_id: string | null }>(
    'SELECT role, client_id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspaceId, user.userId],
  ))[0];
  if (!member || !isWorkspaceRole(member.role)) return { error: json({ error: 'Vous n’avez pas accès à cet espace.' }, 403) };
  return { user, workspaceId, role: member.role as WorkspaceRole, clientId: member.client_id };
}

/** What a client may read of an item: the published side, never the internal notes or the lock. */
const forClient = (i: PlanItem) => ({
  id: i.id, name: i.name, due: i.due, status: i.status, planCode: i.planCode, planType: i.planType, planSerie: i.planSerie,
  planFormat: i.planFormat, planHook: i.planHook, planContent: i.planContent, planCta: i.planCta, revision: i.revision,
});

export async function GET(req: Request) {
  const a = await access(req);
  if ('error' in a) return a.error;
  const url = new URL(req.url);
  const client = a.role === 'client';
  const planId = url.searchParams.get('planId');
  if (planId) {
    const plan = await getPlan(a.workspaceId, planId);
    if (!plan || (client && (!plan.shared || plan.clientId !== a.clientId || plan.archived))) return json({ error: 'Plan introuvable.' }, 404);
    const rows = await loadRecords(a.workspaceId);
    const items = await planItems(a.workspaceId, planId, rows);
    const visible = plan.archived ? items : items.filter((i) => !i.archived);
    const ids = new Set(visible.map((i) => i.id));
    const comments = rows.filter((r) => r.kind === 'comment' && r.taskId && ids.has(r.taskId) && !r.deletedAt)
      .map((c) => ({ id: c.id, taskId: c.taskId, text: c.name, author: c.author, audience: c.audience, createdAt: c.createdAt }));
    if (client) {
      const shown = {
        id: plan.id, clientId: plan.clientId, month: plan.month, focus: plan.focus, overview: plan.overview, counts: plan.counts, quotas: plan.quotas,
        stories: plan.stories, specialStories: plan.specialStories, production: plan.production, questions: plan.questions, shootDays: plan.shootDays, shared: plan.shared,
      };
      return json({ plan: shown, items: visible.map(forClient), comments });
    }
    const members = await database().query<{ userId: string; name: string | null; email: string | null; role: string }>(
      "SELECT user_id AS \"userId\", name, email, role FROM workspace_members WHERE workspace_id = $1 AND role NOT IN ('client', 'viewer')", [a.workspaceId],
    );
    return json({
      plan, items: visible, comments,
      members: members.map((m) => ({ userId: m.userId, name: memberName(m as never) })),
      canEdit: canSocial(a.role),
    });
  }
  const clientId = client ? a.clientId : url.searchParams.get('clientId');
  if (!clientId) return json({ error: 'Client inconnu.' }, 400);
  const plans = (await listPlans(a.workspaceId, clientId)).filter((p) => !client || (p.shared && !p.archived));
  if (client) return json({ plans: plans.map(({ id, month, overview, counts }) => ({ id, month, overview, counts })) });
  const profile = await readProfile(a.workspaceId, clientId);
  return json({ profile, plans, canEdit: canSocial(a.role), aiConfigured: planAiConfigured(), gaps: profile ? profileGaps(profile) : null });
}

export async function POST(req: Request) {
  const a = await access(req);
  if ('error' in a) return a.error;
  if (!sameOrigin(req)) return json({ error: 'Origine non autorisée.' }, 403);
  if (!canSocial(a.role)) return json({ error: 'Le Plan Éditorial est géré par le propriétaire, les administrateurs et les social media managers.' }, 403);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const actor = a.user.fullName || a.user.displayName;
  const ai = ['generate', 'regenerate', 'regenerate-item'].includes(String(body.action));
  const refusal = await planRefusal(a.workspaceId, ai ? 'aiPerMonth' : undefined);
  if (refusal) return json(refusal, refusal.status);

  // The client file must belong to this workspace and be active.
  const clientOk = async (clientId: unknown) => typeof clientId === 'string'
    && (await loadRecords(a.workspaceId)).some((r) => r.kind === 'client' && r.id === clientId && !r.archived);
  const planOf = async (id: unknown) => (typeof id === 'string' ? getPlan(a.workspaceId, id) : null);

  try {
    switch (body.action) {
      case 'save-profile': {
        if (!(await clientOk(body.clientId))) return json({ error: 'Client introuvable.' }, 404);
        const profile = await saveProfile(a.workspaceId, body.clientId as string, body.profile, actor);
        return json({ profile, gaps: profileGaps(profile) });
      }
      case 'generate': {
        if (!(await clientOk(body.clientId))) return json({ error: 'Client introuvable.' }, 404);
        if (!isMonth(body.month)) return json({ error: 'Choisissez un mois.' }, 400);
        const focus = typeof body.focus === 'string' ? body.focus.trim().slice(0, 2000) : '';
        await countAiCall(a.workspaceId);
        const plan = await generatePlan(a.workspaceId, a.user.userId, actor, body.clientId as string, body.month, focus);
        return json({ plan, notice: 'Plan généré.' });
      }
      case 'regenerate':
      case 'regenerate-item': {
        const plan = await planOf(body.planId);
        if (!plan) return json({ error: 'Plan introuvable.', }, 404);
        await countAiCall(a.workspaceId);
        const done = await regenerate(a.workspaceId, plan.id, body.action === 'regenerate-item' ? String(body.itemId ?? '') : undefined);
        return json({ plan: done.plan, changed: done.changed });
      }
      case 'update-item': {
        const item = (await loadRecords(a.workspaceId)).find((r) => r.id === body.itemId && isPlanItem(r)) as PlanItem | undefined;
        if (!item) return json({ error: 'Élément introuvable.' }, 404);
        const p = (body.patch ?? {}) as Record<string, unknown>;
        const patch: ItemPatch = {};
        const str = (k: keyof ItemPatch, max: number) => { if (typeof p[k] === 'string') (patch as Record<string, unknown>)[k] = (p[k] as string).trim().slice(0, max); };
        str('name', 160); str('planSerie', 80); str('planFormat', 120); str('planHook', 400); str('planContent', 1200); str('planCta', 200); str('planShoot', 40);
        if (typeof p.name === 'string' && !patch.name) return json({ error: 'Le titre est obligatoire.' }, 400);
        if (p.due !== undefined) {
          if (typeof p.due !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.due) || Number.isNaN(Date.parse(p.due))) return json({ error: 'Date invalide.' }, 400);
          patch.due = p.due;
        }
        if (p.status !== undefined) {
          if (!statuses.includes(p.status as never)) return json({ error: 'Statut invalide.' }, 400);
          patch.status = p.status as PlanItem['status'];
        }
        if (Array.isArray(p.planPeople)) patch.planPeople = p.planPeople.filter((x): x is string => typeof x === 'string').map((x) => x.trim().slice(0, 80)).filter(Boolean).slice(0, 10);
        if (typeof p.planLocked === 'boolean') patch.planLocked = p.planLocked;
        if (p.deliverable !== undefined) {
          const link = typeof p.deliverable === 'string' ? p.deliverable.trim() : '';
          if (link && !safeLink(link)) return json({ error: 'Lien Drive invalide (https://…).' }, 400);
          patch.deliverable = link ? safeLink(link) : '';
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
        const next = await updateItem(a.workspaceId, item.id, patch, Number(body.revision), assignee);
        return json({ item: next });
      }
      case 'update-plan': {
        const plan = await planOf(body.planId);
        if (!plan) return json({ error: 'Plan introuvable.' }, 404);
        const p = (body.patch ?? {}) as Record<string, unknown>;
        const patch: PlanPatch = {};
        const t = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
        if (typeof p.overview === 'string') patch.overview = t(p.overview, 3000);
        if (Array.isArray(p.stories)) patch.stories = p.stories.slice(0, 30).map((s: Record<string, unknown>) => ({ time: t(s?.time, 5), name: t(s?.name, 120), days: Array.isArray(s?.days) ? s.days.map(Number).filter((d) => d >= 0 && d <= 6) : [], note: t(s?.note, 500) }));
        if (Array.isArray(p.specialStories)) patch.specialStories = p.specialStories.slice(0, 60).map((s: Record<string, unknown>) => ({ date: t(s?.date, 10), name: t(s?.name, 160), type: t(s?.type, 60), note: t(s?.note, 500) }));
        if (Array.isArray(p.production)) patch.production = p.production.slice(0, 30).map((s: Record<string, unknown>) => ({ step: t(s?.step, 120), date: t(s?.date, 10), content: t(s?.content, 3000) }));
        if (Array.isArray(p.reserve)) patch.reserve = p.reserve.map((x) => t(x, 300)).filter(Boolean).slice(0, 30);
        if (Array.isArray(p.questions)) patch.questions = p.questions.slice(0, 60).map((q: Record<string, unknown>) => ({ text: t(q?.text, 500), done: q?.done === true })).filter((q) => q.text);
        return json({ plan: await updatePlan(a.workspaceId, plan.id, patch, Number(body.revision)) });
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

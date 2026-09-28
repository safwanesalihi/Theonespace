// « Plateforme »: The One Core's owner (OWNER_EMAIL) sees every company that signed up, with its plan
// and usage, and records what was paid — start a plan, add paid months, extend a trial, suspend.
// Nobody else reaches it; the answer to anyone else is the same 404 as a route that doesn't exist.
import { getAppUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/auth-settings';
import { isOwnerEmail } from '@/lib/password-auth';
import { extendPaid, isPaidPlanId, trialDays } from '@/lib/plans';
import { listCompanies, subscriptionOf, updateSubscription } from '@/lib/subscription';
import { isCompanyWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const notFound = () => json({ error: 'Introuvable.' }, 404);

async function platformOwner(req: Request) {
  const user = await getAppUser(req);
  return user && !user.mustChangePassword && isOwnerEmail(user.email) ? user : null;
}

export async function GET(req: Request) {
  if (!(await platformOwner(req))) return notFound();
  return json({ companies: await listCompanies() });
}

export async function POST(req: Request) {
  if (!(await platformOwner(req))) return notFound();
  if (!sameOrigin(req)) return json({ error: 'Origine non autorisée.' }, 403);
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; workspaceId?: unknown; plan?: unknown; months?: unknown; days?: unknown };
  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
  if (!isCompanyWorkspaceId(workspaceId)) return json({ error: 'Espace inconnu.' }, 400);
  const sub = await subscriptionOf(workspaceId);
  if (!sub) return json({ error: 'Espace inconnu.' }, 400);

  switch (body.action) {
    // A payment received: this plan, `months` more paid (from today, or from the end of the current period).
    case 'mark-paid': {
      const months = Number(body.months);
      if (!isPaidPlanId(body.plan)) return json({ error: 'Plan inconnu.' }, 400);
      if (!Number.isInteger(months) || months < 1 || months > 36) return json({ error: 'Durée invalide (1 à 36 mois).' }, 400);
      await updateSubscription(workspaceId, { plan: body.plan, paidUntil: extendPaid(sub.plan === 'trial' ? { ...sub, paidUntil: null } : sub, months), canceled: false, clearRequest: true });
      break;
    }
    case 'extend-trial': {
      const days = Number(body.days ?? trialDays);
      if (!Number.isInteger(days) || days < 1 || days > 90) return json({ error: 'Durée invalide (1 à 90 jours).' }, 400);
      const from = Math.max(Date.now(), Date.parse(sub.trialEndsAt));
      await updateSubscription(workspaceId, { plan: 'trial', trialEndsAt: new Date(from + days * 86_400_000).toISOString(), paidUntil: null, canceled: false });
      break;
    }
    case 'suspend':
      await updateSubscription(workspaceId, { canceled: true });
      break;
    case 'reactivate':
      await updateSubscription(workspaceId, { canceled: false });
      break;
    case 'dismiss-request':
      await updateSubscription(workspaceId, { clearRequest: true });
      break;
    default:
      return json({ error: 'Action inconnue.' }, 400);
  }
  return json({ companies: await listCompanies() });
}

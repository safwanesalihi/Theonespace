// « Plateforme »: The One Core's owner (OWNER_EMAIL) sees every company that signed up, with its plan,
// usage and team; records what was paid (start a plan, add paid months, extend a trial), suspends,
// helps (owner password-reset link, read-only support access) and deletes a company for good. Every change
// lands in the platform's log (lib/platform-audit.ts), and the public site's key information is edited here
// too (lib/site-content.ts).
// Nobody else reaches it; the answer to anyone else is the same 404 as a route that doesn't exist.
import { getAppUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/auth-settings';
import { isOwnerEmail } from '@/lib/password-auth';
import { recentErrors } from '@/lib/error-report';
import { extendPaid, isPaidPlanId, trialDays } from '@/lib/plans';
import { listCompanies, subscriptionOf, updateSubscription } from '@/lib/subscription';
import { companyDetails, companyOwner, deleteCompany, setSupportAccess } from '@/lib/platform-admin';
import { requestPasswordReset } from '@/lib/password-reset';
import { env } from '@/lib/env';
import { recentActions, recordAction } from '@/lib/platform-audit';
import { siteContentSchema } from '@/lib/site-content';
import { saveSiteContent, siteContent } from '@/lib/site-content-server';
import { revalidatePath } from 'next/cache';
import { isCompanyWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const notFound = () => json({ error: 'Introuvable.' }, 404);

async function platformOwner(req: Request) {
  const user = await getAppUser(req);
  return user && !user.mustChangePassword && isOwnerEmail(user.email) ? user : null;
}

export async function GET(req: Request) {
  const user = await platformOwner(req);
  if (!user) return notFound();
  // ?errors : the latest production failures (lib/error-report.ts).
  if (new URL(req.url).searchParams.has('errors')) return json({ errors: await recentErrors() });
  // ?audit : the platform's log, newest first. ?site : the public site's key information.
  if (new URL(req.url).searchParams.has('audit')) return json({ actions: await recentActions() });
  if (new URL(req.url).searchParams.has('site')) return json({ site: await siteContent() });
  // ?workspace=… : one company's team and invitations, for the support panel.
  const id = new URL(req.url).searchParams.get('workspace');
  if (id) {
    const details = await companyDetails(id, user.userId);
    return details ? json({ details }) : json({ error: 'Espace inconnu.' }, 404);
  }
  return json({ companies: await listCompanies() });
}

export async function POST(req: Request) {
  const user = await platformOwner(req);
  if (!user) return notFound();
  if (!sameOrigin(req)) return json({ error: 'Origine non autorisée.' }, 403);
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; workspaceId?: unknown; plan?: unknown; months?: unknown; days?: unknown; confirm?: unknown; content?: unknown };
  const log = (action: string, workspaceId: string | null, detail?: Record<string, unknown>) => recordAction({ actor: user.email, action, workspaceId, detail });

  // The public site's key information: checked field by field, saved, and the prebuilt home page redone.
  if (body.action === 'site-save') {
    const parsed = siteContentSchema.safeParse(body.content);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return json({ error: issue?.message ?? 'Contenu invalide.', field: issue?.path.join('.') }, 400);
    }
    const site = await saveSiteContent(parsed.data, user.email);
    await log('site-save', null);
    revalidatePath('/accueil');
    return json({ site });
  }

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
      await log('mark-paid', workspaceId, { plan: body.plan, months });
      break;
    }
    case 'extend-trial': {
      const days = Number(body.days ?? trialDays);
      if (!Number.isInteger(days) || days < 1 || days > 90) return json({ error: 'Durée invalide (1 à 90 jours).' }, 400);
      const from = Math.max(Date.now(), Date.parse(sub.trialEndsAt));
      await updateSubscription(workspaceId, { plan: 'trial', trialEndsAt: new Date(from + days * 86_400_000).toISOString(), paidUntil: null, canceled: false });
      await log('extend-trial', workspaceId, { days });
      break;
    }
    case 'suspend':
      await updateSubscription(workspaceId, { canceled: true });
      await log('suspend', workspaceId);
      break;
    case 'reactivate':
      await updateSubscription(workspaceId, { canceled: false });
      await log('reactivate', workspaceId);
      break;
    case 'dismiss-request':
      await updateSubscription(workspaceId, { clearRequest: true });
      await log('dismiss-request', workspaceId, { plan: sub.requestedPlan });
      break;
    // Help: read-only support access, visible in the company's team, until the platform owner leaves.
    case 'support-on':
    case 'support-off':
      await setSupportAccess(workspaceId, { userId: user.userId, email: user.email }, body.action === 'support-on');
      await log(body.action, workspaceId);
      return json({ companies: await listCompanies(), details: await companyDetails(workspaceId, user.userId) });
    // Help: the owner receives a « new password » link by e-mail (lib/password-reset.ts).
    case 'reset-owner': {
      const owner = await companyOwner(workspaceId);
      if (!owner) return json({ error: 'Cette entreprise n’a pas de propriétaire.' }, 400);
      try {
        const sent = await requestPasswordReset(owner.email, 'platform', env.AUTH_URL ?? new URL(req.url).origin);
        await log('reset-owner', workspaceId, { email: owner.email });
        return json({ companies: await listCompanies(), reset: { email: owner.email, ...(sent.devLink ? { devLink: sent.devLink } : {}) } });
      } catch (error) {
        return json({ error: (error as Error).message }, 503);
      }
    }
    // For good: typed confirmation of the company's name, then everything goes (lib/platform-admin.ts).
    case 'delete': {
      const details = await companyDetails(workspaceId, user.userId);
      if (!details) return json({ error: 'Espace inconnu.' }, 400);
      if (typeof body.confirm !== 'string' || body.confirm.trim() !== details.name.trim()) {
        return json({ error: 'Tapez exactement le nom de l’entreprise pour confirmer.' }, 400);
      }
      const done = await deleteCompany(workspaceId, user.userId);
      if (!done) return json({ error: 'Espace inconnu.' }, 400);
      await log('delete', workspaceId, { name: details.name }); // the company is gone: its name stays in the detail
      return json({ companies: await listCompanies(), deleted: done });
    }
    default:
      return json({ error: 'Action inconnue.' }, 400);
  }
  return json({ companies: await listCompanies() });
}

// Workspace-level settings: the company's plan request, the print workspace gate, validation rules and
// the brand (name, logo, colour).
import { brandId, isHexColor, logoOnDarkModes, type Brand } from '@/lib/branding';
import { sendPlanRequest } from '@/lib/mail';
import { isPaidPlanId, plans } from '@/lib/plans';
import { mutatePrinting } from '@/lib/printing-server';
import { requestPlan as storePlanRequest } from '@/lib/subscription';
import { workflowSettingsSchema } from '@/lib/workflow-settings';
import { workflowSettingsKey } from '@/lib/workflow-settings-server';
import { canManageMembers, isCompanyWorkspaceId, isManager, isPrintWorkspaceId } from '@/lib/workspace';
import type { ActionStep } from '../context';
import { response } from '../http';
import { one, upsertMeta } from '../store';
import { brandOf } from '../workspace-access';

export const requestPlan: ActionStep = {
  actions: ['request-plan'],
  async run({ body, workspace, user, actor, result }) {
    if (!isCompanyWorkspaceId(workspace.id)) return response({ error: 'Action invalide.' }, 400);
    if (workspace.role !== 'owner') return response({ error: 'Seul le propriétaire peut choisir le plan.' }, 403);
    if (!isPaidPlanId(body.plan)) return response({ error: 'Plan inconnu.' }, 400);
    await storePlanRequest(workspace.id, body.plan);
    const mail = await sendPlanRequest({ company: workspace.name, plan: plans[body.plan].name, priceMad: plans[body.plan].priceMad, email: user.email, name: actor });
    return result({ planRequest: { sent: mail.sent } });
  },
};

/** Actions the print workspace shares with the studio; everything else there is a print action or refused. */
const sharedWithPrint = ['invite-member', 'renew-invitation', 'set-member-role', 'remove-member', 'set-member-titles', 'set-member-whatsapp', 'update-profile', 'start-timer', 'stop-timer'];

/** The print workspace answers its own actions (lib/printing-server.ts) and passes on the shared ones. */
export const printWorkspaceGate: ActionStep = {
  when: ({ workspace }) => isPrintWorkspaceId(workspace.id),
  async run({ body, workspace, owner, actor, rows, origin, result }) {
    if (workspace.role === 'client') return response({ error: 'Accès non autorisé.' }, 403);
    if (['print-save', 'print-task-status', 'print-delete'].includes(body.action)) {
      const changed = await mutatePrinting(workspace, owner, actor, body, rows, origin);
      if ('error' in changed) return response({ error: changed.error }, changed.status);
      return result({ id: changed.id, ...('assignmentWhatsapp' in changed ? { assignmentWhatsapp: changed.assignmentWhatsapp } : {}) });
    }
    if (!sharedWithPrint.includes(body.action)) return response({ error: 'Cette action n’est pas disponible dans Impression.' }, 403);
    return null;
  },
};

export const setWorkflowSettings: ActionStep = {
  actions: ['set-workflow-settings'],
  async run({ body, workspace, db, owner, result }) {
    if (!isManager(workspace.role)) return response({ error: 'Seuls le propriétaire et les administrateurs peuvent modifier les règles de validation.' }, 403);
    const parsed = workflowSettingsSchema.safeParse(body.data);
    if (!parsed.success) return response({ error: 'Indiquez un délai entre 1 minute et 365 jours et un nombre entier de tours entre 0 et 10 000.' }, 400);
    if (!Number.isSafeInteger(body.revision) || body.revision < 0) return response({ error: 'Actualisez les paramètres avant de réessayer.' }, 400);
    const saved = body.revision === 0
      ? await db.query("INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, $2, $3, 'meta', $4::jsonb, 1) ON CONFLICT (id) DO NOTHING RETURNING id", [workflowSettingsKey(workspace.id), owner, workspace.id, JSON.stringify(parsed.data)])
      : await db.query("UPDATE records SET data = $1::jsonb, revision = revision + 1 WHERE id = $2 AND workspace_id = $3 AND kind = 'meta' AND revision = $4 RETURNING id", [JSON.stringify(parsed.data), workflowSettingsKey(workspace.id), workspace.id, body.revision]);
    if (!saved.length) return response({ error: 'Ces règles ont changé. Fermez et rouvrez les paramètres avant de réessayer.' }, 409);
    return result();
  },
};

/** The workspace's brand: name (a company's own workspace), logo, main colour. */
export const setBrand: ActionStep = {
  actions: ['set-brand'],
  async run({ body, workspace, db, owner, result }) {
    if (!canManageMembers(workspace.role)) return response({ error: 'Seuls le propriétaire et les administrateurs peuvent changer la marque.' }, 403);
    if (isPrintWorkspaceId(workspace.id)) return response({ error: 'L’espace Impression garde la marque The One Print.' }, 400);
    const current = await brandOf(workspace);
    const next: Brand = { ...current };
    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!isCompanyWorkspaceId(workspace.id)) {
        if (name && name !== workspace.name) return response({ error: 'Le nom de l’espace du studio ne change pas.' }, 400);
      } else {
        if (name.length < 2 || name.length > 80) return response({ error: 'Nom de l’espace : de 2 à 80 caractères.' }, 400);
        await db.query('UPDATE workspaces SET name = $1, updated_at = now() WHERE id = $2', [name, workspace.id]);
        workspace.name = name; next.name = name;
      }
    }
    // A logo is the workspace's own upload; with it come its light-surface twin and its measured tone.
    const ownLogo = async (id: unknown) => typeof id === 'string' && id
      ? (await one<{ id: string }>("SELECT id FROM assets WHERE id = $1 AND workspace_id = $2 AND kind = 'logo'", [id, workspace.id]))?.id ?? null
      : null;
    if (body.logo !== undefined) {
      delete next.logo; delete next.logoLight; delete next.logoTone; delete next.logoOnDark;
      if (body.logo !== null && body.logo !== '') {
        const logo = await ownLogo(body.logo);
        if (!logo) return response({ error: 'Logo introuvable : envoyez-le à nouveau.' }, 400);
        next.logo = logo;
        if (body.logoLight) {
          const twin = await ownLogo(body.logoLight);
          if (!twin) return response({ error: 'Logo introuvable : envoyez-le à nouveau.' }, 400);
          next.logoLight = twin;
        }
        if (body.logoTone === 'dark' || body.logoTone === 'light') next.logoTone = body.logoTone;
      }
    }
    if (body.logoOnDark !== undefined) {
      if (!logoOnDarkModes.includes(body.logoOnDark)) return response({ error: 'Affichage du logo invalide.' }, 400);
      if (body.logoOnDark === 'auto') delete next.logoOnDark; else next.logoOnDark = body.logoOnDark;
    }
    if (body.color !== undefined) {
      if (body.color === null || body.color === '') delete next.color;
      else if (!isHexColor(body.color)) return response({ error: 'Couleur invalide.' }, 400);
      else next.color = (body.color as string).toLowerCase();
    }
    await upsertMeta(db, brandId(workspace.id), owner, workspace.id, { logo: next.logo ?? null, logoLight: next.logoLight ?? null, logoTone: next.logoTone ?? null, logoOnDark: next.logoOnDark ?? null, color: next.color ?? null });
    return result();
  },
};

// The CRM (lib/crm.ts): the owner and administrators keep their prospects — create, edit, move between
// stages, delete — and the owner turns a won prospect into a client, the only way the CRM creates one.
import { insertRecord } from '@/lib/flow-server';
import { canUseCrm, clientFromProspect, isProspectStage, prospectFields, prospectLimits, prospectStageLabels } from '@/lib/crm';
import type { RecordItem } from '@/lib/model';
import type { ActionStep } from '../context';
import { response } from '../http';

const refused = () => response({ error: 'Le CRM est réservé au propriétaire et aux administrateurs.' }, 403);
const changed = () => response({ error: 'Ce prospect a changé. Actualisez avant de réessayer.' }, 409);

export const saveProspect: ActionStep = {
  actions: ['prospect-save'],
  async run({ body, workspace, rows, actor, now, saveTask, insert, result }) {
    if (!canUseCrm(workspace.role)) return refused();
    const fields = prospectFields(body.data);
    if ('error' in fields) return response(fields, 400);
    const existing = body.id ? rows.find((r) => r.kind === 'prospect' && r.id === body.id) : undefined;
    if (body.id && !existing) return response({ error: 'Prospect introuvable.' }, 404);
    if (existing && existing.revision !== body.revision) return changed();
    if (!existing && rows.filter((r) => r.kind === 'prospect').length >= prospectLimits.perWorkspace) return response({ error: `Le CRM garde jusqu’à ${prospectLimits.perWorkspace} prospects : supprimez les plus anciens.` }, 403);
    if (fields.prospectStage === 'won' && existing?.prospectStage !== 'won' && !existing?.convertedClientId) {
      return response({ error: 'Un prospect gagné devient client : utilisez « Convertir en client ».' }, 400);
    }
    const stageMoved = !!existing && existing.prospectStage !== fields.prospectStage;
    // Won or lost closes a prospect: the analysis dates it from the first time it closed in that stage.
    const closed = fields.prospectStage === 'won' || fields.prospectStage === 'lost';
    const closedAt = closed ? (existing?.prospectStage === fields.prospectStage && existing.closedAt) || now : undefined;
    const prospect: RecordItem = {
      ...(existing ?? { id: crypto.randomUUID(), kind: 'prospect' as const, revision: 1, createdAt: now, author: actor }),
      name: fields.name, contact: fields.contact || undefined, email: fields.email || undefined, whatsapp: fields.whatsapp || undefined,
      city: fields.city || undefined, sector: fields.sector || undefined, source: fields.source || undefined,
      estimatedValue: fields.estimatedValue ?? undefined, due: fields.due || undefined, description: fields.description,
      prospectStage: fields.prospectStage, lostReason: fields.lostReason || undefined, lostNote: fields.lostNote || undefined, closedAt,
      history: [...(existing?.history ?? []), { text: !existing ? `Ajouté par ${actor}` : stageMoved ? `${prospectStageLabels[fields.prospectStage]} (${actor})` : `Modifié par ${actor}`, date: now }].slice(-50),
    };
    if (existing) {
      if (!(await saveTask(existing, prospect))) return changed();
    } else await insert(prospect);
    return result({ id: prospect.id });
  },
};

/** Moving a card on the board: only its stage changes, the move is written in its history. */
export const moveProspect: ActionStep = {
  actions: ['prospect-stage'],
  async run({ body, workspace, rows, actor, now, saveTask, result }) {
    if (!canUseCrm(workspace.role)) return refused();
    const prospect = rows.find((r) => r.kind === 'prospect' && r.id === body.id);
    if (!prospect) return response({ error: 'Prospect introuvable.' }, 404);
    if (!isProspectStage(body.stage)) return response({ error: 'Étape inconnue.' }, 400);
    if (body.stage === 'won') return response({ error: 'Un prospect gagné devient client : utilisez « Convertir en client ».' }, 400);
    if (prospect.prospectStage === body.stage) return result();
    if (prospect.convertedClientId) return response({ error: 'Ce prospect est déjà devenu client.' }, 409);
    if (prospect.revision !== body.revision) return changed();
    const moved = { ...prospect, prospectStage: body.stage, closedAt: body.stage === 'lost' ? now : undefined, ...(body.stage === 'lost' ? {} : { lostReason: undefined, lostNote: undefined }),
      history: [...(prospect.history ?? []), { text: `${prospectStageLabels[body.stage]} (${actor})`, date: now }].slice(-50) };
    if (!(await saveTask(prospect, moved))) return changed();
    return result({ id: prospect.id });
  },
};

/**
 * Won: the prospect becomes a client with its name and contact details, and stays on the board as
 * « Gagné », linked to it. Creating a client is the owner's, here as everywhere else.
 */
export const convertProspect: ActionStep = {
  actions: ['prospect-convert'],
  async run({ body, workspace, rows, db, owner, actor, now, result }) {
    if (!canUseCrm(workspace.role)) return refused();
    if (workspace.role !== 'owner') return response({ error: 'Seul le propriétaire crée des clients : demandez-lui de convertir ce prospect.' }, 403);
    const prospect = rows.find((r) => r.kind === 'prospect' && r.id === body.id);
    if (!prospect) return response({ error: 'Prospect introuvable.' }, 404);
    if (prospect.convertedClientId) return result({ id: prospect.convertedClientId });
    if (prospect.revision !== body.revision) return changed();
    if (rows.some((r) => r.kind === 'client' && !r.archived && r.name.trim().toLowerCase() === prospect.name.trim().toLowerCase())) {
      return response({ error: 'Un client porte déjà ce nom. Renommez le prospect ou ouvrez ce client.' }, 409);
    }
    const client = clientFromProspect(prospect, now);
    const won = { ...prospect, prospectStage: 'won' as const, convertedClientId: client.id, closedAt: now, lostReason: undefined, lostNote: undefined,
      history: [...(prospect.history ?? []), { text: `Gagné : devenu client (${actor})`, date: now }].slice(-50) };
    const saved = await db.transaction(async (tx) => {
      const updated = await tx.query('UPDATE records SET data = $1::jsonb, revision = revision + 1 WHERE id = $2 AND workspace_id = $3 AND revision = $4 RETURNING id',
        [JSON.stringify(won), prospect.id, workspace.id, prospect.revision]);
      if (!updated.length) return false;
      const insert = insertRecord(client, owner, workspace.id);
      await tx.query(insert.text, insert.params);
      const event = insertRecord({ id: `evt:${client.id}:client-added:${now}`, kind: 'event', revision: 1, type: 'client-added', audience: 'studio',
        name: `Nouveau client « ${client.name} » (gagné depuis le CRM) ajouté par ${actor}.`, clientId: client.id, createdAt: now }, 'system', workspace.id, true);
      await tx.query(event.text, event.params);
      return true;
    });
    if (!saved) return changed();
    return result({ id: client.id });
  },
};

export const deleteProspect: ActionStep = {
  actions: ['prospect-delete'],
  async run({ body, workspace, rows, db, result }) {
    if (!canUseCrm(workspace.role)) return refused();
    const prospect = rows.find((r) => r.kind === 'prospect' && r.id === body.id);
    if (!prospect) return response({ error: 'Prospect introuvable.' }, 404);
    await db.query("DELETE FROM records WHERE id = $1 AND workspace_id = $2 AND kind = 'prospect'", [prospect.id, workspace.id]);
    return result();
  },
};

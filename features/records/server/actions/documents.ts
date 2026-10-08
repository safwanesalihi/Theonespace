// Devis, factures and contrats: created and managed by the owner, visible only to their own client, who
// accepts or refuses them explicitly. Once sent, a document's financial shape is locked.
import { canonical, scopeReadiness, workflowSnapshot } from '@/lib/client-pipeline';
import { docPrefixes, docStatusesFor, docStatusLabels, nextDocNumber, nextDocStatuses } from '@/lib/documents';
import type { DocStatus, RecordItem } from '@/lib/model';
import { documentFields } from '@/lib/validation';
import { loadWorkflowState } from '@/lib/workflow-settings-server';
import type { ActionStep } from '../context';
import { response } from '../http';
import { deleteAtRevision, updateAtRevision } from '../store';

/**
 * A commercial decision is always explicit, scoped to this client's sent document and revision.
 * It does not use the deliverable's silence clock or claim a certified electronic signature.
 */
export const documentDecision: ActionStep = {
  actions: ['document-decision'],
  async run({ body, workspace, user, rows, actor, now, today, saveTask, result }) {
    if (workspace.role !== 'client' && workspace.role !== 'owner') return response({ error: 'Votre rôle ne peut pas accepter ce document.' }, 403);
    const doc = rows.find((r) => r.kind === 'document' && r.id === body.id && !r.archived && (workspace.role === 'owner' || r.clientId === workspace.clientId));
    if (!doc) return response({ error: 'Document introuvable.' }, 404);
    if (doc.docType === 'facture' || doc.docStatus !== 'sent' || !['accepted', 'refused'].includes(body.status)) return response({ error: 'Ce document ne peut plus recevoir de décision.' }, 409);
    if (body.status === 'accepted' && doc.docType === 'devis' && doc.validUntil && doc.validUntil < today) return response({ error: 'Ce devis est expiré. Demandez au studio une nouvelle version.' }, 409);
    if (body.revision !== doc.revision) return response({ error: 'Ce document a changé. Actualisez avant de réessayer.' }, 409);
    const decided = { ...doc, docStatus: body.status as DocStatus, documentDecision: { by: actor, userId: user.userId, email: user.email, at: now, method: workspace.role === 'client' ? 'portal' as const : 'studio' as const, status: body.status as 'accepted' | 'refused' }, history: [...(doc.history || []), { text: `Statut : ${docStatusLabels[body.status as DocStatus]} — ${actor}`, date: now }].slice(-100) };
    if (!(await saveTask(doc, decided))) return response({ error: 'Ce document a changé. Actualisez avant de réessayer.' }, 409);
    return result({ id: doc.id });
  },
};

export const deleteDocument: ActionStep = {
  actions: ['delete'],
  when: ({ body }) => body.kind === 'document',
  async run({ body, workspace, rows, db, result }) {
    if (workspace.role !== 'owner') return response({ error: 'Seul le propriétaire peut supprimer un document.' }, 403);
    const doc = rows.find((r) => r.id === body.id && r.kind === 'document');
    if (!doc) return response({ error: 'Document introuvable.' }, 404);
    // A document the client may already have seen is never hard-deleted, only archived — the numbered history stays intact.
    if (doc.docStatus !== 'draft') return response({ error: 'Seul un brouillon peut être supprimé ; archivez ce document à la place.' }, 409);
    if (body.revision !== doc.revision) return response({ error: 'Ce document a changé. Actualisez avant de réessayer.' }, 409);
    if (!(await deleteAtRevision(db, workspace.id, doc.id, doc.revision))) return response({ error: 'Ce document a changé. Actualisez avant de réessayer.' }, 409);
    return result();
  },
};

export const saveDocument: ActionStep = {
  actions: ['create', 'update'],
  when: ({ body }) => body.kind === 'document',
  async run({ body, workspace, user, rows, db, owner, actor, now, result }) {
    if (workspace.role !== 'owner') return response({ error: 'Seul le propriétaire peut créer ou modifier un devis, une facture ou un contrat.' }, 403);
    const existing = body.action === 'update' ? rows.find((r) => r.id === body.id && r.kind === 'document') : undefined;
    if (body.action === 'update' && !existing) return response({ error: 'Document introuvable.' }, 404);
    const parsed = documentFields.safeParse(body.data);
    if (!parsed.success) return response({ error: parsed.error.issues[0].message }, 400);
    const data = parsed.data;
    if (data.clientId !== 'internal') {
      const docClient = rows.find((r) => r.kind === 'client' && r.id === data.clientId && !r.archived);
      if (!docClient) return response({ error: 'Sélectionnez un client actif.' }, 400);
    }
    const docStatus: DocStatus = data.docStatus || existing?.docStatus || 'draft';
    if (!docStatusesFor[data.docType].includes(docStatus)) return response({ error: 'Statut invalide pour ce type de document.' }, 400);
    const scope = data.serviceScope ?? existing?.serviceScope;
    const purpose = data.documentPurpose ?? existing?.documentPurpose ?? 'base';
    let sourceTerms: RecordItem['workflowTerms'];
    if (data.requestId && !rows.some((r) => r.kind === 'request' && r.id === data.requestId && r.clientId === data.clientId)) return response({ error: 'Demande introuvable pour ce client.' }, 400);
    if (purpose === 'extra' && (data.docType !== 'devis' || !data.requestId || !data.scopeFormat || !data.scopeUnits || data.lineItems.reduce((sum, line) => sum + line.quantity, 0) !== data.scopeUnits)) return response({ error: 'Un devis extra doit préciser la demande, le format et la quantité exacte.' }, 400);
    if (data.sourceDocumentId) {
      const source = rows.find((d) => d.kind === 'document' && d.id === data.sourceDocumentId && d.clientId === data.clientId && d.docType === 'devis' && d.docStatus === 'accepted' && (!d.archived || existing?.sourceDocumentId === d.id || data.docType === 'facture'));
      if (!source) return response({ error: 'Choisissez un devis accepté de ce client.' }, 400);
      if (canonical(scope) !== canonical(source.serviceScope) || canonical(data.lineItems) !== canonical(source.lineItems) || (data.taxRate ?? 0) !== (source.taxRate ?? 0)) return response({ error: 'Le contrat doit reprendre le périmètre et les montants du devis accepté.' }, 409);
      if (data.docType === 'contract' && (data.notes || '') !== (source.notes || '')) return response({ error: 'Le contrat doit conserver les conditions particulières du devis accepté.' }, 409);
      sourceTerms = source.workflowTerms ?? workflowSnapshot();
      if (data.workflowSettings && canonical(data.workflowSettings) !== canonical({ validationHours: sourceTerms.validationHours, maxRevisionRounds: sourceTerms.maxRevisionRounds })) return response({ error: 'Le contrat doit conserver les règles de validation du devis accepté.' }, 409);
    }
    if (data.docType === 'contract' && scope && !data.sourceDocumentId) return response({ error: 'Créez le contrat depuis le devis accepté.' }, 400);

    const requestedTerms = sourceTerms ?? (data.workflowSettings ? workflowSnapshot(data.workflowSettings) : existing?.workflowTerms) ?? (scope ? workflowSnapshot(rows.find((r) => r.kind === 'client' && r.id === data.clientId)?.workflowSettings ?? (await loadWorkflowState(workspace.id)).settings) : undefined);
    if (existing) {
      if (!nextDocStatuses(existing.docType!, existing.docStatus || 'draft').includes(docStatus)) return response({ error: 'Un document envoyé ne peut pas redevenir un brouillon ; créez une nouvelle version.' }, 409);
      if (docStatus === 'sent' && existing.docStatus === 'draft' && scope && scopeReadiness(scope).length) return response({ error: `Complétez le périmètre avant envoi : ${scopeReadiness(scope).join(', ')}.` }, 400);
      // Once it has left "draft", the client may already have seen it: lock the financial shape.
      // Line items are compared field-by-field, not via JSON.stringify — Postgres jsonb does not
      // preserve object key insertion order, so a round-tripped-but-unchanged item would otherwise
      // look "different" the moment its key order happens to differ from the freshly-parsed input.
      const sameLineItems = (a: typeof data.lineItems, b: typeof data.lineItems) =>
        a.length === b.length && a.every((item, i) => item.description === b[i]?.description && item.quantity === b[i]?.quantity && item.unitPrice === b[i]?.unitPrice);
      const locked = existing.docStatus !== 'draft' && (
        !sameLineItems(existing.lineItems || [], data.lineItems)
        || (existing.taxRate ?? 0) !== (data.taxRate ?? 0)
        || existing.docType !== data.docType
        || existing.clientId !== data.clientId
        || canonical(existing.serviceScope) !== canonical(scope)
        || canonical(existing.workflowTerms) !== canonical(requestedTerms)
        || (existing.notes || '') !== (data.notes || '')
        || (existing.issuedAt || '') !== (data.issuedAt || '')
        || (existing.dueAt || '') !== (data.dueAt || '')
        || (existing.validUntil || '') !== (data.validUntil || '')
        || (existing.sourceDocumentId || '') !== (data.sourceDocumentId || '')
        || (existing.documentPurpose || 'base') !== purpose
        || (existing.requestId || '') !== (data.requestId || '')
        || existing.scopeFormat !== data.scopeFormat
        || existing.scopeUnits !== data.scopeUnits
      );
      if (locked) return response({ error: 'Un document envoyé ne peut plus être modifié sur ses lignes ou son montant.' }, 409);
      if (body.revision !== existing.revision) return response({ error: 'Ce document a changé. Actualisez avant de réessayer.' }, 409);
      const statusChanged = docStatus !== existing.docStatus;
      const item: RecordItem = {
        ...existing, name: data.name || existing.name, lineItems: data.lineItems, taxRate: data.taxRate,
        issuedAt: data.issuedAt, dueAt: data.dueAt, validUntil: data.validUntil, notes: data.notes,
        archived: data.archived ?? existing.archived, docStatus,
        serviceScope: scope, documentPurpose: purpose, sourceDocumentId: data.sourceDocumentId, requestId: data.requestId,
        scopeFormat: data.scopeFormat, scopeUnits: data.scopeUnits,
        workflowTerms: requestedTerms,
        sentAt: existing.sentAt ?? (docStatus === 'sent' ? now : undefined),
        ...(statusChanged && ['accepted', 'refused'].includes(docStatus) ? { documentDecision: { by: actor, userId: user.userId, email: user.email, at: now, method: 'studio' as const, status: docStatus as 'accepted' | 'refused' } } : {}),
        history: [...(existing.history || []), { text: statusChanged ? `Statut : ${docStatusLabels[docStatus]}` : 'Modifié', date: now }].slice(-100),
      };
      if (!(await updateAtRevision(db, workspace.id, existing.id, body.revision, item))) return response({ error: 'Modification simultanée. Actualisez votre espace.' }, 409);
      return result({ id: item.id });
    }

    // New document: assign the next number for this type this year. The unique index on
    // (workspace, docType, number) is the real guarantee; a WHERE NOT EXISTS insert plus a
    // short retry loop handles the rare case of two people creating one at the same instant.
    const year = new Date(now).getFullYear();
    let createdId: string | null = null;
    for (let attempt = 0; attempt < 3 && !createdId; attempt++) {
      const existingNumbers = await db.query<{ number: string }>(
        `SELECT data->>'number' AS number FROM records WHERE workspace_id = $1 AND kind = 'document' AND data->>'docType' = $2 AND data->>'number' LIKE $3`,
        [workspace.id, data.docType, `${docPrefixes[data.docType]}-${year}-%`],
      );
      const { seq, number } = nextDocNumber(existingNumbers.map((r) => r.number), data.docType, year);
      const item: RecordItem = {
        id: crypto.randomUUID(), kind: 'document', revision: 1, name: data.name || number,
        docType: data.docType, number, seq, docStatus: 'draft', clientId: data.clientId,
        lineItems: data.lineItems, taxRate: data.taxRate, issuedAt: data.issuedAt, dueAt: data.dueAt,
        validUntil: data.validUntil, notes: data.notes, author: actor, createdAt: now,
        serviceScope: scope, workflowTerms: requestedTerms, sourceDocumentId: data.sourceDocumentId, documentPurpose: purpose, requestId: data.requestId,
        scopeFormat: data.scopeFormat, scopeUnits: data.scopeUnits,
        history: [{ text: 'Créé', date: now }],
      };
      try {
        const inserted = await db.query(
          `INSERT INTO records (id, owner, workspace_id, kind, data, revision)
             SELECT $1, $2, $3, 'document', $4::jsonb, 1
             WHERE NOT EXISTS (SELECT 1 FROM records WHERE workspace_id = $3 AND kind = 'document' AND data->>'number' = $5)
             RETURNING id`,
          [item.id, owner, workspace.id, JSON.stringify(item), number],
        );
        if (inserted.length) createdId = item.id;
      } catch (error) {
        if ((error as { code?: string }).code !== '23505') throw error;
        // Number taken meanwhile — loop and recompute from a fresh read.
      }
    }
    if (!createdId) return response({ error: 'Numérotation en cours, réessayez.' }, 409);
    return result({ id: createdId });
  },
};

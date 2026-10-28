import { z } from 'zod';
import type { RecordItem } from './model';
import { behaviourOf, isDone, oneCoreProcess, type Process } from './process';
import { flow } from './flow';
import { activeContract, defaultWorkflowSettings, type WorkflowSettings } from './workflow-settings';
export { activeContract } from './workflow-settings';

export const scopeFormats = ['post', 'carousel', 'reel', 'story', 'shooting', 'other'] as const;
export type ScopeFormat = typeof scopeFormats[number];
export const scopeLabels: Record<ScopeFormat, string> = { post: 'Posts', carousel: 'Carrousels', reel: 'Reels', story: 'Frames de story', shooting: 'Séances de shooting', other: 'Autres livrables' };
const day = z.string().refine(v => !v || /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, 'Date invalide.');
const text = z.string().trim().max(3000);
export const serviceScopeSchema = z.object({
  version: z.literal(1), title: z.string().trim().min(1).max(160), cadence: z.enum(['monthly', 'once']),
  issuerIdentity: text.optional(), clientIdentity: text.optional(),
  startDate: day, endDate: day, approver: z.string().trim().max(160), platforms: z.array(z.string().trim().min(1).max(60)).max(12), languages: z.string().trim().max(160),
  items: z.array(z.object({ format: z.enum(scopeFormats), quantity: z.number().int().min(0).max(10000), definition: text })).max(6)
    .refine(items => new Set(items.map(i => i.format)).size === items.length, 'Chaque format doit apparaître une seule fois.'),
  adaptations: text, communityManagement: text, exclusions: text, clientInputs: text, paymentTerms: text, cancellationTerms: text, rights: text,
  carryover: z.enum(['none', 'written']), extras: z.array(z.object({ label: z.string().trim().min(1).max(160), unit: z.string().trim().min(1).max(80), unitPrice: z.number().min(0).max(10000000).nullable() })).max(20),
}).refine(s => !s.endDate || !s.startDate || s.endDate >= s.startDate, 'La fin du contrat doit suivre son début.');
export type ServiceScope = z.infer<typeof serviceScopeSchema>;
export type WorkflowSnapshot = { validationHours: number; maxRevisionRounds: number; lockDays: number; gates: { label: string; offset: number }[] };
export const workflowSnapshot = (settings: WorkflowSettings = defaultWorkflowSettings): WorkflowSnapshot => ({ ...settings, lockDays: flow.lockDays, gates: flow.gates.map(g => ({ label: g.label, offset: g.offset })) });

export function emptyServiceScope(client?: Pick<RecordItem, 'name' | 'contact'>): ServiceScope {
  const definitions: Record<ScopeFormat, string> = {
    post: 'Un visuel original et sa légende. Préciser les formats et langues inclus.',
    carousel: 'Un carrousel original. Préciser le nombre maximal de slides.',
    reel: 'Une vidéo originale montée. Préciser durée, tournage et sous-titrage.',
    story: 'Un frame de story = une unité. Une séquence de 5 frames consomme 5 unités. Les reposts ne sont pas des créations originales.',
    shooting: 'Une séance. Préciser durée, lieu, équipe et déplacements inclus.',
    other: 'Préciser le livrable et son unité de décompte.',
  };
  return { version: 1, title: `Forfait ${client?.name || 'contenu'}`, issuerIdentity: '', clientIdentity: client?.name || '', cadence: 'monthly', startDate: '', endDate: '', approver: client?.contact || '', platforms: [], languages: '',
    items: scopeFormats.map(format => ({ format, quantity: 0, definition: definitions[format] })),
    adaptations: '', communityManagement: '', exclusions: '', clientInputs: '', paymentTerms: '', cancellationTerms: '', rights: '', carryover: 'none',
    extras: [{ label: 'Frame de story supplémentaire', unit: 'frame', unitPrice: null }, { label: 'Post supplémentaire', unit: 'post', unitPrice: null }, { label: 'Tour de modifications supplémentaire', unit: 'tour', unitPrice: null }],
  };
}

export function scopeReadiness(scope?: ServiceScope) {
  if (!scope) return [];
  const missing: string[] = [];
  if (!scope.issuerIdentity) missing.push('Identité du prestataire');
  if (!scope.clientIdentity) missing.push('Identité du client');
  if (!scope.items.some(i => i.quantity > 0)) missing.push('Quantités incluses');
  if (!scope.platforms.length) missing.push('Plateformes');
  if (!scope.startDate) missing.push('Début de prestation');
  if (!scope.approver) missing.push('Contact de validation');
  if (!scope.languages) missing.push('Langues');
  for (const [key, label] of [['adaptations', 'Adaptations et reposts'], ['communityManagement', 'Community management'], ['exclusions', 'Exclusions'], ['clientInputs', 'Éléments à fournir'], ['paymentTerms', 'Conditions de paiement'], ['cancellationTerms', 'Durée et résiliation'], ['rights', 'Droits et fichiers sources']] as const) if (!scope[key]) missing.push(label);
  if (scope.items.some(i => i.quantity > 0 && !i.definition)) missing.push('Définition des livrables');
  return missing;
}

/** Stable comparison: jsonb may reorder every nested object's keys. Arrays remain ordered. */
export function canonical(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}


type ScopedRecord = RecordItem & { planType?: string };
export function recordScopeFormat(record: ScopedRecord): ScopeFormat | undefined {
  if (record.scopeFormat) return record.scopeFormat;
  const v = (record.planType || record.postType || '').toLowerCase();
  return ({ post: 'post', story: 'story', reel: 'reel', carousel: 'carousel', carrousel: 'carousel' } as Record<string, ScopeFormat>)[v];
}

/** Count production records once. Social scheduling and reposts never increase the sold production quota. */
export function scopeUsage(records: RecordItem[], clientId: string, scope: ServiceScope, month: string, process: Process = oneCoreProcess) {
  const period = (r: RecordItem) => r.due || (r.planMonth ? `${r.planMonth}-01` : r.createdAt);
  const live = records.filter(r => (r.kind === 'task' || r.kind === 'plan_item') && r.clientId === clientId && !r.archived && r.publishable !== false && r.commercialTreatment !== 'extra' && (scope.cadence === 'once' ? (!scope.startDate || period(r).slice(0, 10) >= scope.startDate) && (!scope.endDate || period(r).slice(0, 10) <= scope.endDate) : period(r).startsWith(month)));
  return { rows: scope.items.filter(i => i.quantity > 0).map(item => { const matching = live.filter(r => recordScopeFormat(r) === item.format); return { ...item, planned: matching.reduce((n, r) => n + (r.scopeUnits || 1), 0), approved: matching.filter(r => isDone(r.status, process)).reduce((n, r) => n + (r.scopeUnits || 1), 0) }; }), unclassified: live.filter(r => !recordScopeFormat(r)).length };
}

export const pipelineStages = [
  { id: 'scope', label: 'Cadrage', detail: 'Définir quantités, unités et responsabilités.' },
  { id: 'quote', label: 'Devis', detail: 'Faire accepter une offre précise.' },
  { id: 'contract', label: 'Contrat', detail: 'Reprendre le devis accepté et consigner l’accord.' },
  { id: 'onboarding', label: 'Brief', detail: 'Rassembler identité, objectifs et accès.' },
  { id: 'planning', label: 'Plan', detail: 'Planifier les contenus convenus.' },
  { id: 'production', label: 'Production', detail: 'Assigner et produire les livrables.' },
  { id: 'review', label: 'Validation', detail: 'Centraliser les retours dans le portail.' },
  { id: 'delivery', label: 'Bilan', detail: 'Livrer, facturer et préparer le renouvellement.' },
] as const;

export function clientPipeline(client: RecordItem, records: RecordItem[], today: string, process: Process = oneCoreProcess) {
  const docs = records.filter(d => d.kind === 'document' && d.clientId === client.id && !d.archived && d.documentPurpose !== 'extra');
  const contract = activeContract(records, client.id, today);
  const quote = records.find(d => d.kind === 'document' && d.clientId === client.id && d.id === contract?.sourceDocumentId && d.docType === 'devis' && d.docStatus === 'accepted') || docs.filter(d => d.docType === 'devis').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).find(d => d.docStatus === 'accepted');
  const tasks = records.filter(r => (r.kind === 'task' || r.kind === 'plan_item') && r.clientId === client.id && !r.archived && r.publishable !== false && (r.due || r.planMonth || r.createdAt).startsWith(today.slice(0, 7)));
  const brief = client.brief;
  const briefReady = !!brief?.overview && !!brief.goals.length && !!(brief.identity.colors.length || brief.identity.direction || brief.identity.typography);
  let index = !contract && !quote && (!client.serviceScope || scopeReadiness(client.serviceScope).length > 0) ? 0 : !quote && !contract ? 1 : !contract ? 2 : !briefReady ? 3 : !tasks.some(t => t.kind === 'task') ? 4 : tasks.some(t => behaviourOf(t.status, process) === 'client') ? 6 : tasks.every(t => isDone(t.status, process)) ? 7 : 5;
  if (client.archived) index = 7;
  return { index, quote, contract, tasks, stage: pipelineStages[index], unpaid: docs.filter(d => d.docType === 'facture' && d.docStatus === 'sent').length };
}

export function scopeSections(scope: ServiceScope, workflow: WorkflowSnapshot = workflowSnapshot()) {
  const period = `${scope.cadence === 'monthly' ? 'Par mois' : 'Prestation ponctuelle'} · ${scope.startDate || 'Début à définir'}${scope.endDate ? ` au ${scope.endDate}` : ''}`;
  return [
    { title: 'Identité des parties', lines: [`Prestataire : ${scope.issuerIdentity || 'À définir'}`, `Client : ${scope.clientIdentity || 'À définir'}`] },
    { title: 'Périmètre de prestation', lines: [scope.title, period, `Plateformes : ${scope.platforms.join(', ') || 'À définir'}`, `Langues : ${scope.languages || 'À définir'}`, `Contact de validation : ${scope.approver || 'À définir'}`, ...scope.items.filter(i => i.quantity > 0).map(i => `${scopeLabels[i.format]} : ${i.quantity} ${scope.cadence === 'monthly' ? '/ mois' : 'au total'}. ${i.definition}`)] },
    { title: 'Décompte et limites', lines: ['1 frame de story = 1 unité ; une séquence de 5 frames = 5 unités.', `Adaptations et reposts : ${scope.adaptations || 'À définir'}`, `Community management : ${scope.communityManagement || 'À définir'}`, `Non inclus : ${scope.exclusions || 'À définir'}`, scope.carryover === 'none' ? 'Les unités inutilisées ne sont pas reportées au mois suivant.' : 'Tout report d’unités nécessite un accord écrit précisant quantité et période.'] },
    { title: 'Production et validation', lines: [`Le brief, les retours consolidés et les validations sont consignés dans le portail client.`, `Validation des livrables : ${workflow.validationHours} h après mise à disposition ; validation tacite à l’échéance selon les règles de collaboration convenues. Ce délai ne vaut pas acceptation d’un devis ou d’un extra.`, `${workflow.maxRevisionRounds} tours de modifications consolidées inclus par livrable. Une nouvelle direction ou un contenu supplémentaire constitue une nouvelle demande.`, `Calendrier gelé à J-${workflow.lockDays}. Toute exception doit être confirmée par le studio.`, workflow.gates.map(g => `${g.label} : J-${g.offset}`).join(' · '), `Éléments à fournir par le client : ${scope.clientInputs || 'À définir'}`] },
    { title: 'Hors forfait et demandes supplémentaires', lines: ['Demande via le portail > qualification > devis séparé > acceptation explicite > production. Aucun extra payant n’est accepté par silence.', ...scope.extras.map(e => `${e.label} : ${e.unitPrice === null ? 'sur devis' : `${e.unitPrice.toFixed(2)} MAD HT`} / ${e.unit}.`)] },
    { title: 'Paiement, durée et droits', lines: [`Paiement : ${scope.paymentTerms || 'À définir'}`, `Durée, renouvellement et résiliation : ${scope.cancellationTerms || 'À définir'}`, `Droits d’usage et fichiers sources : ${scope.rights || 'À définir'}`] },
  ];
}

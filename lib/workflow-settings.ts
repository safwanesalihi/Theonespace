import { z } from 'zod';
import type { RecordItem } from './model';

export const defaultWorkflowSettings = { validationHours: 48, maxRevisionRounds: 2 };
export const workflowSettingsSchema = z.object({
  validationHours: z.number().finite().min(1 / 60).max(8760),
  maxRevisionRounds: z.number().int().min(0).max(10000),
}).strict();
export type WorkflowSettings = z.infer<typeof workflowSettingsSchema>;

export function activeContract(records: RecordItem[], clientId: string, today: string) {
  return records.filter(d => d.kind === 'document' && d.clientId === clientId && !d.archived && d.docType === 'contract' && d.docStatus === 'accepted' && d.serviceScope && (!d.serviceScope.startDate || d.serviceScope.startDate <= today) && (!d.serviceScope.endDate || d.serviceScope.endDate >= today))
    .sort((a, b) => (b.documentDecision?.at || b.createdAt).localeCompare(a.documentDecision?.at || a.createdAt))[0];
}

export function clientWorkflowSettings(records: RecordItem[], clientId: string, defaults: WorkflowSettings, today: string): WorkflowSettings {
  const client = records.find(r => r.kind === 'client' && r.id === clientId);
  const agreement = activeContract(records, clientId, today);
  // Accepted terms remain authoritative. Legacy agreements used the original defaults.
  return agreement ? { validationHours: agreement.workflowTerms?.validationHours ?? 48, maxRevisionRounds: agreement.workflowTerms?.maxRevisionRounds ?? 2 }
    : client?.workflowSettings ?? defaults;
}

/** Approval rounds retain the policy the client saw when the deliverable was first sent. */
export function taskWorkflowSettings(task: Pick<RecordItem, 'approvalSettings' | 'effectiveWorkflow' | 'sentAt' | 'approvalDueAt'>): WorkflowSettings {
  if (task.approvalSettings) return { ...task.approvalSettings };
  const settings = task.sentAt ? defaultWorkflowSettings : task.effectiveWorkflow ?? defaultWorkflowSettings;
  // The deadline is the source of truth for legacy/in-flight approvals.
  const duration = task.sentAt && task.approvalDueAt ? (Date.parse(task.approvalDueAt) - Date.parse(task.sentAt)) / 3600000 : NaN;
  return { ...settings, ...(duration > 0 && Number.isFinite(duration) ? { validationHours: duration } : {}) };
}

export function withWorkflowSettings(records: RecordItem[], defaults: WorkflowSettings, today: string): RecordItem[] {
  const clients = new Map(records.filter(r => r.kind === 'client').map(r => [r.id, clientWorkflowSettings(records, r.id, defaults, today)]));
  return records.map(r => r.kind === 'client' || r.kind === 'task' || r.kind === 'plan_item'
    ? { ...r, effectiveWorkflow: r.kind === 'client' ? clients.get(r.id) ?? defaults : r.approvalSettings ?? (r.sentAt ? taskWorkflowSettings(r) : clients.get(r.clientId || '') ?? defaults) }
    : r);
}

/** Same reminder proportions as the original 48-hour policy (halfway and one eighth left). */
export const workflowReminderHours = (settings: WorkflowSettings) => [settings.validationHours / 2, settings.validationHours / 8];

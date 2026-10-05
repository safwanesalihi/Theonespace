import { database } from '@/lib/database';
import { defaultWorkflowSettings, workflowSettingsSchema, type WorkflowSettings } from './workflow-settings';

export const workflowSettingsKey = (workspaceId: string) => `workflow-settings:${workspaceId}`;
export async function loadWorkflowState(workspaceId: string) {
  const rows = await database().query<{ data: unknown; revision: number }>("SELECT data, revision FROM records WHERE workspace_id = $1 AND id = $2 AND kind = 'meta'", [workspaceId, workflowSettingsKey(workspaceId)]);
  const raw = rows[0]?.data;
  const parsed = workflowSettingsSchema.safeParse(typeof raw === 'string' ? JSON.parse(raw) : raw);
  return { settings: parsed.success ? parsed.data : { ...defaultWorkflowSettings }, revision: rows[0]?.revision ?? 0 };
}
export async function loadWorkflowSettings(workspaceId: string): Promise<WorkflowSettings> { return (await loadWorkflowState(workspaceId)).settings; }

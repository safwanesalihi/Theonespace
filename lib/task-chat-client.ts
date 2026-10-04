import type { RecordItem } from '@/lib/model';
import { syncServerClock } from '@/lib/app-clock';
import { timestampDate } from '@/lib/time';

/** A late workspace snapshot must never erase a just-saved message or restore a deleted one. */
export function mergeChatMessages(current: RecordItem[], incoming: RecordItem[]) {
  const byId = new Map(current.map(message => [message.id, message]));
  let changed = false;
  for (const message of incoming) {
    const previous = byId.get(message.id);
    if (!previous || (message.revision ?? 1) >= (previous.revision ?? 1) && JSON.stringify(previous) !== JSON.stringify(message)) {
      if (previous?.deletedAt && !message.deletedAt) continue;
      byId.set(message.id, message); changed = true;
    }
  }
  return changed ? [...byId.values()].sort((a, b) => timestampDate(a.createdAt).getTime() - timestampDate(b.createdAt).getTime() || a.id.localeCompare(b.id)) : current;
}

export class TaskChatReader {
  private active: AbortController | null = null;
  private etag: string | null = null;
  constructor(private timeout = 12000) {}
  cancel() { const active = this.active; this.active = null; active?.abort(); }
  async read(workspaceId: string, taskId: string, fresh = false): Promise<{ messages?: RecordItem[]; status: number; error?: string } | null> {
    if (fresh) { this.cancel(); this.etag = null; }
    if (this.active) return null;
    const controller = new AbortController(); this.active = controller;
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const started = performance.now();
      const response = await fetch(`/api/records?threadTaskId=${encodeURIComponent(taskId)}`, {
        cache: 'no-store', signal: controller.signal,
        headers: { 'X-Workspace-Id': workspaceId, ...(this.etag ? { 'If-None-Match': this.etag } : {}) },
      });
      if (this.active !== controller) return null;
      syncServerClock(response.headers, started);
      if (response.status === 304) return { status: 304 };
      const data = await response.json().catch(() => null) as { messages?: RecordItem[]; error?: string } | null;
      if (this.active !== controller) return null;
      if (!response.ok) return { status: response.status, error: data?.error };
      if (!Array.isArray(data?.messages) || data.messages.some(m => !m || m.kind !== 'comment' || m.taskId !== taskId || typeof m.id !== 'string' || !Number.isFinite(timestampDate(m.createdAt).getTime()))) throw Error('Actualisation de la discussion impossible.');
      this.etag = response.headers.get('ETag');
      return { messages: data.messages, status: response.status };
    } catch (error) {
      if (this.active !== controller) return null;
      throw error;
    } finally {
      clearTimeout(timer);
      if (this.active === controller) this.active = null;
    }
  }
}

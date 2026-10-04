// Request submissions carry a stable key so a lost response can be retried without duplicating work.
import { syncServerClock } from '@/lib/app-clock';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const connectionError = 'Connexion au serveur impossible. Vérifiez votre connexion internet, puis réessayez : votre texte est conservé.';
export const serverResponseError = 'Le serveur n’a pas confirmé l’enregistrement. Vos saisies sont conservées ; réessayez dans un instant.';
const accessError = 'Le serveur a refusé la demande. Vérifiez votre accès auprès du studio.';
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export async function sendRecordMutation<T>(body: unknown, workspaceId?: string | null): Promise<{ ok: boolean; status: number; data: T & { error?: string; code?: string } }> {
  const request = object(body) && body.action === 'request' && object(body.data) && typeof body.data.submissionId === 'string' && uuid.test(body.data.submissionId);
  const chat = object(body) && body.action === 'comment' && body.chatOnly === true && typeof body.submissionId === 'string' && uuid.test(body.submissionId);
  const retryable = request || chat;
  const serialized = JSON.stringify(body);
  const headers = { 'Content-Type': 'application/json', ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}) };
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = retryable ? setTimeout(() => controller.abort(), chat ? 15000 : 35000) : undefined;
    try {
      const started = performance.now();
      const res = await fetch('/api/records', { method: 'POST', headers, body: serialized, signal: controller.signal });
      syncServerClock(res.headers, started);
      const parsed: unknown = await res.json().catch(() => null);
      const valid = object(parsed) && (!request || !res.ok || typeof parsed.id === 'string' && !!parsed.id && Array.isArray(parsed.records)) && (!chat || !res.ok || object(parsed.message) && typeof parsed.message.id === 'string' && parsed.message.kind === 'comment' && parsed.message.taskId === body.taskId && typeof parsed.message.createdAt === 'string');
      // Do not turn an HTML error page into either an internet warning or a false success.
      const fallback = res.status === 401 ? 'Connexion requise.' : res.status === 403 ? accessError : serverResponseError;
      const data = valid ? { ...parsed, ...(!res.ok && typeof parsed.error !== 'string' ? { error: fallback } : {}) } : { error: fallback };
      if (retryable && attempt === 0 && ([500, 502, 503, 504].includes(res.status) || res.ok && !valid)) continue;
      return { ok: res.ok && valid, status: res.status, data: data as T & { error?: string; code?: string } };
    } catch {
      if (retryable && attempt === 0) continue;
      throw new Error(controller.signal.aborted ? serverResponseError : connectionError);
    } finally { clearTimeout(timer); }
  }
}

type ReadOptions = { workspaceId?: string | null; etag?: string | null; silent?: boolean };
export const workspaceLoadError = 'Impossible de charger votre espace. Réessayez.';
export const workspaceTimeoutError = 'Le chargement prend trop de temps. Réessayez dans un instant.';
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** One active read: polling must never supersede the sign-in or workspace-switch response. */
export class WorkspaceLoader<T> {
  private active: AbortController | null = null;
  constructor(private timeout = 35000) {}
  get pending() { return this.active !== null; }
  cancel() { const previous = this.active; this.active = null; previous?.abort(); }

  async read({ workspaceId, etag, silent = false }: ReadOptions): Promise<{ response: Response; data: T & { error?: string; code?: string } | null } | null> {
    if (silent && this.active) return null;
    this.active?.abort();
    const controller = new AbortController();
    this.active = controller;
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const send = (id?: string | null, tag?: string | null) => fetch('/api/records', {
        cache: 'no-store', signal: controller.signal,
        headers: { ...(id ? { 'X-Workspace-Id': id } : {}), ...(tag ? { 'If-None-Match': tag } : {}) },
      });
      let response = await send(workspaceId, silent ? etag : null);
      if (response.status === 304) return { response, data: null };
      let data: unknown = await response.json().catch(() => null);
      // A browser may remember a workspace from another account, or an invitation that was revoked.
      // Let the server choose an allowed membership once; this never grants or changes permissions.
      if (!silent && workspaceId && response.status === 403 && object(data) && !data.code) {
        response = await send();
        data = await response.json().catch(() => null);
      }
      if (this.active !== controller) return null;
      if (response.ok && (!object(data) || !Array.isArray(data.records) || !Array.isArray(data.members) || !object(data.workspace) || typeof data.workspace.id !== 'string' || !object(data.user) || typeof data.user.id !== 'string')) {
        throw new Error(workspaceLoadError);
      }
      if (!object(data)) data = { error: workspaceLoadError };
      return { response, data: data as T & { error?: string; code?: string } };
    } catch (error) {
      if (this.active !== controller) return null;
      if (controller.signal.aborted) throw new Error(workspaceTimeoutError);
      throw error instanceof Error && !(error instanceof TypeError) ? error : new Error(workspaceLoadError);
    } finally {
      clearTimeout(timer);
      if (this.active === controller) this.active = null;
    }
  }
}

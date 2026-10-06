import { connection, connectionKey, driveCredentials, DriveError, readMeta, sealedTokens, tokenContents, writeMeta, type DriveConnection, type DriveTokens } from '@/lib/drive-store';
import { driveIdSchema, folderMime, type DriveFile } from '@/lib/client-folders';

const base = 'https://www.googleapis.com/drive/v3';
export const fileFields = 'id,name,mimeType,parents,size,modifiedTime,trashed,driveId,appProperties,capabilities(canAddChildren,canEdit,canTrash,canUntrash,canDownload),webViewLink';
export async function exchangeDriveToken(params: URLSearchParams): Promise<DriveTokens> {
  const credentials = driveCredentials();
  if (!credentials.clientId || !credentials.clientSecret) throw new DriveError('Configurez le client OAuth Google sur le serveur.', 503, 'not-configured');
  params.set('client_id', credentials.clientId); params.set('client_secret', credentials.clientSecret);
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: params, signal: AbortSignal.timeout(20_000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) throw new DriveError('Reconnectez Google Drive : l’autorisation a expiré ou a été retirée.', 401, 'reconnect');
  if (data.scope && !String(data.scope).split(' ').includes('https://www.googleapis.com/auth/drive.file')) throw new DriveError('Autorisez l’accès aux fichiers Drive pour continuer.', 403, 'scope-denied');
  return { accessToken: data.access_token, refreshToken: data.refresh_token ?? '', expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 };
}
export async function driveToken(w: string, force = false): Promise<string> {
  const row = await readMeta<DriveConnection>(w, connectionKey(w));
  if (!row) throw new DriveError('Connectez le Drive de l’agence dans les paramètres.', 409, 'not-connected');
  const old = tokenContents(row.data, w);
  if (!force && old.expiresAt > Date.now() + 60_000) return old.accessToken;
  if (!old.refreshToken) throw new DriveError('Reconnectez Google Drive pour renouveler l’accès.', 401, 'reconnect');
  const next = await exchangeDriveToken(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: old.refreshToken }));
  next.refreshToken ||= old.refreshToken;
  try { await writeMeta(w, connectionKey(w), { ...row.data, tokens: sealedTokens(next, w) }, row.revision); }
  catch (e) { if (!(e instanceof DriveError && e.code === 'conflict')) throw e; const current = await connection(w); if (!current || current.account.id !== row.data.account.id) throw new DriveError('La connexion Drive a changé. Actualisez.', 409); }
  return next.accessToken;
}
export async function googleFailure(r: Response): Promise<never> {
  const data = await r.json().catch(() => ({}));
  const reason = data.error?.errors?.[0]?.reason;
  if (r.status === 401) throw new DriveError('Reconnectez Google Drive pour continuer.', 401, 'reconnect');
  if (r.status === 404) throw new DriveError('Fichier introuvable ou non autorisé. Sélectionnez-le avec Google Picker si nécessaire.', 404, 'file-missing');
  if (r.status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') throw new DriveError('Google Drive est très demandé. Réessayez dans un instant.', 429, 'rate-limit');
  if (reason === 'storageQuotaExceeded') throw new DriveError('Le stockage Google Drive est plein.', 409, 'storage-full');
  if (r.status === 403) throw new DriveError('Google Drive refuse cette action. Vérifiez les droits du compte sur ce dossier.', 403, 'drive-permission');
  if (r.status === 409) throw new DriveError('Cette action a déjà été exécutée. Actualisez.', 409, 'already-exists');
  throw new DriveError('Google Drive ne répond pas. Réessayez.', 503, 'unavailable');
}
// All URLs are constructed here. No client-supplied URL is ever fetched with a bearer token.
export async function driveRequest(w: string, path: string, init: RequestInit = {}): Promise<Response> {
  let token = await driveToken(w);
  const read = !init.method || init.method === 'GET';
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`${base}/${path}`, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), Authorization: `Bearer ${token}` }, signal: init.signal ?? AbortSignal.timeout(20_000), cache: 'no-store' });
    if (r.status === 401 && attempt === 0) { token = await driveToken(w, true); continue; }
    if (read && [429, 500, 502, 503, 504].includes(r.status) && attempt < 2) { await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt)); continue; }
    if (!r.ok) await googleFailure(r);
    return r;
  }
  throw new DriveError('Google Drive ne répond pas. Réessayez.', 503);
}
export function checkedId(id: string) { if (!driveIdSchema.safeParse(id).success) throw new DriveError('Identifiant Drive invalide.'); return id; }
export async function getDriveFile(w: string, id: string): Promise<DriveFile> {
  return (await driveRequest(w, `files/${checkedId(id)}?supportsAllDrives=true&fields=${encodeURIComponent(fileFields)}`)).json();
}
export async function generateIds(w: string, count: number): Promise<string[]> {
  const data = await (await driveRequest(w, `files/generateIds?count=${count}&space=drive&type=files`)).json();
  if (!Array.isArray(data.ids) || data.ids.length !== count || !data.ids.every((id: unknown) => driveIdSchema.safeParse(id).success)) throw new DriveError('Identifiants Drive indisponibles.', 503);
  return data.ids;
}
export async function createFolder(w: string, id: string, parentId: string, name: string, appProperties: Record<string, string>): Promise<DriveFile> {
  try {
    return await (await driveRequest(w, `files?supportsAllDrives=true&fields=${encodeURIComponent(fileFields)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name, mimeType: folderMime, parents: [parentId], appProperties }) })).json();
  } catch (e) {
    // IDs are committed before creation. A lost response can safely be retried with the same id.
    if (!(e instanceof DriveError && e.code === 'already-exists')) throw e;
    const file = await getDriveFile(w, id);
    if (file.mimeType !== folderMime || file.trashed || !file.parents?.includes(parentId) || Object.entries(appProperties).some(([key, value]) => file.appProperties?.[key] !== value)) throw new DriveError('Le dossier a changé dans Drive. Vérifiez son emplacement.', 409);
    return file;
  }
}
export async function listDriveFiles(w: string, parent: DriveFile, pageToken?: string, trashed = false): Promise<{ files: DriveFile[]; nextPageToken?: string }> {
  const query = new URLSearchParams({ q: `'${checkedId(parent.id)}' in parents and trashed=${trashed}`, fields: `nextPageToken,files(${fileFields})`, pageSize: '100', orderBy: 'folder,name', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', spaces: 'drive' });
  if (parent.driveId) { query.set('corpora', 'drive'); query.set('driveId', parent.driveId); }
  if (pageToken) { if (pageToken.length > 2000) throw new DriveError('Page invalide.'); query.set('pageToken', pageToken); }
  return (await driveRequest(w, `files?${query}`)).json();
}
/** Enforce the client boundary using actual Drive parents, including files moved outside the app. */
export async function insideClientRoot(w: string, rootId: string, fileId: string, allowTrash = false): Promise<DriveFile> {
  const file = await getDriveFile(w, fileId); let ancestor = file;
  const seen = new Set<string>();
  for (let depth = 0; depth < 40; depth++) {
    if (ancestor.trashed && !allowTrash) throw new DriveError('Ce dossier est dans la corbeille.', 409, 'trashed');
    if (ancestor.id === rootId) return file;
    if (!ancestor.parents?.[0] || seen.has(ancestor.id)) break;
    seen.add(ancestor.id); ancestor = await getDriveFile(w, ancestor.parents[0]);
  }
  throw new DriveError('Ce fichier n’appartient pas à ce client.', 403, 'outside-client');
}
export async function updateDriveFile(w: string, id: string, body: Record<string, unknown>, params?: Record<string, string>): Promise<DriveFile> {
  const q = new URLSearchParams({ supportsAllDrives: 'true', fields: fileFields, ...params });
  return (await driveRequest(w, `files/${checkedId(id)}?${q}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
}

import { driveAccess } from '@/lib/drive-access';
import { database } from '@/lib/database';
import { connectionKey, DriveError, readMeta, sealedTokens, tokenContents, writeMeta, type DriveConnection } from '@/lib/drive-store';
import { driveCallback, driveReturn, oauthCookie, readDriveState, readOAuthCookie } from '@/lib/drive-oauth';
import { exchangeDriveToken } from '@/lib/drive-google';
import { planRefusal } from '@/lib/subscription';

export async function GET(req: Request) {
  let clientId: string | undefined;
  try {
    const q = new URL(req.url).searchParams; const state = q.get('state') ?? '';
    const cookie = JSON.parse(readOAuthCookie(req) || '{}');
    if (cookie.state !== state || !cookie.verifier) throw new DriveError('Connexion Google invalide. Recommencez.', 400);
    const data = readDriveState(state); clientId = data.c;
    const a = await driveAccess(req, data.w, true);
    if (a.user.userId !== data.u) throw new DriveError('Reconnectez-vous avec le compte qui a lancé la connexion.', 403);
    const refusal = await planRefusal(a.workspaceId); if (refusal) throw new DriveError(refusal.error, refusal.status);
    const consumed = await database().query("DELETE FROM records WHERE id=$1 AND workspace_id=$2 AND kind='meta' AND (data->>'expires')::bigint>$3 RETURNING id", [`drive-oauth:${data.n}`, a.workspaceId, Date.now()]);
    if (!consumed.length) throw new DriveError('Cette connexion a déjà été utilisée ou a expiré.', 400);
    if (q.get('error') || !q.get('code')) throw new DriveError('L’accès Google Drive a été refusé. Vous pouvez reconnecter le compte.', 400);
    const tokens = await exchangeDriveToken(new URLSearchParams({ grant_type: 'authorization_code', code: q.get('code')!, redirect_uri: driveCallback(req), code_verifier: cookie.verifier }));
    const about = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(permissionId,displayName,emailAddress)', { headers: { Authorization: `Bearer ${tokens.accessToken}` }, signal: AbortSignal.timeout(20_000) });
    if (!about.ok) throw new DriveError('Google n’a pas autorisé l’accès à Drive.', 403);
    const profile = (await about.json()).user;
    if (!profile?.permissionId) throw new DriveError('Compte Drive introuvable.', 400);
    const old = await readMeta<DriveConnection>(a.workspaceId, connectionKey(a.workspaceId));
    const same = old?.data.account.id === profile.permissionId;
    if (same) tokens.refreshToken ||= tokenContents(old!.data).refreshToken;
    if (!tokens.refreshToken) throw new DriveError('Google n’a pas fourni l’accès permanent. Reconnectez le compte.', 400);
    await writeMeta(a.workspaceId, connectionKey(a.workspaceId), { account: { id: profile.permissionId, name: profile.displayName || '', email: profile.emailAddress || '' }, connectedAt: new Date().toISOString(), tokens: sealedTokens(tokens), ...(same && old?.data.root ? { root: old.data.root } : {}) }, old?.revision ?? 0);
    return finish(req, { driveConnected: '1' }, clientId);
  } catch (e) {
    return finish(req, { driveError: e instanceof DriveError ? e.message : 'La connexion Google Drive a échoué. Réessayez.' }, clientId);
  }
}
function finish(req: Request, params: Record<string, string>, clientId?: string) {
  return new Response(null, { status: 303, headers: { Location: driveReturn(req, params, clientId), 'Set-Cookie': oauthCookie('', req, true), 'Cache-Control': 'no-store' } });
}

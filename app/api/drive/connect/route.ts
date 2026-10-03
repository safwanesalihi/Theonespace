import { driveAccess, driveClient, driveFailure } from '@/lib/drive-access';
import { driveConfigured, DriveError, writeMeta } from '@/lib/drive-store';
import { challenge, driveCallback, driveScope, newDriveState, oauthCookie, verifier } from '@/lib/drive-oauth';
import { env } from '@/lib/env';
import { planRefusal } from '@/lib/subscription';
import { database } from '@/lib/database';

export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const a = await driveAccess(req, q.get('workspaceId'), true);
    const refusal = await planRefusal(a.workspaceId); if (refusal) throw new DriveError(refusal.error, refusal.status);
    if (!driveConfigured()) throw new DriveError('Configurez GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET et AUTH_SECRET sur le serveur.', 503, 'not-configured');
    const clientId = q.get('clientId') ?? undefined;
    if (clientId) await driveClient(a.workspaceId, clientId);
    const { state, value } = newDriveState(a.workspaceId, a.user.userId, clientId); const v = verifier();
    await database().query("DELETE FROM records WHERE workspace_id=$1 AND kind='meta' AND id LIKE 'drive-oauth:%' AND (data->>'expires')::bigint<$2", [a.workspaceId, Date.now()]);
    await writeMeta(a.workspaceId, `drive-oauth:${value.n}`, { expires: value.e }, 0);
    const params = new URLSearchParams({ client_id: env.GOOGLE_DRIVE_CLIENT_ID!, redirect_uri: driveCallback(req), response_type: 'code', scope: driveScope, state, access_type: 'offline', prompt: 'consent', code_challenge: challenge(v), code_challenge_method: 'S256' });
    return new Response(null, { status: 303, headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, 'Set-Cookie': oauthCookie(JSON.stringify({ state, verifier: v }), req), 'Cache-Control': 'no-store' } });
  } catch (e) { return driveFailure(e); }
}

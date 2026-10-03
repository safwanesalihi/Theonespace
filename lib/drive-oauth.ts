import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';
import { DriveError } from '@/lib/drive-store';
import { appOrigin } from '@/lib/social-access';

export const driveScope = 'https://www.googleapis.com/auth/drive.file';
export const driveCookie = 'the-one.drive-login';
export const driveCallback = (req: Request) => `${appOrigin(req)}/api/drive/callback`;
export type DriveState = { n: string; w: string; u: string; e: number; c?: string };
export function newDriveState(w: string, u: string, c?: string) {
  const value: DriveState = { n: randomBytes(18).toString('base64url'), w, u, e: Date.now() + 10 * 60_000, ...(c ? { c } : {}) };
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return { value, state: `${payload}.${createHmac('sha256', env.AUTH_SECRET!).update(`google-drive:${payload}`).digest('base64url')}` };
}
export function readDriveState(state: string): DriveState {
  try {
    if (state.length > 2000) throw new Error();
    const [payload, signature, extra] = state.split('.');
    const expected = createHmac('sha256', env.AUTH_SECRET!).update(`google-drive:${payload}`).digest();
    const given = Buffer.from(signature, 'base64url');
    if (extra || expected.length !== given.length || !timingSafeEqual(expected, given)) throw new Error();
    const data: DriveState = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.n || !data.w || !data.u || data.e < Date.now()) throw new Error();
    return data;
  } catch { throw new DriveError('La connexion Google a expiré. Recommencez depuis les paramètres.', 400, 'state-invalid'); }
}
export const verifier = () => randomBytes(32).toString('base64url');
export const challenge = (v: string) => createHash('sha256').update(v).digest('base64url');
export function oauthCookie(value: string, req: Request, clear = false) {
  return `${driveCookie}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/api/drive; Max-Age=${clear ? 0 : 600}${appOrigin(req).startsWith('https:') ? '; Secure' : ''}`;
}
export function readOAuthCookie(req: Request): string {
  try { return decodeURIComponent(req.headers.get('cookie')?.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${driveCookie}=`))?.slice(driveCookie.length + 1) ?? ''); } catch { return ''; }
}
export function driveReturn(req: Request, params: Record<string, string>, clientId?: string) {
  return `${appOrigin(req)}/?${new URLSearchParams(params)}#${clientId ? `client/${encodeURIComponent(clientId)}/files` : 'home'}`;
}

// Responses and typed failures of /api/records. Every answer is uncached and carries the server's clock
// (X-Server-Time), which the browser uses to correct its own (lib/app-clock.ts).
import { createHash } from 'node:crypto';
import { env } from '@/lib/env';

/** A refusal raised inside a transaction (quota, concurrent change): answered with its message and status. */
export class CommercialError extends Error { constructor(message: string, readonly status = 409) { super(message); } }
/** The signed-in person asked for a workspace they are not (or no longer) a member of. */
export class WorkspaceAccessError extends Error {}
/** The signed-in person belongs to no workspace and is not the studio's owner. */
export class NoWorkspaceError extends Error {}

export const response = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Server-Time': new Date().toISOString() } });

/** A JSON answer with a weak ETag: when the browser already holds exactly this body, a 304 with none. */
export function conditionalResponse(req: Request, data: unknown) {
  const text = JSON.stringify(data);
  const etag = `W/"${createHash('sha1').update(text).digest('base64url')}"`;
  const headers = { 'Cache-Control': 'no-store', ETag: etag, 'X-Server-Time': new Date().toISOString() };
  return req.headers.get('if-none-match') === etag
    ? new Response(null, { status: 304, headers })
    : new Response(text, { headers: { ...headers, 'Content-Type': 'application/json' } });
}

/** The sign-in page (AUTH_URL, else this request's origin): e-mails and WhatsApp link there, since the
 *  site's home is the public landing page for anyone signed out. */
export const signInUrl = (req: Request) => `${(env.AUTH_URL ?? new URL(req.url).origin).replace(/\/$/, '')}/login`;

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

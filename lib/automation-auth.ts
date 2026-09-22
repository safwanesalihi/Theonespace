// Shared-secret check for machine callers (Vercel Cron, n8n). Constant-time compare so the token
// can't be guessed byte by byte from response timing; a missing or short secret disables the route.
export function bearerMatches(req: Request, secret: string | undefined): boolean {
  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!secret || secret.length < 32 || provided.length !== secret.length) return false;
  const a = new TextEncoder().encode(provided), b = new TextEncoder().encode(secret);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

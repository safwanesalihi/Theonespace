// The finance dashboard's HTML, for the owner only (see lib/finance-dashboard.ts). Anyone else gets the
// site's ordinary 404, exactly as for an address that doesn't exist: the route never admits it's here.
// GET serves the file to the page's iframe; PUT replaces it with a new export.
import { notFound } from 'next/navigation';
import { sameOrigin } from '@/lib/auth-settings';
import { financeLimits, financeOwner, readDashboard, saveDashboard } from '@/lib/finance-dashboard';

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });

export async function GET(req: Request) {
  const user = await financeOwner(req);
  if (!user) notFound();
  const file = await readDashboard(user);
  if (!file) notFound();
  return new Response(file.html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      // Even opened on its own in a tab, the export runs sandboxed: its scripts get an opaque origin,
      // so they can't act on this app with the owner's session, and it can load or send nothing.
      'Content-Security-Policy':
        "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-ancestors 'self'",
    },
  });
}

export async function PUT(req: Request) {
  const user = await financeOwner(req);
  if (!user) notFound();
  if (!sameOrigin(req)) return json({ error: 'Origine non autorisée.' }, 403);
  if (!req.headers.get('content-type')?.includes('text/html')) return json({ error: 'Choisissez le fichier HTML exporté.' }, 415);
  if (Number(req.headers.get('content-length') || 0) > financeLimits.bytes) return json({ error: 'Fichier trop lourd (2 Mo au plus).' }, 413);
  const html = await req.text();
  if (new TextEncoder().encode(html).length > financeLimits.bytes) return json({ error: 'Fichier trop lourd (2 Mo au plus).' }, 413);
  if (!/<html[\s>]/i.test(html)) return json({ error: 'Ce fichier n’est pas une page HTML.' }, 400);
  let name = 'dashboard.html';
  try { name = decodeURIComponent(req.headers.get('x-file-name') || name); } catch { /* keep the default */ }
  name = name.replace(/[^\p{L}\p{N} ._()-]/gu, '').slice(0, 120) || 'dashboard.html';
  const saved = await saveDashboard(user, { html, name });
  return 'error' in saved ? json(saved, 409) : json(saved);
}

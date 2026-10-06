// Serves a post's photo from the app's own domain, for TikTok (lib/social-file.ts).
import { fileTarget } from '@/lib/social-file';
import { fetchMediaSource } from '@/lib/media-source';

export const dynamic = 'force-dynamic';

// Only what a post can carry. Anything else the upstream claims is refused rather than reflected.
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'image/heic', 'image/avif', 'application/octet-stream']);

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const target = fileTarget((await params).token);
  if (!target) return new Response('Not Found', { status: 404 });
  // Only ever the post's own media (Drive or the app's storage), redirects checked too.
  const upstream = await fetchMediaSource(target, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
  if (!upstream?.ok || !upstream.body) return new Response('Not Found', { status: 404 });
  const type = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!allowedTypes.has(type)) { void upstream.body.cancel().catch(() => {}); return new Response('Unsupported Media Type', { status: 415 }); }
  return new Response(upstream.body, {
    headers: {
      'Content-Type': type, 'Cache-Control': 'private, max-age=3600', 'X-Robots-Tag': 'noindex',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox',
      ...(upstream.headers.get('content-length') ? { 'Content-Length': upstream.headers.get('content-length')! } : {}),
    },
  });
}

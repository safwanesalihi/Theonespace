// Serves a post's photo from the app's own domain, for TikTok (lib/social-file.ts).
import { fileTarget } from '@/lib/social-file';
import { fetchMediaSource } from '@/lib/media-source';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const target = fileTarget((await params).token);
  if (!target) return new Response('Not Found', { status: 404 });
  // Only ever the post's own media (Drive or the app's storage), redirects checked too.
  const upstream = await fetchMediaSource(target, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
  const type = upstream?.headers.get('content-type') || '';
  if (!upstream?.ok || !upstream.body || type.startsWith('text/html')) return new Response('Not Found', { status: 404 });
  return new Response(upstream.body, {
    headers: {
      'Content-Type': type, 'Cache-Control': 'private, max-age=3600', 'X-Robots-Tag': 'noindex',
      ...(upstream.headers.get('content-length') ? { 'Content-Length': upstream.headers.get('content-length')! } : {}),
    },
  });
}

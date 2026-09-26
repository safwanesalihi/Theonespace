// Instagram's pictures (profile photos, post thumbnails) through the app: Instagram refuses to show
// them on other sites. Only its own image hosts, only for those who may use the IG Analyzer.
import { igAccess } from '@/lib/ig-analyzer/access';
import { isInstagramImage } from '@/lib/ig-analyzer/scraper';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const access = await igAccess(req);
  if ('error' in access) return new Response(access.error, { status: access.status });
  const url = new URL(req.url).searchParams.get('u') ?? '';
  if (!isInstagramImage(url)) return new Response('Not found', { status: 404 });
  const upstream = await fetch(url, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  const type = upstream?.headers.get('content-type') ?? '';
  if (!upstream?.ok || !type.startsWith('image/')) return new Response('Not found', { status: 404 });
  const bytes = await upstream.arrayBuffer();
  if (bytes.byteLength > 5_000_000) return new Response('Too large', { status: 413 });
  return new Response(bytes, { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
}

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
  // Redirects are followed by hand, each hop re-checked against Instagram's image hosts.
  let upstream: Response | null = null;
  let target = url;
  for (let hop = 0; hop <= 3; hop++) {
    upstream = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(10_000) }).catch(() => null);
    const next = upstream && upstream.status >= 300 && upstream.status < 400 ? upstream.headers.get('location') : null;
    if (!next) break;
    await upstream!.body?.cancel().catch(() => {});
    target = new URL(next, target).toString();
    upstream = null;
    if (!isInstagramImage(target)) break;
  }
  const type = upstream?.headers.get('content-type') ?? '';
  if (!upstream?.ok || !type.startsWith('image/') || !upstream.body) return new Response('Not found', { status: 404 });
  // The 5 MB cap is enforced while reading, not after the whole body is in memory.
  const reader = upstream.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
    if (done || !value) break;
    total += value.byteLength;
    if (total > 5_000_000) { await reader.cancel().catch(() => {}); return new Response('Too large', { status: 413 }); }
    parts.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return new Response(bytes, { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
}

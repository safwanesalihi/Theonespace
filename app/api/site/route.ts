// The public site's key information (lib/site-content.ts), for the landing: public, read-only, cached a
// minute at the edge. Edited on Plateforme → Site (POST /api/platform, action « site-save »).
import { siteContent } from '@/lib/site-content-server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { content, updatedAt } = await siteContent();
  return Response.json({ content, updatedAt }, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } });
}

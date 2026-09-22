import { env } from '@/lib/env';
import { bearerMatches } from '@/lib/automation-auth';
import { sweepAllWorkspaces } from '@/lib/flow-server';

export const dynamic = 'force-dynamic';

// Cron entry point. Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically
// (vercel.json → crons); any external scheduler can do the same.
async function run(req: Request) {
  const secret = env.CRON_SECRET;
  if (!bearerMatches(req, secret)) {
    return Response.json({ error: 'Balayage non autorisé.' }, { status: secret && secret.length >= 32 ? 401 : 503, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const result = await sweepAllWorkspaces();
    return Response.json({ ok: true, ...result, at: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('flow sweep', error);
    return Response.json({ error: 'Balayage impossible.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
export const GET = run;
export const POST = run;

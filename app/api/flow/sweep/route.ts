import { env } from '@/lib/env';
import { bearerMatches } from '@/lib/automation-auth';
import { database } from '@/lib/database';
import { repairJsonRows } from '@/lib/json-repair';
import { pruneErrors, reportError } from '@/lib/error-report';
import { sweepAllWorkspaces } from '@/lib/flow-server';
import { purgeAllExpired } from '@/lib/ig-analyzer/store';

export const dynamic = 'force-dynamic';

// Cron entry point. Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically
// (vercel.json → crons); any external scheduler can do the same.
async function run(req: Request) {
  const secret = env.CRON_SECRET;
  if (!bearerMatches(req, secret)) {
    return Response.json({ error: 'Balayage non autorisé.' }, { status: secret && secret.length >= 32 ? 401 : 503, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    // Rows stored as JSON text by the old serializer (lib/database.ts): finds nothing once repaired.
    await repairJsonRows(database()).catch((error: Error) => console.error('repair json rows', error.message));
    const result = await sweepAllWorkspaces();
    // Failures not seen for 30 days leave the Plateforme page (lib/error-report.ts).
    await pruneErrors().catch(() => {});
    // Instagram analyses nobody exported within two days are deleted (lib/ig-analyzer/store.ts).
    const ig = await purgeAllExpired().catch((error) => { console.error('ig purge', error); return { removed: 0 }; });
    return Response.json({ ok: true, ...result, igRemoved: ig.removed, at: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    await reportError('daily-sweep', error);
    return Response.json({ error: 'Balayage impossible.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
export const GET = run;
export const POST = run;

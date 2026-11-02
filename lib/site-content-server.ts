// The public site's key information on the server (lib/site-content.ts): one row in `site_content`,
// created on first use. Read by GET /api/site and by the landing; saved from Plateforme → Site.
import { lockTable } from '@/lib/lock-table';
import { database, type Db } from '@/lib/database';
import { readSiteContent, type SiteContent, type SiteContentState } from '@/lib/site-content';

let ready: Promise<void> | null = null;
function ensureTable(db: Db) {
  ready ??= (async () => {
    await db.query('CREATE TABLE IF NOT EXISTS site_content (key text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), updated_by text)');
    await lockTable(db, 'site_content');
  })().catch((error) => { ready = null; throw error; });
  return ready;
}

export async function siteContent(db: Db = database()): Promise<SiteContentState> {
  await ensureTable(db);
  const row = (await db.query<{ data: unknown; updated_at: Date | string; updated_by: string | null }>("SELECT data, updated_at, updated_by FROM site_content WHERE key = 'landing'"))[0];
  return {
    content: readSiteContent(row ? (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) : null),
    updatedAt: row ? new Date(row.updated_at).toISOString() : null,
    updatedBy: row?.updated_by ?? null,
  };
}

/** Saves an already validated content (siteContentSchema). */
export async function saveSiteContent(content: SiteContent, by: string, db: Db = database()): Promise<SiteContentState> {
  await ensureTable(db);
  await db.query(
    `INSERT INTO site_content (key, data, updated_at, updated_by) VALUES ('landing', $1::jsonb, now(), $2)
     ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(content), by],
  );
  return siteContent(db);
}

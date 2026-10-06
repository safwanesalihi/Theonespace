// Tables this app creates for itself at first use (outside the migrations) must be closed to Supabase's
// public API roles like every other table: row-level security on, no grants for anon/authenticated.
// `table` is always a fixed name from the caller, never user input.
type Queryable = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

export async function lockTable(db: Queryable, table: string) {
  await db.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
  await db.query(
    `DO $$ BEGIN
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
         REVOKE ALL ON TABLE ${table} FROM anon, authenticated;
       END IF;
     END $$`,
  );
}

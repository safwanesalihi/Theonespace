// The hosted demo's build step (vercel.json buildCommand, release/demo only): before `next build`, brings the
// demo's own database up to date (drizzle migrations) and, the first time only, loads the two demo
// agencies (scripts/seed-demo.mjs --remote, which refuses any database holding other workspaces). Runs
// on Vercel with the project's own variables, so no secret ever leaves it; prints no connection string.
import { execFileSync } from 'node:child_process';

const url = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING;
if (!url) throw new Error('demo-prepare: no direct database URL (DATABASE_URL_UNPOOLED) in this build.');
const run = (cmd, args, env = {}) => execFileSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });

console.log('demo-prepare: migrations');
run('npx', ['drizzle-kit', 'migrate'], { DIRECT_URL: url });

const { default: postgres } = await import('postgres');
const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 15 });
const [{ n }] = await sql`SELECT count(*)::int AS n FROM workspaces WHERE id = 'ws:org:demo-atelier-nour'`;
await sql.end();
// DEMO_RESEED=1 for one build (`vercel deploy --build-env DEMO_RESEED=1`) reloads them from the current seed.
if (n && process.env.DEMO_RESEED !== '1') console.log('demo-prepare: demo agencies already there, kept as they are');
else {
  console.log('demo-prepare: loading the demo agencies');
  run('node', ['scripts/seed-demo.mjs', '--remote'], { DEMO_DATABASE_URL: url });
}

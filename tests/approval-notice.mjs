// The owner's e-mail when a task is approved: sent for client, studio and tacit approvals, never when the
// owner approves it themselves, never without e-mail set up. nodemailer is replaced by a recorder.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';
const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime', { recursive: true });
const sent = [];
const mailRecorder = { name: 'mail-recorder', setup(build) {
  build.onResolve({ filter: /^nodemailer$/ }, () => ({ path: 'nodemailer', namespace: 'recorder' }));
  build.onLoad({ filter: /.*/, namespace: 'recorder' }, () => ({ loader: 'js', contents: 'export default { createTransport: () => ({ sendMail: async (m) => { (globalThis.sentMail ??= []).push(m); } }) };' }));
} };
await esbuild.build({ entryPoints: { notice: 'lib/approval-notice.ts', flow: 'lib/flow-server.ts' }, outdir: '.sites-runtime/approval', bundle: true, platform: 'node', format: 'esm', plugins: [mailRecorder, testRuntimePlugin({ auth: false })] });
const { db, pg } = await createTestDb();
const testEnv = { AUTH_URL: 'https://tracker.test' };
globalThis.testDb = db; globalThis.sentMail = sent; globalThis.testEnv = testEnv;
const { notifyOwnerOfApproval } = await import(pathToFileURL(`${process.cwd()}/.sites-runtime/approval/notice.js`));
const { applySweep } = await import(pathToFileURL(`${process.cwd()}/.sites-runtime/approval/flow.js`));
let checks = 0; const ok = (v, m) => { assert.ok(v, m); checks++; };
const WS = 'ws:owner';
await pg.query("INSERT INTO users (id, name, email, password_hash) VALUES ('owner', 'Studio Owner', 'owner@studio.test', 'test-only'), ('adm', 'Admin', 'admin@studio.test', 'test-only')");
await pg.query("INSERT INTO workspaces (id, name, created_by) VALUES ($1, 'Studio <Test>', 'owner')", [WS]);
await pg.query("INSERT INTO workspace_members (workspace_id, user_id, role, name, email) VALUES ($1,'owner','owner','Studio Owner','owner@studio.test'), ($1,'adm','admin','Admin','admin@studio.test')", [WS]);
const task = (signOff, extra = {}) => ({ id: 't1', kind: 'task', revision: 1, name: 'Reel ramadan', clientId: 'c1', status: 'Validé', createdAt: new Date().toISOString(), signOff, ...extra });
const at = new Date().toISOString();

// Not configured: silent.
await notifyOwnerOfApproval(WS, task({ mode: 'explicit', by: 'Sara', at, round: 0 }), 'https://tracker.test', 'Client Un');
ok(sent.length === 0, 'no e-mail without GMAIL settings');

Object.assign(testEnv, { GMAIL_USER: 'sender@gmail.test', GMAIL_APP_PASSWORD: 'x' });
await notifyOwnerOfApproval(WS, task({ mode: 'explicit', by: 'Sara', email: 'sara@client.test', at, round: 0 }), 'https://tracker.test', 'Client Un');
ok(sent.length === 1 && sent[0].to === 'owner@studio.test', 'the client’s approval is mailed to the owner');
ok(sent[0].subject.includes('Reel ramadan') && sent[0].text.includes('validé par Sara') && sent[0].text.includes('https://tracker.test/#task/t1'), 'subject, who and a link to the task');
ok(sent[0].from.address === 'sender@gmail.test' && sent[0].from.name === 'Studio Test', 'sent from the studio’s name, sanitized');

await notifyOwnerOfApproval(WS, task({ mode: 'studio', by: 'Admin', email: 'admin@studio.test', at, round: 0 }), 'https://tracker.test');
ok(sent.length === 2 && sent[1].text.includes('depuis le studio par Admin'), 'a studio approval by an admin is mailed too');

await notifyOwnerOfApproval(WS, task({ mode: 'studio', by: 'Studio Owner', email: 'OWNER@studio.test', at, round: 0 }), 'https://tracker.test');
ok(sent.length === 2, 'the owner approving it themselves is not mailed to themselves');

await notifyOwnerOfApproval(WS, task({ mode: 'silence', by: 'Validation tacite', at, round: 0 }), 'https://tracker.test');
ok(sent.length === 3 && sent[2].text.includes('tacitement'), 'a tacit approval is mailed');

await notifyOwnerOfApproval(WS, { ...task({ mode: 'explicit', by: 'Sara', at, round: 0 }), status: 'À valider' }, 'https://tracker.test');
ok(sent.length === 3, 'only an approved task triggers it');

// The scheduled sweep: a deadline that passed approves the task and mails the owner.
const past = new Date(Date.now() - 3 * 3600_000).toISOString();
const pending = { id: 't2', kind: 'task', revision: 1, name: 'Affiche', clientId: 'c1', status: 'À valider', createdAt: past, sentAt: new Date(Date.now() - 60 * 3600_000).toISOString(), approvalDueAt: past, due: '2099-01-01' };
await pg.query("INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ('t2','owner',$1,'task',$2::jsonb,1)", [WS, JSON.stringify(pending)]);
await pg.query("INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ('c1','owner',$1,'client',$2::jsonb,1)", [WS, JSON.stringify({ id: 'c1', kind: 'client', revision: 1, name: 'Client Un', createdAt: past })]);
globalThis.testAfter = [];
await applySweep(WS);
for (const callback of globalThis.testAfter.splice(0)) await callback();
const row = (await pg.query("SELECT data FROM records WHERE id = 't2'")).rows[0].data;
ok(row.status === 'Validé' && row.signOff.mode === 'silence', 'the sweep approved the late task');
ok(sent.length === 4 && sent[3].text.includes('Affiche') && sent[3].text.includes('Client Un'), 'and the owner was told, with the client’s name');
await applySweep(WS);
for (const callback of globalThis.testAfter.splice(0)) await callback();
ok(sent.length === 4, 'a second sweep does not mail again');
console.log(`${checks} approval notice checks passed: client, studio and tacit approvals, owner self-approval, no mail setup, sweep, no repeats.`);
await pg.close();

import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';
const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: ['app/api/records/route.ts'], outfile: '.sites-runtime/mentions-api.mjs', bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })] });
const { db, pg } = await createTestDb();
globalThis.testDb = db; globalThis.testEnv = { OWNER_EMAIL: 'owner@studio.test' };
const { GET, POST } = await import(pathToFileURL(`${process.cwd()}/.sites-runtime/mentions-api.mjs`));
const owner = { userId: 'owner', fullName: 'Studio Owner', displayName: 'Studio Owner', email: 'owner@studio.test' };
const WS = 'ws:owner';
const as = user => { globalThis.testUser = user; };
async function call(body, status = 200, query = '', workspaceId = WS) {
  const req = new Request(`https://tracker.test/api/records${query}`, { method: body ? 'POST' : 'GET', headers: { origin: 'https://tracker.test', 'Content-Type': 'application/json', ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const res = await (body ? POST(req) : GET(req)); const data = await res.json(); assert.equal(res.status, status, JSON.stringify(data)); return data;
}
const people = id => call(null, 200, `?chatTaskId=${id}`);
try {
  as(owner); await call(null, 200, '', null);
  const c1 = (await call({ action: 'create', kind: 'client', data: { name: 'First client' } })).id;
  const c2 = (await call({ action: 'create', kind: 'client', data: { name: 'Second client' } })).id;
  async function member(id, role, name, clientId = null) {
    await pg.query("INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, 'test-only')", [id, name, `${id}@people.test`]);
    await pg.query('INSERT INTO workspace_members (workspace_id, user_id, role, name, email, client_id) VALUES ($1,$2,$3,$4,$5,$6)', [WS, id, role, name, `${id}@people.test`, clientId]);
    return { userId: id, fullName: name, displayName: name, email: `${id}@people.test` };
  }
  const admin = await member('admin', 'admin', 'Studio Admin');
  const assignee = await member('assigned', 'creative', 'Assigned Designer');
  const other = await member('other', 'creative', 'Other Designer');
  const client = await member('contact', 'client', 'Client Contact', c1);
  const colleague = await member('contact2', 'client', 'Another Contact', c1);
  const outsider = await member('outsider', 'client', 'Other Client', c2);
  const task = (await call({ action: 'create', kind: 'task', data: { name: 'Task discussion', clientId: c1, assignee: 'Assigned Designer', assigneeId: 'assigned', status: 'À faire', due: '2026-12-25' } })).id;
  const otherTask = (await call({ action: 'create', kind: 'task', data: { name: 'Other task', clientId: c2, assignee: 'Other Designer', assigneeId: 'other', status: 'À faire', due: '2026-12-25' } })).id;
  const idea = { id: 'shared-idea', kind: 'plan_item', name: 'Shared plan discussion', clientId: c1, planId: 'plan-one', planShared: true, assignee: 'Assigned Designer', assigneeId: 'assigned', createdAt: new Date().toISOString() };
  await pg.query('INSERT INTO records(id,owner,workspace_id,kind,data,revision) VALUES($1,$2,$3,$4,$5,1)', [idea.id,owner.email,WS,idea.kind,JSON.stringify(idea)]);
  const expected = ['owner','admin','assigned','contact','contact2'].sort();
  for (const user of [owner, admin, assignee, client]) {
    as(user); const data = await people(task);
    assert.deepEqual(data.people.map(p => p.userId).sort(), expected);
    assert.ok(data.people.every(p => Object.keys(p).sort().join() === 'name,role,userId'));
  }
  for (const user of [owner, admin, assignee, client]) {
    as(user); assert.deepEqual((await people(idea.id)).people.map(p => p.userId).sort(), expected, 'shared idea conversations remain accessible to the assigned participant');
    assert.ok((await call()).records.some(r => r.id === idea.id));
  }
  as(assignee);
  const ideaComment = (await call({ action: 'comment', taskId: idea.id, text: '@Studio Owner, this idea is ready.', mentions: [{ userId: 'owner', start: 0, end: 13 }] })).records.find(r => r.kind === 'comment' && r.taskId === idea.id);
  assert.ok(ideaComment?.mentions.some(m => m.userId === 'owner'));
  as(owner); assert.ok((await call()).records.some(r => r.taskId === idea.id && r.recipients?.includes('owner')));
  as(other); await call(null, 404, `?chatTaskId=${idea.id}`); await call({ action: 'comment', taskId: idea.id, text: 'Unrelated participant' }, 404);
  // A stable assignee ID still controls access when the legacy display name is blank.
  await pg.query("UPDATE records SET data=jsonb_set(data,'{assignee}','\"\"'::jsonb) WHERE id=$1", [idea.id]);
  await call(null, 404, `?chatTaskId=${idea.id}`); await call({ action: 'comment', taskId: idea.id, text: 'Blank name cannot bypass assignment' }, 404);
  as(assignee); await people(idea.id);
  const unassigned = { ...idea, id: 'unassigned-idea', assignee: '', assigneeId: undefined };
  await pg.query('INSERT INTO records(id,owner,workspace_id,kind,data,revision) VALUES($1,$2,$3,$4,$5,1)', [unassigned.id,owner.email,WS,unassigned.kind,JSON.stringify(unassigned)]);
  await call(null, 404, `?chatTaskId=${unassigned.id}`); await call({ action: 'comment', taskId: unassigned.id, text: 'Unassigned studio idea' }, 404);
  as(owner); await people(unassigned.id);
  as(client);
  await pg.query("UPDATE records SET data=jsonb_set(data,'{planShared}','false'::jsonb) WHERE id=$1", [idea.id]);
  await call(null, 404, `?chatTaskId=${idea.id}`);
  await call({ action: 'comment', taskId: idea.id, text: 'Private idea cannot be commented' }, 404);
  as(other); await call(null, 404, `?chatTaskId=${task}`);
  as(outsider); await call(null, 404, `?chatTaskId=${task}`);
  as(client); await call(null, 404, `?chatTaskId=${otherTask}`);
  await call(null, 403, `?chatTaskId=${task}`, 'ws:missing');
  assert.deepEqual((await call()).members, [], 'client payload still contains no workspace directory');
  const p = (await people(task)).people;
  const tagged = [p.find(p => p.userId === 'admin'), p.find(p => p.userId === 'assigned'), p.find(p => p.userId === 'contact2')];
  let text = 'Please review ', spans = [];
  for (const person of tagged) { const token = `@${person.name}`; spans.push({ userId: person.userId, start: text.length, end: text.length + token.length }); text += token + ' '; }
  text = text.trim();
  const result = await call({ action: 'comment', taskId: task, text, mentions: spans });
  const comment = result.records.find(r => r.kind === 'comment' && r.name === text);
  assert.equal(comment.mentions.length, 3);
  as(owner); const stored = await call();
  const events = stored.records.filter(r => r.id.includes(`:mention:${comment.id}:`));
  assert.deepEqual(events.flatMap(e => e.recipients).sort(), ['admin','assigned','contact2']);
  assert.ok(events.every(e => !e.read && e.readBy.length === 0));
  const clientEvent = events.find(e => e.recipients.includes('contact2'));
  assert.equal(clientEvent.audience, 'client');
  as(client); assert.ok(!(await call()).records.some(r => r.id === clientEvent.id), 'a different contact never receives a targeted alert');
  await call({ action: 'mark-read', ids: [clientEvent.id] });
  as(owner); assert.deepEqual((await call()).records.find(r => r.id === clientEvent.id).readBy, [], 'cannot mark somebody else’s client alert');
  as(colleague); assert.ok((await call()).records.some(r => r.id === clientEvent.id));
  await call({ action: 'mark-read', ids: [clientEvent.id] });
  as(owner); assert.deepEqual((await call()).records.find(r => r.id === clientEvent.id).readBy, ['contact2']);
  const count = (await call()).records.filter(r => r.id.includes(':mention:')).length;
  await call({ action: 'comment', taskId: task, text: 'Typed @Studio Admin and email@domain.test are ordinary text' });
  assert.equal((await call()).records.filter(r => r.id.includes(':mention:')).length, count);
  await call({ action: 'comment', taskId: task, text: '@Other Designer', mentions: [{ userId: 'other', start: 0, end: 15 }] }, 400);
  await call({ action: 'comment', taskId: task, text: '@Other Client', mentions: [{ userId: 'outsider', start: 0, end: 13 }] }, 400);
  await call({ action: 'comment', taskId: task, text: '@Fake Name', mentions: [{ userId: 'admin', start: 0, end: 10 }] }, 400);
  const before = (await call()).records.filter(r => r.kind === 'comment').length;
  await pg.query("UPDATE workspace_members SET role='creative' WHERE workspace_id=$1 AND user_id='admin'", [WS]);
  assert.ok(!(await people(task)).people.some(p => p.userId === 'admin'), 'fresh picker reflects role changes');
  await call({ action: 'comment', taskId: task, text: '@Studio Admin', mentions: [{ userId: 'admin', start: 0, end: 13 }] }, 400);
  assert.equal((await call()).records.filter(r => r.kind === 'comment').length, before, 'invalid mention cannot write a message or event');
  // Replies quote one earlier message of the same conversation that the sender can see.
  as(owner);
  const answer = (await call({ action: 'comment', taskId: task, text: 'Answering you', replyTo: comment.id })).records.find(r => r.kind === 'comment' && r.taskId === task && r.name === 'Answering you');
  assert.equal(answer?.replyTo, comment.id, 'a reply stores the id of the message it answers');
  const foreign = (await call({ action: 'comment', taskId: otherTask, text: 'On another task' })).records.find(r => r.kind === 'comment' && r.taskId === otherTask);
  await call({ action: 'comment', taskId: task, text: 'Quoting another conversation', replyTo: foreign.id }, 400);
  await call({ action: 'comment', taskId: task, text: 'Quoting nothing', replyTo: 'no-such-message' }, 400);
  await call({ action: 'comment', taskId: task, text: 'Quoting a number', replyTo: 12 }, 400);
  as(client);
  const clientAnswer = (await call({ action: 'comment', taskId: task, text: 'Client answers', replyTo: answer.id })).records.find(r => r.kind === 'comment' && r.name === 'Client answers');
  assert.equal(clientAnswer?.replyTo, answer.id, 'the client can answer a studio message in their conversation');
  as(owner);
  const deleted = await call({ action: 'comment-delete', id: comment.id });
  const removed = deleted.records.find(r => r.id === comment.id);
  assert.ok(removed.deletedAt && !removed.name && !removed.mentions);
  await pg.query("UPDATE records SET data=jsonb_set(data,'{archived}','true'::jsonb) WHERE id=$1", [task]);
  await call(null, 404, `?chatTaskId=${task}`);
  console.log('Task mention API checks passed: scoped picker, IDs, current roles, private recipients, read state, plain @text, erased messages and replies.');
} finally { await pg.close(); }

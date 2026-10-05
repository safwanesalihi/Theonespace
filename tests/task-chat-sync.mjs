import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';
const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: ['app/api/records/route.ts'], outfile: '.sites-runtime/chat-api.mjs', bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })] });
await esbuild.build({ stdin: { contents: "export * from './lib/task-chat-client'; export * from './lib/records-client'; export * from './lib/app-clock'; export * from './lib/time';", resolveDir: process.cwd() }, outfile: '.sites-runtime/chat-client.mjs', bundle: true, platform: 'node', format: 'esm' });
const clientCode = await import(pathToFileURL(`${process.cwd()}/.sites-runtime/chat-client.mjs`));
let checks = 0;
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const ok = (value, label) => { assert.ok(value, label); checks++; };
const { db, pg } = await createTestDb();
globalThis.testDb = db;
globalThis.testEnv = { OWNER_EMAIL: 'owner@studio.test', WHATSAPP_TOKEN: 'test-only', WHATSAPP_PHONE_NUMBER_ID: '12345', WHATSAPP_COMMENT_TEMPLATE: 'new_message', WHATSAPP_COMMENT_LANGUAGE: 'fr' };
globalThis.testAfter = [];
const { GET, POST } = await import(pathToFileURL(`${process.cwd()}/.sites-runtime/chat-api.mjs`));
const owner = { userId: 'owner', fullName: 'Owner', displayName: 'Owner', email: 'owner@studio.test' }, WS = 'ws:owner';
const as = user => { globalThis.testUser = user; };
async function call(body, status = 200, query = '', ws = WS, headers = {}) {
  const request = new Request(`https://tracker.test/api/records${query}`, { method: body ? 'POST' : 'GET', headers: { origin: 'https://tracker.test', 'Content-Type': 'application/json', ...(ws ? { 'X-Workspace-Id': ws } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const response = await (body ? POST(request) : GET(request));
  const data = response.status === 304 ? null : await response.json();
  eq(response.status, status, JSON.stringify(data));
  return { data, response };
}
const thread = (id, status = 200, headers = {}) => call(null, status, `?threadTaskId=${encodeURIComponent(id)}`, WS, headers);
const originalFetch = globalThis.fetch;
try {
  as(owner); await call(null, 200, '', null);
  const c1 = (await call({ action: 'create', kind: 'client', data: { name: 'Client one', whatsapp: '+212642353278' } })).data.id;
  const c2 = (await call({ action: 'create', kind: 'client', data: { name: 'Client two' } })).data.id;
  async function member(id, role, clientId = null) {
    const name = id;
    await pg.query("INSERT INTO users(id,name,email,password_hash) VALUES ($1,$2,$3,'test-only')", [id,name,`${id}@people.test`]);
    await pg.query('INSERT INTO workspace_members(workspace_id,user_id,role,name,email,client_id) VALUES ($1,$2,$3,$4,$5,$6)', [WS,id,role,name,`${id}@people.test`,clientId]);
    return { userId:id,fullName:name,displayName:name,email:`${id}@people.test` };
  }
  const client = await member('client', 'client', c1), outsider = await member('outsider', 'client', c2);
  const assignee = await member('assignee', 'creative'), unrelated = await member('unrelated', 'creative');
  const viewer = await member('viewer', 'viewer');
  const project = (await call({ action:'create',kind:'project',data:{name:'Project',clientId:c1} })).data.id;
  const futureDay = new Date(Date.now() + 30 * 86400000).toISOString().slice(0,10);
  const task = (await call({ action:'create',kind:'task',data:{name:'Conversation',clientId:c1,projectId:project,assignee:'assignee',assigneeId:'assignee',status:'À faire',due:futureDay} })).data.id;
  const initial = await thread(task);
  eq(initial.data, { messages:[] }, 'thread sends no directory or workspace payload');
  ok(Number.isFinite(Date.parse(initial.response.headers.get('X-Server-Time'))), 'server clock is an explicit UTC instant');
  const unchanged = await thread(task,304,{'If-None-Match':initial.response.headers.get('ETag')});
  ok(unchanged.response.headers.get('X-Server-Time'), '304 still aligns the clock');
  as(client);
  const body = { action:'comment',chatOnly:true,taskId:task,text:'Please modify the image',submissionId:crypto.randomUUID() };
  const before = Date.now();
  const sent = (await call(body)).data;
  eq(Object.keys(sent), ['message'], 'acknowledge saved message without reloading workspace');
  ok(!('authorId' in sent.message), 'client receipt keeps existing identity privacy');
  ok(Date.parse(sent.message.createdAt) >= before && Date.parse(sent.message.createdAt) <= Date.now(), 'timestamp belongs to server save, not receipt or device');
  eq((await call(body)).data.message, sent.message, 'retry returns the exact original timestamp and ID');
  await call({...body,text:'Reused key with other text'},409);
  for (const user of [client,assignee,owner,viewer]) {
    as(user);
    const messages=(await thread(task)).data.messages;
    eq(messages.length,1,'both sides see one message');
    eq([messages[0].id,messages[0].createdAt],[sent.message.id,sent.message.createdAt],'both sides use the same instant');
  }
  // Receipts represent a different task participant, with server-controlled times and no identity leak.
  const receipt = (delivered = [sent.message.id], seen = [], extra = {}) => call({ action: 'chat-receipt', taskId: task, delivered, seen, ...extra });
  as(client); await receipt([sent.message.id], [sent.message.id]);
  eq((await thread(task)).data.messages[0].deliveredAt, undefined, 'reading your own message never marks it delivered');
  as(viewer); await receipt([sent.message.id], [sent.message.id]);
  eq((await thread(task)).data.messages[0].seenAt, undefined, 'unassigned viewer cannot acknowledge for task participants');
  as(owner); await receipt();
  const delivered = (await thread(task)).data.messages[0];
  ok(Number.isFinite(Date.parse(delivered.deliveredAt)), 'another browser acknowledges delivery');
  eq(delivered.seenAt, undefined, 'delivery does not mean seen');
  await receipt();
  eq((await thread(task)).data.messages[0].revision, delivered.revision, 'repeated delivery is a no-op');
  const etagBeforeSeen = (await thread(task)).response.headers.get('ETag');
  as(assignee); const readStarted = Date.now(); await receipt([], [sent.message.id], { seenAt: '2030-01-01', userId: 'client' });
  const viewed = (await thread(task, 200, { 'If-None-Match': etagBeforeSeen })).data.messages[0];
  eq(viewed.deliveredAt, delivered.deliveredAt, 'first delivery timestamp stays intact');
  ok(Date.parse(viewed.seenAt) >= readStarted && Date.parse(viewed.seenAt) <= Date.now(), 'seen time is set by the server');
  await receipt([], [sent.message.id]);
  eq((await thread(task)).data.messages[0].revision, viewed.revision, 'repeated seen receipts do not rewrite the thread');
  await call({action:'chat-receipt',taskId:task,delivered:['foreign-message'],seen:[]},404);
  await call({action:'chat-receipt',taskId:task,delivered:[sent.message.id],seen:'all'},400);
  as(outsider); await call({action:'chat-receipt',taskId:task,delivered:[sent.message.id],seen:[]},404);
  as(unrelated); await call({action:'chat-receipt',taskId:task,delivered:[sent.message.id],seen:[]},404);
  as(client);
  const privateReceipt = (await thread(task)).data.messages[0];
  eq(Object.keys(privateReceipt).filter(key => key.includes('By') || key === 'authorId'), [], 'receipt exposes no member IDs to the portal');
  as(owner);
  const noticesBefore=(await call()).data.records.filter(r=>r.type==='comment').length;
  as(client);
  const concurrent={...body,text:'Two simultaneous retries',submissionId:crypto.randomUUID()};
  const replies=await Promise.all([call(concurrent),call(concurrent)]);
  eq(replies[0].data.message.id,replies[1].data.message.id,'concurrent retries insert once');
  eq((await thread(task)).data.messages.length,2,'no duplicate after concurrent retry');
  as(owner);
  eq((await call()).data.records.filter(r=>r.type==='comment').length,noticesBefore+1,'duplicate retry does not notify twice');
  as(client);
  const NativeDate = Date, sameInstant = Date.now();
  try {
    globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [sameInstant])); } static now() { return sameInstant; } };
    await Promise.all([call({...body, text: 'Fast message A', submissionId: crypto.randomUUID()}), call({...body, text: 'Fast message B', submissionId: crypto.randomUUID()})]);
  } finally { globalThis.Date = NativeDate; }
  as(owner);
  eq((await call()).data.records.filter(r=>r.type==='comment').length,noticesBefore+3,'distinct messages sent at the same instant each notify once');
  for(const user of [outsider,unrelated]) { as(user); await thread(task,404); await call({...body,submissionId:crypto.randomUUID()},404); }
  as(viewer); await call({...body,submissionId:crypto.randomUUID()},403);
  as(client); await call(null,403,`?threadTaskId=${task}`,'ws:other');
  as(owner);
  // Slow external notifications must not hold the send receipt or the client's next chat read.
  const studioBody={...body,text:'The corrected image is ready',submissionId:crypto.randomUUID()};
  const studioSent=(await call(studioBody)).data.message;
  eq(globalThis.testAfter.length,1,'WhatsApp work runs after the response');
  let release;
  let whatsappCalls=0;
  globalThis.fetch=()=>{whatsappCalls++; return new Promise(resolve=>{release=resolve;});};
  const background=globalThis.testAfter.shift()();
  while(!release) await new Promise(resolve=>setImmediate(resolve));
  as(client);
  ok((await thread(task)).data.messages.some(m=>m.id===studioSent.id),'client sees committed message while WhatsApp is pending');
  release(Response.json({messages:[{id:'test-meta-id'}]})); await background;
  eq(whatsappCalls,1,'one notification');
  as(owner); await call(studioBody);
  eq(globalThis.testAfter.length,0,'idempotent resend does not schedule WhatsApp again');
  await call({...studioBody,text:'Another update',submissionId:crypto.randomUUID()});
  await globalThis.testAfter.shift()();
  eq(whatsappCalls,1,'two-hour WhatsApp cooldown is preserved for compact sends');
  // Legacy response shape continues working, and deletion reaches a separate conversation read.
  const legacy=(await call({action:'comment',taskId:task,text:'Legacy caller'})).data;
  ok(Array.isArray(legacy.records),'legacy save still returns workspace');
  await call({action:'comment-delete',id:sent.message.id});
  as(client);
  const removed=(await thread(task)).data.messages.find(m=>m.id===sent.message.id);
  ok(removed.deletedAt && !removed.name,'deletion synchronizes, preserving a tombstone');
  as(owner);
  const idea={id:'shared-idea',kind:'plan_item',name:'Plan item',clientId:c1,planShared:true,assigneeId:'assignee',createdAt:new Date().toISOString()};
  await pg.query('INSERT INTO records(id,owner,workspace_id,kind,data,revision) VALUES($1,$2,$3,$4,$5,1)',[idea.id,owner.userId,WS,idea.kind,JSON.stringify(idea)]);
  as(client); await thread(idea.id);
  await pg.query("UPDATE records SET data=jsonb_set(data,'{planShared}','false'::jsonb) WHERE id=$1",[idea.id]);
  await thread(idea.id,404);
  await pg.query("UPDATE records SET data=jsonb_set(data,'{archived}','true'::jsonb) WHERE id=$1",[project]);
  await thread(task,404); await call({...body,submissionId:crypto.randomUUID()},404);
  await pg.query("UPDATE records SET data=jsonb_set(data,'{archived}','false'::jsonb) WHERE id=$1",[project]);
  await pg.query("DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",[WS,client.userId]);
  await thread(task,403);
} finally {globalThis.fetch=originalFetch;await pg.close();}

// Client transport races and wall-clock correctness, independent of device settings.
const { TaskChatReader, mergeChatMessages, sendRecordMutation, formatTimestamp, syncServerClock, appNowMs }=clientCode;
const message={id:'saved',kind:'comment',revision:1,taskId:'task',name:'Message',createdAt:'2026-10-04T15:00:00Z'};
try {
  for(const zone of ['UTC','Europe/Paris','America/New_York','Asia/Tokyo']) {
    process.env.TZ=zone;
    for(const stamp of ['2026-10-04T15:00:00Z','2026-10-04T15:00:00','2026-10-04 15:00:00','2026-10-04T17:00:00+02:00']) eq(formatTimestamp(stamp,'en-GB',{hour:'2-digit',minute:'2-digit'}),'16:00','Casablanca applies its offset once, including legacy UTC stamps');
    eq(formatTimestamp('2026-02-25T15:00:00Z','en-GB',{hour:'2-digit',minute:'2-digit'}),'15:00','Ramadan UTC+0');
  }
  const deletion={...message,revision:2,name:'',deletedAt:'2026-10-04T15:02:00Z'};
  const merged=mergeChatMessages([deletion],[message,{...message,id:'new'}]);
  eq(merged.length,2,'late snapshots preserve new saves');
  eq(merged.find(m=>m.id===message.id),deletion,'late snapshots never restore deleted content');
  eq(mergeChatMessages([message],[message]).length,1,'stable IDs deduplicate snapshots');
  eq(mergeChatMessages([], [{...message,id:'later',createdAt:'2026-10-04T16:00:00Z'},{...message,id:'earlier',createdAt:'2026-10-04T17:00:00+02:00'}]).map(m=>m.id),['earlier','later'],'chronology compares instants rather than offset text');
  const deferred=[];
  globalThis.fetch=(_url,options)=>new Promise(resolve=>deferred.push({options,resolve}));
  const reader=new TaskChatReader();
  const stale=reader.read('workspace','task');
  eq(await reader.read('workspace','task'),null,'slow reads are not overlapped');
  const fresh=reader.read('workspace','task',true);
  ok(deferred[0].options.signal.aborted,'send confirmation cancels an older chat snapshot');
  deferred[1].resolve(Response.json({messages:[message]},{headers:{ETag:'new'}}));
  eq((await fresh).messages,[message],'fresh conversation wins');
  deferred[0].resolve(Response.json({messages:[]}));
  eq(await stale,null,'late cancelled conversation is discarded');
  let readHeaders;
  globalThis.fetch=async(_url,options)=>{readHeaders=options.headers; return new Response(null,{status:304});};
  eq((await reader.read('workspace','task')).status,304,'conditional read');
  eq(readHeaders['If-None-Match'],'new','thread ETag avoids duplicate payload');
  globalThis.fetch=async()=>Response.json({messages:[{...message,taskId:'another-task'}]});
  await assert.rejects(reader.read('workspace','task'));checks++;
  globalThis.fetch=async()=>Response.json({error:'Access revoked'},{status:403});
  eq((await reader.read('workspace','task')).status,403,'revoked access is visible to the UI');
  globalThis.fetch=(_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('timeout'))));
  await assert.rejects(new TaskChatReader(5).read('workspace','task'));checks++;
  const body={action:'comment',chatOnly:true,taskId:'task',text:'Message',submissionId:crypto.randomUUID()};
  const sentBodies=[];
  globalThis.fetch=async(_url,options)=>{sentBodies.push(options.body);if(sentBodies.length===1)throw new TypeError('Lost response');return Response.json({message});};
  eq((await sendRecordMutation(body,'workspace')).ok,true,'lost response retries a keyed chat send');
  eq(sentBodies,[JSON.stringify(body),JSON.stringify(body)],'retry keeps the exact submission ID');
  let calls=0;
  globalThis.fetch=async()=>{calls++;return Response.json({error:'Forbidden'},{status:403});};
  eq((await sendRecordMutation(body,'workspace')).ok,false,'refusal is not reported as sent');
  eq(calls,1,'no retry for access refusal');
  calls=0;globalThis.fetch=async()=>{calls++;return new Response('<html>Gateway page</html>');};
  eq((await sendRecordMutation(body,'workspace')).ok,false,'HTML success page is never a chat receipt');
  eq(calls,2,'one bounded retry');
} finally {globalThis.fetch=originalFetch;}
const originalPerformance=globalThis.performance, originalNow=Date.now;
try {
  let elapsed=2000;
  globalThis.performance={now:()=>elapsed};
  Date.now=()=>Date.parse('2030-01-01T00:00:00Z');
  syncServerClock(new Headers({'X-Server-Time':'2026-10-04T15:00:00.000Z'}),1000);
  eq(appNowMs(),Date.parse('2026-10-04T15:00:00Z')+500,'server time corrects a wrong device clock');
  elapsed+=2000;
  Date.now=()=>0;
  eq(appNowMs(),Date.parse('2026-10-04T15:00:00Z')+2500,'device clock changes cannot move synchronized app time');
  syncServerClock(new Headers({'X-Server-Time':'bad'}),3000);
  eq(appNowMs(),Date.parse('2026-10-04T15:00:00Z')+2500,'invalid response time cannot poison the clock');
  elapsed+=3000;
  syncServerClock(new Headers({'X-Server-Time':'2026-10-04T17:00:00.000Z'}),4000);
  eq(appNowMs(),Date.parse('2026-10-04T17:00:00Z')+1500,'wake after suspended browser clock resynchronizes immediately');
} finally {globalThis.performance=originalPerformance;Date.now=originalNow;}
console.log(`Task chat and time: ${checks} checks passed (shared timestamps, permissions, idempotent sends, deferred WhatsApp, refresh races, device clocks and Ramadan).`);

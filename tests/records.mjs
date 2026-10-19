import {strict as assert} from 'node:assert';
import {globSync,mkdirSync,readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createTestDb,testRuntimePlugin} from './helpers/pg.mjs';
const esbuildPath=globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]||'node_modules/esbuild/lib/main.js';
const esbuild=await import(pathToFileURL(esbuildPath));
mkdirSync('.sites-runtime',{recursive:true});
await esbuild.build({entryPoints:['app/api/records/route.ts'],outfile:'.sites-runtime/route-test.mjs',bundle:true,platform:'node',format:'esm',plugins:[testRuntimePlugin({auth:false})]});
const {db,pg}=await createTestDb();globalThis.testDb=db;
globalThis.testEnv={OWNER_EMAIL:'test@example.com'};
globalThis.testUser={userId:'owner-a',fullName:'Test Owner',displayName:'Test Owner',email:'test@example.com'};
const {GET,POST}=await import(pathToFileURL(process.cwd()+'/.sites-runtime/route-test.mjs'));
let assertions=0;
async function post(body,status=200,origin='https://tracker.test',workspaceId){const r=await POST(new Request('https://tracker.test/api/records',{method:'POST',headers:{'Content-Type':'application/json',origin,...(workspaceId?{'X-Workspace-Id':workspaceId}:{})},body:JSON.stringify(body)}));const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));assertions++;return d;}
async function seedMember(userId,role,workspaceId='ws:owner-a'){await pg.query('INSERT INTO workspace_members (workspace_id,user_id,role,created_at) VALUES ($1,$2,$3,$4)',[workspaceId,userId,role,new Date().toISOString()]);}
async function getWorkspace(workspaceId,status=200){const response=await GET(new Request('https://tracker.test/api/records',{headers:{'X-Workspace-Id':workspaceId}}));assert.equal(response.status,status);assertions++;return response.json();}
const c=await post({action:'create',kind:'client',data:{name:'Client A'}});
const c2=await post({action:'create',kind:'client',data:{name:'Client B'}});
const p=await post({action:'create',kind:'project',data:{name:'Campaign',clientId:c.id}});
const base={name:'Artwork',clientId:c.id,projectId:p.id,status:'En cours',due:'2026-09-10',source:'Interne'};
await post({action:'create',kind:'task',data:{...base,clientId:c2.id}},400);
await post({action:'create',kind:'task',data:{...base,due:'2026-02-30'}},400);
await post({action:'create',kind:'task',data:{...base,status:'À valider'}},400);
await post({action:'create',kind:'task',data:{...base,deliverable:'javascript:alert(1)'}},400);
await post({action:'create',kind:'task',data:{...base,assignee:'Unknown teammate'}},400);
const t=await post({action:'create',kind:'task',data:{...base,assignee:''}});
const review=await post({action:'update',kind:'task',id:t.id,revision:1,data:{...base,assignee:'',status:'À valider',deliverable:'https://example.com/art.pdf'}});
assert.equal(review.records.find(r=>r.id===t.id).status,'À valider');
await post({action:'update',kind:'task',id:t.id,revision:1,data:{...base,name:'Stale overwrite'}},409);
await post({action:'comment',taskId:t.id,text:'Please adjust the spacing.'});
const approved=await post({action:'update',kind:'task',id:t.id,revision:2,data:{...base,status:'Validé',deliverable:'https://example.com/art.pdf'}});
assert.ok(approved.records.find(r=>r.id===t.id).validatedAt);
const revised=await post({action:'update',kind:'task',id:t.id,revision:3,data:{...base,status:'Validé',deliverable:'https://example.com/revision.pdf'}});
assert.equal(revised.records.find(r=>r.id===t.id).status,'En cours');
await post({action:'update',kind:'client',id:c.id,revision:1,data:{name:'Client A',archived:true}});
await post({action:'comment',taskId:t.id,text:'Archived parent'},404);
await post({action:'update',kind:'task',id:t.id,revision:4,data:base},400);
await post({action:'update',kind:'client',id:c.id,revision:2,data:{name:'Client A',archived:false}});
await post({action:'create',kind:'client',data:{name:'Cross-origin'}},403,'https://malicious.test');
// Only an accepted invitation should create membership; role changes must not create one.
await post({action:'set-member-role',userId:'member-a',role:'creative',expectedRole:'viewer'},404);
await seedMember('member-a','viewer');
const membership=await post({action:'set-member-role',userId:'member-a',role:'creative',expectedRole:'viewer'});
assert.equal(membership.members.find(m=>m.userId==='member-a').role,'creative');
globalThis.testUser={...globalThis.testUser,userId:'member-a'};
const memberView=await (await GET(new Request('https://tracker.test/api/records'))).json();
// The page polls: an unchanged workspace answers 304 with no body, a changed one the full payload.
{const first=await GET(new Request('https://tracker.test/api/records'));const tag=first.headers.get('ETag');assert.ok(tag);const again=await GET(new Request('https://tracker.test/api/records',{headers:{'If-None-Match':tag}}));assert.equal(again.status,304);assert.equal(await again.text(),'');const stale=await GET(new Request('https://tracker.test/api/records',{headers:{'If-None-Match':'W/"old"'}}));assert.equal(stale.status,200);assertions+=3;}
assert.equal(memberView.workspace.role,'creative');
assert.equal(memberView.user.id,'member-a');
assert.equal(memberView.members.find(m=>m.userId==='member-a').email,'test@example.com');
assert.ok(memberView.records.some(r=>r.id===t.id));
await post({action:'create',kind:'client',data:{name:'Client created by a creative member'}},403);
await post({action:'set-member-role',userId:'owner-a',role:'viewer',expectedRole:'owner'},403);
await post({action:'remove-member',userId:'owner-a',expectedRole:'owner'},403);
await post({action:'create',kind:'project',data:{name:'Archived create',clientId:c.id,archived:true}},403);
await post({action:'update',kind:'task',id:t.id,revision:4,data:{...base,archived:true}},403);
// A member's only edit on a task is the deliverable link; every other field is read-only for them.
await post({action:'update',kind:'task',id:t.id,revision:4,data:{...base,archived:false,description:'Updated by a creative member'}},403);
const memberUpdate=await post({action:'update',kind:'task',id:t.id,revision:4,data:{...base,archived:false,deliverable:'https://example.com/member-update.pdf'}});
assert.equal(memberUpdate.records.find(r=>r.id===t.id).revision,5);
assert.equal(memberUpdate.records.find(r=>r.id===t.id).status,'Validation interne','saving a new deliverable link submits it to internal review, never straight to the client');
assert.equal(memberUpdate.records.find(r=>r.id===t.id).approvalDueAt,undefined,'no client clock runs during internal review');
// Internal review: a member can neither send to the client nor decide; the owner sends it, or returns it with a note only the studio reads.
{
  const link='https://example.com/member-update.pdf';
  await post({action:'update',kind:'task',id:t.id,revision:5,data:{...base,archived:false,status:'À valider',deliverable:link}},403);
  await post({action:'internal-review',taskId:t.id,revision:5,decision:'send'},403);
  globalThis.testUser={...globalThis.testUser,userId:'owner-a'};
  const inbox=await getWorkspace('ws:owner-a');
  assert.ok(inbox.records.some(r=>r.kind==='event'&&r.taskId===t.id&&r.id.includes(':internal-review:')&&r.recipients?.includes('owner-a')),'the owner is told a deliverable waits for internal review');
  const roundsBefore=inbox.records.find(r=>r.id===t.id).revisionRound||0;
  await post({action:'internal-review',taskId:t.id,revision:4,decision:'send'},409);
  await post({action:'internal-review',taskId:t.id,revision:5,decision:'reject',text:'  '},400);
  await post({action:'internal-review',taskId:t.id,revision:5,decision:'maybe'},400);
  const refused=(await post({action:'internal-review',taskId:t.id,revision:5,decision:'reject',text:'Logo too small'})).records.find(r=>r.id===t.id);
  assert.equal(refused.status,'En cours');
  assert.deepEqual([refused.internalReview.note,refused.internalReview.by],['Logo too small','Test Owner']);
  assert.equal(refused.revisionRound||0,roundsBefore,'an internal refusal is not a client round');
  await post({action:'internal-review',taskId:t.id,revision:6,decision:'send'},409);
  globalThis.testUser={...globalThis.testUser,userId:'member-a'};
  const resubmitted=(await post({action:'update',kind:'task',id:t.id,revision:6,data:{...base,archived:false,status:'Validation interne',deliverable:link}})).records.find(r=>r.id===t.id);
  assert.equal(resubmitted.status,'Validation interne','the member submits again once the note is addressed');
  globalThis.testUser={...globalThis.testUser,userId:'owner-a'};
  const sent=(await post({action:'internal-review',taskId:t.id,revision:7,decision:'send'})).records.find(r=>r.id===t.id);
  assert.equal(sent.status,'À valider'); assert.ok(sent.sentAt&&sent.approvalDueAt,'sending starts the client clock');
  assert.equal(sent.sentDeliverable,link); assert.equal(sent.internalReview,undefined,'the studio note is settled once the client has it');
  assert.ok(sent.history.some(h=>h.internal&&h.text==='Validé en interne par Test Owner'));
  // Back to the state the rest of this file expects: the member's link, revision 5 no longer exists.
  globalThis.testUser={...globalThis.testUser,userId:'member-a'};
  assertions+=11;
}
globalThis.testUser={...globalThis.testUser,userId:'owner-a'};
await post({action:'set-member-role',userId:'member-a',role:'viewer',expectedRole:'creative'});
globalThis.testUser={...globalThis.testUser,userId:'member-a'};
await post({action:'update',kind:'task',id:t.id,revision:5,data:{...base,name:'Viewer overwrite'}},403);
await post({action:'comment',taskId:t.id,text:'Viewer comment'},403);
await post({action:'set-member-role',userId:'owner-a',role:'viewer',expectedRole:'owner'},403);
await post({action:'remove-member',userId:'owner-a',expectedRole:'owner'},403);
globalThis.testUser={...globalThis.testUser,userId:'owner-a'};
const ownerView=await getWorkspace('ws:owner-a');
assert.equal(ownerView.members.find(m=>m.userId==='owner-a').name,'Test Owner');
assert.equal(ownerView.members.length,2);
for (const userId of ['owner-a',' owner-a ','\towner-a']) {
  await post({action:'set-member-role',userId,role:'viewer',expectedRole:'owner'},400);
  await post({action:'remove-member',userId,expectedRole:'owner'},400);
}
await post({action:'set-member-role',userId:'member-a',role:'owner',expectedRole:'viewer'},400);
await post({action:'set-member-role',userId:'member-a',role:'superadmin',expectedRole:'viewer'},400);
await post({action:'set-member-role',userId:'member-a',role:'admin'},400);
await post({action:'set-member-role',userId:'member-a',role:'admin',expectedRole:'creative'},409);
await post({action:'remove-member',userId:'member-a',expectedRole:'creative'},409);
await post({action:'remove-member',userId:'missing-member',expectedRole:'viewer'},404);
await post({action:'set-member-role',userId:4,role:'admin',expectedRole:'viewer'},400);
await post({action:'remove-member',userId:'x'.repeat(201),expectedRole:'viewer'},400);
await post(null,400);await post([],400);await post('invalid',400);
await post({action:'set-member-role',userId:'member-a',role:'admin',expectedRole:'viewer'});
globalThis.testUser={...globalThis.testUser,userId:'member-a'};
await post({action:'set-member-role',userId:'member-a',role:'viewer',expectedRole:'admin'},400);
await post({action:'remove-member',userId:'member-a',expectedRole:'admin'},400);
await post({action:'set-member-role',userId:'owner-a',role:'viewer',expectedRole:'owner'},400);
await post({action:'remove-member',userId:'owner-a',expectedRole:'owner'},400);
await seedMember('member-c','viewer');
await post({action:'set-member-role',userId:'member-c',role:'creative',expectedRole:'viewer'});
const removed=await post({action:'remove-member',userId:'member-c',expectedRole:'creative'});
assert.ok(!removed.members.some(m=>m.userId==='member-c'));
await post({action:'set-member-role',userId:'member-c',role:'creative',expectedRole:'viewer'},404);
globalThis.testUser={...globalThis.testUser,userId:'owner-a'};
await post({action:'remove-member',userId:'member-a',expectedRole:'admin'});
globalThis.testUser={...globalThis.testUser,userId:'member-a'};
await getWorkspace('ws:owner-a',403);
await post({action:'comment',taskId:t.id,text:'Removed member'},403,'https://tracker.test','ws:owner-a');
await post({action:'create',kind:'client',data:{name:'Stale browser'}},403,'https://tracker.test','ws:owner-a');
// A removed user can have their own workspace, but never inherit the old workspace's data.
const separateView=await (await GET(new Request('https://tracker.test/api/records'))).json();assert.notEqual(separateView.workspace.id,'ws:owner-a');assert.deepEqual(separateView.records.filter(r=>r.kind!=='platform'),[]);assert.equal(separateView.records.filter(r=>r.kind==='platform').length,3,'a fresh workspace gets the default platforms, nothing else');
globalThis.testUser={...globalThis.testUser,userId:'owner-a'};
assert.equal((await getWorkspace('ws:owner-a')).records.find(r=>r.id===t.id).deliverable,'https://example.com/member-update.pdf');
// Unknown stored roles fail closed, including a corrupted owner membership.
await pg.query('UPDATE workspace_members SET role = $1 WHERE user_id = $2',['invalid','owner-a']);
assert.equal((await GET(new Request('https://tracker.test/api/records'))).status,403);
await post({action:'create',kind:'client',data:{name:'Blocked'}},403);
await pg.query('UPDATE workspace_members SET role = $1 WHERE user_id = $2',['owner','owner-a']);
globalThis.testUser={...globalThis.testUser,userId:'owner-b'};
{const ownerBRecords=(await (await GET(new Request('https://tracker.test/api/records'))).json()).records;assert.deepEqual(ownerBRecords.filter(r=>r.kind!=='platform'),[]);assert.equal(ownerBRecords.filter(r=>r.kind==='platform').length,3);}
await getWorkspace('ws:owner-a',403);
await post({action:'remove-member',userId:'owner-a',expectedRole:'owner'},403,'https://tracker.test','ws:owner-a');
await seedMember('member-b','viewer','ws:owner-b');
await post({action:'set-member-role',userId:'member-b',role:'creative',expectedRole:'viewer'});
globalThis.testUser={...globalThis.testUser,userId:'owner-a'};
await post({action:'set-member-role',userId:'member-b',role:'admin',expectedRole:'creative'},404);
await post({action:'remove-member',userId:'member-b',expectedRole:'creative'},404);
globalThis.testUser={...globalThis.testUser,userId:'owner-b'};
await post({action:'update',kind:'task',id:t.id,revision:4,data:base},404);
await post({action:'comment',taskId:t.id,text:'Unauthorized'},404);
// The retired demo action is just an unknown action now, and any demo rows a workspace still holds
// from the old seeding are purged on its next load.
await post({action:'demo'},400);
await pg.query("INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, $2, $3, 'client', $4::jsonb, 1)",['owner-b:demo-c0','owner-b','ws:owner-b',JSON.stringify({id:'owner-b:demo-c0',kind:'client',revision:1,name:'Maison Noya',demo:true,createdAt:new Date().toISOString()})]);
await pg.query("INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, $2, $3, 'meta', '{}'::jsonb, 1)",['owner-b:demo','owner-b','ws:owner-b']);
assert.ok(!(await (await GET(new Request('https://tracker.test/api/records'))).json()).records.some(r=>r.demo||r.name==='Maison Noya'),'leftover demo rows are purged on load');
assert.equal((await pg.query("SELECT count(*)::int AS n FROM records WHERE workspace_id = 'ws:owner-b' AND (id LIKE '%:demo' OR data->>'demo' = 'true')")).rows[0].n,0);assertions++;
// Editorial posts (the posting calendar) and platforms: permission boundaries, a stale platform id
// being silently dropped rather than rejected, and the required publishing date.
globalThis.testUser={...globalThis.testUser,userId:'owner-a'};
await seedMember('member-c','creative','ws:owner-a');
await seedMember('viewer-a','viewer','ws:owner-a');
const platformsBefore=(await getWorkspace('ws:owner-a')).records.filter(r=>r.kind==='platform');
assert.equal(platformsBefore.length,3,'the three default platforms were seeded lazily');
globalThis.testUser={...globalThis.testUser,userId:'viewer-a'};
await post({action:'create',kind:'platform',data:{name:'Pinterest'}},403,'https://tracker.test','ws:owner-a');
globalThis.testUser={...globalThis.testUser,userId:'member-c'};
const newPlatform=await post({action:'create',kind:'platform',data:{name:'Pinterest'}},200,'https://tracker.test','ws:owner-a');
assert.ok(newPlatform.records.some(r=>r.kind==='platform'&&r.name==='Pinterest'),'any non-viewer studio role can add a platform');
const samePlatform=await post({action:'create',kind:'platform',data:{name:'  pinterest '}},200,'https://tracker.test','ws:owner-a');
assert.equal(samePlatform.id,newPlatform.id,'re-adding a platform under another casing returns the existing one');
assert.equal(samePlatform.records.filter(r=>r.kind==='platform'&&r.name.toLowerCase()==='pinterest').length,1);
await post({action:'create',kind:'editorial_post',data:{name:'Post refusé',clientId:c.id,due:'2026-12-01'}},403,'https://tracker.test','ws:owner-a');
globalThis.testUser={...globalThis.testUser,userId:'owner-a'};
await post({action:'create',kind:'editorial_post',data:{name:'Sans date',clientId:c.id}},400,'https://tracker.test','ws:owner-a');
await post({action:'create',kind:'editorial_post',data:{name:'Format inconnu',clientId:c.id,due:'2026-12-05',postType:'Podcast'}},400,'https://tracker.test','ws:owner-a');
const editorialPost=await post({action:'create',kind:'editorial_post',data:{name:'Post multi-plateforme',clientId:c.id,due:'2026-12-05',postType:'Story',channels:[newPlatform.id,'platform:does-not-exist']}},200,'https://tracker.test','ws:owner-a');
assert.deepEqual(editorialPost.records.find(r=>r.id===editorialPost.id).channels,[newPlatform.id],'a stale/unknown platform id is silently dropped, not rejected');
assert.equal(editorialPost.records.find(r=>r.id===editorialPost.id).postType,'Story','the post format is stored');
globalThis.testUser={...globalThis.testUser,userId:'member-c'};
await post({action:'update',kind:'editorial_post',id:editorialPost.id,revision:1,data:{name:'Post modifié',clientId:c.id,due:'2026-12-06'}},403,'https://tracker.test','ws:owner-a');
globalThis.testUser={...globalThis.testUser,userId:'owner-a'};
const updatedPost=await post({action:'update',kind:'editorial_post',id:editorialPost.id,revision:1,data:{name:'Post modifié',clientId:c.id,due:'2026-12-06',postType:'',channels:[]}},200,'https://tracker.test','ws:owner-a');
assert.equal(updatedPost.records.find(r=>r.id===editorialPost.id).name,'Post modifié','the Social roles update a post; a « Membre » no longer does');
assert.equal(updatedPost.records.find(r=>r.id===editorialPost.id).postType,'','clearing the format empties it instead of keeping the old one');
globalThis.testUser={...globalThis.testUser,userId:'viewer-a'};
await post({action:'update',kind:'editorial_post',id:editorialPost.id,revision:2,data:{name:'x',clientId:c.id,due:'2026-12-06'}},403,'https://tracker.test','ws:owner-a');
globalThis.testUser={...globalThis.testUser,userId:'owner-a'};
await post({action:'delete',kind:'editorial_post',id:editorialPost.id,revision:2},200,'https://tracker.test','ws:owner-a');
await post({action:'delete',kind:'platform',id:newPlatform.id,revision:1},200,'https://tracker.test','ws:owner-a');

// Structured briefs use the client's existing revision, workspace and manager-only boundaries.
const brief=JSON.parse(readFileSync('public/brief-marque-modele.json','utf8'));
const briefCreated=await post({action:'create',kind:'client',data:{name:'Brief Client',brief}},200,'https://tracker.test','ws:owner-a');
assert.deepEqual(briefCreated.records.find(r=>r.id===briefCreated.id).brief,brief);
assert.equal(briefCreated.records.find(r=>r.id===briefCreated.id).description,brief.overview,'legacy copy agrees with the visual board');
const briefChanged={...brief,overview:'Updated positioning'};
await post({action:'update',kind:'client',id:briefCreated.id,revision:1,data:{name:'Brief Client',brief:briefChanged}},200,'https://tracker.test','ws:owner-a');
assert.deepEqual((await getWorkspace('ws:owner-a')).records.find(r=>r.id===briefCreated.id).brief,briefChanged,'brief survives a fresh load');
const largeBrief={...brief,overview:'x'.repeat(15000),requirements:Array.from({length:30},(_,i)=>({id:String(i),text:'x'.repeat(1000),priority:'must'}))};
await post({action:'create',kind:'client',data:{name:'Large valid brief',brief:largeBrief}},200,'https://tracker.test','ws:owner-a');
await post({action:'create',kind:'client',data:{name:'Oversized paragraph',description:'x'.repeat(25001)}},413,'https://tracker.test','ws:owner-a');
await post({action:'create',kind:'client',data:{name:'Oversized brief',brief:{...brief,overview:'x'.repeat(300000)}}},413,'https://tracker.test','ws:owner-a');
await post({action:'update',kind:'client',id:briefCreated.id,revision:1,data:{name:'Brief Client',brief}},409,'https://tracker.test','ws:owner-a');
await post({action:'update',kind:'client',id:briefCreated.id,revision:2,data:{name:'Brief Client',brief:{...brief,references:[{id:'bad',label:'Bad',url:'javascript:alert(1)'}]}}},400,'https://tracker.test','ws:owner-a');
await post({action:'create',kind:'project',data:{name:'Wrong kind',clientId:c.id,brief}},400,'https://tracker.test','ws:owner-a');
for(const userId of ['member-c','viewer-a']){
  globalThis.testUser={...globalThis.testUser,userId};
  await post({action:'update',kind:'client',id:briefCreated.id,revision:2,data:{name:'Brief Client',brief}},403,'https://tracker.test','ws:owner-a');
}
globalThis.testUser={...globalThis.testUser,userId:'owner-b'};
await post({action:'update',kind:'client',id:briefCreated.id,revision:2,data:{name:'Brief Client',brief}},404,'https://tracker.test','ws:owner-b');
assert.ok(!(await getWorkspace('ws:owner-b')).records.some(r=>r.id===briefCreated.id),'another workspace cannot read the brief');

globalThis.testUser=null;
assert.equal((await GET(new Request('https://tracker.test/api/records'))).status,401);
await post({action:'create',kind:'client',data:{name:'Anonymous'}},401);
console.log(`${assertions} API cases passed: validation, workflow, persistence, role changes, owner protection, stale changes, removal, isolation and authentication.`);

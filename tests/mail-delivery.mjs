// How e-mail leaves (lib/mail.ts): Resend's API once its key and the sending address are set, nothing at all
// otherwise; the agency's name as the sender, and its owner's address as Reply-To on what an agency sends its
// clients, so their answers reach the agency. Resend is replaced by a recorder.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { testRuntimePlugin } from './helpers/pg.mjs';
const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: { mail: 'lib/mail.ts' }, outdir: '.sites-runtime/mail-delivery', bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })], logLevel: 'error' });
const testEnv = {};
globalThis.testEnv = testEnv;
const calls = [];
let answer = () => Response.json({ id: 'sent' });
globalThis.fetch = async (url, init = {}) => { calls.push({ url: String(url), init }); return answer(); };
const body = () => JSON.parse(calls.at(-1).init.body);
const refused = (status, name, message) => () => Response.json({ statusCode: status, name, message }, { status });
const logged = [];
console.error = (...parts) => logged.push(parts.join(' '));
const mail = await import(pathToFileURL(`${process.cwd()}/.sites-runtime/mail-delivery/mail.js`));

let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const notice = { to: ['lina@atlas.test'], clientName: 'Atlas', studio: 'Agence Nova', url: 'https://space.test', pendingTasks: ['Reel'] };
const sender = 'notifications@mail.the1core.test';

// Nothing configured: nothing leaves, the caller shows the information instead.
eq(mail.mailSettings({}), null, 'no settings, no transport');
ok(!mail.mailConfigured());
eq(await mail.sendClientNotice(notice), { sent: false }, 'nothing sent without settings');
eq(await mail.checkMail(), { ok: false, error: 'mail not configured' });
eq(calls.length, 0, 'and Resend is not called');
eq(mail.mailSettings({ RESEND_API_KEY: 'key' }), null, 'a key without its sending address is not used');
eq(mail.mailSettings({ MAIL_FROM: sender }), null, 'a sending address without its key is not used');
eq(mail.mailSettings({ RESEND_API_KEY: '  ', MAIL_FROM: sender }), null, 'a blank key is no key');

// Through Resend: the agency's name as the sender, its owner as Reply-To.
Object.assign(testEnv, { RESEND_API_KEY: ' re_test_key ', MAIL_FROM: sender, OWNER_EMAIL: 'owner@the1core.test' });
eq(mail.mailSettings(testEnv), { apiKey: 're_test_key', from: sender }, 'spaces pasted around a value are dropped');
ok((await mail.sendClientNotice({ ...notice, replyTo: 'owner@nova.test' })).sent, 'sent through Resend');
eq([calls.at(-1).url, calls.at(-1).init.method, calls.at(-1).init.headers.Authorization], ['https://api.resend.com/emails', 'POST', 'Bearer re_test_key']);
eq([body().from, body().to, body().reply_to], [`"Agence Nova" <${sender}>`, ['lina@atlas.test'], 'owner@nova.test'], 'the agency’s name as sender, its owner as Reply-To');
ok(body().subject && body().text && body().html, 'subject, text and HTML');

// An invitation carries its welcome PDF, in the form Resend reads.
ok((await mail.sendInvitation({ to: 'yasmine@nova.test', name: 'Yasmine', temporaryPassword: 'tmp', studio: 'Agence Nova', url: 'https://space.test', roleLabel: 'Membre', renewal: false, logoPng: null, replyTo: 'owner@nova.test' })).sent);
const [pdf] = body().attachments;
eq([pdf.filename, pdf.content_type, Buffer.from(pdf.content, 'base64').subarray(0, 4).toString()], ['acces-Agence Nova.pdf', 'application/pdf', '%PDF'], 'with its welcome PDF, in base64');

// A sender's name can't break out of its header, and a Reply-To is a plain address or nothing.
await mail.sendClientNotice({ ...notice, studio: 'Studio "<x>", @y\r\nBcc: z' });
eq(body().from, `"Studio x y Bcc: z" <${sender}>`, 'the name is sanitized');
await mail.sendClientNotice({ ...notice, replyTo: 'x@y.test\r\nBcc: victim@z.test' });
ok(!('reply_to' in body()), 'a malformed Reply-To is dropped');
await mail.sendClientNotice({ ...notice, replyTo: null });
ok(!('reply_to' in body()), 'none when the agency has no owner address');

// The platform's own messages keep the platform's name, and a request can be answered directly.
await mail.sendPasswordReset({ to: 'a@b.test', name: 'A', link: 'https://space.test/login?reset=x' });
eq(body().from, `"The One Space" <${sender}>`, 'a password reset comes from The One Space');
await mail.sendAccessRequestNotice({ company: 'Nova', name: 'Sara', email: 'sara@nova.test', phone: '', city: '', teamSize: '', message: '', url: 'https://space.test/#platform' });
eq([body().to, body().reply_to], ['owner@the1core.test', 'sara@nova.test'], 'an access request reaches the platform owner, answers to the agency');

// Resend refuses: the caller is told without the reason, the Plateforme's test and the log get it, the key never.
answer = refused(403, 'validation_error', 'The mail.the1core.test domain is not verified.');
eq(await mail.sendClientNotice(notice), { sent: false, error: 'L’envoi de l’e-mail a échoué.' }, 'a refusal is not a success');
eq(await mail.sendMailTest('a@b.test'), { sent: false, error: 'Resend 403: The mail.the1core.test domain is not verified.' }, 'the Plateforme’s test says why');
answer = () => new Response('Bad gateway', { status: 502, statusText: 'Bad Gateway' });
eq(await mail.sendMailTest('a@b.test'), { sent: false, error: 'Resend 502: Bad Gateway' }, 'an answer that is not JSON');
answer = () => { throw new Error('network down'); };
eq(await mail.sendPasswordReset({ to: 'a@b.test', name: '', link: 'https://space.test' }), { sent: false, error: 'L’e-mail n’a pas pu être envoyé.' }, 'Resend out of reach');
ok(logged.some((line) => line.includes('not verified')), 'the log has the reason');
ok(!logged.some((line) => line.includes('re_test_key')), 'and never the key');

// The Plateforme's check tries the key without sending anything: a key limited to sending is a good key.
answer = () => Response.json({ data: [] });
eq(await mail.checkMail(), { ok: true }, 'a full access key');
eq([calls.at(-1).url, calls.at(-1).init.method, calls.at(-1).init.body], ['https://api.resend.com/domains', undefined, undefined], 'only reads');
answer = refused(401, 'restricted_api_key', 'This API key is restricted to only send emails.');
eq(await mail.checkMail(), { ok: true }, 'a sending access key');
answer = refused(400, 'validation_error', 'API key is invalid');
eq(await mail.checkMail(), { ok: false, error: 'Resend 400: API key is invalid' }, 'a key that does not exist');
answer = refused(403, 'restricted_api_key', 'API key is not active');
eq(await mail.checkMail(), { ok: false, error: 'Resend 403: API key is not active' }, 'a key that was switched off');
answer = () => { throw new Error('network down'); };
eq(await mail.checkMail(), { ok: false, error: 'network down' }, 'Resend out of reach');

console.log(`mail delivery: ${checks} checks passed`);

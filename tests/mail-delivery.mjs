// How e-mail leaves (lib/mail.ts): a sending provider's SMTP when MAIL_SMTP_* is set, else Gmail as before,
// nothing at all otherwise; the agency's name as the sender, and its owner's address as Reply-To on what an
// agency sends its clients, so their answers reach the agency. nodemailer is replaced by a recorder.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { testRuntimePlugin } from './helpers/pg.mjs';
const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime', { recursive: true });
const recorder = { name: 'mail-recorder', setup(build) {
  build.onResolve({ filter: /^nodemailer$/ }, () => ({ path: 'nodemailer', namespace: 'recorder' }));
  build.onLoad({ filter: /.*/, namespace: 'recorder' }, () => ({ loader: 'js', contents:
    'export default { createTransport: (t) => ({ sendMail: async (m) => { (globalThis.sentMail ??= []).push({ ...m, transport: t }); } }) };' }));
} };
await esbuild.build({ entryPoints: { mail: 'lib/mail.ts' }, outdir: '.sites-runtime/mail-delivery', bundle: true, platform: 'node', format: 'esm', plugins: [recorder, testRuntimePlugin({ auth: false })], logLevel: 'error' });
const testEnv = {};
globalThis.testEnv = testEnv;
globalThis.sentMail = [];
const mail = await import(pathToFileURL(`${process.cwd()}/.sites-runtime/mail-delivery/mail.js`));

let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const notice = { to: ['lina@atlas.test'], clientName: 'Atlas', studio: 'Agence Nova', url: 'https://space.test', pendingTasks: ['Reel'] };

// Nothing configured: nothing leaves, the caller shows the information instead.
eq(mail.mailSettings({}), null, 'no settings, no transport');
ok(!mail.mailConfigured());
eq(await mail.sendClientNotice(notice), { sent: false }, 'nothing sent without settings');

// Gmail, as before.
Object.assign(testEnv, { GMAIL_USER: 'contact@the1core.test', GMAIL_APP_PASSWORD: 'app-pass' });
eq(mail.mailSettings(testEnv), { host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: 'contact@the1core.test', pass: 'app-pass' }, from: 'contact@the1core.test' });
ok((await mail.sendClientNotice({ ...notice, replyTo: 'owner@nova.test' })).sent, 'sent through Gmail');
let last = globalThis.sentMail.at(-1);
eq([last.transport.host, last.from, last.replyTo], ['smtp.gmail.com', { name: 'Agence Nova', address: 'contact@the1core.test' }, 'owner@nova.test'],
  'the agency’s name as sender, its owner as Reply-To');
ok(!('from' in last.transport), 'the sending address is not passed as a transport option');

// A sending provider wins over Gmail once it is set (port 587: STARTTLS).
Object.assign(testEnv, { MAIL_SMTP_HOST: 'smtp.resend.test', MAIL_SMTP_PORT: '587', MAIL_SMTP_USER: 'resend', MAIL_SMTP_PASSWORD: 'key', MAIL_FROM: 'notifications@theonespace.test' });
eq(mail.mailSettings(testEnv), { host: 'smtp.resend.test', port: 587, secure: false, auth: { user: 'resend', pass: 'key' }, from: 'notifications@theonespace.test' });
ok((await mail.sendInvitation({ to: 'yasmine@nova.test', name: 'Yasmine', temporaryPassword: 'tmp', studio: 'Agence Nova', url: 'https://space.test', roleLabel: 'Membre', renewal: false, logoPng: null, replyTo: 'owner@nova.test' })).sent);
last = globalThis.sentMail.at(-1);
eq([last.transport.host, last.from.address, last.replyTo], ['smtp.resend.test', 'notifications@theonespace.test', 'owner@nova.test'], 'an invitation through the provider, answers to the agency');
ok(last.attachments?.[0]?.contentType === 'application/pdf', 'with its welcome PDF');
eq(mail.mailSettings({ ...testEnv, MAIL_FROM: '' }).host, 'smtp.gmail.com', 'a provider without its sending address is not used');

// A Reply-To is a plain address or nothing: never a way to inject headers.
await mail.sendClientNotice({ ...notice, replyTo: 'x@y.test\r\nBcc: victim@z.test' });
ok(!('replyTo' in globalThis.sentMail.at(-1)), 'a malformed Reply-To is dropped');
await mail.sendClientNotice({ ...notice, replyTo: null });
ok(!('replyTo' in globalThis.sentMail.at(-1)), 'none when the agency has no owner address');

// The platform's own messages keep the platform's name.
await mail.sendPasswordReset({ to: 'a@b.test', name: 'A', link: 'https://space.test/login?reset=x' });
eq(globalThis.sentMail.at(-1).from, { name: 'The One Space', address: 'notifications@theonespace.test' }, 'a password reset comes from The One Space');

console.log(`mail delivery: ${checks} checks passed`);

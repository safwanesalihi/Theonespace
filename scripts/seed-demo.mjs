// Local demo data for screenshots and sales demos: `node scripts/seed-demo.mjs` with the dev server STOPPED
// (PGlite in .data/pglite allows one process). Creates two company workspaces:
//   - « Atelier Nour »: a busy agency (teal brand, every role, clients, tasks in every status, chat,
//     meetings, shoots, CRM, social posts, library, requests);
//   - « Studio Lune »: an agency that just signed up (trial, no data) for the first-run screens;
//   - six lighter agencies in every state of a subscription (paid, trial ending, payment late, a plan
//     asked for, trial over), with this month's usage, for the Plateforme page.
// With OWNER_EMAIL in .env, a local run also makes that platform owner's account and session.
// Every account's e-mail ends in .test and shares DEMO_PASSWORD from .env (never committed).
// Re-running replaces both workspaces. Local by default: refuses when DATABASE_URL is set.
// A hosted demo: `node scripts/seed-demo.mjs --remote` with DEMO_DATABASE_URL in the environment (an empty,
// already migrated database of its own). It refuses any database that holds a workspace other than the
// two demo ones, so it can never write into a real workspace's database.
import { readFileSync, readdirSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, scrypt as scryptCb } from 'node:crypto';
import { promisify } from 'node:util';
import { PGlite } from '@electric-sql/pglite';

const root = process.cwd();
const env = Object.fromEntries(
  (existsSync(join(root, '.env')) ? readFileSync(join(root, '.env'), 'utf8') : '').split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const remote = process.argv.includes('--remote');
if (!remote && env.DATABASE_URL) throw new Error('DATABASE_URL is set: this script only seeds the local embedded database (or pass --remote).');
const remoteUrl = process.env.DEMO_DATABASE_URL;
if (remote && !remoteUrl) throw new Error('--remote needs DEMO_DATABASE_URL in the environment.');
const password = process.env.DEMO_PASSWORD || env.DEMO_PASSWORD;
if (!password || password.length < 10) throw new Error('Set DEMO_PASSWORD (10+ characters) in .env first.');

const scrypt = promisify(scryptCb);
async function hashPassword(pw) {
  const salt = randomBytes(16);
  const hash = await scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

// The same small surface as PGlite (exec, query → { rows }, transaction, close) over postgres.js for --remote.
// JSON is passed as the text the script already wrote, as lib/database.ts does.
async function remoteDb(url) {
  const { default: postgres } = await import('postgres');
  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 15, types: { json: { to: 114, from: [114, 3802], serialize: (v) => (typeof v === 'string' ? v : JSON.stringify(v)), parse: (v) => JSON.parse(v) } } });
  const wrap = (c) => ({ exec: (text) => c.unsafe(text), query: async (text, params = []) => ({ rows: await c.unsafe(text, params) }), transaction: (fn) => c.begin((tx) => fn(wrap(tx))) });
  return { ...wrap(sql), close: () => sql.end() };
}

let pg;
if (remote) {
  pg = await remoteDb(remoteUrl);
  const [{ n }] = (await pg.query("SELECT count(*)::int AS n FROM workspaces WHERE id NOT LIKE 'ws:org:demo-%'")).rows;
  if (n > 0) { await pg.close(); throw new Error(`This database holds ${n} workspace(s) that are not the demo ones: refusing to seed it.`); }
} else {
  const dataDir = join(root, '.data', 'pglite');
  mkdirSync(dataDir, { recursive: true });
  pg = await PGlite.create({ dataDir });
  await pg.exec('CREATE TABLE IF NOT EXISTS _local_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const applied = new Set((await pg.query('SELECT name FROM _local_migrations')).rows.map((r) => r.name));
  for (const file of readdirSync(join(root, 'drizzle')).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue;
    await pg.exec(readFileSync(join(root, 'drizzle', file), 'utf8').replaceAll('--> statement-breakpoint', ''));
    await pg.query('INSERT INTO _local_migrations (name) VALUES ($1)', [file]);
  }
}
await pg.exec(`CREATE TABLE IF NOT EXISTS subscriptions (
  workspace_id text PRIMARY KEY, plan text NOT NULL, trial_ends_at timestamptz NOT NULL, paid_until timestamptz,
  canceled boolean NOT NULL DEFAULT false, requested_plan text, requested_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now())`);

await pg.exec('CREATE TABLE IF NOT EXISTS ai_usage (workspace_id text NOT NULL, month text NOT NULL, calls integer NOT NULL DEFAULT 0, PRIMARY KEY (workspace_id, month))');
await pg.exec('CREATE TABLE IF NOT EXISTS usage_counters (workspace_id text NOT NULL, month text NOT NULL, meter text NOT NULL, amount integer NOT NULL DEFAULT 0, PRIMARY KEY (workspace_id, month, meter))');

// ------------------------------------------------------------------ dates (relative to today)
const DAY = 86_400_000;
const now = Date.now();
const iso = (offsetDays = 0, hour = 10) => { const d = new Date(now + offsetDays * DAY); d.setUTCHours(hour, 0, 0, 0); return d.toISOString(); };
const day = (offsetDays = 0) => iso(offsetDays).slice(0, 10);

// ------------------------------------------------------------------ workspaces and people
const NOUR = 'ws:org:demo-atelier-nour';
const LUNE = 'ws:org:demo-studio-lune';
const people = {
  sara: { id: 'demo-u-sara', name: 'Sara Bennani', email: 'sara@atelier-nour.test', role: 'owner' },
  yassine: { id: 'demo-u-yassine', name: 'Yassine Alaoui', email: 'yassine@atelier-nour.test', role: 'admin' },
  lina: { id: 'demo-u-lina', name: 'Lina Tazi', email: 'lina@atelier-nour.test', role: 'creative' },
  omar: { id: 'demo-u-omar', name: 'Omar Idrissi', email: 'omar@atelier-nour.test', role: 'creative' },
  salma: { id: 'demo-u-salma', name: 'Salma Chraibi', email: 'salma@atelier-nour.test', role: 'social' },
  karim: { id: 'demo-u-karim', name: 'Karim Fassi', email: 'karim@atelier-nour.test', role: 'viewer' },
  client: { id: 'demo-u-client', name: 'Houda Zitouni', email: 'houda@cafe-zitoun.test', role: 'client', clientId: 'demo-c-zitoun' },
  nadia: { id: 'demo-u-nadia', name: 'Nadia El Amrani', email: 'nadia@studio-lune.test', role: 'owner' },
};

// The platform's other agencies (Plateforme page): an owner each, a few clients, a subscription in a given
// state (days relative to today) and this month's metered use.
const showcase = [
  { key: 'medina', name: 'Medina Digital', city: 'Marrakech', owner: 'Ilyas Benjelloun', plan: 'pro', created: -75, paidUntil: 40, clients: 6, use: { whatsappPerMonth: 640, meetingMinutesPerMonth: 1200, igPerMonth: 22, ai: 300 } },
  { key: 'pixel-atlas', name: 'Pixel Atlas Studio', city: 'Rabat', owner: 'Salma Ouazzani', plan: 'starter', created: -50, paidUntil: 12, clients: 4, use: { whatsappPerMonth: 120, meetingMinutesPerMonth: 300, igPerMonth: 6, ai: 80 } },
  { key: 'kech-lab', name: 'Kech Creative Lab', city: 'Marrakech', owner: 'Anas Tahiri', plan: 'agency', created: -140, paidUntil: -3, clients: 14, use: { whatsappPerMonth: 3900, meetingMinutesPerMonth: 6000, igPerMonth: 120, ai: 2100 } },
  { key: 'sahara-social', name: 'Sahara Social', city: 'Agadir', owner: 'Rania Bouzidi', plan: 'trial', created: -12, trialEnds: 2, clients: 2, use: { whatsappPerMonth: 30, meetingMinutesPerMonth: 90, igPerMonth: 2, ai: 25 } },
  { key: 'nordik', name: 'Nordik Média', city: 'Tanger', owner: 'Youssef Lamrani', plan: 'trial', created: -6, trialEnds: 8, requested: 'pro', clients: 3, use: { whatsappPerMonth: 44, meetingMinutesPerMonth: 120, igPerMonth: 4, ai: 40 } },
  { key: 'basma', name: 'Studio Basma', city: 'Fès', owner: 'Basma Alami', plan: 'trial', created: -19, trialEnds: -5, clients: 1, use: { whatsappPerMonth: 0, meetingMinutesPerMonth: 0, igPerMonth: 0, ai: 12 } },
].map((s) => ({ ...s, ws: `ws:org:demo-${s.key}`, person: { id: `demo-u-${s.key}`, name: s.owner, email: `${s.owner.split(' ')[0].toLowerCase()}@${s.key}.test`, role: 'owner' } }));
const nourUse = { whatsappPerMonth: 820, meetingMinutesPerMonth: 1900, igPerMonth: 34, ai: 410 };
const platformEmail = remote ? '' : (process.env.OWNER_EMAIL || env.OWNER_EMAIL || '').trim().toLowerCase();
const platformPerson = platformEmail ? { id: 'demo-u-platform', name: 'The One Core', email: platformEmail, role: 'platform' } : null;

const clients = [
  { id: 'demo-c-zitoun', name: 'Café Zitoun', contact: 'Houda Zitouni', email: 'houda@cafe-zitoun.test', city: 'Casablanca', sector: 'Restauration', quota: '12', language: 'Français', postApproval: true },
  { id: 'demo-c-atlas', name: 'Atlas Surf School', contact: 'Mehdi Berrada', email: 'mehdi@atlas-surf.test', city: 'Taghazout', sector: 'Sport & loisirs', quota: '8', language: 'Français' },
  { id: 'demo-c-dar', name: 'Dar Lalla Spa', contact: 'Imane Kettani', email: 'imane@darlalla.test', city: 'Marrakech', sector: 'Beauté & bien-être', quota: '10', language: 'العربية' },
  { id: 'demo-c-volta', name: 'Volta Motors', contact: 'Reda Lahlou', email: 'reda@volta.test', city: 'Rabat', sector: 'Automobile', quota: '16', language: 'Français' },
  { id: 'demo-c-kenza', name: 'Kenza Jewelry', contact: 'Kenza Amrani', email: 'kenza@kenza.test', city: 'Tanger', sector: 'Mode & accessoires', quota: '6', language: 'English' },
];

const briefs = {
  'demo-c-zitoun': {
    version: 1,
    overview: 'Café de quartier à Maârif : torréfaction maison, brunchs du week-end et pâtisseries marocaines revisitées.',
    audience: 'Jeunes actifs 22–35 ans, étudiants et familles du quartier le week-end.',
    voice: 'Chaleureux, gourmand, un peu d’humour. Tutoiement.',
    identity: { colors: [{ name: 'Olive', value: '#3b5d3a' }, { name: 'Crème', value: '#f4ead5' }, { name: 'Cannelle', value: '#c4733b' }], typography: 'Fraunces pour les titres, Inter pour le texte', direction: 'Lumière naturelle, tables en bois, mains qui servent.', dos: 'Montrer l’équipe et les clients habitués.', donts: 'Pas de photos de stock, pas de fonds blancs.' },
    goals: [{ id: 'g1', title: '+30 % de réservations brunch d’ici décembre', measure: 'Réservations du week-end' }, { id: 'g2', title: 'Lancer la carte d’hiver', measure: 'Ventes des boissons chaudes' }],
    requirements: [{ id: 'r1', text: 'Logo en bas à droite sur chaque visuel', priority: 'must' }],
    references: [],
  },
};

// Every task belongs to the client it is about, with its own status: each client has work in
// production, work waiting for its approval and work already validated.
const titles = [
  ['Reel — lancement carte d’hiver', 'Reel', 'zitoun', 'En cours'], ['Carrousel — 5 boissons chaudes', 'Carrousel', 'zitoun', 'À valider'],
  ['Story — brunch du dimanche', 'Story', 'zitoun', 'Validé'], ['Post — portrait de l’équipe', 'Post', 'zitoun', 'À faire'],
  ['Vidéo — coulisses torréfaction', 'Vidéo', 'zitoun', 'En cours'], ['Reel — tutoriel latte art', 'Reel', 'zitoun', 'À valider'],
  ['Post — recrutement barista', 'Post', 'zitoun', 'Validé'], ['Post — horaires Ramadan', 'Post', 'zitoun', 'Validation interne'],
  ['Story — jeu concours', 'Story', 'zitoun', 'Validé'],
  ['Reel — session coucher de soleil', 'Reel', 'atlas', 'À valider'], ['Post — offre stage Toussaint', 'Post', 'atlas', 'En cours'],
  ['Carrousel — 3 spots secrets', 'Carrousel', 'atlas', 'Validé'], ['Story — quiz surf', 'Story', 'atlas', 'À faire'],
  ['Reel — tournée des plages', 'Reel', 'atlas', 'Validé'], ['Vidéo — film de marque 30 s', 'Vidéo', 'atlas', 'En pause'],
  ['Carrousel — chiffres de l’année', 'Carrousel', 'atlas', 'Validé'],
  ['Story — avis clients', 'Story', 'dar', 'Validé'], ['Reel — rituel hammam', 'Reel', 'dar', 'À valider'],
  ['Post — nouvelle gamme huiles', 'Post', 'dar', 'En cours'], ['Carrousel — routine soin hiver', 'Carrousel', 'dar', 'Validation interne'],
  ['Post — témoignage cliente spa', 'Post', 'dar', 'Validé'], ['Copywriting — newsletter novembre', 'Texte', 'dar', 'À faire'],
  ['Vidéo — essai Volta E-City', 'Vidéo', 'volta', 'Validation interne'], ['Post — portes ouvertes showroom', 'Post', 'volta', 'À valider'],
  ['Reel — 0 à 100 en silence', 'Reel', 'volta', 'Validé'], ['Carrousel — comparatif autonomie', 'Carrousel', 'volta', 'En cours'],
  ['Story — sondage couleur', 'Story', 'volta', 'À faire'], ['Reel — livraison clients', 'Reel', 'volta', 'Validé'],
  ['Post — fête de l’Indépendance', 'Post', 'volta', 'Validé'],
  ['Post — collection Amazigh', 'Post', 'kenza', 'À valider'], ['Reel — making-of bague', 'Reel', 'kenza', 'En cours'],
  ['Carrousel — guide des tailles', 'Carrousel', 'kenza', 'Validé'], ['Carrousel — entretien bijoux', 'Carrousel', 'kenza', 'À faire'],
  ['Post — Black Friday', 'Post', 'kenza', 'À faire'], ['Prémontage — interview fondatrice', 'Montage', 'kenza', 'En cours'],
  ['Shooting produits — saison 2', 'Shooting', 'kenza', 'En cours'],
];
const creatives = [people.lina, people.omar, people.salma, people.yassine];
const priorities = ['Moyenne', 'Haute', 'Basse', 'Moyenne', 'Urgente', 'Moyenne'];

const records = [];
const planRows = [];
const push = (r, owner = people.sara.id) => records.push({ owner, ...r });

for (const c of clients) {
  push({ ...c, kind: 'client', revision: 1, createdAt: iso(-120), channels: ['Instagram', 'Facebook'], ...(briefs[c.id] ? { brief: briefs[c.id] } : {}) });
}

let n = 0;
for (const [title, type, clientKey, status] of titles) {
  const client = clients.find((c) => c.id === `demo-c-${clientKey}`);
  const who = creatives[n % creatives.length];
  const offset = status === 'Validé' ? -((n % 9) + 1) : (n % 17) - 3;
  const id = `demo-t-${String(n + 1).padStart(2, '0')}`;
  const task = {
    id, kind: 'task', revision: 1, name: title, clientId: client.id, assignee: who.name, assigneeId: who.id,
    due: day(offset), status, priority: priorities[n % priorities.length], channel: type === 'Story' ? 'Instagram' : (n % 3 ? 'Instagram' : 'Facebook'),
    description: `${type} pour ${client.name}. Brief validé, voir le dossier Drive pour les rushs.`,
    createdAt: iso(offset - 14), publishable: !['Texte', 'Montage'].includes(type), source: n % 7 === 3 ? 'Portail' : 'Interne',
    history: [{ text: `Créée par ${people.sara.name}`, date: iso(offset - 14) }],
  };
  if (['En cours', 'En pause', 'Validation interne', 'À valider', 'Validé'].includes(status)) {
    task.timeEntries = [{ userId: who.id, name: who.name, start: iso(offset - 4, 9), end: iso(offset - 4, 12) }, { userId: who.id, name: who.name, start: iso(offset - 3, 14), end: iso(offset - 3, 16) }];
    task.history.push({ text: `${who.name} a commencé`, date: iso(offset - 4, 9) });
  }
  if (['Validation interne', 'À valider', 'Validé'].includes(status)) task.deliverable = 'https://drive.google.com/demo-livrable';
  if (['À valider', 'Validé'].includes(status)) {
    task.sentDeliverable = task.deliverable;
    task.sentAt = iso(offset - 2, 11);
    task.approvalDueAt = new Date(Date.parse(task.sentAt) + 48 * 3600_000).toISOString();
    if (status === 'À valider') { task.sentAt = new Date(now - (3 + (n % 6)) * 3600_000).toISOString(); task.approvalDueAt = new Date(Date.parse(task.sentAt) + 48 * 3600_000).toISOString(); }
    task.history.push({ text: 'Envoyé au client pour validation', date: task.sentAt });
  }
  if (status === 'Validé') {
    task.validatedAt = iso(offset - 1, 15);
    task.revisionRound = n % 4 === 0 ? 1 : 0;
    task.signOff = { mode: n % 5 === 0 ? 'silence' : 'explicit', by: client.contact, email: client.email, at: task.validatedAt, round: task.revisionRound };
    if (offset < -2) task.publishedAt = iso(offset, 18);
  }
  if (status === 'Validation interne' && n % 2) task.internalReview = undefined;
  if (title === 'Vidéo — coulisses torréfaction') task.revisionRound = 2;
  push(task);
  n += 1;
}
// Undated validated reserve (evergreen)
for (const [i, c] of clients.slice(0, 3).entries()) {
  push({ id: `demo-t-ever-${i}`, kind: 'task', revision: 1, name: `Evergreen — ${['astuce du barista', 'conseil sécurité', 'rituel beauté'][i]}`, clientId: c.id, status: 'Validé', evergreen: true, priority: 'Basse', assignee: people.lina.name, assigneeId: people.lina.id, createdAt: iso(-30), validatedAt: iso(-20), signOff: { mode: 'explicit', by: c.contact, at: iso(-20), round: 0 } });
}

// Chat on a few tasks
const chats = {
  'Reel — tutoriel latte art': [
    [people.lina, 'Première version du Reel prête, j’ai gardé la musique validée la semaine dernière.', -2, 10],
    [people.sara, 'Super rythme 👌 Je l’envoie à Houda.', -2, 11],
    [people.client, 'Très joli ! On peut mettre le prix du latte en plus gros à la fin ?', -1, 9],
    [people.lina, 'Oui, je m’en occupe ce matin.', -1, 10],
  ],
  'Vidéo — coulisses torréfaction': [
    [people.omar, '@Sara la cliente a demandé un deuxième fond, je refais la scène 3.', -3, 16],
    [people.sara, 'Ok, c’est le dernier tour inclus, on reste dans le forfait.', -3, 17],
  ],
  'Vidéo — essai Volta E-City': [[people.salma, 'Prêt pour la validation interne, sous-titres FR + AR inclus.', -1, 15]],
};
for (const [title, lines] of Object.entries(chats)) {
  const task = records.find((r) => r.kind === 'task' && r.name === title), taskId = task.id;
  lines.forEach(([p, text, off, h], i) => push({
    id: `demo-m-${taskId}-${i}`, kind: 'comment', revision: 1, name: text, taskId, clientId: task.clientId, author: p.name, authorId: p.id,
    createdAt: iso(off, h), ...(p.role === 'client' ? { audience: 'client' } : {}),
  }, p.id));
}

// Meetings, shoots, prospects
push({ id: 'demo-meet-1', kind: 'meeting', revision: 1, name: 'Point mensuel — plan de novembre', clientId: 'demo-c-zitoun', due: day(1), time: '10:00', duration: 45, callMode: 'video', attendees: [people.yassine.id, people.lina.id], attendeeNames: [people.sara.name, people.yassine.name, people.lina.name], description: 'Revue des chiffres d’octobre et validation du plan de novembre.', createdAt: iso(-5), authorId: people.sara.id, author: people.sara.name });
push({ id: 'demo-meet-2', kind: 'meeting', revision: 1, name: 'Lancement campagne E-City', clientId: 'demo-c-volta', due: day(3), time: '15:30', duration: 60, callMode: 'video', attendees: [people.omar.id], attendeeNames: [people.sara.name, people.omar.name], description: '', createdAt: iso(-2), authorId: people.sara.id, author: people.sara.name });
push({ id: 'demo-meet-3', kind: 'meeting', revision: 1, name: 'Debrief shooting spa', clientId: 'demo-c-dar', due: day(-4), time: '11:00', duration: 30, callMode: 'audio', attendees: [people.lina.id], attendeeNames: [people.sara.name, people.lina.name], description: '', createdAt: iso(-10), endedAt: iso(-4, 11), endedBy: people.sara.name, authorId: people.sara.id, author: people.sara.name });
push({ id: 'demo-shoot-1', kind: 'shoot', revision: 1, name: 'Shooting carte d’hiver', shootType: 'external', clientId: 'demo-c-zitoun', due: day(2), time: '08:30', duration: 180, location: 'Café Zitoun, Maârif', attendees: [people.omar.id, people.lina.id], attendeeNames: [people.omar.name, people.lina.name], externalCrew: 'Ali (assistant lumière)', description: 'Boissons chaudes, pâtisseries, 3 portraits équipe.', clientDecision: { state: 'confirmed', by: people.client.name, at: iso(-1) }, history: [{ text: `Planifié par ${people.sara.name}`, date: iso(-6) }], createdAt: iso(-6), authorId: people.sara.id, author: people.sara.name });
push({ id: 'demo-shoot-2', kind: 'shoot', revision: 1, name: 'Session surf golden hour', shootType: 'external', clientId: 'demo-c-atlas', due: day(6), time: '17:00', duration: 120, location: 'Plage d’Anza', attendees: [people.omar.id], attendeeNames: [people.omar.name], description: 'Drone + GoPro.', history: [{ text: `Planifié par ${people.sara.name}`, date: iso(-2) }], createdAt: iso(-2), authorId: people.sara.id, author: people.sara.name });
push({ id: 'demo-shoot-3', kind: 'shoot', revision: 1, name: 'Portraits équipe studio', shootType: 'internal', due: day(-8), time: '14:00', duration: 90, location: 'Studio', attendees: [people.lina.id], attendeeNames: [people.lina.name], description: '', endedAt: iso(-8, 16), endedBy: people.sara.name, history: [], createdAt: iso(-15), authorId: people.sara.id, author: people.sara.name });
const prospects = [
  ['Riad Yasmine', 'new', 6000, 'Instagram'], ['Pâtisserie Amandine', 'contacted', 4500, 'Recommandation'], ['Clinique Sourire', 'meeting', 9000, 'Site web'],
  ['FitLab Casa', 'proposal', 12000, 'Salon'], ['Boutique Noor', 'won', 5000, 'Instagram'], ['Hôtel Ocean View', 'lost', 15000, 'LinkedIn'], ['Studio Pilates Rabat', 'contacted', 3500, 'Recommandation'],
];
prospects.forEach(([name, stage, value, source], i) => push({
  id: `demo-p-${i}`, kind: 'prospect', revision: 1, name, prospectStage: stage, estimatedValue: value, source, contact: ['Leila', 'Hamza', 'Dr. Naciri', 'Anas', 'Noor', 'M. Durand', 'Ghita'][i],
  city: ['Marrakech', 'Casablanca', 'Rabat', 'Casablanca', 'Fès', 'Agadir', 'Rabat'][i], due: day(i - 2), createdAt: iso(-40 + i * 4),
  ...(stage === 'won' || stage === 'lost' ? { closedAt: iso(-6) } : {}), ...(stage === 'lost' ? { lostReason: 'price', lostNote: 'Budget réduit pour 2027.' } : {}),
}));

// Requests from the portal
push({ id: 'demo-req-1', kind: 'request', revision: 1, name: 'Story pour la soirée jazz du jeudi', clientId: 'demo-c-zitoun', description: 'Soirée jazz ce jeudi à 20h, entrée libre. Une story le jour J et une la veille.', platforms: ['Instagram'], requestStatus: 'new', due: day(2), request: { by: people.client.name, email: people.client.email, at: iso(-0.2) }, createdAt: iso(-0.2) }, people.client.id);
push({ id: 'demo-req-2', kind: 'request', revision: 1, name: 'Visuel promo -20 % abonnement', clientId: 'demo-c-atlas', description: 'Promo pour les vacances de Toussaint.', platforms: ['Instagram', 'Facebook'], requestStatus: 'new', due: day(5), request: { by: 'Mehdi Berrada', at: iso(-1) }, createdAt: iso(-1) });

// Social posts
const postTitles = ['Latte d’automne', 'Coucher de soleil à Anza', 'Rituel hammam', 'E-City en ville', 'Bague Tifinagh', 'Brunch du dimanche', 'Cours débutant', 'Massage aux pierres', 'Essai routier', 'Collection hiver'];
postTitles.forEach((title, i) => {
  const client = clients[i % clients.length];
  const offset = i - 4;
  push({
    id: `demo-post-${i}`, kind: 'editorial_post', revision: 1, name: title, clientId: client.id, due: day(offset), time: ['09:00', '12:30', '18:00', '20:00'][i % 4],
    postType: ['Post', 'Carrousel', 'Story', 'Post'][i % 4], socialState: offset < 0 ? 'scheduled' : (i % 3 ? 'scheduled' : 'draft'),
    targets: [{ network: 'instagram', format: ['post', 'carousel', 'story', 'post'][i % 4], caption: `${title} ✨ #${client.name.replace(/\s/g, '')}` }, ...(i % 2 ? [{ network: 'facebook', format: 'post', caption: title }] : [])],
    media: (i % 4 === 1 ? [1, 2] : [1]).map((slide) => ({ url: `/demo/posts/post-${i}-${slide}.svg`, type: 'image', name: `${title} ${slide}.svg` })), description: `${title} — légende en préparation.`, createdAt: iso(offset - 7), authorId: people.salma.id, author: people.salma.name,
    ...(offset < 0 ? { publishedAt: iso(offset, 19), publishResults: { instagram: { ok: true, at: iso(offset, 19), manual: true } }, stats: { instagram: { views: 1200 + i * 431, reach: 900 + i * 210, likes: 80 + i * 17, comments: 4 + i, shares: 3 + i, saves: 10 + i * 2, at: iso(-1) } } } : {}),
    ...(client.postApproval && offset >= 0 ? { approval: { state: 'pending', at: iso(-1) } } : {}),
  }, people.salma.id);
});

// Editorial plan: Café Zitoun, next month, three branches of ideas
{
  const start = new Date(now); start.setUTCDate(1); start.setUTCMonth(start.getUTCMonth() + 1);
  const month = start.toISOString().slice(0, 7);
  const plan = {
    id: 'demo-plan-zitoun', clientId: 'demo-c-zitoun', month, shared: true, archived: false,
    branches: [{ id: 'winter', name: 'Carte d’hiver' }, { id: 'community', name: 'Communauté' }, { id: 'events', name: 'Événements' }],
    notes: 'Mois de la carte d’hiver : boissons chaudes et brunch. Confirmer la date de la soirée jazz avec Houda.',
    createdAt: iso(-3), createdBy: people.sara.id, updatedAt: iso(-1), revision: 1,
  };
  planRows.push(plan);
  [
    ['Reel — chocolat chaud à la cannelle', 'winter', 'reel', 'Gros plan sur la mousse, la cannelle qui tombe, son ASMR.', 2],
    ['Carrousel — la carte d’hiver en 5 boissons', 'winter', 'post', 'Une boisson par slide, prix et allergènes en légende.', 5],
    ['Story — sondage « thé ou café ? »', 'winter', 'story', 'Sondage du matin, résultat partagé le soir.', 8],
    ['Post — portrait de Youssef, notre barista', 'community', 'post', 'Portrait en lumière naturelle, citation sur son premier latte.', 11],
    ['Reel — un samedi au brunch', 'community', 'reel', 'Plan-séquence de l’ouverture au rush de midi.', 15],
    ['Story — soirée jazz du jeudi', 'events', 'story', 'Annonce la veille, rappel le jour J à 18 h.', 19],
    ['Post — fête de l’Indépendance', 'events', 'post', 'Visuel aux couleurs du café, message sobre.', 18],
  ].forEach(([name, branch, type, idea, dayOfMonth], i) => push({
    id: `demo-plan-item-${i}`, kind: 'plan_item', revision: 1, name, clientId: plan.clientId, status: 'À faire', publishable: true,
    due: `${month}-${String(dayOfMonth).padStart(2, '0')}`, createdAt: iso(-3), history: [{ text: `Créée par ${people.sara.name}`, date: iso(-3) }],
    planId: plan.id, planMonth: month, planBranch: branch, planType: type, planContent: idea, planShared: true, description: idea,
  }));
}

// Library
[
  ['Prompt légende Instagram chaleureuse', 'prompt', 'Écris une légende Instagram pour {client} sur {sujet}, ton chaleureux, 3 emojis max, 5 hashtags locaux.', ['Légende', 'Instagram']],
  ['Prompt idées de Reels', 'prompt', 'Propose 10 idées de Reels de 15 s pour {client} ({secteur}), chacune avec un hook de 3 mots.', ['Reel', 'Idées']],
  ['Pack LUTs cinématiques', 'preset', 'https://example.com/luts', ['Couleur']],
  ['Figma — templates stories', 'asset', 'https://www.figma.com/community', ['Story', 'Template']],
  ['Remove.bg', 'website', 'https://www.remove.bg', ['Outil']],
].forEach(([name, category, value, tags], i) => push({
  id: `demo-lib-${i}`, kind: 'library', revision: 1, name, category, ...(category === 'prompt' ? { content: value, tool: 'ChatGPT' } : { link: value }), tags,
  createdAt: iso(-20 + i), authorId: people.lina.id, author: people.lina.name, copies: 3 + i * 5, favoriteBy: i < 2 ? [people.sara.id] : [],
}, people.lina.id));

// Notifications
[
  ['Houda Zitouni a demandé des modifications sur « Story — brunch du dimanche ».', 'decision', -0.1],
  ['Nouvelle demande de Café Zitoun : « Story pour la soirée jazz du jeudi ».', 'request', -0.2],
  ['Lina Tazi a envoyé « Reel — tutoriel latte art » en validation interne.', 'reminder', -0.5],
].forEach(([name, type, off], i) => push({ id: `demo-evt-${i}`, kind: 'event', revision: 1, type, name, audience: 'studio', createdAt: iso(off, 12), read: false }, 'system'));

// ------------------------------------------------------------------ write
const hash = await hashPassword(password);
await pg.transaction(async (tx) => {
  for (const ws of [NOUR, LUNE, ...showcase.map((s) => s.ws)]) {
    await tx.query('DELETE FROM usage_counters WHERE workspace_id = $1', [ws]);
    await tx.query('DELETE FROM ai_usage WHERE workspace_id = $1', [ws]);
    await tx.query('DELETE FROM records WHERE workspace_id = $1', [ws]);
    await tx.query('DELETE FROM workspace_members WHERE workspace_id = $1', [ws]);
    await tx.query('DELETE FROM subscriptions WHERE workspace_id = $1', [ws]);
    await tx.query('DELETE FROM workspaces WHERE id = $1', [ws]);
  }
  for (const p of [...Object.values(people), ...showcase.map((s) => s.person), ...(platformPerson ? [platformPerson] : [])]) {
    await tx.query('DELETE FROM sessions WHERE user_id = $1', [p.id]);
    await tx.query('DELETE FROM users WHERE id = $1 OR email = $2', [p.id, p.email]);
    await tx.query('INSERT INTO users (id, name, email, password_hash, must_change_password, last_login_at) VALUES ($1, $2, $3, $4, false, now())', [p.id, p.name, p.email, hash]);
  }
  await tx.query('INSERT INTO workspaces (id, name, created_by, created_at) VALUES ($1, $2, $3, $4)', [NOUR, 'Atelier Nour', people.sara.id, iso(-180)]);
  await tx.query('INSERT INTO workspaces (id, name, created_by, created_at) VALUES ($1, $2, $3, now())', [LUNE, 'Studio Lune', people.nadia.id]);
  for (const p of Object.values(people)) {
    const ws = p === people.nadia ? LUNE : NOUR;
    await tx.query('INSERT INTO workspace_members (workspace_id, user_id, role, name, email, client_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [ws, p.id, p.role, p.name, p.email, p.clientId ?? null, iso(p.role === 'owner' ? -180 : -90)]);
  }
  await tx.query("INSERT INTO subscriptions (workspace_id, plan, trial_ends_at, paid_until) VALUES ($1, 'agency', $2, $3)", [NOUR, iso(-166), iso(200)]);
  await tx.query("INSERT INTO subscriptions (workspace_id, plan, trial_ends_at) VALUES ($1, 'trial', $2)", [LUNE, iso(14)]);
  const month = new Date(now).toISOString().slice(0, 7);
  const use = async (ws, u) => {
    for (const meter of ['whatsappPerMonth', 'meetingMinutesPerMonth', 'igPerMonth']) if (u[meter]) await tx.query('INSERT INTO usage_counters (workspace_id, month, meter, amount) VALUES ($1, $2, $3, $4)', [ws, month, meter, u[meter]]);
    if (u.ai) await tx.query('INSERT INTO ai_usage (workspace_id, month, calls) VALUES ($1, $2, $3)', [ws, month, u.ai]);
  };
  await use(NOUR, nourUse);
  for (const s of showcase) {
    await tx.query('INSERT INTO workspaces (id, name, created_by, created_at) VALUES ($1, $2, $3, $4)', [s.ws, s.name, s.person.id, iso(s.created)]);
    await tx.query('INSERT INTO workspace_members (workspace_id, user_id, role, name, email, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [s.ws, s.person.id, 'owner', s.person.name, s.person.email, iso(s.created)]);
    await tx.query('INSERT INTO subscriptions (workspace_id, plan, trial_ends_at, paid_until, requested_plan, requested_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [s.ws, s.plan, iso(s.trialEnds ?? s.created + 14), s.paidUntil === undefined ? null : iso(s.paidUntil), s.requested ?? null, s.requested ? iso(-1) : null]);
    for (let i = 0; i < s.clients; i++) {
      await tx.query('INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, $2, $3, $4, $5::jsonb, 1)',
        [`demo-${s.key}-c${i}`, s.person.id, s.ws, 'client', JSON.stringify({ id: `demo-${s.key}-c${i}`, kind: 'client', name: `Client ${i + 1}`, city: s.city, revision: 1, createdAt: iso(s.created + i) })]);
    }
    await use(s.ws, s.use);
  }
  await tx.query("INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, 'system', $2, 'meta', $3::jsonb, 1)",
    [`brand:${NOUR}`, NOUR, JSON.stringify({ id: `brand:${NOUR}`, name: 'Atelier Nour', color: '#1e9e8f' })]);
  for (const plan of planRows) await tx.query("INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, 'system', $2, 'meta', $3::jsonb, 1)",
    [`content-plan:${NOUR}:${plan.id}`, NOUR, JSON.stringify(plan)]);
  for (const { owner, ...r } of records) {
    const data = Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined));
    await tx.query('INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, $2, $3, $4, $5::jsonb, 1)', [r.id, owner, NOUR, r.kind, JSON.stringify(data)]);
  }
});
// Ready-made sessions, so screenshots can switch role by setting the `the-one.session` cookie
// (local http only) instead of signing in. Written to .data/ (gitignored), replaced on each run.
// A hosted demo gets none: people sign in with their e-mail and DEMO_PASSWORD.
const sessions = {};
for (const [key, p] of remote ? [] : [...Object.entries(people), ...(platformPerson ? [['platform', platformPerson]] : [])]) {
  const token = randomBytes(32).toString('hex');
  const hashed = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('hex');
  await pg.query('INSERT INTO sessions (session_token, user_id, expires) VALUES ($1, $2, $3)', [hashed, p.id, iso(7)]);
  sessions[key] = token;
}
if (!remote) writeFileSync(join(root, '.data', 'demo-sessions.json'), JSON.stringify(sessions, null, 2));
await pg.close();
console.log(`Seeded ${records.length} records in Atelier Nour, the empty Studio Lune and ${showcase.length} more agencies for the Plateforme page.`);
if (platformPerson) console.log(`  platform ${platformPerson.email} (OWNER_EMAIL)`);
console.log('Accounts (password = DEMO_PASSWORD in .env):');
for (const p of Object.values(people)) console.log(`  ${p.role.padEnd(8)} ${p.email}`);

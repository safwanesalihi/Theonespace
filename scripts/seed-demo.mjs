// Local demo data for screenshots and sales demos: `node scripts/seed-demo.mjs` with the dev server STOPPED
// (PGlite in .data/pglite allows one process). Creates two company workspaces:
//   - « Atelier Nour »: a busy agency (teal brand, every role, clients, tasks in every status, chat,
//     meetings, shoots, CRM, social posts, library, requests);
//   - « Studio Lune »: an agency that just signed up (trial, no data) for the first-run screens.
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
  const [{ n }] = (await pg.query("SELECT count(*)::int AS n FROM workspaces WHERE id NOT IN ('ws:org:demo-atelier-nour', 'ws:org:demo-studio-lune')")).rows;
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

const titles = [
  ['Reel — lancement carte d’hiver', 'Reel'], ['Carrousel — 5 boissons chaudes', 'Carrousel'], ['Story — brunch du dimanche', 'Story'],
  ['Post — portrait de l’équipe', 'Post'], ['Shooting produits — saison 2', 'Shooting'], ['Vidéo — coulisses torréfaction', 'Vidéo'],
  ['Reel — session coucher de soleil', 'Reel'], ['Post — offre stage Toussaint', 'Post'], ['Carrousel — 3 spots secrets', 'Carrousel'],
  ['Story — avis clients', 'Story'], ['Reel — rituel hammam', 'Reel'], ['Post — nouvelle gamme huiles', 'Post'],
  ['Carrousel — routine soin hiver', 'Carrousel'], ['Vidéo — essai Volta E-City', 'Vidéo'], ['Post — portes ouvertes showroom', 'Post'],
  ['Reel — 0 à 100 en silence', 'Reel'], ['Carrousel — comparatif autonomie', 'Carrousel'], ['Story — sondage couleur', 'Story'],
  ['Post — collection Amazigh', 'Post'], ['Reel — making-of bague', 'Reel'], ['Carrousel — guide des tailles', 'Carrousel'],
  ['Copywriting — newsletter novembre', 'Texte'], ['Prémontage — interview fondatrice', 'Montage'], ['Post — fête de l’Indépendance', 'Post'],
  ['Reel — tutoriel latte art', 'Reel'], ['Story — quiz surf', 'Story'], ['Post — témoignage cliente spa', 'Post'],
  ['Reel — livraison clients', 'Reel'], ['Carrousel — entretien bijoux', 'Carrousel'], ['Post — Black Friday', 'Post'],
  ['Story — jeu concours', 'Story'], ['Reel — tournée des plages', 'Reel'], ['Post — recrutement barista', 'Post'],
  ['Vidéo — film de marque 30 s', 'Vidéo'], ['Carrousel — chiffres de l’année', 'Carrousel'], ['Post — horaires Ramadan', 'Post'],
];
const statusPlan = ['À faire', 'À faire', 'En cours', 'En cours', 'En cours', 'En pause', 'Validation interne', 'Validation interne', 'À valider', 'À valider', 'À valider', 'Validé', 'Validé', 'Validé', 'Validé', 'Validé'];
const creatives = [people.lina, people.omar, people.salma, people.yassine];
const priorities = ['Moyenne', 'Haute', 'Basse', 'Moyenne', 'Urgente', 'Moyenne'];

const records = [];
const push = (r, owner = people.sara.id) => records.push({ owner, ...r });

for (const c of clients) {
  push({ ...c, kind: 'client', revision: 1, createdAt: iso(-120), channels: ['Instagram', 'Facebook'], ...(briefs[c.id] ? { brief: briefs[c.id] } : {}) });
}

let n = 0;
for (const [title, type] of titles) {
  const client = clients[n % clients.length];
  const status = statusPlan[n % statusPlan.length];
  const who = creatives[n % creatives.length];
  const offset = status === 'Validé' ? -((n % 9) + 1) : (n % 17) - 3;
  const id = `demo-t-${String(n + 1).padStart(2, '0')}`;
  const task = {
    id, kind: 'task', revision: 1, name: title, clientId: client.id, assignee: who.name, assigneeId: who.id,
    due: day(offset), status, priority: priorities[n % priorities.length], channel: type === 'Story' ? 'Instagram' : (n % 3 ? 'Instagram' : 'Facebook'),
    description: `${type} pour ${client.name}. Brief validé, voir le dossier Drive pour les rushs.`,
    createdAt: iso(offset - 14), publishable: !['Texte', 'Montage'].includes(type), source: n % 7 === 3 ? 'Portail' : 'Studio',
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
    if (status === 'À valider') { task.sentAt = iso(-1, 9 + (n % 6)); task.approvalDueAt = new Date(Date.parse(task.sentAt) + 48 * 3600_000).toISOString(); }
    task.history.push({ text: 'Envoyé au client pour validation', date: task.sentAt });
  }
  if (status === 'Validé') {
    task.validatedAt = iso(offset - 1, 15);
    task.revisionRound = n % 4 === 0 ? 1 : 0;
    task.signOff = { mode: n % 5 === 0 ? 'silence' : 'explicit', by: client.contact, email: client.email, at: task.validatedAt, round: task.revisionRound };
    if (offset < -2) task.publishedAt = iso(offset, 18);
  }
  if (status === 'Validation interne' && n % 2) task.internalReview = undefined;
  if (n === 2) task.revisionRound = 2;
  push(task);
  n += 1;
}
// Undated validated reserve (evergreen)
for (const [i, c] of clients.slice(0, 3).entries()) {
  push({ id: `demo-t-ever-${i}`, kind: 'task', revision: 1, name: `Evergreen — ${['astuce du barista', 'conseil sécurité', 'rituel beauté'][i]}`, clientId: c.id, status: 'Validé', evergreen: true, priority: 'Basse', assignee: people.lina.name, assigneeId: people.lina.id, createdAt: iso(-30), validatedAt: iso(-20), signOff: { mode: 'explicit', by: c.contact, at: iso(-20), round: 0 } });
}

// Chat on a few tasks
const chats = {
  'demo-t-09': [
    [people.lina, 'Première version du Reel prête, j’ai gardé la musique validée la semaine dernière.', -2, 10],
    [people.sara, 'Super rythme 👌 Je l’envoie à Houda.', -2, 11],
    [people.client, 'Très joli ! On peut mettre le prix du latte en plus gros à la fin ?', -1, 9],
    [people.lina, 'Oui, je m’en occupe ce matin.', -1, 10],
  ],
  'demo-t-03': [
    [people.omar, '@Sara la cliente a demandé un deuxième fond, je refais la scène 3.', -3, 16],
    [people.sara, 'Ok, c’est le dernier tour inclus, on reste dans le forfait.', -3, 17],
  ],
  'demo-t-07': [[people.salma, 'Prêt pour la validation interne, sous-titres FR + AR inclus.', -1, 15]],
};
for (const [taskId, lines] of Object.entries(chats)) {
  const task = records.find((r) => r.id === taskId);
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
    postType: ['Reel', 'Post', 'Carrousel', 'Story'][i % 4], socialState: offset < 0 ? 'scheduled' : (i % 3 ? 'scheduled' : 'draft'),
    targets: [{ network: 'instagram', format: ['reel', 'post', 'carousel', 'story'][i % 4], caption: `${title} ✨ #${client.name.replace(/\s/g, '')}` }, ...(i % 2 ? [{ network: 'facebook', format: 'post', caption: title }] : [])],
    media: [], description: `${title} — légende en préparation.`, createdAt: iso(offset - 7), authorId: people.salma.id, author: people.salma.name,
    ...(offset < 0 ? { publishedAt: iso(offset, 19), publishResults: { instagram: { ok: true, at: iso(offset, 19), manual: true } }, stats: { instagram: { views: 1200 + i * 431, reach: 900 + i * 210, likes: 80 + i * 17, comments: 4 + i, shares: 3 + i, saves: 10 + i * 2, at: iso(-1) } } } : {}),
    ...(client.postApproval && offset >= 0 ? { approval: { state: 'pending', at: iso(-1) } } : {}),
  }, people.salma.id);
});

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
  for (const ws of [NOUR, LUNE]) {
    await tx.query('DELETE FROM records WHERE workspace_id = $1', [ws]);
    await tx.query('DELETE FROM workspace_members WHERE workspace_id = $1', [ws]);
    await tx.query('DELETE FROM subscriptions WHERE workspace_id = $1', [ws]);
    await tx.query('DELETE FROM workspaces WHERE id = $1', [ws]);
  }
  for (const p of Object.values(people)) {
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
  await tx.query("INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, 'system', $2, 'meta', $3::jsonb, 1)",
    [`brand:${NOUR}`, NOUR, JSON.stringify({ id: `brand:${NOUR}`, name: 'Atelier Nour', color: '#1e9e8f' })]);
  for (const { owner, ...r } of records) {
    const data = Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined));
    await tx.query('INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, $2, $3, $4, $5::jsonb, 1)', [r.id, owner, NOUR, r.kind, JSON.stringify(data)]);
  }
});
// Ready-made sessions, so screenshots can switch role by setting the `the-one.session` cookie
// (local http only) instead of signing in. Written to .data/ (gitignored), replaced on each run.
// A hosted demo gets none: people sign in with their e-mail and DEMO_PASSWORD.
const sessions = {};
for (const [key, p] of remote ? [] : Object.entries(people)) {
  const token = randomBytes(32).toString('hex');
  const hashed = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('hex');
  await pg.query('INSERT INTO sessions (session_token, user_id, expires) VALUES ($1, $2, $3)', [hashed, p.id, iso(7)]);
  sessions[key] = token;
}
if (!remote) writeFileSync(join(root, '.data', 'demo-sessions.json'), JSON.stringify(sessions, null, 2));
await pg.close();
console.log(`Seeded ${records.length} records in Atelier Nour, and the empty Studio Lune.`);
console.log('Accounts (password = DEMO_PASSWORD in .env):');
for (const p of Object.values(people)) console.log(`  ${p.role.padEnd(8)} ${p.email}`);

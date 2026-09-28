// « Plan Éditorial »: a client's content profile (filled once) and the monthly plans generated from it.
// This module is pure (browser and server): the types, the deterministic month skeleton — every reel
// and post slot, placed by code so the counts always equal the contract's quotas — the shoot days, the
// recurring stories, and the checks run on what the AI writes into the slots (lib/content-plan-ai.ts).
// Storage and the API live in lib/content-plan-server.ts and app/api/content-plan/route.ts.

export type SlotType = 'reel' | 'post';
export type SeriesFormat = 'reel' | 'post' | 'story';
export type Frequency = 'weekly' | 'biweekly' | 'first' | 'last';
export const contentLanguages = ['darija', 'arabe', 'français'] as const;
export type ContentLanguage = (typeof contentLanguages)[number];
export const planPlatforms = ['Instagram', 'Facebook', 'TikTok'] as const;
/** Weekdays as JavaScript numbers them (0 = Sunday), listed Monday first for the forms. */
export const weekdays = [1, 2, 3, 4, 5, 6, 0] as const;
export const weekdayLabels: Record<number, string> = { 0: 'Dim', 1: 'Lun', 2: 'Mar', 3: 'Mer', 4: 'Jeu', 5: 'Ven', 6: 'Sam' };
export const frequencyLabels: Record<Frequency, string> = { weekly: 'Chaque semaine', biweekly: 'Une semaine sur deux', first: 'Premier du mois', last: 'Dernier du mois' };

export type Series = { name: string; format: SeriesFormat; weekday: number; frequency: Frequency; description: string; presenter: string };
export type RecurringStory = { name: string; time: string; days: number[] };
export type Person = { name: string; role: string; speciality: string };

export type ContentProfile = {
  sector: string; city: string; offer: string;
  goal: string; situation: string;
  audiences: string[];
  languages: ContentLanguage[];
  platforms: string[];
  quotas: { reels: number; posts: number; storiesPerDay: number };
  shootDays: number;
  /** Weekdays that receive the reels and posts not taken by a series (default reels Tue/Thu/Sun, posts Mon/Wed/Fri). */
  rhythm: { reels: number[]; posts: number[] };
  series: Series[];
  stories: RecurringStory[];
  formats: string[];
  people: Person[];
  schedule: string;
  ctaAllowed: string[];
  ctaForbidden: string[];
  proofRules: string;
  notes: string;
  updatedAt?: string;
  updatedBy?: string;
};

export const emptyProfile = (): ContentProfile => ({
  sector: '', city: '', offer: '', goal: '', situation: '', audiences: [], languages: ['français'], platforms: ['Instagram'],
  quotas: { reels: 8, posts: 8, storiesPerDay: 3 }, shootDays: 2, rhythm: { reels: [2, 4, 0], posts: [1, 3, 5] },
  series: [], stories: [], formats: [], people: [], schedule: '', ctaAllowed: [], ctaForbidden: [], proofRules: '', notes: '',
});

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v: unknown, max: number, count = 40) => (Array.isArray(v) ? v.map((x) => text(x, max)).filter(Boolean).slice(0, count) : []);
const int = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const days = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
const time = (v: unknown) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.trim()) ? v.trim() : '');

/** A profile as typed in the form or read back from storage, cleaned and bounded. */
export function normalizeProfile(input: unknown): ContentProfile {
  const p = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const base = emptyProfile();
  const quotas = (p.quotas && typeof p.quotas === 'object' ? p.quotas : {}) as Record<string, unknown>;
  const rhythm = (p.rhythm && typeof p.rhythm === 'object' ? p.rhythm : {}) as Record<string, unknown>;
  const reelDays = days(rhythm.reels), postDays = days(rhythm.posts);
  return {
    sector: text(p.sector, 120), city: text(p.city, 80), offer: text(p.offer, 600),
    goal: text(p.goal, 400), situation: text(p.situation, 400),
    audiences: list(p.audiences, 80, 12),
    languages: (Array.isArray(p.languages) ? p.languages : []).filter((l): l is ContentLanguage => contentLanguages.includes(l as ContentLanguage)),
    platforms: (Array.isArray(p.platforms) ? p.platforms : []).filter((x): x is string => planPlatforms.includes(x as (typeof planPlatforms)[number])),
    quotas: { reels: int(quotas.reels, 0, 60, base.quotas.reels), posts: int(quotas.posts, 0, 60, base.quotas.posts), storiesPerDay: int(quotas.storiesPerDay, 0, 20, base.quotas.storiesPerDay) },
    shootDays: int(p.shootDays, 0, 8, base.shootDays),
    rhythm: { reels: reelDays.length ? reelDays : base.rhythm.reels, posts: postDays.length ? postDays : base.rhythm.posts },
    series: (Array.isArray(p.series) ? p.series : []).slice(0, 20).map((s: Record<string, unknown>) => ({
      name: text(s?.name, 80), format: (['reel', 'post', 'story'].includes(s?.format as string) ? s.format : 'reel') as SeriesFormat,
      weekday: int(s?.weekday, 0, 6, 1), frequency: (['weekly', 'biweekly', 'first', 'last'].includes(s?.frequency as string) ? s.frequency : 'weekly') as Frequency,
      description: text(s?.description, 400), presenter: text(s?.presenter, 80),
    })).filter((s) => s.name),
    stories: (Array.isArray(p.stories) ? p.stories : []).slice(0, 20).map((s: Record<string, unknown>) => ({ name: text(s?.name, 80), time: time(s?.time), days: days(s?.days) })).filter((s) => s.name),
    formats: list(p.formats, 80, 40),
    people: (Array.isArray(p.people) ? p.people : []).slice(0, 30).map((x: Record<string, unknown>) => ({ name: text(x?.name, 80), role: text(x?.role, 80), speciality: text(x?.speciality, 80) })).filter((x) => x.name),
    schedule: text(p.schedule, 4000), ctaAllowed: list(p.ctaAllowed, 120, 20), ctaForbidden: list(p.ctaForbidden, 120, 20),
    proofRules: text(p.proofRules, 1000), notes: text(p.notes, 20000),
    ...(typeof p.updatedAt === 'string' ? { updatedAt: p.updatedAt } : {}),
    ...(typeof p.updatedBy === 'string' ? { updatedBy: p.updatedBy } : {}),
  };
}

/** What a profile still needs before a month can be generated. */
export function profileGaps(p: ContentProfile): string[] {
  const gaps: string[] = [];
  if (!p.sector && !p.offer) gaps.push('le secteur ou l’offre');
  if (!p.goal) gaps.push('l’objectif n°1');
  if (!p.languages.length) gaps.push('la langue du contenu');
  if (!p.platforms.length) gaps.push('les plateformes');
  if (!p.ctaAllowed.length) gaps.push('au moins un CTA autorisé');
  if (p.quotas.reels + p.quotas.posts === 0) gaps.push('les quotas de reels et de posts');
  return gaps;
}

// ---------------------------------------------------------------- months and dates

export const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const monthNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
export const monthLabel = (month: string) => `${monthNames[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
export const nextMonth = (month: string, by = 1) => {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => iso(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000));
export const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
export function daysOf(month: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${month}-01T00:00:00Z`); iso(d).startsWith(month); d = new Date(d.getTime() + 86_400_000)) out.push(iso(d));
  return out;
}
export const inMonth = (day: string, month: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && day.startsWith(`${month}-`) && daysOf(month).includes(day);

// ---------------------------------------------------------------- the skeleton

export type Slot = { code: string; date: string; type: SlotType; serie: string };
export type ShootDay = { label: string; date: string };
export type Skeleton = { month: string; slots: Slot[]; shootDays: ShootDay[]; stories: StoryRow[] };
export type StoryRow = { time: string; name: string; days: number[]; note: string };

/** The dates a series falls on in the month. */
function seriesDates(month: string, s: Series): string[] {
  const all = daysOf(month).filter((d) => weekdayOf(d) === s.weekday);
  if (s.frequency === 'first') return all.slice(0, 1);
  if (s.frequency === 'last') return all.slice(-1);
  if (s.frequency === 'biweekly') return all.filter((_, i) => i % 2 === 0);
  return all;
}

/** `k` items picked evenly across `items` (keeps order); fewer items than `k` returns them all. */
function spread<T>(items: T[], k: number): T[] {
  if (k <= 0) return [];
  if (items.length <= k) return [...items];
  return Array.from({ length: k }, (_, i) => items[Math.floor(((i + 0.5) * items.length) / k)]);
}

/**
 * The month's slots, placed by code — never by the AI — so the counts are exact:
 * 1. every reel/post series on its weekday (a series over quota loses its last dates, the last series first);
 * 2. the rest of each quota spread evenly on the profile's rhythm days (reels Tue/Thu/Sun, posts Mon/Wed/Fri
 *    by default), extra rhythm days dropped evenly; missing ones added on free days;
 * 3. codes R1…/P1… in date order; the shoot days (J1 before the first publication, the others spread,
 *    J2 mid-month when there are two); the recurring stories, story-format series included.
 */
export function buildSkeleton(profile: ContentProfile, month: string): Skeleton {
  const monthDays = daysOf(month);
  const slots: Omit<Slot, 'code'>[] = [];
  for (const type of ['reel', 'post'] as SlotType[]) {
    const quota = type === 'reel' ? profile.quotas.reels : profile.quotas.posts;
    // 1. series, in the profile's order (the first series matters most).
    let fixed: Omit<Slot, 'code'>[] = [];
    for (const s of profile.series.filter((x) => x.format === type)) {
      for (const date of seriesDates(month, s)) if (!fixed.some((f) => f.date === date)) fixed.push({ date, type, serie: s.name });
    }
    while (fixed.length > quota) {
      const lastSeries = fixed[fixed.length - 1].serie;
      const ofIt = fixed.filter((f) => f.serie === lastSeries).sort((a, b) => a.date.localeCompare(b.date));
      const drop = ofIt[ofIt.length - 1];
      fixed = fixed.filter((f) => f !== drop);
    }
    // 2. the rest on the rhythm days, spread evenly; then free days if the rhythm is too short.
    const taken = new Set(fixed.map((f) => f.date));
    const rhythm = type === 'reel' ? profile.rhythm.reels : profile.rhythm.posts;
    const need = quota - fixed.length;
    const onRhythm = spread(monthDays.filter((d) => rhythm.includes(weekdayOf(d)) && !taken.has(d)), need);
    onRhythm.forEach((d) => taken.add(d));
    const busy = new Set([...slots.map((s) => s.date), ...taken]);
    const extra = spread(monthDays.filter((d) => !busy.has(d) && weekdayOf(d) !== 6), need - onRhythm.length);
    extra.forEach((d) => taken.add(d));
    const stillMissing = need - onRhythm.length - extra.length;
    const doubled = stillMissing > 0 ? spread(monthDays.filter((d) => rhythm.includes(weekdayOf(d))), stillMissing) : [];
    slots.push(...fixed, ...[...onRhythm, ...extra, ...doubled].map((date) => ({ date, type, serie: '' })));
  }
  slots.sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? 0 : a.type === 'reel' ? -1 : 1));
  let r = 0, p = 0;
  const coded: Slot[] = slots.map((s) => ({ ...s, code: s.type === 'reel' ? `R${++r}` : `P${++p}` }));

  // Shoot days: J1 two days before the first publication (no Sunday; may fall in the previous month),
  // the others spread over the month, J2 around the 15th when there are two.
  const shootDays: ShootDay[] = [];
  if (profile.shootDays > 0) {
    const first = coded[0]?.date ?? `${month}-01`;
    let j1 = addDays(first, -2);
    while (weekdayOf(j1) === 0) j1 = addDays(j1, -1);
    shootDays.push({ label: 'J1', date: j1 });
    for (let i = 1; i < profile.shootDays; i++) {
      let d = monthDays[Math.min(monthDays.length - 1, Math.round((i * monthDays.length) / profile.shootDays))];
      if (profile.shootDays === 2) d = `${month}-15`;
      while (weekdayOf(d) === 0) d = addDays(d, 1);
      shootDays.push({ label: `J${i + 1}`, date: d });
    }
  }

  const stories: StoryRow[] = [
    ...profile.stories.map((s) => ({ time: s.time, name: s.name, days: s.days.length ? s.days : [0, 1, 2, 3, 4, 5, 6], note: '' })),
    ...profile.series.filter((s) => s.format === 'story').map((s) => ({ time: '', name: s.name, days: [s.weekday], note: s.frequency === 'weekly' ? '' : frequencyLabels[s.frequency] })),
  ].sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
  return { month, slots: coded, shootDays, stories };
}

export const shootOptions = (skeleton: Pick<Skeleton, 'shootDays'>) => [...skeleton.shootDays.map((d) => d.label), 'rushes existants', 'aucun'];

// ---------------------------------------------------------------- the AI's answer, checked

export type DraftItem = { code: string; titre: string; format: string; hook: string; contenu: string; cta: string; personnes: string[]; jour_tournage: string };
export type Draft = {
  overview: string;
  items: DraftItem[];
  stories: { notes: { name: string; note: string }[]; special: { date: string; name: string; type: string; note: string }[] };
  production: { jours: { jour: string; elements: { contenu: string; duree: string }[] }[]; reserve: string[] };
  questions_client: string[];
};

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Checks the AI's draft against the skeleton and the profile: one entry per slot (matched by code, date
 * and type always taken from the skeleton), nothing empty, CTAs only from the allowed list and never
 * from the forbidden one, people only from the profile, special stories inside the month, and the
 * sections filled. Returns the usable items and the list of problems (empty = valid).
 */
export function checkDraft(
  draft: Partial<Draft> | null | undefined, skeleton: Skeleton, profile: ContentProfile,
  { codes: onlyCodes, sections = !onlyCodes }: { codes?: string[]; sections?: boolean } = {},
) {
  const problems: string[] = [];
  const wanted = onlyCodes ? skeleton.slots.filter((s) => onlyCodes.includes(s.code)) : skeleton.slots;
  const byCode = new Map((Array.isArray(draft?.items) ? draft.items : []).map((i) => [String(i?.code ?? '').trim().toUpperCase(), i]));
  const allowed = new Map(profile.ctaAllowed.map((c) => [norm(c), c]));
  const forbidden = profile.ctaForbidden.map(norm).filter(Boolean);
  const people = new Map(profile.people.map((p) => [norm(p.name), p.name]));
  const shoots = shootOptions(skeleton);
  const items: (DraftItem & Slot)[] = [];
  for (const slot of wanted) {
    const it = byCode.get(slot.code);
    if (!it) { problems.push(`${slot.code} (${slot.date}) : absent de la réponse`); continue; }
    const missing = (['titre', 'hook', 'contenu'] as const).filter((k) => !text(it[k], 2000));
    if (missing.length) problems.push(`${slot.code} : ${missing.join(', ')} vide`);
    let cta = text(it.cta, 200);
    if (cta && forbidden.some((f) => norm(cta).includes(f))) { problems.push(`${slot.code} : CTA interdit « ${cta} »`); cta = ''; }
    if (cta && !allowed.has(norm(cta))) { problems.push(`${slot.code} : CTA hors liste « ${cta} »`); cta = ''; }
    else if (cta) cta = allowed.get(norm(cta))!;
    if (!cta && allowed.size) problems.push(`${slot.code} : CTA manquant`);
    const personnes = (Array.isArray(it.personnes) ? it.personnes : []).map((n) => people.get(norm(String(n)))).filter((n): n is string => !!n);
    const jour = shoots.find((s) => norm(s) === norm(String(it.jour_tournage ?? ''))) ?? (slot.type === 'post' ? 'aucun' : shoots[0] ?? 'aucun');
    items.push({
      ...slot, titre: text(it.titre, 80), format: text(it.format, 120), hook: text(it.hook, 400), contenu: text(it.contenu, 1200),
      cta, personnes: [...new Set(personnes)], jour_tournage: jour,
    });
  }
  if (sections) {
    const extra = [...byCode.keys()].filter((c) => !wanted.some((s) => s.code === c));
    if (extra.length) problems.push(`codes en trop ignorés : ${extra.join(', ')}`);
    if (!text(draft?.overview, 2000)) problems.push('vue d’ensemble vide');
    const special = Array.isArray(draft?.stories?.special) ? draft!.stories!.special : [];
    special.filter((s) => !inMonth(String(s?.date ?? ''), skeleton.month)).forEach((s) => problems.push(`story spéciale hors du mois : ${s?.date ?? '?'}`));
    if (!special.length) problems.push('aucune story spéciale');
    if (!(Array.isArray(draft?.production?.jours) && draft!.production!.jours.length) && skeleton.shootDays.length) problems.push('plan de production vide');
    if (!(Array.isArray(draft?.questions_client) && draft!.questions_client.length)) problems.push('questions client vides');
  }
  const counts = { reels: items.filter((i) => i.type === 'reel').length, posts: items.filter((i) => i.type === 'post').length };
  return { items, problems, counts };
}

// ---------------------------------------------------------------- what is stored

export type PlanStory = { time: string; name: string; days: number[]; note: string };
export type PlanSpecialStory = { date: string; name: string; type: string; note: string };
export type PlanProductionRow = { step: string; date: string; content: string };
export type PlanQuestion = { text: string; done: boolean };

export type ContentPlan = {
  id: string; clientId: string; month: string; focus: string;
  overview: string;
  counts: { reels: number; posts: number };
  quotas: { reels: number; posts: number };
  stories: PlanStory[];
  specialStories: PlanSpecialStory[];
  production: PlanProductionRow[];
  reserve: string[];
  questions: PlanQuestion[];
  shootDays: ShootDay[];
  warnings: string[];
  shared: boolean;
  archived: boolean;
  generatedWith: string;
  createdAt: string; createdBy: string; updatedAt: string;
  revision: number;
};

/** A plan item is a real task (kind 'task') carrying these fields besides the usual ones. */
export type PlanItemFields = {
  planId: string; planCode: string; planType: SlotType; planSerie: string; planFormat: string;
  planHook: string; planContent: string; planCta: string; planPeople: string[]; planShoot: string; planLocked?: boolean; planShared?: boolean;
};

/** The task's description, rebuilt from the plan fields so the usual task page reads well. */
export function itemDescription(f: Pick<PlanItemFields, 'planType' | 'planSerie' | 'planFormat' | 'planHook' | 'planContent' | 'planCta' | 'planPeople' | 'planShoot'>) {
  return [
    `${f.planType === 'reel' ? 'Reel' : 'Post'}${f.planSerie ? ` · Série « ${f.planSerie} »` : ''}${f.planFormat ? ` · ${f.planFormat}` : ''}`,
    f.planHook && `Hook : ${f.planHook}`,
    f.planContent && `Contenu : ${f.planContent}`,
    f.planCta && `CTA : ${f.planCta}`,
    f.planPeople.length ? `À l’écran : ${f.planPeople.join(', ')}` : '',
    f.planShoot && `Tournage : ${f.planShoot}`,
  ].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------- the test client

/** Centre Alkhaouarizmi (Tanger): the example profile used by the tests and the demo seed. */
export const alkhaouarizmiProfile: ContentProfile = normalizeProfile({
  sector: 'Soutien scolaire et orientation', city: 'Tanger',
  offer: 'Centre de soutien scolaire (collège, tronc commun, bac) et accompagnement à l’orientation après le bac.',
  goal: 'Être LA référence de l’orientation scolaire à Tanger.',
  situation: 'Centre complet → pas de CTA d’inscription ; seulement la liste d’attente.',
  audiences: ['Parents d’élèves', 'Élèves du collège', 'Élèves du tronc commun et du bac'],
  languages: ['darija', 'arabe'], platforms: ['Instagram', 'Facebook', 'TikTok'],
  quotas: { reels: 12, posts: 12, storiesPerDay: 4 }, shootDays: 2,
  rhythm: { reels: [2, 4, 0], posts: [1, 3, 5] },
  series: [
    { name: 'الخوارزمي يوجه', format: 'reel', weekday: 4, frequency: 'weekly', description: 'Reel d’orientation : une question d’orientation, une réponse claire (filières, écoles, concours).', presenter: 'Le directeur' },
    { name: 'دقيقة مع أستاذ', format: 'reel', weekday: 2, frequency: 'weekly', description: 'Un conseil concret d’un professeur, en une minute.', presenter: 'Un professeur' },
    { name: 'Élève du mois', format: 'post', weekday: 5, frequency: 'last', description: 'Portrait d’un élève (avec accord des parents) : son parcours, ses progrès.', presenter: '' },
    { name: 'Élève de la semaine', format: 'story', weekday: 6, frequency: 'weekly', description: 'Story qui met en avant un élève de la semaine.', presenter: '' },
  ],
  stories: [
    { name: 'حكمة اليوم', time: '08:00', days: [0, 1, 2, 3, 4, 5, 6] },
    { name: 'هل تعلم', time: '13:00', days: [0, 1, 2, 3, 4, 5, 6] },
    { name: 'Best of the day (vidéo)', time: '20:30', days: [1, 2, 3, 4, 5] },
    { name: 'تذكير بحصص الغد', time: '21:30', days: [0, 1, 2, 3, 4] },
  ],
  formats: ['Histoire d’élève', 'Coulisses', 'Sketch', 'Motion design', 'Voix d’élève', 'Réponse à un commentaire', 'Carrousel conseils', 'Question aux parents'],
  people: [
    { name: 'Le directeur', role: 'Directeur', speciality: 'Orientation' },
    { name: 'Professeur de mathématiques', role: 'Professeur', speciality: 'Mathématiques' },
    { name: 'Professeur de physique', role: 'Professeur', speciality: 'Physique-chimie' },
    { name: 'Professeure de français', role: 'Professeure', speciality: 'Français' },
  ],
  schedule: 'Séances du dimanche au jeudi, 17:00–21:00 ; samedi matin : ateliers d’orientation.',
  ctaAllowed: ['Enregistrez ce post', 'Partagez avec un parent', 'Posez votre question en commentaire', 'Inscrivez-vous sur la liste d’attente'],
  ctaForbidden: ['Inscrivez-vous maintenant', 'Réservez votre place'],
  proofRules: 'Pas de statistiques ni de pourcentages : uniquement des cas individuels, avec l’accord des parents.',
  notes: 'Ton rassurant et expert. Montrer la méthode et l’accompagnement, jamais la pression. Mettre en avant l’orientation (choix de filière, écoles, concours) plus que le soutien.',
});

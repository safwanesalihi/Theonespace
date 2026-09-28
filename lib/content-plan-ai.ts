// The AI half of the Plan Éditorial (lib/content-plan.ts builds the slots; this fills them). Gemini with a
// responseSchema when GEMINI_API_KEY is set, otherwise Groq with a strict JSON schema (the app's usual
// AI, lib/ai.ts). Either way the answer is constrained to the slot codes, the allowed CTAs, the people of
// the profile and the shoot days, then checked again in code (checkDraft); one retry with the list of
// problems, and whatever is still wrong is reported instead of silently saved.
import { env } from '@/lib/env';
import {
  checkDraft, monthLabel, shootOptions, weekdayLabels,
  type ContentProfile, type Draft, type Skeleton, type Slot,
} from '@/lib/content-plan';

export type PlanAiResult = { ok: true; draft: Partial<Draft>; model: string; problems: string[] } | { ok: false; error: string };

export const planAiConfigured = () => !!(env.GEMINI_API_KEY || env.GROQ_API_KEY);
const geminiModel = () => env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash';
const groqModel = () => env.GROQ_MODEL?.trim() || 'openai/gpt-oss-120b';
const unavailable = 'L’IA ne répond pas pour le moment : réessayez dans un instant.';

// ---------------------------------------------------------------- the answer's shape (JSON Schema)

type JsonSchema = Record<string, unknown>;
const str = (description?: string, values?: string[]): JsonSchema => ({ type: 'string', ...(description ? { description } : {}), ...(values?.length ? { enum: values } : {}) });
const arr = (items: JsonSchema, description?: string): JsonSchema => ({ type: 'array', items, ...(description ? { description } : {}) });
const obj = (properties: Record<string, JsonSchema>): JsonSchema => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

function draftSchema(skeleton: Skeleton, profile: ContentProfile, codes: string[], sections: boolean): JsonSchema {
  const item = obj({
    code: str('Le code du créneau, repris tel quel.', codes),
    titre: str('Titre court en français pour l’équipe (40 caractères max), ex. « Orientation ép.1 : quelle filière après le bac ? ».'),
    format: str('Format précis : « reel 30–60 s », « carrousel 6 slides », « poster », « motion design »…'),
    hook: str('La première phrase / accroche, dans la langue du contenu du client.'),
    contenu: str('Ce que montre le contenu, en 1–2 phrases, en français pour l’équipe.'),
    cta: str('Un CTA de la liste autorisée, repris mot pour mot.', profile.ctaAllowed),
    personnes: arr(str(undefined, profile.people.map((p) => p.name))),
    jour_tournage: str('Quand il est tourné.', shootOptions(skeleton)),
  });
  const properties: Record<string, JsonSchema> = { items: arr(item) };
  if (sections) {
    properties.overview = str('2–3 phrases sur la logique du mois, en français.');
    properties.stories = obj({
      notes: arr(obj({ name: str(undefined, skeleton.stories.map((s) => s.name)), note: str('Idée de contenu pour cette story récurrente ce mois-ci.') })),
      special: arr(obj({ date: str('AAAA-MM-JJ, dans le mois'), name: str(), type: str('quiz, sondage, boîte à questions, compte à rebours…'), note: str() })),
    });
    properties.production = obj({
      jours: arr(obj({ jour: str(undefined, skeleton.shootDays.map((d) => d.label)), elements: arr(obj({ contenu: str('Ce qui est filmé (code du créneau + sujet).'), duree: str('Durée approximative, ex. « 30 min ».') })) })),
      reserve: arr(str('Contenu de réserve à tourner pour le mois suivant.')),
    });
    properties.questions_client = arr(str('Point à valider avec le client, en français.'));
  }
  return obj(properties);
}

/** Gemini reads an OpenAPI-style schema: upper-case types, no additionalProperties. */
function toGemini(schema: JsonSchema): JsonSchema {
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'additionalProperties') continue;
    if (key === 'type') out.type = String(value).toUpperCase();
    else if (key === 'properties') out.properties = Object.fromEntries(Object.entries(value as Record<string, JsonSchema>).map(([k, v]) => [k, toGemini(v)]));
    else if (key === 'items') out.items = toGemini(value as JsonSchema);
    else out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------- the prompt

const languageRule = (profile: ContentProfile) => {
  const langs = profile.languages.map((l) => (l === 'darija' ? 'darija marocaine (écrite en lettres arabes)' : l === 'arabe' ? 'arabe standard' : 'français'));
  return `Langue des hooks : ${langs.join(' / ') || 'français'}. Varie selon le public quand plusieurs langues sont prévues.`;
};

function system(profile: ContentProfile) {
  return [
    'Tu es directeur·rice de contenu dans une agence de communication marocaine. Tu écris le plan éditorial mensuel d’un client sur Instagram, Facebook et TikTok.',
    'Les créneaux (dates, type reel/post, séries) sont déjà fixés : tu remplis chacun, tu n’en ajoutes ni n’en retires aucun.',
    languageRule(profile),
    'Le titre, le contenu, le format, la vue d’ensemble, la production et les questions sont en français (pour l’équipe).',
    'Chaque CTA vient de la liste autorisée, mot pour mot ; jamais un CTA interdit. Les personnes à l’écran viennent de la liste du profil.',
    'Respecte la situation et les règles de preuve du client. Varie les formats de la banque, sans reprendre les sujets ni les formats des mois précédents quand c’est possible.',
    'Une série garde son nom et son principe ; chaque épisode traite un sujet différent.',
  ].join('\n');
}

function profileBrief(profile: ContentProfile) {
  const { notes, ...rest } = profile;
  return JSON.stringify({ ...rest, notes: notes.slice(0, 8000) }, null, 0);
}

function slotLines(slots: Slot[]) {
  return slots.map((s) => `${s.code} · ${s.date} (${weekdayLabels[new Date(`${s.date}T00:00:00Z`).getUTCDay()]}) · ${s.type}${s.serie ? ` · série « ${s.serie} »` : ''}`).join('\n');
}

export type PlanContext = {
  profile: ContentProfile; skeleton: Skeleton; focus: string;
  /** Titles and formats of the last two months, to avoid repeating them. */
  previous: string[];
  /** Items kept as they are (locked, or the rest of the plan when one item is regenerated). */
  fixed?: { code: string; titre: string; format: string }[];
};

function userPrompt(ctx: PlanContext, codes: string[], sections: boolean) {
  const slots = ctx.skeleton.slots.filter((s) => codes.includes(s.code));
  return [
    `Mois : ${monthLabel(ctx.skeleton.month)}.`,
    ctx.focus ? `Focus du mois : ${ctx.focus}` : 'Pas de focus particulier ce mois-ci.',
    `Profil contenu du client (JSON) : ${profileBrief(ctx.profile)}`,
    `Créneaux à remplir :\n${slotLines(slots)}`,
    ctx.fixed?.length ? `Déjà écrits, à ne pas répéter :\n${ctx.fixed.map((f) => `${f.code} · ${f.titre} · ${f.format}`).join('\n')}` : '',
    ctx.previous.length ? `Mois précédents (ne pas répéter ces sujets ni enchaîner les mêmes formats) :\n${ctx.previous.slice(0, 60).join('\n')}` : '',
    sections ? `Jours de tournage : ${ctx.skeleton.shootDays.map((d) => `${d.label} = ${d.date}`).join(', ') || 'aucun'}.` : '',
    sections ? `Stories récurrentes : ${ctx.skeleton.stories.map((s) => `${s.time || '—'} ${s.name} (${s.days.map((d) => weekdayLabels[d]).join('/')})`).join(' ; ') || 'aucune'}. ${ctx.profile.quotas.storiesPerDay} stories par jour au total ; propose des stories spéciales datées (quiz, sondages, boîte à questions…).` : '',
    sections ? 'Production : pour chaque jour de tournage, ce qui est filmé (codes des créneaux) avec une durée approximative ; puis le contenu de réserve à tourner pour le mois suivant.' : '',
    sections ? 'Questions client : la liste des points à valider avec le client avant de produire.' : '',
  ].filter(Boolean).join('\n\n');
}

// ---------------------------------------------------------------- the two providers

async function callGemini(systemText: string, user: string, schema: JsonSchema): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel())}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY! },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemText }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: 16384, temperature: 0.8, responseMimeType: 'application/json', responseSchema: toGemini(schema) },
      }),
      signal: AbortSignal.timeout(110_000),
    });
  } catch (error) {
    console.error('gemini plan', (error as Error).name === 'TimeoutError' ? 'timeout' : (error as Error).message);
    return { ok: false, error: unavailable };
  }
  const data = (await response.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]; error?: { status?: string; message?: string } };
  if (!response.ok) {
    console.error('gemini plan', response.status, data.error?.status, data.error?.message);
    if (response.status === 429) return { ok: false, error: 'L’IA est très demandée : réessayez dans une minute.' };
    if (response.status === 400 && /API key/i.test(data.error?.message ?? '')) return { ok: false, error: 'Clé de l’IA refusée (GEMINI_API_KEY).' };
    if (response.status === 404) return { ok: false, error: `Modèle introuvable chez Gemini (${geminiModel()}) : vérifiez GEMINI_MODEL.` };
    return { ok: false, error: unavailable };
  }
  const text = (data.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('').trim();
  return text ? { ok: true, text } : { ok: false, error: unavailable };
}

async function callGroq(systemText: string, user: string, schema: JsonSchema): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: groqModel(), max_completion_tokens: 16000, temperature: 0.8,
        messages: [{ role: 'system', content: systemText }, { role: 'user', content: user }],
        response_format: { type: 'json_schema', json_schema: { name: 'plan_editorial', strict: true, schema } },
        ...(groqModel().startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
      }),
      signal: AbortSignal.timeout(110_000),
    });
  } catch (error) {
    console.error('groq plan', (error as Error).name === 'TimeoutError' ? 'timeout' : (error as Error).message);
    return { ok: false, error: unavailable };
  }
  const data = (await response.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[]; error?: { code?: string; message?: string } };
  if (!response.ok) {
    console.error('groq plan', response.status, data.error?.code, data.error?.message);
    if (response.status === 429) return { ok: false, error: 'L’IA est très demandée : réessayez dans une minute.' };
    if (response.status === 401 || response.status === 403) return { ok: false, error: 'Clé de l’IA refusée (GROQ_API_KEY).' };
    return { ok: false, error: unavailable };
  }
  const text = (data.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return text ? { ok: true, text } : { ok: false, error: unavailable };
}

const provider = () => (env.GEMINI_API_KEY ? { name: `Gemini ${geminiModel()}`, call: callGemini } : { name: `Groq ${groqModel()}`, call: callGroq });

/**
 * Fills `codes` of the skeleton (all of them by default), plus the month's sections when `sections`.
 * One retry, told exactly what was wrong; the problems still left are returned with the draft.
 */
export async function draftPlan(ctx: PlanContext, { codes = ctx.skeleton.slots.map((s) => s.code), sections = true }: { codes?: string[]; sections?: boolean } = {}): Promise<PlanAiResult> {
  if (!planAiConfigured()) return { ok: false, error: 'L’IA n’est pas configurée (GEMINI_API_KEY ou GROQ_API_KEY).' };
  const { name, call } = provider();
  const schema = draftSchema(ctx.skeleton, ctx.profile, codes, sections);
  const systemText = system(ctx.profile);
  let user = userPrompt(ctx, codes, sections);
  let last: { draft: Partial<Draft>; problems: string[] } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const answer = await call(systemText, user, schema);
    if (!answer.ok) { if (last) break; return answer; }
    let draft: Partial<Draft>;
    try { draft = JSON.parse(answer.text) as Partial<Draft>; } catch { draft = {}; }
    const { problems } = checkDraft(draft, ctx.skeleton, ctx.profile, { codes, sections });
    if (!last || problems.length < last.problems.length) last = { draft, problems };
    if (!problems.length) break;
    user = `${userPrompt(ctx, codes, sections)}\n\nTa réponse précédente avait ces problèmes, corrige-les et renvoie la réponse complète :\n- ${problems.join('\n- ')}`;
  }
  return last ? { ok: true, draft: last.draft, model: name, problems: last.problems } : { ok: false, error: unavailable };
}

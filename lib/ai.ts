// Writing help and the assistant, powered by Google Gemini: captions and titles for social posts (Gemini
// looks at the photos and videos themselves), a spelling/clarity pass on any text, and the floating
// assistant's answers (lib/assistant.ts). Server-only; every function returns a result and never
// throws, so a failing call only costs the button its answer.
import { env } from '@/lib/env';
import { driveDownloadUrl, driveFileId } from '@/lib/drive';
import { captionLimits, formatLabels, limits, networkLabels, type Network, type PostFormat } from '@/lib/social';

export const aiConfigured = () => !!env.GEMINI_API_KEY;
/** The Gemini model: a current, fast one by default; GEMINI_MODEL switches it without a deploy of code. */
export const aiModel = () => env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash';

export type AiResult<T> = { ok: true; data: T } | { ok: false; error: string };
type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
export type Turn = { role: 'user' | 'model'; parts: Part[] };
type GeminiAnswer = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
};

const notConfigured = 'L’IA n’est pas configurée pour cet espace (GEMINI_API_KEY).';
const unavailable = 'L’IA ne répond pas pour le moment. Réessayez.';

/** The language the studio writes in for a client: their file's language, French otherwise. */
export const writingLanguage = (language?: string) => (language === 'العربية' ? 'Arabic' : language === 'English' ? 'English' : 'French');

/** One call to Gemini: plain text back, or JSON matching `schema`. */
export async function gemini(system: string, contents: Turn[], { schema, maxOutputTokens = 8192 }: { schema?: Record<string, unknown>; maxOutputTokens?: number } = {}): Promise<AiResult<string>> {
  if (!env.GEMINI_API_KEY) return { ok: false, error: notConfigured };
  let response: Response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(aiModel())}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { maxOutputTokens, ...(schema ? { responseMimeType: 'application/json', responseSchema: schema } : {}) },
      }),
      signal: AbortSignal.timeout(55_000),
    });
  } catch (error) {
    console.error('gemini', (error as Error).name === 'TimeoutError' ? 'timeout' : (error as Error).message);
    return { ok: false, error: unavailable };
  }
  const data = (await response.json().catch(() => ({}))) as GeminiAnswer;
  if (!response.ok) {
    console.error('gemini', response.status, data.error?.status, data.error?.message);
    if (response.status === 429) return { ok: false, error: 'L’IA est très demandée : réessayez dans une minute.' };
    if (response.status === 401 || response.status === 403 || /API key/i.test(data.error?.message || '')) return { ok: false, error: 'Clé de l’IA refusée (GEMINI_API_KEY).' };
    if (response.status === 404) return { ok: false, error: `Modèle Gemini introuvable (${aiModel()}) : vérifiez GEMINI_MODEL.` };
    return { ok: false, error: unavailable };
  }
  const candidate = data.candidates?.[0];
  if (data.promptFeedback?.blockReason || ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION'].includes(candidate?.finishReason || '')) {
    return { ok: false, error: 'L’IA n’a pas pu traiter ce contenu.' };
  }
  const text = (candidate?.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('').trim();
  if (candidate?.finishReason === 'MAX_TOKENS' && !text) return { ok: false, error: 'Réponse trop longue : raccourcissez le texte.' };
  if (!text) return { ok: false, error: unavailable };
  return { ok: true, data: text };
}

async function ask<T>(system: string, parts: Part[], schema: Record<string, unknown>): Promise<AiResult<T>> {
  const answer = await gemini(system, [{ role: 'user', parts }], { schema });
  if (!answer.ok) return answer;
  try { return { ok: true, data: JSON.parse(answer.data) as T }; } catch { return { ok: false, error: unavailable }; }
}

const object = (properties: Record<string, unknown>) => ({ type: 'OBJECT', properties, required: Object.keys(properties) });
const list = { type: 'ARRAY', items: { type: 'STRING' } };

// ---------------------------------------------------------------- media Gemini looks at

export type MediaRef = { url: string; type: 'image' | 'video'; mime?: string };
export const mediaLimits = { items: 3, totalBytes: 18 * 1024 * 1024 };

/**
 * The post's photos and videos as Gemini input — only files from Google Drive or the app's own storage
 * (never an address the browser made up), at most three and 18 MB in all; the rest are left out.
 */
export async function mediaParts(media: MediaRef[], fetcher: typeof fetch = fetch): Promise<{ parts: Part[]; skipped: number }> {
  const parts: Part[] = [];
  let total = 0, skipped = 0;
  for (const item of media) {
    if (parts.length >= mediaLimits.items) { skipped++; continue; }
    const id = item.url.startsWith('https://drive.usercontent.google.com/') ? driveFileId(item.url) : null;
    const storage = env.SUPABASE_URL && item.url.startsWith(`${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/`) ? item.url : null;
    const url = id ? driveDownloadUrl(id) : storage;
    if (!url) { skipped++; continue; }
    try {
      const response = await fetcher(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
      const mime = (response.headers.get('content-type') || item.mime || '').split(';')[0].trim().toLowerCase();
      const size = Number(response.headers.get('content-length')) || 0;
      if (!response.ok || !/^(image|video)\//.test(mime) || total + size > mediaLimits.totalBytes) { await response.body?.cancel().catch(() => {}); skipped++; continue; }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (total + bytes.length > mediaLimits.totalBytes) { skipped++; continue; }
      total += bytes.length;
      parts.push({ inlineData: { mimeType: mime, data: bytes.toString('base64') } });
    } catch {
      skipped++;
    }
  }
  return { parts, skipped };
}

// ---------------------------------------------------------------- captions and titles

export type CaptionBrief = {
  network: Network; format: PostFormat; client?: string; language?: string;
  /** What the post is about: the internal title, the notes or a draft caption. */
  brief: string; current?: string;
  media?: { images: number; videos: number };
  /** The files themselves, when Gemini should look at them. */
  files?: Part[];
};

/**
 * Three captions for one network and format, a short title, and what to check before publishing
 * (the media against the format, text in the image, anything off-brand).
 */
export async function writeCaptions(input: CaptionBrief): Promise<AiResult<{ captions: string[]; title: string; checks: string[] }>> {
  const language = writingLanguage(input.language);
  const system = `You write social media captions for the clients of The One Core, a creative agency in Casablanca. Write in ${language}, in the voice of the brand itself (never mention the agency). Match the network's habits: ${networkLabels[input.network]} ${formatLabels[input.format]}. Keep each caption under ${captionLimits[input.network]} characters, with at most ${limits.hashtags} hashtags; Instagram and TikTok captions end with a few relevant hashtags, Facebook uses few or none. When photos or videos are attached, describe what they actually show; do not invent facts, prices, dates or offers that neither the media nor the brief give. The title is a short internal label for the post (under 60 characters, no hashtags). In "checks", list in French, briefly, only real problems to fix before publishing: media that does not suit the format (e.g. a horizontal video for a Reel or Story, a blurry or dark photo), spelling mistakes in text visible on the media, or content that looks off-brand or risky. Leave "checks" empty when everything is fine.`;
  const lines = [
    input.client ? `Brand: ${input.client}` : '',
    `Network: ${networkLabels[input.network]} — format: ${formatLabels[input.format]}`,
    input.media ? `Media on the post: ${input.media.images} photo(s), ${input.media.videos} video(s)${input.files?.length ? ` — ${input.files.length} attached above` : ''}` : '',
    input.brief.trim() ? `Brief:\n${input.brief}` : 'No brief: write from the media.',
    input.current?.trim() ? `Current draft (improve on it, keep what works):\n${input.current}` : '',
    'Write three different captions: one short and punchy, one storytelling, one with a clear call to action.',
  ];
  const result = await ask<{ captions: string[]; title: string; checks: string[] }>(system, [...(input.files ?? []), { text: lines.filter(Boolean).join('\n\n') }], object({ captions: list, title: { type: 'STRING' }, checks: list }));
  if (!result.ok) return result;
  const captions = (result.data.captions ?? []).map((c) => String(c).trim().slice(0, captionLimits[input.network])).filter(Boolean).slice(0, 3);
  if (!captions.length) return { ok: false, error: 'L’IA n’a pas proposé de texte. Réessayez.' };
  const checks = (result.data.checks ?? []).map((c) => String(c).trim().slice(0, 300)).filter(Boolean).slice(0, 5);
  return { ok: true, data: { captions, title: String(result.data.title ?? '').trim().slice(0, 160), checks } };
}

/** A YouTube title for a video, from its caption or notes. */
export async function writeTitle(input: { brief: string; client?: string; language?: string; format: PostFormat }): Promise<AiResult<{ titles: string[] }>> {
  const language = writingLanguage(input.language);
  const system = `You write YouTube ${input.format === 'short' ? 'Shorts' : 'video'} titles for the clients of a creative agency. Write in ${language}, in the brand's own voice. Each title is under ${limits.titleLength} characters, specific and enticing without clickbait, with no hashtags. Do not invent facts the brief does not give.`;
  const prompt = `${input.client ? `Brand: ${input.client}\n\n` : ''}What the video is about:\n${input.brief}\n\nPropose three titles.`;
  const result = await ask<{ titles: string[] }>(system, [{ text: prompt }], object({ titles: list }));
  if (!result.ok) return result;
  const titles = (result.data.titles ?? []).map((t) => String(t).trim().replace(/#\S+/g, '').trim().slice(0, limits.titleLength)).filter(Boolean).slice(0, 3);
  return titles.length ? { ok: true, data: { titles } } : { ok: false, error: 'L’IA n’a pas proposé de titre. Réessayez.' };
}

// ---------------------------------------------------------------- corrections

export const correctionKinds = ['task', 'brief', 'feedback', 'caption', 'title'] as const;
export type CorrectionKind = (typeof correctionKinds)[number];
const kindLabels: Record<CorrectionKind, string> = {
  task: 'a task name in a production tracker', brief: 'a task or client brief', feedback: 'a client’s requested changes on a deliverable',
  caption: 'a social media caption', title: 'a title',
};

/** Spelling, grammar and clarity fixed, in the text's own language, meaning and tone kept. */
export async function correctText(text: string, kind: CorrectionKind): Promise<AiResult<{ text: string; changed: boolean }>> {
  const system = `You proofread ${kindLabels[kind]}. Fix spelling, grammar, punctuation and typography (French spacing and quotes rules for French text), and make unclear wording clearer. Keep the same language, meaning, tone, length, line breaks, emojis, hashtags, mentions and links. Never add information. If the text is already correct, return it unchanged.`;
  const result = await ask<{ text: string }>(system, [{ text: `Text to correct:\n<text>\n${text}\n</text>` }], object({ text: { type: 'STRING' } }));
  if (!result.ok) return result;
  const fixed = String(result.data.text ?? '').trim();
  if (!fixed) return { ok: false, error: 'L’IA n’a pas renvoyé de texte. Réessayez.' };
  return { ok: true, data: { text: fixed, changed: fixed !== text.trim() } };
}

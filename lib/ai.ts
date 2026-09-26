// Writing help and the assistant, powered by Groq (OpenAI-compatible chat completions): captions and
// titles for social posts (a vision model looks at the photos), a spelling/clarity pass on any text, and
// the floating assistant's answers (lib/assistant.ts). Server-only; every function returns a result and
// never throws, so a failing call only costs the button its answer.
import { env } from '@/lib/env';
import { driveDownloadUrl, driveFileId, driveThumbnailUrl } from '@/lib/drive';
import { captionLimits, formatLabels, limits, networkLabels, type Network, type PostFormat } from '@/lib/social';

export const aiConfigured = () => !!env.GROQ_API_KEY;
/** Groq's production text model by default; GROQ_MODEL switches it without touching the code. */
export const aiModel = () => env.GROQ_MODEL?.trim() || 'openai/gpt-oss-120b';
/** The model that reads images (Groq's vision models are in preview): GROQ_VISION_MODEL switches it. */
export const visionModel = () => env.GROQ_VISION_MODEL?.trim() || 'meta-llama/llama-4-scout-17b-16e-instruct';

export type AiResult<T> = { ok: true; data: T } | { ok: false; error: string };
type Content = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: Content };
type GroqAnswer = {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  error?: { message?: string; type?: string; code?: string };
};

const notConfigured = 'L’IA n’est pas configurée pour cet espace (GROQ_API_KEY).';
const unavailable = 'L’IA ne répond pas pour le moment. Réessayez.';

/** The language the studio writes in for a client: their file's language, French otherwise. */
export const writingLanguage = (language?: string) => (language === 'العربية' ? 'Arabic' : language === 'English' ? 'English' : 'French');

/** One call to Groq: plain text back, or a JSON object (`json`). */
export async function chat(messages: ChatMessage[], { json = false, maxTokens = 4096, model = aiModel() }: { json?: boolean; maxTokens?: number; model?: string } = {}): Promise<AiResult<string>> {
  if (!env.GROQ_API_KEY) return { ok: false, error: notConfigured };
  let response: Response;
  try {
    response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model, messages, max_completion_tokens: maxTokens,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
        // gpt-oss thinks before answering: a little is enough for captions and corrections.
        ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
      }),
      signal: AbortSignal.timeout(55_000),
    });
  } catch (error) {
    console.error('groq', (error as Error).name === 'TimeoutError' ? 'timeout' : (error as Error).message);
    return { ok: false, error: unavailable };
  }
  const data = (await response.json().catch(() => ({}))) as GroqAnswer;
  if (!response.ok) {
    console.error('groq', response.status, data.error?.code, data.error?.message);
    if (response.status === 429) return { ok: false, error: 'L’IA est très demandée : réessayez dans une minute.' };
    if (response.status === 401 || response.status === 403) return { ok: false, error: 'Clé de l’IA refusée (GROQ_API_KEY).' };
    if (response.status === 404 || data.error?.code === 'model_not_found') return { ok: false, error: `Modèle introuvable chez Groq (${model}) : vérifiez GROQ_MODEL.` };
    return { ok: false, error: unavailable };
  }
  const choice = data.choices?.[0];
  const text = (choice?.message?.content ?? '').trim();
  if (choice?.finish_reason === 'content_filter') return { ok: false, error: 'L’IA n’a pas pu traiter ce contenu.' };
  if (choice?.finish_reason === 'length' && !text) return { ok: false, error: 'Réponse trop longue : raccourcissez le texte.' };
  if (!text) return { ok: false, error: unavailable };
  return { ok: true, data: text };
}

/** A JSON answer; `shape` is described in the prompt since every Groq model supports JSON mode. */
async function ask<T>(system: string, user: Content, shape: string, model?: string): Promise<AiResult<T>> {
  const answer = await chat([{ role: 'system', content: `${system}\n\nAnswer with one JSON object only, exactly this shape: ${shape}` }, { role: 'user', content: user }], { json: true, model });
  if (!answer.ok) return answer;
  try { return { ok: true, data: JSON.parse(answer.data) as T }; } catch { return { ok: false, error: unavailable }; }
}

// ---------------------------------------------------------------- media the AI looks at

export type MediaRef = { url: string; type: 'image' | 'video'; mime?: string };
export const mediaLimits = { items: 3, bytesPerImage: 4 * 1024 * 1024 };

/**
 * The post's pictures as data URLs for the vision model — only files from Google Drive or the app's own
 * storage (never an address the browser made up), at most three of 4 MB. A Drive video is read through
 * the preview frame Drive makes for it; other videos are left out.
 */
export async function mediaImages(media: MediaRef[], fetcher: typeof fetch = fetch): Promise<{ images: string[]; skipped: number }> {
  const images: string[] = [];
  let skipped = 0;
  for (const item of media) {
    if (images.length >= mediaLimits.items) { skipped++; continue; }
    const id = item.url.startsWith('https://drive.usercontent.google.com/') ? driveFileId(item.url) : null;
    const storage = env.SUPABASE_URL && item.type === 'image' && item.url.startsWith(`${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/`) ? item.url : null;
    const url = id ? (item.type === 'video' ? driveThumbnailUrl(id) : driveDownloadUrl(id)) : storage;
    if (!url) { skipped++; continue; }
    try {
      const response = await fetcher(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
      const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const size = Number(response.headers.get('content-length')) || 0;
      if (!response.ok || !mime.startsWith('image/') || size > mediaLimits.bytesPerImage) { await response.body?.cancel().catch(() => {}); skipped++; continue; }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > mediaLimits.bytesPerImage) { skipped++; continue; }
      images.push(`data:${mime};base64,${bytes.toString('base64')}`);
    } catch {
      skipped++;
    }
  }
  return { images, skipped };
}

// ---------------------------------------------------------------- captions and titles

export type CaptionBrief = {
  network: Network; format: PostFormat; client?: string; language?: string;
  /** What the post is about: the internal title, the notes or a draft caption. */
  brief: string; current?: string;
  media?: { images: number; videos: number };
  /** The pictures themselves (data URLs), when the AI should look at them. */
  images?: string[];
};

/**
 * Three captions for one network and format, a short title, and what to check before publishing
 * (the media against the format, text in the image, anything off-brand).
 */
export async function writeCaptions(input: CaptionBrief): Promise<AiResult<{ captions: string[]; title: string; checks: string[] }>> {
  const language = writingLanguage(input.language);
  const system = `You write social media captions for the clients of The One Core, a creative agency in Casablanca. Write in ${language}, in the voice of the brand itself (never mention the agency). Match the network's habits: ${networkLabels[input.network]} ${formatLabels[input.format]}. Keep each caption under ${captionLimits[input.network]} characters, with at most ${limits.hashtags} hashtags; Instagram and TikTok captions end with a few relevant hashtags, Facebook uses few or none. When photos or videos are attached, describe what they actually show; do not invent facts, prices, dates or offers that neither the media nor the brief give. The title is a short internal label for the post (under 60 characters, no hashtags). In "checks", list in French, briefly, only real problems to fix before publishing: media that does not suit the format (e.g. a horizontal picture for a Reel or Story, a blurry or dark photo), spelling mistakes in text visible on the media, or content that looks off-brand or risky. Leave "checks" empty when everything is fine.`;
  const lines = [
    input.client ? `Brand: ${input.client}` : '',
    `Network: ${networkLabels[input.network]} — format: ${formatLabels[input.format]}`,
    input.media ? `Media on the post: ${input.media.images} photo(s), ${input.media.videos} video(s)${input.images?.length ? ` — ${input.images.length} picture(s) attached` : ''}` : '',
    input.brief.trim() ? `Brief:\n${input.brief}` : 'No brief: write from the media.',
    input.current?.trim() ? `Current draft (improve on it, keep what works):\n${input.current}` : '',
    'Write three different captions: one short and punchy, one storytelling, one with a clear call to action.',
  ];
  const prompt = lines.filter(Boolean).join('\n\n');
  const shape = '{"captions": [string, string, string], "title": string, "checks": [string]}';
  type Answer = { captions: string[]; title: string; checks: string[] };
  // With pictures, the vision model reads them; if it can't (preview model changed, image refused),
  // the captions are still written from the brief alone.
  let result: AiResult<Answer> = input.images?.length
    ? await ask<Answer>(system, [...input.images.map((url) => ({ type: 'image_url' as const, image_url: { url } })), { type: 'text' as const, text: prompt }], shape, visionModel())
    : { ok: false, error: '' };
  if (!result.ok) result = await ask<Answer>(system, input.images?.length ? `${prompt}\n\n(The pictures could not be read: write from the brief.)` : prompt, shape);
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
  const result = await ask<{ titles: string[] }>(system, prompt, '{"titles": [string, string, string]}');
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
  const result = await ask<{ text: string }>(system, `Text to correct:\n<text>\n${text}\n</text>`, '{"text": string}');
  if (!result.ok) return result;
  const fixed = String(result.data.text ?? '').trim();
  if (!fixed) return { ok: false, error: 'L’IA n’a pas renvoyé de texte. Réessayez.' };
  return { ok: true, data: { text: fixed, changed: fixed !== text.trim() } };
}

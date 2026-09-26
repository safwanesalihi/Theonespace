// Writing help from Claude: captions and titles for social posts, and a spelling/clarity pass on any
// text (tasks, briefs, requested changes). Server-only; every function returns a result and never
// throws, so a failing call only costs the button its answer.
import Anthropic from '@anthropic-ai/sdk';
import { env } from '@/lib/env';
import { captionLimits, formatLabels, limits, networkLabels, type Network, type PostFormat } from '@/lib/social';

export const aiConfigured = () => !!env.ANTHROPIC_API_KEY;

const model = 'claude-opus-5';

export type AiResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** The language the studio writes in for a client: their file's language, French otherwise. */
export const writingLanguage = (language?: string) => (language === 'العربية' ? 'Arabic' : language === 'English' ? 'English' : 'French');

async function ask<T>(system: string, prompt: string, schema: Record<string, unknown>, effort: 'low' | 'medium'): Promise<AiResult<T>> {
  if (!env.ANTHROPIC_API_KEY) return { ok: false, error: 'L’IA n’est pas configurée pour cet espace (ANTHROPIC_API_KEY).' };
  // Built per call, fetching through the global fetch, so tests can answer for Claude.
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, fetch: (url, init) => globalThis.fetch(url, init), timeout: 60_000, maxRetries: 1 });
  try {
    const response = await client.beta.messages.create({
      model,
      max_tokens: 4000,
      // A request Claude's safety checks decline is retried on the model Anthropic recommends.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages: [{ role: 'user', content: prompt }],
      output_config: { effort, format: { type: 'json_schema', schema } },
    });
    if (response.stop_reason === 'refusal') return { ok: false, error: 'L’IA n’a pas pu traiter ce texte.' };
    if (response.stop_reason === 'max_tokens') return { ok: false, error: 'Réponse trop longue : raccourcissez le texte.' };
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    return { ok: true, data: JSON.parse(text) as T };
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return { ok: false, error: 'L’IA est très demandée : réessayez dans une minute.' };
    if (error instanceof Anthropic.AuthenticationError) return { ok: false, error: 'Clé de l’IA refusée (ANTHROPIC_API_KEY).' };
    if (error instanceof Anthropic.APIError) {
      console.error('ai', error.status, error.message);
      return { ok: false, error: 'L’IA ne répond pas pour le moment. Réessayez.' };
    }
    console.error('ai', (error as Error).message);
    return { ok: false, error: 'L’IA ne répond pas pour le moment. Réessayez.' };
  }
}

const strings = (items: Record<string, unknown>, required: string[]) => ({ type: 'object', properties: items, required, additionalProperties: false });

export type CaptionBrief = {
  network: Network; format: PostFormat; client?: string; language?: string;
  /** What the post is about: the internal title, the notes or a draft caption. */
  brief: string; current?: string;
  media?: { images: number; videos: number };
};

/** Three captions for one network and format, and a short title for the post. */
export async function writeCaptions(input: CaptionBrief): Promise<AiResult<{ captions: string[]; title: string }>> {
  const language = writingLanguage(input.language);
  const system = `You write social media captions for a creative studio's clients. Write in ${language}, in the voice of the brand itself (never mention the studio). Match the network's habits: ${networkLabels[input.network]} ${formatLabels[input.format]}. Keep each caption under ${captionLimits[input.network]} characters, with at most ${limits.hashtags} hashtags; Instagram and TikTok captions end with a few relevant hashtags, Facebook uses few or none. Do not invent facts, prices, dates or offers that the brief does not give. The title is a short internal label for the post (under 60 characters, no hashtags).`;
  const lines = [
    input.client ? `Brand: ${input.client}` : '',
    `Network: ${networkLabels[input.network]} — format: ${formatLabels[input.format]}`,
    input.media ? `Media: ${input.media.images} photo(s), ${input.media.videos} video(s)` : '',
    `Brief:\n${input.brief}`,
    input.current?.trim() ? `Current draft (improve on it, keep what works):\n${input.current}` : '',
    'Write three different captions: one short and punchy, one storytelling, one with a clear call to action.',
  ];
  const schema = strings({ captions: { type: 'array', items: { type: 'string' } }, title: { type: 'string' } }, ['captions', 'title']);
  const result = await ask<{ captions: string[]; title: string }>(system, lines.filter(Boolean).join('\n\n'), schema, 'medium');
  if (!result.ok) return result;
  const captions = (result.data.captions ?? []).map((c) => c.trim().slice(0, captionLimits[input.network])).filter(Boolean).slice(0, 3);
  if (!captions.length) return { ok: false, error: 'L’IA n’a pas proposé de texte. Réessayez.' };
  return { ok: true, data: { captions, title: (result.data.title ?? '').trim().slice(0, 160) } };
}

/** A YouTube title for a video, from its caption or notes. */
export async function writeTitle(input: { brief: string; client?: string; language?: string; format: PostFormat }): Promise<AiResult<{ titles: string[] }>> {
  const language = writingLanguage(input.language);
  const system = `You write YouTube ${input.format === 'short' ? 'Shorts' : 'video'} titles for a creative studio's clients. Write in ${language}, in the brand's own voice. Each title is under ${limits.titleLength} characters, specific and enticing without clickbait, with no hashtags. Do not invent facts the brief does not give.`;
  const prompt = `${input.client ? `Brand: ${input.client}\n\n` : ''}What the video is about:\n${input.brief}\n\nPropose three titles.`;
  const result = await ask<{ titles: string[] }>(system, prompt, strings({ titles: { type: 'array', items: { type: 'string' } } }, ['titles']), 'low');
  if (!result.ok) return result;
  const titles = (result.data.titles ?? []).map((t) => t.trim().replace(/#\S+/g, '').trim().slice(0, limits.titleLength)).filter(Boolean).slice(0, 3);
  return titles.length ? { ok: true, data: { titles } } : { ok: false, error: 'L’IA n’a pas proposé de titre. Réessayez.' };
}

export const correctionKinds = ['task', 'brief', 'feedback', 'caption', 'title'] as const;
export type CorrectionKind = (typeof correctionKinds)[number];
const kindLabels: Record<CorrectionKind, string> = {
  task: 'a task name in a production tracker', brief: 'a task or client brief', feedback: 'a client’s requested changes on a deliverable',
  caption: 'a social media caption', title: 'a title',
};

/** Spelling, grammar and clarity fixed, in the text's own language, meaning and tone kept. */
export async function correctText(text: string, kind: CorrectionKind): Promise<AiResult<{ text: string; changed: boolean }>> {
  const system = `You proofread ${kindLabels[kind]}. Fix spelling, grammar, punctuation and typography (French spacing and quotes rules for French text), and make unclear wording clearer. Keep the same language, meaning, tone, length, line breaks, emojis, hashtags, mentions and links. Never add information. If the text is already correct, return it unchanged.`;
  const result = await ask<{ text: string }>(system, `Text to correct:\n<text>\n${text}\n</text>`, strings({ text: { type: 'string' } }, ['text']), 'low');
  if (!result.ok) return result;
  const fixed = (result.data.text ?? '').trim();
  if (!fixed) return { ok: false, error: 'L’IA n’a pas renvoyé de texte. Réessayez.' };
  return { ok: true, data: { text: fixed, changed: fixed !== text.trim() } };
}

// The assistant's engine on Google Gemini: answers stream as they are written (streamGenerateContent,
// server-sent events), and the model may call tools — the route decides which ones and runs them
// (app/api/assistant). Up to `rounds` model turns per question: call tools, read their results,
// answer. Server-only; never throws — a failure ends the stream with an error event.
import { env } from '@/lib/env';

export type GeminiPart = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
};
export type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] };
export type ToolDeclaration = { name: string; description: string; parameters?: Record<string, unknown> };
type Chunk = {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
};

export const geminiConfigured = () => !!env.GEMINI_API_KEY;

/** GEMINI_MODEL first, then Google's always-current Flash alias, then a pinned Flash and the Flash-Lite
 *  alias (another pool when Flash is overloaded). A model Google says does not exist, or is closed to
 *  this key, is skipped for the next questions (per server instance). */
const missing = new Set<string>();
export const geminiModels = () => {
  const list = [...new Set([env.GEMINI_MODEL?.trim(), 'gemini-flash-latest', 'gemini-3.8-flash', 'gemini-flash-lite-latest'].filter((m): m is string => !!m))];
  const known = list.filter((m) => !missing.has(m));
  return known.length ? known : list;
};

/** The pause before trying an overloaded model again. */
const retryDelay = 700;
export const keyRefused = 'Clé de l’IA refusée (GEMINI_API_KEY).';
const unavailable = 'L’IA ne répond pas pour le moment. Réessayez.';
const blocked = ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION'];

/** One streamed model turn: text is handed to `onText` as it comes; the full turn (parts kept exactly
 *  as sent, thought signatures included) is returned for the next round. */
async function turn(model: string, body: unknown, onText: (text: string) => void, fetcher: typeof fetch): Promise<
  { ok: true; parts: GeminiPart[]; finish?: string } | { ok: false; error: string; retry: boolean; started: boolean; busy?: boolean }
> {
  let response: Response;
  try {
    response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY! },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (error) {
    console.error('gemini', model, (error as Error).name === 'TimeoutError' ? 'timeout' : (error as Error).message);
    return { ok: false, error: unavailable, retry: true, started: false };
  }
  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => ({}))) as Chunk | Chunk[];
    const error = (Array.isArray(data) ? data[0] : data)?.error;
    console.error('gemini', model, response.status, error?.status, error?.message);
    if (response.status === 401 || response.status === 403 || /API key/i.test(error?.message || '')) return { ok: false, error: keyRefused, retry: false, started: false };
    // Another model may exist, have room, or be up.
    const retry = [404, 429, 500, 503].includes(response.status) || /not found|not supported/i.test(error?.message || '');
    if (response.status === 404 || /not found|no longer available/i.test(error?.message || '')) missing.add(model);
    return { ok: false, error: response.status === 429 ? 'L’IA est très demandée : réessayez dans un instant.' : unavailable, retry, started: false, busy: response.status === 503 || response.status === 500 };
  }
  const parts: GeminiPart[] = [];
  let finish: string | undefined;
  let started = false;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const take = (line: string) => {
    if (!line.startsWith('data:')) return;
    let chunk: Chunk;
    try { chunk = JSON.parse(line.slice(5).trim()) as Chunk; } catch { return; }
    if (chunk.promptFeedback?.blockReason) finish = 'SAFETY';
    const candidate = chunk.candidates?.[0];
    if (candidate?.finishReason) finish = candidate.finishReason;
    for (const part of candidate?.content?.parts ?? []) {
      parts.push(part);
      if (typeof part.text === 'string' && part.text && !part.thought) { started = true; onText(part.text); }
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      lines.forEach(take);
    }
    take(buffer);
  } catch (error) {
    console.error('gemini stream', model, (error as Error).message);
    return { ok: false, error: unavailable, retry: !started && !parts.length, started };
  }
  if (finish && finish !== 'STOP') console.error('gemini finish', model, finish);
  if (finish && blocked.includes(finish)) return { ok: false, error: 'L’IA n’a pas pu traiter ce contenu.', retry: false, started };
  return { ok: true, parts, finish };
}

/**
 * The agent loop. `run` executes one tool call and returns what the model reads back; `onText` gets the
 * answer as it streams. Returns an error only when nothing useful could be said.
 */
export async function runAgent({ system, contents, tools, run, onText, onTool, rounds = 6, fetcher = fetch }: {
  system: string;
  contents: GeminiContent[];
  tools?: ToolDeclaration[];
  run: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  onText: (text: string) => void;
  /** A tool is about to run: the page says what the assistant is doing meanwhile. */
  onTool?: (name: string) => void;
  rounds?: number;
  fetcher?: typeof fetch;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!env.GEMINI_API_KEY) return { ok: false, error: 'L’IA n’est pas configurée pour cet espace (GEMINI_API_KEY).' };
  const history = [...contents];
  let wrote = false;
  for (let round = 0; round < rounds; round++) {
    const last = round === rounds - 1;
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: history,
      // The last round has no tools: the model must answer with what it has done.
      ...(tools?.length && !last ? { tools: [{ functionDeclarations: tools }] } : {}),
      generationConfig: { maxOutputTokens: 8192, temperature: 0.4 },
    };
    let result: Awaited<ReturnType<typeof turn>> | null = null;
    // Text after a tool call starts a new paragraph.
    let gap = wrote;
    const write = (text: string) => { onText(gap ? `\n\n${text.trimStart()}` : text); gap = false; wrote = true; };
    models: for (const model of geminiModels()) {
      // An overloaded model often answers a moment later: one more try before the next model.
      for (let attempt = 0; attempt < 2; attempt++) {
        result = await turn(model, body, write, fetcher);
        if (result.ok || !result.retry || result.started) break models;
        if (!result.busy) break;
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
    if (!result || !result.ok) return wrote ? { ok: true } : { ok: false, error: result?.error ?? unavailable };
    const calls = result.parts.filter((p) => p.functionCall);
    if (!calls.length) {
      if (!wrote) return { ok: false, error: result.finish === 'MAX_TOKENS' ? 'Réponse trop longue : précisez la question.' : unavailable };
      return { ok: true };
    }
    history.push({ role: 'model', parts: result.parts });
    const responses: GeminiPart[] = [];
    for (const { functionCall } of calls) {
      const { id, name, args } = functionCall!;
      let response: Record<string, unknown>;
      onTool?.(name);
      try { response = await run(name, args ?? {}); } catch (error) {
        console.error('assistant tool', name, (error as Error).message);
        response = { error: 'Action impossible pour le moment.' };
      }
      responses.push({ functionResponse: { ...(id ? { id } : {}), name, response } });
    }
    history.push({ role: 'user', parts: responses });
  }
  return wrote ? { ok: true } : { ok: false, error: unavailable };
}

// JSON writing/vision calls. The assistant keeps its separate streaming/tool engine.
import { env } from '@/lib/env';
import { geminiModels, keyRefused } from '@/lib/agent';
import type { AiResult } from '@/lib/ai';

export type MediaPart = { text: string } | { inlineData: { mimeType: string; data: string } } | { fileData: { mimeType: string; fileUri: string } };
const unavailable = 'L’IA ne répond pas pour le moment. Réessayez.';

export async function geminiJson<T>(system: string, parts: MediaPart[], signal?: AbortSignal): Promise<AiResult<T>> {
  if (!env.GEMINI_API_KEY) return { ok: false, error: 'L’analyse vidéo n’est pas encore configurée. Contactez l’administrateur.' };
  for (const model of geminiModels()) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts }],
          generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8192 },
        }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(55_000)]) : AbortSignal.timeout(55_000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.error('gemini json', model, response.status, data.error?.status, data.error?.message?.slice(0, 200));
        if ([401, 403].includes(response.status) || /API key/i.test(data.error?.message || '')) return { ok: false, error: keyRefused };
        if ([404, 429, 500, 503].includes(response.status)) continue;
        return { ok: false, error: unavailable };
      }
      const candidate = data.candidates?.[0];
      if (data.promptFeedback?.blockReason || ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION'].includes(candidate?.finishReason)) return { ok: false, error: 'L’IA n’a pas pu traiter ce contenu.' };
      const text = (candidate?.content?.parts ?? []).filter((p: { thought?: boolean; text?: string }) => !p.thought).map((p: { text?: string }) => p.text || '').join('').trim();
      return { ok: true, data: JSON.parse(text) as T };
    } catch (error) {
      // Parsing/refusal failures never become an answer that has not read the supplied media.
      console.error('gemini json', model, (error as Error).name === 'TimeoutError' ? 'timeout' : (error as Error).name, (error as Error).message.slice(0, 200));
      return { ok: false, error: unavailable };
    }
  }
  return { ok: false, error: unavailable };
}

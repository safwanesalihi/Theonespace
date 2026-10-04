// Calls for the meetings (lib/meetings.ts) on Daily (daily.co): one private room per meeting, and a
// personal, short-lived token for each person who joins, so only those invited get in. The call opens
// inside the app (Daily Prebuilt: camera, microphone, screen sharing, chat). Set DAILY_API_KEY
// (dashboard.daily.co → Developers) in Vercel to switch it on.
import { env } from '@/lib/env';

const api = 'https://api.daily.co/v1';
export const dailyConfigured = () => !!env.DAILY_API_KEY;
const headers = () => ({ Authorization: `Bearer ${env.DAILY_API_KEY}`, 'Content-Type': 'application/json' });
// Daily Prebuilt speaks French and English; for Arabic it follows the browser.
const languageOf = (locale?: string) => (locale === 'fr' ? 'fr' : locale === 'en' ? 'en' : 'user');

export const roomNameFor = (meetingId: string) => `the-one-${meetingId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 60)}`;

/** Daily documents DELETE /rooms/:name as the way to disconnect everyone, including hosts.
 * Only the temporary provider room is removed; the app keeps the meeting and its history.
 * The records row lock prevents joins from recreating it while completion is being saved.
 * https://docs.daily.co/reference/rest-api/rooms#rooms */
export async function finishRoom(meetingId: string): Promise<{ error?: string }> {
  if (!dailyConfigured()) return { error: 'La fermeture de l’appel nécessite la configuration Daily. Contactez l’administrateur.' };
  const room = `${api}/rooms/${roomNameFor(meetingId)}`;
  const signal = AbortSignal.timeout(12_000);
  const error = 'L’appel n’a pas pu être terminé pour tout le monde. Réessayez.';
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const closed = await fetch(room, { method: 'DELETE', headers: headers(), signal });
      // Never opened, already expired, or an earlier attempt succeeded before its response was lost.
      if (closed.status === 404) return {};
      const data = await closed.json().catch(() => ({})) as { deleted?: boolean; error?: unknown; info?: unknown };
      if (closed.ok && data.deleted === true) return {};
      if ((closed.status === 429 || closed.status >= 500) && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
        signal.throwIfAborted();
        continue;
      }
      // Provider debug information stays on the server; never log the key, headers or join tokens.
      const safe = (value: unknown) => typeof value === 'string'
        ? value.replaceAll(env.DAILY_API_KEY!, '[redacted]').replace(/Bearer\s+\S+|[A-Za-z0-9_-]{40,}/gi, '[redacted]').slice(0, 300)
        : undefined;
      console.error('Daily meeting completion failed', { meetingId, operation: 'delete-room', status: closed.status,
        error: safe(data.error), info: safe(data.info) });
      return { error: closed.status === 401 || closed.status === 403 ? 'Clé Daily refusée (DAILY_API_KEY).'
        : closed.status === 429 ? 'Le service d’appel est momentanément occupé. Réessayez dans quelques secondes.' : error };
    }
    return { error };
  } catch {
    console.error('Daily meeting completion failed', { meetingId, operation: 'delete-room', reason: signal.aborted ? 'timeout' : 'network' });
    return { error: 'Daily ne répond pas pour le moment. Réessayez.' };
  }
}

/** The meeting's room, created on first join and kept open until `until` (then Daily closes it). */
async function ensureRoom(name: string, until: Date, signal: AbortSignal): Promise<{ url: string } | { error: string }> {
  const exp = Math.floor(until.getTime() / 1000);
  const properties = { exp, eject_at_room_exp: true, enable_prejoin_ui: true, enable_screenshare: true, enable_chat: true, enable_knocking: false };
  try {
    const found = await fetch(`${api}/rooms/${name}`, { headers: headers(), signal });
    if (!found.ok && found.status !== 404) return { error: found.status === 401 ? 'Clé Daily refusée (DAILY_API_KEY).' : 'La salle de réunion n’a pas pu être ouverte. Réessayez.' };
    const response = found.ok
      // Moved meetings keep their room: its closing time follows the new schedule.
      ? await fetch(`${api}/rooms/${name}`, { method: 'POST', headers: headers(), signal, body: JSON.stringify({ properties }) })
      : await fetch(`${api}/rooms`, { method: 'POST', headers: headers(), signal, body: JSON.stringify({ name, privacy: 'private', properties }) });
    const data = (await response.json().catch(() => ({}))) as { url?: string; error?: string; info?: string };
    if (!response.ok || !data.url) return { error: response.status === 401 ? 'Clé Daily refusée (DAILY_API_KEY).' : 'La salle de réunion n’a pas pu être ouverte. Réessayez.' };
    return { url: data.url };
  } catch {
    return { error: 'Daily ne répond pas pour le moment. Réessayez.' };
  }
}

/** A link that lets this one person into the room, with their name, for a few hours. */
export async function joinLink(input: { meetingId: string; until: Date; userId: string; userName: string; owner: boolean; audioOnly: boolean; locale?: string }): Promise<{ url: string } | { error: string }> {
  const name = roomNameFor(input.meetingId);
  const signal = AbortSignal.timeout(12_000);
  const room = await ensureRoom(name, input.until, signal);
  if ('error' in room) return room;
  try {
    const response = await fetch(`${api}/meeting-tokens`, {
      method: 'POST', headers: headers(), signal,
      body: JSON.stringify({ properties: {
        room_name: name, user_name: input.userName.slice(0, 60), user_id: input.userId.slice(0, 36), is_owner: input.owner,
        exp: Math.floor(input.until.getTime() / 1000), start_video_off: input.audioOnly, start_audio_off: false, lang: languageOf(input.locale),
      } }),
    });
    const data = (await response.json().catch(() => ({}))) as { token?: string };
    if (!response.ok || !data.token) return { error: 'L’accès à la réunion n’a pas pu être préparé. Réessayez.' };
    return { url: `${room.url}?t=${encodeURIComponent(data.token)}` };
  } catch {
    return { error: 'Daily ne répond pas pour le moment. Réessayez.' };
  }
}

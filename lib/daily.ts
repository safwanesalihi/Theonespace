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

/** Close the room to old tokens and disconnect its current participants. A room that was never
 * opened is already closed. All requests share a deadline; errors keep the app's meeting unfinished. */
export async function finishRoom(meetingId: string): Promise<{ error?: string }> {
  if (!dailyConfigured()) return {};
  const room = `${api}/rooms/${roomNameFor(meetingId)}`;
  const signal = AbortSignal.timeout(12_000);
  const error = 'L’appel n’a pas pu être terminé pour tout le monde. Réessayez.';
  try {
    const closed = await fetch(room, { method: 'POST', headers: headers(), signal,
      body: JSON.stringify({ properties: { exp: Math.floor(Date.now() / 1000), eject_at_room_exp: true } }),
    });
    if (closed.status === 404) return {};
    if (!closed.ok) return { error };
    const presence = await fetch(`${room}/presence?limit=10000`, { headers: headers(), signal });
    if (presence.status === 404) return {};
    if (!presence.ok) return { error };
    const data = (await presence.json()) as { data?: { id: string }[] };
    if (!Array.isArray(data.data)) return { error };
    const ids = data.data.map((p) => p.id);
    for (let i = 0; i < ids.length; i += 100) {
      const ejected = await fetch(`${room}/eject`, { method: 'POST', headers: headers(), signal,
        body: JSON.stringify({ ids: ids.slice(i, i + 100) }),
      });
      if (!ejected.ok && ejected.status !== 404) return { error };
    }
    return {};
  } catch { return { error }; }
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

// The Bibliothèque: the team's shared prompts, plugins, assets, presets and useful sites. Pure helpers
// used by the page, the records API and the assistant: guessing what was pasted, link identity (to
// catch duplicates), fill-in blanks in prompts ({client}, {produit}), and who may change an entry.
import type { LibraryCategory, RecordItem } from '@/lib/model';
import type { WorkspaceRole } from '@/lib/workspace';

export const libraryLimits = { tags: 10, tag: 30, tool: 40 };
/** AI tools offered for a prompt (free text is allowed too). */
export const promptTools = ['ChatGPT', 'Claude', 'Gemini', 'Midjourney', 'DALL·E', 'Firefly', 'Runway', 'Kling', 'Suno', 'ElevenLabs'];

const urlLike = /^https?:\/\/\S+$/i;
/** What a pasted text most likely is: a link (a site, or a plugin on a known store) or a prompt. */
export function guessPaste(text: string): { category: LibraryCategory; link?: string; content?: string } {
  const v = text.trim();
  if (urlLike.test(v)) {
    let host = '';
    try { host = new URL(v).hostname.replace(/^www\./, ''); } catch { /* not a link after all */ }
    const plugin = /(^|\.)((chromewebstore|chrome)\.google\.com|addons\.mozilla\.org|figma\.com|aescripts\.com|plugins\.|marketplace\.|wordpress\.org)/i.test(host)
      || /\/(plugin|plugins|extension|addon)s?\b/i.test(v);
    const asset = /(^|\.)(drive\.google\.com|dropbox\.com|wetransfer\.com|we\.tl|envato\.com|freepik\.com|unsplash\.com|pexels\.com)$/i.test(host);
    return { category: plugin ? 'plugin' : asset ? 'asset' : 'website', link: v };
  }
  return { category: 'prompt', content: v };
}

/** A link's identity for duplicates: no protocol, "www.", trailing slash, fragment or tracking tags. */
export function linkKey(link?: string) {
  if (!link) return '';
  try {
    const u = new URL(link.trim());
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$)/i.test(k)) u.searchParams.delete(k);
    const q = u.searchParams.toString();
    return `${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '')}${q ? `?${q}` : ''}`;
  } catch { return link.trim().toLowerCase(); }
}

/** The blanks of a prompt, in order, once each: « {client} », « {produit} », « {ton de la marque} ». */
export function promptVariables(text?: string): string[] {
  const found = (text ?? '').match(/\{([^{}\n]{1,40})\}/g) ?? [];
  return [...new Set(found.map((m) => m.slice(1, -1).trim()).filter(Boolean))];
}
/** The prompt with its blanks filled; a blank left empty stays as it was. */
export const fillPrompt = (text: string, values: Record<string, string>) =>
  text.replace(/\{([^{}\n]{1,40})\}/g, (m, name: string) => values[name.trim()]?.trim() || m);

/** Tags tidied: trimmed, no « # », one of each (case-insensitive), at most ten. */
export function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  for (const raw of tags) {
    const tag = String(raw).replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, libraryLimits.tag);
    if (tag && !out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out.slice(0, libraryLimits.tags);
}

/** Everyone in the studio adds; the author, the owner and admins change or delete. An older entry with
 *  no author id belongs to the person whose name it carries. */
export function canManageEntry(item: RecordItem, who: { userId: string; name: string; role: WorkspaceRole }) {
  if (who.role === 'owner' || who.role === 'admin') return true;
  if (who.role === 'viewer' || who.role === 'client') return false;
  return item.authorId ? item.authorId === who.userId : !!item.author && item.author === who.name;
}

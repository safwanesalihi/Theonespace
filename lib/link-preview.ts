// A link's title and icon, read from the page itself when someone adds it to the Bibliothèque. The
// server fetches an address a person typed, so it refuses anything that is not a public web server:
// only http(s) on the usual ports, every address the name resolves to must be public (no loopback,
// private, link-local or cloud-metadata ranges), redirects are followed by hand and checked again,
// and it reads at most 300 KB for 6 seconds.
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';

export type LinkPreview = { title?: string; site?: string; icon?: string; description?: string };

function privateV4(ip: string) {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}
export function privateAddress(ip: string) {
  if (isIP(ip) === 4) return privateV4(ip);
  const v = ip.toLowerCase().split('%')[0];
  if (isIP(v) !== 6) return true;
  // Expand to 8 groups so every embedded-IPv4 form is judged by its real address.
  let head = v, tail = '';
  if (v.includes('::')) [head, tail] = v.split('::');
  const dotted = (list: string[]) => {
    const last = list[list.length - 1];
    if (last?.includes('.')) {
      const o = last.split('.').map(Number);
      return [...list.slice(0, -1), ((o[0] << 8) | o[1]).toString(16), ((o[2] << 8) | o[3]).toString(16)];
    }
    return list;
  };
  const h = dotted(head ? head.split(':') : []), t = dotted(tail ? tail.split(':') : []);
  const groups = v.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  const g = groups.map((x) => parseInt(x || '0', 16));
  if (g.length !== 8 || g.some(Number.isNaN)) return true;
  const v4 = (hi: number, lo: number) => privateV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0 || g[5] === 0xffff)) {
    if (g[5] === 0xffff) return v4(g[6], g[7]);        // ::ffff:a.b.c.d (also the hex form ::ffff:7f00:1)
    return true;                                       // :: (unspecified), ::1 (loopback), ::a.b.c.d (IPv4-compatible)
  }
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return true; // NAT64 64:ff9b::/96
  if (g[0] === 0x2002) return true;                    // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true;      // Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true;  // documentation
  if (g[0] === 0x3fff && g[1] < 0x1000) return true;   // documentation 3fff::/20
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0 || (g[0] & 0xff00) === 0xff00;
}

// The address each validated URL resolved to. The connection is made to *that* address, so the name
// can't resolve to something else between the check and the use (DNS rebinding).
const pinned = new Map<string, { address: string; family: 4 | 6 }>();

/** fetch() replacement that connects to the address publicUrl() validated instead of resolving the name again. */
const pinnedFetch = ((input: URL | string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
  const url = new URL(String(input));
  const target = pinned.get(url.toString());
  pinned.delete(url.toString());
  if (!target) return reject(new Error('unvalidated address'));
  const request = (url.protocol === 'https:' ? https : http).request(url, {
    method: 'GET', headers: init?.headers as Record<string, string>, signal: init?.signal ?? undefined,
    lookup: (_host, _options, callback) => (callback as (e: null, a: string, f: number) => void)(null, target.address, target.family),
  }, (res) => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(res.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
    const status = res.statusCode ?? 502;
    resolve(new Response(status === 204 || status === 304 ? null : (Readable.toWeb(res) as unknown as ReadableStream), { status, headers }));
  });
  request.on('error', reject);
  request.end();
})) as unknown as typeof fetch;

async function publicUrl(raw: string): Promise<URL | null> {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  if (url.port && !['80', '443'].includes(url.port)) return null;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return null;
  try {
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((a) => privateAddress(a.address))) return null;
    if (pinned.size > 200) pinned.clear();
    pinned.set(url.toString(), { address: addresses[0].address, family: isIP(addresses[0].address) === 6 ? 6 : 4 });
  } catch { return null; }
  return url;
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/\s+/g, ' ').trim();
const attr = (tag: string, name: string) => tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1];
function meta(html: string, keys: string[]) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, 'property') || attr(tag, 'name') || '').toLowerCase();
    if (keys.includes(key)) { const v = attr(tag, 'content'); if (v) return decode(v); }
  }
  return undefined;
}

/** Reads the page (following up to 3 checked redirects) and returns what it says about itself. */
export async function linkPreview(raw: string, fetcher: typeof fetch = pinnedFetch): Promise<LinkPreview | null> {
  let url = await publicUrl(raw);
  let response: Response | null = null;
  for (let hop = 0; url && hop < 4; hop++) {
    try {
      response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TheOneSpace/1.0; link preview)', Accept: 'text/html' } });
    } catch { return null; }
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      await response.body?.cancel().catch(() => {});
      url = await publicUrl(new URL(response.headers.get('location')!, url).toString());
      response = null;
      continue;
    }
    break;
  }
  if (!url || !response || !response.ok || !(response.headers.get('content-type') || '').includes('html') || !response.body) {
    await response?.body?.cancel().catch(() => {});
    return url ? { site: url.hostname.replace(/^www\./, ''), icon: new URL('/favicon.ico', url).toString() } : null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < 300_000) {
    const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
    if (done || !value) break;
    chunks.push(value); size += value.length;
  }
  await reader.cancel().catch(() => {});
  const html = new TextDecoder().decode(Buffer.concat(chunks)).slice(0, 300_000);
  const head = html.split(/<\/head>/i)[0];
  const title = meta(head, ['og:title', 'twitter:title']) || decode(head.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '') || undefined;
  const iconTag = (head.match(/<link\b[^>]*>/gi) ?? []).find((tag) => /rel\s*=\s*["'][^"']*\b(icon|apple-touch-icon)\b/i.test(tag));
  const href = iconTag ? attr(iconTag, 'href') : undefined;
  let icon: string | undefined;
  try { icon = new URL(href || '/favicon.ico', url).toString(); } catch { icon = undefined; }
  if (icon && !/^https?:/i.test(icon)) icon = undefined;
  return {
    title: title?.slice(0, 160), site: meta(head, ['og:site_name'])?.slice(0, 80) || url.hostname.replace(/^www\./, ''),
    icon, description: meta(head, ['og:description', 'description'])?.slice(0, 300),
  };
}

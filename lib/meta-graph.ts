// The Meta Graph API version every Meta call uses (Facebook, Instagram, WhatsApp, Facebook Login), in one
// place. Meta retires a version about two years after the next one ships, and a call to a retired version
// is quietly answered by a newer one, so the version must be moved on deliberately: set META_GRAPH_VERSION
// (e.g. v23.0) once publishing, statistics, sign-in and WhatsApp have been checked against it.
import { env } from '@/lib/env';

const fallback = 'v21.0';

export function metaGraphVersion() {
  const value = env.META_GRAPH_VERSION?.trim();
  return value && /^v\d{2}\.0$/.test(value) ? value : fallback;
}

// A signed upload URL for a post's photo or video. The browser sends the file straight to storage
// with it (lib/media-storage.ts explains why), then saves the returned public URL on the post.
import { editorialAccess, json } from '@/lib/editorial-access';
import { mediaLimits, mediaStorageConfigured, mediaTypeOf, publicMediaUrl, signedUpload } from '@/lib/media-storage';
import { can } from '@/lib/roles';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const access = await editorialAccess(req, (who) => can(who, 'social'), 'Le Social est réservé au propriétaire, aux administrateurs et aux social media managers.');
  if ('response' in access) return access.response;
  if (!mediaStorageConfigured()) return json({ error: 'Le stockage des médias n’est pas configuré (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).' }, 503);
  let body: { contentType?: unknown; size?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'Requête invalide.' }, 400); }
  const contentType = typeof body.contentType === 'string' ? body.contentType : '';
  const size = typeof body.size === 'number' ? body.size : 0;
  const mediaType = mediaTypeOf(contentType);
  if (!mediaType) return json({ error: 'Formats acceptés : photo JPEG, vidéo MP4 ou MOV.' }, 415);
  const limit = mediaLimits[mediaType].maxBytes;
  if (size <= 0 || size > limit) return json({ error: `Fichier trop lourd (${Math.round(limit / 1_000_000)} Mo maximum pour ${mediaType === 'image' ? 'une photo' : 'une vidéo'}).` }, 413);
  // Random and per-workspace: nobody can guess another file's address.
  const path = `${access.workspaceId.replace(/[^a-zA-Z0-9-]/g, '_')}/${crypto.randomUUID()}.${mediaType === 'image' ? 'jpg' : contentType.includes('quicktime') ? 'mov' : 'mp4'}`;
  const signed = await signedUpload(path);
  if ('error' in signed) return json({ error: signed.error }, 502);
  return json({ uploadUrl: signed.uploadUrl, publicUrl: publicMediaUrl(path), path, mediaType });
}

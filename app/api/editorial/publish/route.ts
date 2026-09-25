// "Publier maintenant": publishes one post to every platform it targets that isn't done yet, and
// answers with what happened on each. Owner and admins only — it posts in the client's name.
import { editorialAccess, json } from '@/lib/editorial-access';
import { publishPost } from '@/lib/editorial-publish';
import { isManager } from '@/lib/workspace';

export const dynamic = 'force-dynamic';
// Instagram needs time to process a video; the run waits for it up to ~20 s before handing over.
export const maxDuration = 60;

export async function POST(req: Request) {
  const access = await editorialAccess(req, isManager, 'Seuls le propriétaire et les administrateurs publient.');
  if ('response' in access) return access.response;
  let body: { postId?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'Requête invalide.' }, 400); }
  if (typeof body.postId !== 'string' || !body.postId) return json({ error: 'Post introuvable.' }, 404);
  try {
    const run = await publishPost(access.workspaceId, body.postId, { manual: true });
    if (run.status === 'busy') return json({ error: 'Ce post est déjà en cours de publication.' }, 409);
    if (run.status === 'error') return json({ error: run.error }, run.code);
    return json({ ok: true, results: run.results, post: run.post });
  } catch (error) {
    console.error('publish post', error);
    return json({ error: 'Publication impossible. Réessayez.' }, 503);
  }
}

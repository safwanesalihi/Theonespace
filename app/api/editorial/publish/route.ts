// "Publier maintenant": publishes one post to every platform it targets that isn't done yet, and
// answers with what happened on each. Owner, admins and social media managers — it posts in the client's name.
import { editorialAccess, json } from '@/lib/editorial-access';
import { reportError } from '@/lib/error-report';
import { publishPost } from '@/lib/editorial-publish';
import { can } from '@/lib/roles';

export const dynamic = 'force-dynamic';
// A Facebook Reel upload can take a couple of minutes; a video still processing after ~20 s is left
// pending, and the Social hub keeps asking (« follow ») until it is out.
export const maxDuration = 300;

export async function POST(req: Request) {
  const access = await editorialAccess(req, (who) => can(who, 'social'), 'Le Social est réservé au propriétaire, aux administrateurs et aux social media managers.');
  if ('response' in access) return access.response;
  let body: { postId?: unknown; follow?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'Requête invalide.' }, 400); }
  if (typeof body.postId !== 'string' || !body.postId) return json({ error: 'Post introuvable.' }, 404);
  try {
    // `follow`: the hub checking on a video still processing. It finishes what is pending and never
    // retries a failed network before its delay — only a click does that.
    const run = await publishPost(access.workspaceId, body.postId, { manual: body.follow !== true });
    if (run.status === 'busy') return json({ error: 'Ce post est déjà en cours de publication.' }, 409);
    if (run.status === 'error') return json({ error: run.error }, run.code);
    return json({ ok: true, results: run.results, post: run.post });
  } catch (error) {
    await reportError('publishing-now', error, { workspaceId: access.workspaceId });
    return json({ error: 'Publication impossible. Réessayez.' }, 503);
  }
}

// A post's photo or video from Google Drive: checks the pasted link points at a public photo or video
// and answers with the direct address Meta will fetch it from (lib/drive.ts). A folder's link answers
// with every photo and video in it (`files`), and how many were left out (`skipped`).
import { editorialAccess, json } from '@/lib/editorial-access';
import { inspectDriveFile, inspectDriveFolder, isDriveFolder } from '@/lib/drive';
import { canSocial } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const access = await editorialAccess(req, canSocial, 'Le Social est réservé au propriétaire, aux administrateurs et aux social media managers.');
  if ('response' in access) return access.response;
  let body: { link?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'Requête invalide.' }, 400); }
  if (typeof body.link !== 'string' || !body.link.trim() || body.link.length > 2000) return json({ error: 'Collez le lien d’un fichier Google Drive (Partager → Copier le lien).' }, 400);
  if (isDriveFolder(body.link)) {
    const folder = await inspectDriveFolder(body.link);
    return 'error' in folder ? json(folder, 400) : json(folder);
  }
  const file = await inspectDriveFile(body.link);
  return 'error' in file ? json(file, 400) : json(file);
}

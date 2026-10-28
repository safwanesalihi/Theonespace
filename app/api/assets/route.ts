// Upload a client logo or banner, one's own profile picture, or a voice message or a chat file
// for a task's conversation.
// Images are resized in the browser first (lib/image.ts), so bodies stay small; voice messages are
// capped by duration in the recorder (app/voice-recorder.tsx) and by size here.
import { planRefusal } from '@/lib/subscription';
import { getAppUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/auth-settings';
import { database } from '@/lib/database';
import { membershipOf } from '@/lib/membership';
import { can } from '@/lib/roles';
import { isWorkspaceRole } from '@/lib/workspace';
import { smallTaskFileBytes, taskFileType } from '@/lib/task-files';

export const dynamic = 'force-dynamic';

const imageLimits = { maxBytes: 1_500_000, types: ['image/png', 'image/jpeg', 'image/webp'] };
// MediaRecorder output: webm/opus (Chrome, Firefox), mp4/aac (Safari); ogg and mpeg for good measure.
const audioLimits = { maxBytes: 8_000_000, types: ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-m4a', 'audio/aac'] };
// Larger chat files use /api/assets/uploads, keeping every request below the hosting body limit.
const fileLimits = { maxBytes: smallTaskFileBytes, types: [] as string[] };
const assetKinds = ['logo', 'banner', 'avatar', 'audio', 'file'] as const;
type AssetKind = (typeof assetKinds)[number];

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: Request) {
  const user = await getAppUser(req);
  if (!user) return json({ error: 'Connexion requise.' }, 401);
  if (user.mustChangePassword) return json({ error: 'Choisissez votre mot de passe pour continuer.', code: 'password-change-required' }, 403);
  // Multipart uploads are reachable from a plain cross-site <form>, so the Origin header has to be
  // present and match — the same rule the sign-in routes use.
  if (!sameOrigin(req)) return json({ error: 'Origine non autorisée.' }, 403);
  const workspaceId = req.headers.get('X-Workspace-Id');
  if (!workspaceId) return json({ error: 'Espace inconnu.' }, 400);
  const membership = await membershipOf(workspaceId, user.userId);
  if (!membership || !isWorkspaceRole(membership.role)) return json({ error: 'Votre rôle ne permet pas de modifier les images.' }, 403);
  let form: FormData;
  try { form = await req.formData(); } catch { return json({ error: 'Envoi invalide.' }, 400); }
  const kind = String(form.get('kind') ?? '') as AssetKind;
  const file = form.get('file');
  if (!assetKinds.includes(kind)) return json({ error: 'Type de fichier inconnu.' }, 400);
  // Anyone may change their own picture or leave a voice message (a client's feedback is the whole
  // point); a client's logo/banner is studio-owned, owner/admin only.
  if ((kind === 'audio' || kind === 'file') && membership.role === 'viewer') return json({ error: 'Votre rôle est en lecture seule.' }, 403);
  if ((kind === 'logo' || kind === 'banner') && !can({ role: membership.role, permissions: membership.permissions }, 'clients')) return json({ error: 'Votre rôle ne permet pas de modifier les images.' }, 403);
  if (!(file instanceof File)) return json({ error: 'Aucun fichier reçu.' }, 400);
  // Recorders report e.g. "audio/webm;codecs=opus" — the stored type is what <audio> plays back.
  const contentType = kind === 'file' ? taskFileType(file.type, file.name) : file.type.split(';')[0].trim().toLowerCase();
  const limits = kind === 'audio' ? audioLimits : kind === 'file' ? fileLimits : imageLimits;
  if (kind !== 'file' && !limits.types.includes(contentType)) {
    return json({ error: kind === 'audio' ? 'Format audio non pris en charge.' : 'Formats acceptés : PNG, JPEG, WebP.' }, 415);
  }
  if (file.size === 0 || file.size > limits.maxBytes) {
    return json({ error: kind === 'audio' ? 'Message vocal trop lourd (8 Mo maximum).' : kind === 'file' ? 'Fichier trop lourd (4 Mo maximum).' : 'Image trop lourde (1,5 Mo maximum après redimensionnement).' }, 413);
  }
  // A PDF is checked by its first bytes too: the type the browser reports is only a claim.
  if (contentType === 'application/pdf' && Buffer.from(await file.slice(0, 5).arrayBuffer()).toString('latin1') !== '%PDF-') {
    return json({ error: 'Ce fichier n’est pas un PDF valide.' }, 415);
  }
  // A company's plan: read-only after its trial or paid period, and a storage limit (lib/subscription.ts).
  const refusal = await planRefusal(workspaceId, 'storageMb', file.size / 1_048_576);
  if (refusal) return json(refusal, refusal.status);
  const bytes = Buffer.from(await file.arrayBuffer());
  const id = crypto.randomUUID();
  await database().query(
    'INSERT INTO assets (id, workspace_id, kind, content_type, size, bytes, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [id, workspaceId, kind, contentType, bytes.length, bytes, user.userId],
  );
  return json({ id, type: contentType, size: file.size });
}

// Writing help: analyse all post media first, then write grounded captions; also titles and corrections.
// Studio only: captions for Social managers, corrections for team writers. Requests are metered.
import { countAiCall, planRefusal } from '@/lib/subscription';
import { limitMessages } from '@/lib/plans';
import { getAppUser } from '@/lib/auth';
import { writingConfigured, correctText, correctionKinds, writeBrief, writeCaptions, writeTitle, type CorrectionKind, type MediaRef } from '@/lib/ai';
import { briefShape, briefSources, toBrief } from '@/lib/brief-ai';
import { listPlans } from '@/lib/content-plan-server';
import { analysePostMedia, analysisLimits, type MediaObservation } from '@/lib/post-media-analysis';
import { editorialAccess, json } from '@/lib/editorial-access';
import { loadRecords } from '@/lib/flow-server';
import { formatsFor, networks, type Network, type PostFormat } from '@/lib/social';
import { can } from '@/lib/roles';
import type { WorkspaceRole } from '@/lib/workspace';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const writer = ({ role }: { role: WorkspaceRole }) => role !== 'client' && role !== 'viewer';
const maxText = 15_000;
const overBudget = () => json({ error: limitMessages.aiPerMonth, status: 403, code: 'plan-limit' }, 403);

// Best effort (per server instance): enough to stop a stuck button or a script from running up the bill.
const recent = new Map<string, number[]>();
const aiLimit = { calls: 20, windowMs: 60_000 };
function allow(userId: string, now = Date.now()) {
  const calls = (recent.get(userId) ?? []).filter((t) => now - t < aiLimit.windowMs);
  if (calls.length >= aiLimit.calls) return false;
  recent.set(userId, [...calls, now]);
  return true;
}

export async function GET(req: Request) {
  if (!(await getAppUser(req))) return json({ error: 'Connexion requise.' }, 401);
  return json({ configured: writingConfigured(), assistant: writingConfigured() });
}

export async function POST(req: Request) {
  const access = await editorialAccess(req, writer, 'L’aide à la rédaction est réservée à l’équipe du studio.');
  if ('response' in access) return access.response;
  let body: { action?: unknown; text?: unknown; kind?: unknown; brief?: unknown; current?: unknown; network?: unknown; format?: unknown; clientId?: unknown; media?: { images?: unknown; videos?: unknown }; files?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'Requête invalide.' }, 400); }
  const text = (value: unknown) => (typeof value === 'string' ? value.slice(0, maxText) : '');
  if (!['caption', 'title', 'correct', 'brief'].includes(body.action as string)) return json({ error: 'Action inconnue.' }, 400);
  // The brand brief is written by those who edit it: the owner and the administrators.
  if (body.action === 'brief' && !can(access, 'clients')) return json({ error: 'Le brief de marque est rédigé par le propriétaire et les administrateurs.' }, 403);
  if (body.action !== 'correct' && body.action !== 'brief' && !can(access, 'social')) return json({ error: 'Le Social est réservé au propriétaire, aux administrateurs et aux social media managers.' }, 403);
  if (!writingConfigured()) return json({ error: 'L’IA n’est pas configurée pour cet espace (GROQ_API_KEY).' }, 503);
  // A company's plan counts its AI requests per month (lib/subscription.ts).
  const quota = await planRefusal(access.workspaceId, 'aiPerMonth');
  if (quota) return json(quota, quota.status);

  if (body.action === 'correct') {
    const input = text(body.text);
    if (!input.trim()) return json({ error: 'Rien à corriger.' }, 400);
    if (!correctionKinds.includes(body.kind as CorrectionKind)) return json({ error: 'Texte inconnu.' }, 400);
    if (!allow(access.user.userId)) return json({ error: 'Trop de demandes : patientez une minute.' }, 429);
    if (!(await countAiCall(access.workspaceId, 1))) return overBudget();
    const result = await correctText(input, body.kind as CorrectionKind);
    return result.ok ? json(result.data) : json({ error: result.error }, 502);
  }

  if (body.action === 'brief') {
    const rows = await loadRecords(access.workspaceId);
    const client = rows.find((r) => r.kind === 'client' && r.id === body.clientId && !r.archived);
    if (!client) return json({ error: 'Client introuvable.' }, 404);
    const sources = briefSources(rows, await listPlans(access.workspaceId, client.id), client.id);
    if (!allow(access.user.userId)) return json({ error: 'Trop de demandes : patientez une minute.' }, 429);
    if (!(await countAiCall(access.workspaceId, 1))) return overBudget();
    const result = await writeBrief({ client: client.name, language: client.language, material: sources.text, shape: briefShape });
    if (!result.ok) return json({ error: result.error }, 502);
    const brief = toBrief(result.data, client.brief, sources.urls);
    return brief ? json({ brief, basis: sources.basis, revision: client.revision }) : json({ error: 'L’IA n’a pas proposé de brief exploitable. Réessayez.' }, 502);
  }

  const brief = text(body.brief), current = text(body.current);
  // Never truncate or silently discard an attachment: every file must be analysed.
  const rawFiles = body.action === 'caption' ? body.files ?? [] : [];
  if (!Array.isArray(rawFiles) || rawFiles.length > analysisLimits.items || rawFiles.some(f => !f || typeof f.url !== 'string' || f.url.length > 2000 || !['image', 'video'].includes(f.type))) return json({ error: 'Liste de médias invalide.' }, 400);
  const files: MediaRef[] = rawFiles.map(f => ({ url: f.url, type: f.type }));
  if (body.action === 'caption' && !files.length && (Number(body.media?.images) > 0 || Number(body.media?.videos) > 0)) return json({ error: 'Ajoutez les médias à analyser avant de générer le texte.' }, 400);
  if (!brief.trim() && !current.trim() && !files.length) return json({ error: 'Donnez un titre, quelques notes, un premier jet ou une photo.' }, 400);
  // The brand's name and language come from its client file, not from the browser.
  const clientId = typeof body.clientId === 'string' ? body.clientId : '';
  const client = clientId && clientId !== 'internal'
    ? (await loadRecords(access.workspaceId)).find((r) => r.kind === 'client' && r.id === clientId && !r.archived)
    : undefined;
  const brand = { client: client?.name, language: client?.language };

  if (body.action === 'title') {
    const format = body.format === 'short' ? 'short' : 'video';
    if (!allow(access.user.userId)) return json({ error: 'Trop de demandes : patientez une minute.' }, 429);
    if (!(await countAiCall(access.workspaceId, 1))) return overBudget();
    const result = await writeTitle({ brief: [brief, current].filter((s) => s.trim()).join('\n\n'), format, ...brand });
    return result.ok ? json(result.data) : json({ error: result.error }, 502);
  }

  const network = body.network as Network;
  if (!networks.includes(network) || !formatsFor[network].includes(body.format as PostFormat)) return json({ error: 'Format non pris en charge sur ce réseau.' }, 400);
  if (!allow(access.user.userId)) return json({ error: 'Trop de demandes : patientez une minute.' }, 429);
  // One unit for the text plus one per analysed media item (at most analysisLimits.items), reserved before any provider work.
  if (!(await countAiCall(access.workspaceId, 1 + Math.min(files.length, analysisLimits.items)))) return overBudget();
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(280_000)]);
  let observations: MediaObservation[] = [];
  if (files.length) {
    const analysed = await analysePostMedia(files, access.workspaceId, signal);
    if (!analysed.ok) return json({ error: analysed.error }, 502);
    observations = analysed.data;
  }
  const result = await writeCaptions({
    network, format: body.format as PostFormat, brief: brief || current, current: brief ? current : '', ...brand,
    media: { images: files.filter(f => f.type === 'image').length, videos: files.filter(f => f.type === 'video').length }, observations, signal,
  });
  return result.ok ? json(result.data) : json({ error: result.error }, 502);
}

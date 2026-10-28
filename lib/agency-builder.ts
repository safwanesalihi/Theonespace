// « Build your agency » (features/customize/build-agency.tsx): the guided setup a new agency plays once,
// right after sign-up. Its answers become the studio's process (lib/process.ts): the kind of agency picks
// a model, the work it makes becomes work types, the checks before the client become a chain of
// internal steps, and the channels switch the automatic messages. Everything stays editable on
// « Personnaliser ». Pure: shared by the browser and the tests.
import { isCompanyWorkspaceId } from '@/lib/workspace';
import { notifyEvents, notifyRoutes, type NotifyChannel, type Process, type StatusColor, type StatusDef } from '@/lib/process';
import { presetProcess } from '@/lib/process-presets';

/** What a marketing agency makes, offered as tiles; any other label can be typed in. */
export const workIdeas = ['Reel', 'Carrousel', 'Story', 'Post', 'Shooting photo', 'Vidéo', 'Campagne pub', 'Article SEO', 'Identité visuelle', 'Site web', 'Newsletter', 'Événement'] as const;
/** The checks an agency may run before the client sees the work, in the order they usually happen. */
export const checkIdeas = ['Relecture', 'Check account manager', 'Check DA', 'Validation direction'] as const;
const checkColors: StatusColor[] = ['purple', 'indigo', 'pink', 'red'];

export type AgencyAnswers = {
  preset: string;
  /** Work type names; none: one path for every task. */
  workTypes: string[];
  /** Internal checks before the client, in order; none: the work goes straight to the client. */
  checks: string[];
  channels: Record<NotifyChannel, boolean>;
};

const slug = (label: string, taken: Set<string>, prefix: string) => {
  const base = `${prefix}-${label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x'}`.slice(0, 50);
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  taken.add(id);
  return id;
};
const clean = (labels: string[], max: number) => {
  const seen = new Set<string>();
  return labels.map((l) => l.replace(/\s+/g, ' ').trim().slice(0, 40)).filter((l) => l && !seen.has(l.toLowerCase()) && seen.add(l.toLowerCase())).slice(0, max);
};

/** The process an agency's answers build. Marked `built`: the game is not offered again. */
export function buildAgency(answers: AgencyAnswers): Process {
  const base = presetProcess(answers.preset);
  const taken = new Set<string>();
  // The model's own internal check gives way to the agency's chain, placed just before the client step
  // (or before the end when nothing goes to the client).
  const statuses = base.statuses.filter((s) => s.behaviour !== 'internal');
  for (const s of statuses) taken.add(s.id);
  const chain: StatusDef[] = clean(answers.checks, 4).map((label, i) => ({ id: slug(label, taken, 'check'), label, color: checkColors[i % checkColors.length], behaviour: 'internal' }));
  const at = statuses.findIndex((s) => s.behaviour === 'client');
  statuses.splice(at >= 0 ? at : statuses.findIndex((s) => s.behaviour === 'done'), 0, ...chain);

  const types = clean(answers.workTypes, 30);
  const workTypes = types.length ? types.map((label) => ({ id: slug(label, taken, 'wt'), label, statusIds: statuses.map((s) => s.id) })) : undefined;

  const off = (Object.keys(answers.channels) as NotifyChannel[]).filter((c) => !answers.channels[c]);
  const notifications = off.length
    ? Object.fromEntries(notifyEvents.filter((e) => notifyRoutes[e].some((c) => off.includes(c))).map((e) => [e, Object.fromEntries(notifyRoutes[e].filter((c) => off.includes(c)).map((c) => [c, false]))]))
    : undefined;

  const { workTypes: presetTypes, ...rest } = base; void presetTypes;
  return { ...rest, statuses, ...(workTypes ? { workTypes } : {}), ...(notifications ? { notifications } : {}), built: true };
}

/**
 * Whether to offer the game: the owner of an agency that signed up on its own, before it set anything
 * up — no process built or changed on « Personnaliser », and no work yet.
 */
export const offersBuild = (args: { workspaceId?: string; owner: boolean; process: Process; processRevision: number; hasWork: boolean }) =>
  !!args.workspaceId && args.owner && isCompanyWorkspaceId(args.workspaceId) && !args.process.built && args.processRevision <= 1 && !args.hasWork;

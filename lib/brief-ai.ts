// The brand brief written by the AI (client page → Brief de marque → « Remplir avec l’IA », owner and
// admins): what the studio knows about the client — its file, its content plans (each month's angle,
// series and ideas), its tasks and posts, its requests and its feedback — becomes a proposed brief in the
// board's own format (lib/client-brief.ts), reviewed before anything is saved. The brief is shown to the
// client in the portal, so prices, contracts, service offers and the team's names are never sent.
// Pure: tests/brief-ai.mjs. The model call is writeBrief (lib/ai.ts).
import { briefHasContent, briefSections, clientBriefSchema, emptyBrief, type BriefSection, type ClientBrief } from '@/lib/client-brief';
import type { ContentPlan, PlanItemFields } from '@/lib/content-plan';
import type { RecordItem } from '@/lib/model';
import { formatLabels, mediaOf, networkLabels, targetsOf } from '@/lib/social';

export const briefSourceLimits = { months: 4, ideasPerMonth: 40, tasks: 40, posts: 20, requests: 15, feedback: 15 };
/**
 * Characters each part of the material may take — about 6 600 in all, so the question stays well
 * inside Groq's per-minute budget (lib/ai.ts → writeBrief) even in Arabic. Each part has its own
 * share, so a long plan never pushes the feedback out.
 */
export const briefBudget = { file: 1600, plans: 2600, posts: 1000, tasks: 600, requests: 400, feedback: 450 };
/** What a proposal was built from, said back to the person before they apply it. */
export type BriefBasis = { months: number; ideas: number; tasks: number; posts: number; requests: number; feedback: number };

const one = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const urlPattern = /https?:\/\/[^\s"'<>)\]]+/g;

/** The client's material as plain text for the model, newest first, bounded, with what it holds. */
export function briefSources(records: RecordItem[], plans: ContentPlan[], clientId: string): { text: string; basis: BriefBasis; urls: string[] } {
  const client = records.find((r) => r.kind === 'client' && r.id === clientId);
  if (!client) return { text: '', basis: { months: 0, ideas: 0, tasks: 0, posts: 0, requests: 0, feedback: 0 }, urls: [] };
  const newest = (a: RecordItem, b: RecordItem) => (b.due || b.createdAt || '').localeCompare(a.due || a.createdAt || '');
  const lines: string[] = [];
  // A part takes whole lines up to its share; what doesn't fit is said to be left out.
  const add = (title: string, body: string[], budget: number) => {
    if (!body.length) return;
    let used = title.length;
    const kept: string[] = [];
    for (const line of body) {
      if (used + line.length + 1 > budget) { kept.push('- … (more, left out)'); break; }
      kept.push(line); used += line.length + 1;
    }
    lines.push(`\n${title}`, ...kept);
  };

  const current = client.brief ? Object.fromEntries(briefSections.filter((k) => briefHasContent(client.brief!, k)).map((k) => [k, sectionOf(client.brief!, k)])) : {};
  add('CLIENT FILE', [
    `Name: ${one(client.name, 160)}`,
    client.sector ? `Sector: ${one(client.sector, 160)}` : '',
    client.language ? `Language of the brand: ${one(client.language, 40)}` : '',
    client.quota ? `Pieces of content per month: ${one(client.quota, 20)}` : '',
    client.description ? `Description: ${one(client.description, 600)}` : '',
    Object.keys(current).length ? `Current brief (keep what is right, complete what is missing): ${JSON.stringify(current).slice(0, 1200)}` : '',
  ].filter(Boolean), briefBudget.file);

  const months = plans.filter((p) => p.clientId === clientId && !p.archived).sort((a, b) => b.month.localeCompare(a.month)).slice(0, briefSourceLimits.months);
  let ideas = 0;
  const planLines: string[] = [];
  for (const plan of months) {
    const items = (records as (RecordItem & Partial<PlanItemFields>)[]).filter((r) => (r.kind === 'task' || r.kind === 'plan_item') && r.planId === plan.id && !r.archived).slice(0, briefSourceLimits.ideasPerMonth);
    ideas += items.length;
    planLines.push(`## ${plan.month}${plan.notes ? ` — angle of the month: ${one(plan.notes, 300)}` : ''}`);
    for (const branch of plan.branches) {
      const mine = items.filter((i) => i.planBranch === branch.id);
      planLines.push(`- Series « ${one(branch.name, 120)} »${mine.length ? ':' : ' (no content yet)'}`);
      for (const i of mine) planLines.push(`  - [${i.planType ?? 'post'}] ${one(i.name, 120)}${i.planContent ? ` — ${one(i.planContent, 160)}` : ''}`);
    }
  }
  add('CONTENT PLANS (newest month first)', planLines, briefBudget.plans);

  const tasks = records.filter((r) => r.kind === 'task' && r.clientId === clientId && !r.planId).sort(newest).slice(0, briefSourceLimits.tasks);
  add('TASKS (newest first)', tasks.map((t) => `- ${one(t.name, 120)}${t.description ? ` — ${one(t.description, 160)}` : ''}`), briefBudget.tasks);

  const posts = records.filter((r) => r.kind === 'editorial_post' && r.clientId === clientId && !r.archived && !r.repeatOf).sort(newest).slice(0, briefSourceLimits.posts);
  add('SOCIAL POSTS (newest first)', posts.map((p) => {
    const where = targetsOf(p).map((t) => `${networkLabels[t.network]} ${formatLabels[t.format]}`).join(', ');
    const media = mediaOf(p);
    return `- [${where || 'no network'}${media.length ? ` · ${media.length} media` : ''}] ${one(p.description || p.name, 300)}`;
  }), briefBudget.posts);

  const requests = records.filter((r) => r.kind === 'request' && r.clientId === clientId).sort(newest).slice(0, briefSourceLimits.requests);
  add('WHAT THE CLIENT ASKED FOR', requests.map((r) => `- ${one(r.name, 120)}${r.description ? ` — ${one(r.description, 200)}` : ''}`), briefBudget.requests);

  const taskIds = new Set(records.filter((r) => (r.kind === 'task' || r.kind === 'plan_item') && r.clientId === clientId).map((r) => r.id));
  const feedback = records.filter((r) => r.kind === 'comment' && !!r.taskId && taskIds.has(r.taskId) && !r.deletedAt && /^\[(Retours client|Tour hors forfait)/.test(r.name ?? ''))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, briefSourceLimits.feedback);
  add('CLIENT FEEDBACK ON DELIVERABLES (newest first)', feedback.map((c) => `- ${one(c.name, 200)}`), briefBudget.feedback);

  const text = lines.join('\n').trim();
  return {
    text,
    basis: { months: months.length, ideas, tasks: tasks.length, posts: posts.length, requests: requests.length, feedback: feedback.length },
    urls: [...new Set(text.match(urlPattern) ?? [])],
  };
}

function sectionOf(brief: ClientBrief, key: BriefSection) {
  if (key === 'audience') return { audience: brief.audience, voice: brief.voice };
  if (key === 'identity') return brief.identity;
  if (key === 'goals') return brief.goals.map(({ title, measure }) => ({ title, measure }));
  if (key === 'requirements') return brief.requirements.map(({ text, priority }) => ({ text, priority }));
  if (key === 'references') return brief.references.map(({ label, url }) => ({ label, url }));
  return brief.overview;
}

/** The JSON the model is asked for: the brief without ids (they are added here). */
export const briefShape = '{"overview": string, "audience": string, "voice": string, "identity": {"colors": [{"name": string, "value": "#RRGGBB"}], "typography": string, "direction": string, "dos": string, "donts": string}, "goals": [{"title": string, "measure": string}], "requirements": [{"text": string, "priority": "must" | "prefer"}], "references": [{"label": string, "url": string}]}';

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? v as Raw : {});
const list = (v: unknown, max: number): Raw[] => (Array.isArray(v) ? v.map(obj).slice(0, max) : []);

/**
 * The model's answer as a valid brief: cut to the board's limits, ids added, and only facts it can
 * back — a colour only as #RRGGBB, a reference only when its link appears in the client's material
 * (or is already in the brief). The current brief's colours, typography and references are kept when
 * the answer has none, since the model can't see the logo.
 */
export function toBrief(answer: unknown, current: ClientBrief | undefined, knownUrls: string[]): ClientBrief | null {
  const a = obj(answer), id = obj(a.identity);
  const base = current ?? emptyBrief();
  const allowed = new Set([...knownUrls, ...base.references.map((r) => r.url)]);
  const colors = list(id.colors, 8).map((c) => ({ name: one(c.name, 80), value: one(c.value, 7) })).filter((c) => c.name && /^#[0-9a-fA-F]{6}$/.test(c.value));
  const references = list(a.references, 20).map((r) => ({ id: crypto.randomUUID(), label: one(r.label, 160), url: one(r.url, 2000) })).filter((r) => r.label && allowed.has(r.url));
  const brief = {
    version: 1 as const,
    overview: typeof a.overview === 'string' ? a.overview.trim().slice(0, 15_000) : '',
    audience: one(a.audience, 5000), voice: one(a.voice, 5000),
    identity: {
      colors: colors.length ? colors : base.identity.colors,
      typography: one(id.typography, 500) || base.identity.typography,
      direction: one(id.direction, 5000), dos: one(id.dos, 5000), donts: one(id.donts, 5000),
    },
    goals: list(a.goals, 20).map((g) => ({ id: crypto.randomUUID(), title: one(g.title, 300), measure: one(g.measure, 500) })).filter((g) => g.title),
    requirements: list(a.requirements, 30).map((r) => ({ id: crypto.randomUUID(), text: one(r.text, 1000), priority: r.priority === 'prefer' ? 'prefer' as const : 'must' as const })).filter((r) => r.text),
    references: references.length ? references : base.references,
  };
  // A proposal is the AI's own writing: colours, fonts and links carried over from the current brief don't make one.
  const written = !!(brief.overview || brief.audience || brief.voice || brief.identity.direction || brief.identity.dos || brief.identity.donts || brief.goals.length || brief.requirements.length);
  const parsed = clientBriefSchema.safeParse(brief);
  return parsed.success && written ? parsed.data : null;
}

/** « Compléter seulement » : the sections already written stay as they are; the empty ones take the proposal. */
export function fillEmptySections(current: ClientBrief, proposal: ClientBrief): ClientBrief {
  const keep = (k: BriefSection) => briefHasContent(current, k);
  return {
    version: 1,
    overview: keep('overview') ? current.overview : proposal.overview,
    audience: keep('audience') ? current.audience : proposal.audience,
    voice: keep('audience') ? current.voice : proposal.voice,
    identity: keep('identity') ? current.identity : proposal.identity,
    goals: keep('goals') ? current.goals : proposal.goals,
    requirements: keep('requirements') ? current.requirements : proposal.requirements,
    references: keep('references') ? current.references : proposal.references,
  };
}

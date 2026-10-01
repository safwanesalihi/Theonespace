import type { ChatMention, RecordItem } from '@/lib/model';
import type { WorkspaceMember } from '@/lib/workspace';

export type MentionCandidate = { userId: string; name: string; role: 'owner' | 'admin' | 'client' | 'assignee' };
export type MentionSelection = Pick<ChatMention, 'userId' | 'start' | 'end'>;

/** A task's people, never the entire workspace directory. Stable assignee IDs win
 * over display names; the legacy fallback must identify exactly one member. */
export function taskMentionCandidates(task: RecordItem, roster: WorkspaceMember[]): MentionCandidate[] {
  const legacy = !task.assigneeId && task.assignee
    ? roster.filter(m => m.role !== 'client' && (m.name === task.assignee || m.email === task.assignee)) : [];
  const assigneeId = task.assigneeId || (legacy.length === 1 ? legacy[0].userId : undefined);
  const seen = new Set<string>();
  return roster.flatMap(member => {
    const role = member.role === 'owner' || member.role === 'admin' ? member.role
      : member.role === 'client' && !!task.clientId && member.clientId === task.clientId ? 'client'
      : member.role !== 'client' && member.userId === assigneeId ? 'assignee' : null;
    if (!role || seen.has(member.userId)) return [];
    seen.add(member.userId);
    const name = (member.name?.trim() || member.email?.split('@')[0] || 'Participant').replace(/\s+/g, ' ');
    return [{ userId: member.userId, name, role }];
  });
}

export function validateMentions(input: unknown, text: string, candidates: MentionCandidate[]): ChatMention[] | { error: string } {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 20) return { error: 'Jusqu’à 20 mentions par message.' };
  const result: ChatMention[] = [];
  for (const value of input) {
    const person = candidates.find(p => p.userId === value?.userId);
    if (!person) return { error: 'Cette personne ne participe pas à cette tâche. Actualisez la discussion.' };
    if (!Number.isInteger(value.start) || !Number.isInteger(value.end) || value.start < 0 || value.end > text.length || value.end <= value.start
      || text.slice(value.start, value.end) !== `@${person.name}`) return { error: 'Mention invalide. Sélectionnez la personne dans la liste.' };
    result.push({ userId: person.userId, name: person.name, start: value.start, end: value.end });
  }
  result.sort((a, b) => a.start - b.start);
  if (result.some((m, i) => i > 0 && m.start < result[i - 1].end)) return { error: 'Mention invalide. Sélectionnez la personne dans la liste.' };
  return result;
}

/** Preserve untouched mention spans when typing before/after them. Editing any
 * part of a mention removes its identity, rather than tagging the wrong person. */
export function editMentions(before: string, after: string, mentions: MentionSelection[], selection?: { start: number; end: number }): MentionSelection[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let oldEnd = before.length, newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
  // A selected replacement can contain identical names. Use the actual edit range
  // so deleting the first @Alex never preserves the first Alex's identity on the second token.
  if (selection && selection.end > selection.start) {
    const selectedEnd = after.length - (before.length - selection.end);
    if (selectedEnd >= selection.start && after.slice(0, selection.start) === before.slice(0, selection.start)
      && after.slice(selectedEnd) === before.slice(selection.end)) {
      start = selection.start; oldEnd = selection.end; newEnd = selectedEnd;
    }
  }
  const delta = newEnd - oldEnd;
  return mentions.flatMap(m => m.end <= start ? [m] : m.start >= oldEnd ? [{ ...m, start: m.start + delta, end: m.end + delta }] : []);
}

export function mentionQuery(text: string, caret: number) {
  const prefix = text.slice(0, caret);
  const match = /(?:^|[\s(])@([^@\n]{0,80})$/.exec(prefix);
  return match ? { start: caret - match[1].length - 1, end: caret, query: match[1] } : null;
}

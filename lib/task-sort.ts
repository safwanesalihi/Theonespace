import type { RecordItem } from '@/lib/model';
import { behaviourOf, oneCoreProcess, statusIds, type Behaviour, type Process } from '@/lib/process';

/** Decisions first: the studio's own check, then the client's; then work not started, in production, paused, done. */
export const behaviourOrder: Behaviour[] = ['internal', 'client', 'todo', 'work', 'paused', 'done'];
/** A studio's statuses in that order (its own order within each kind): the « by status » sort and grouping. */
export const taskStatusOrder = (process: Process = oneCoreProcess) =>
  [...statusIds(process)].sort((a, b) => behaviourOrder.indexOf(behaviourOf(a, process)) - behaviourOrder.indexOf(behaviourOf(b, process)));

/** Approvals first by default (the studio's own, then the client's); due date, name and id keep equal statuses stable. */
export function compareTasks(a: RecordItem, b: RecordItem, sort = 'status', locale = 'fr', process: Process = oneCoreProcess) {
  const byName = () => a.name.localeCompare(b.name, locale) || a.id.localeCompare(b.id);
  if (sort === 'name') return byName();
  const byDue = () => (a.due || '9999').localeCompare(b.due || '9999') || byName();
  if (sort === 'status') {
    const order = statusIds(process);
    const rank = (task: RecordItem) => behaviourOrder.indexOf(behaviourOf(task.status, process)) * 100 + Math.max(0, order.indexOf(task.status ?? ''));
    return rank(a) - rank(b) || byDue();
  }
  return byDue();
}

import { statuses, type RecordItem } from '@/lib/model';

/** Workflow order by default; due date, name and id keep equal statuses stable. */
export function compareTasks(a: RecordItem, b: RecordItem, sort = 'status', locale = 'fr') {
  const byName = () => a.name.localeCompare(b.name, locale) || a.id.localeCompare(b.id);
  if (sort === 'name') return byName();
  const byDue = () => (a.due || '9999').localeCompare(b.due || '9999') || byName();
  if (sort === 'status') {
    const rank = (task: RecordItem) => Math.max(0, statuses.indexOf(task.status!));
    return rank(a) - rank(b) || byDue();
  }
  return byDue();
}

import type { RecordItem } from '@/lib/model';

export const taskStatusOrder = ['À valider', 'À faire', 'En cours', 'En pause', 'Validé'] as const;

/** Approval first by default; due date, name and id keep equal statuses stable. */
export function compareTasks(a: RecordItem, b: RecordItem, sort = 'status', locale = 'fr') {
  const byName = () => a.name.localeCompare(b.name, locale) || a.id.localeCompare(b.id);
  if (sort === 'name') return byName();
  const byDue = () => (a.due || '9999').localeCompare(b.due || '9999') || byName();
  if (sort === 'status') {
    const rank = (task: RecordItem) => {
      const index = taskStatusOrder.indexOf(task.status || 'À faire');
      return index < 0 ? taskStatusOrder.indexOf('À faire') : index;
    };
    return rank(a) - rank(b) || byDue();
  }
  return byDue();
}

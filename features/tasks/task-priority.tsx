'use client';
// Priority as a coloured dot and its word, without a chip: the status is the one filled chip on a row.
import type { Priority } from '@/lib/model';
import { useI18n } from '@/lib/i18n/locale-provider';
export default function TaskPriority({ priority = 'Moyenne' }: { priority?: Priority }) {
  const { t } = useI18n();
  return <span className={`priority-mark priority-${priority.toLowerCase()}`}><span className="priority-dot" aria-hidden="true" />{t(priority)}</span>;
}

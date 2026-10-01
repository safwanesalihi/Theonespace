'use client';
import type { Priority } from '@/lib/model';
import { useI18n } from './locale-provider';
export default function TaskPriority({ priority = 'Moyenne' }: { priority?: Priority }) {
  const { t } = useI18n();
  return <span className={`flag-pill priority-${priority.toLowerCase()}`}><span className="priority-dot" />{t(priority)}</span>;
}

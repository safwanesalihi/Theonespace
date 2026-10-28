'use client';
// The dashboard's signature: the deliverables in hand moving through the studio's steps (lib/process.ts), each drawn with
// the ring of the One Core mark. A ring fills to its step's share of the work, in that status's color; the
// numbers count up as the page opens. The one step that waits on the studio's own decision (internal
// review) carries the gold. A paused task is still "in progress" as far as the steps go.
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n/locale-provider';
import type { RecordItem, Status } from '@/lib/model';
import { behaviourOf, chartColorOf, startStatus, statusDef, statusLabel, stepIds, workStatus } from '@/lib/process';
import { useProcess } from '@/features/workspace/process-context';

const radius = 26;
const circumference = 2 * Math.PI * radius;

/**
 * A number that counts up from its last value to the new one. It only animates where someone is
 * watching: in a hidden tab (no frames run there) or under reduced motion it shows the number at once,
 * so the page is right at rest.
 */
export function CountUp({ value, duration = 700, format }: { value: number; duration?: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (start === value || document.visibilityState !== 'visible' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const id = window.setTimeout(() => setShown(value));
      return () => window.clearTimeout(id);
    }
    let frame = 0;
    const began = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - began) / duration);
      setShown(Math.round(start + (value - start) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    // Leaving the tab mid-count: settle on the number rather than freeze halfway.
    const settle = () => { if (document.visibilityState !== 'visible') { cancelAnimationFrame(frame); setShown(value); } };
    document.addEventListener('visibilitychange', settle);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', settle); };
  }, [value, duration]);
  return <>{format ? format(shown) : shown}</>;
}

export default function FlowPipeline({ tasks, onSelect }: { tasks: RecordItem[]; onSelect: (status: Status) => void }) {
  const { t } = useI18n();
  const process = useProcess();
  const steps = stepIds(process);
  // A paused task still counts where work stands.
  const stepOf = (task: RecordItem) => (behaviourOf(task.status, process) === 'paused' ? workStatus(process) : task.status ?? startStatus(process));
  const counts = steps.map((step) => tasks.filter((task) => stepOf(task) === step).length);
  const paused = tasks.filter((task) => behaviourOf(task.status, process) === 'paused').length;
  const total = Math.max(1, tasks.length);
  return (
    <section className="flow-pipeline" aria-label={t('Le flux de production')}>
      <ol>
        {steps.map((step, index) => {
          const share = counts[index] / total;
          const decide = behaviourOf(step, process) === 'internal' && counts[index] > 0;
          return (
            <li key={step} style={{ '--i': index, '--ring': chartColorOf(statusDef(step, process)?.color ?? 'gray') } as React.CSSProperties}>
              <button type="button" className={decide ? 'decide' : undefined} onClick={() => onSelect(step)}>
                <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
                  <circle cx="32" cy="32" r={radius} className="track" />
                  <circle cx="32" cy="32" r={radius} className="arc" style={{ strokeDasharray: circumference, strokeDashoffset: circumference * (1 - share) }} transform="rotate(-90 32 32)" />
                </svg>
                <strong><CountUp value={counts[index]} /></strong>
                <span>{t(statusLabel(step, process))}</span>
                {step === workStatus(process) && paused > 0 && <small>{t('dont {n} en pause', { n: paused })}</small>}
                {decide && <small className="decide-tag">{t('Votre décision')}</small>}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

'use client';
// The dashboard, kept to what a studio acts on. One bold stage — the production flow on the dark of the
// One Core mark — then what to do now, the rhythm of approvals, and each client at a glance. The detailed
// numbers live where they are used (tasks, clients, the activity report), not here.
import { isDone } from '@/lib/process';
import { useProcess } from '@/features/workspace/process-context';
import { Surface } from "@/components/ui/surface";
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { ArrowUpRight, CheckCircle2, ChevronRight, Plus, RefreshCw } from 'lucide-react';
import { useI18n } from '@/lib/i18n/locale-provider';
import DashboardPeriod from '@/features/dashboard/dashboard-period';
import { TrendArea } from '@/features/dashboard/dashboard-charts';
import FlowPipeline, { CountUp } from '@/features/dashboard/flow-pipeline';
import ClientMark from '@/features/clients/client-mark';
import { Chip } from '@/features/tasks/task-controls';
import { type RecordItem, type Status } from '@/lib/model';
import { type WorkflowSettings } from '@/lib/workflow-settings';
import { clientPeriodWork, clientWork, dayIn, isInternalTask, monthPeriod, shiftDay } from '@/lib/flow';
import { builtinMetrics, computeDashboard, type MetricValue } from '@/lib/dashboard';

// The analysis (time, pace, the client's side) loads when a manager first opens it.
const ReportsView = dynamic(() => import('@/features/reports/reports-view'));

export type DashboardFocus = 'active' | 'review' | 'late' | 'done';
export type DashboardSelection = { focus?: DashboardFocus; status?: Status; clientId?: string };

type Props = {
  workflowSettings?: WorkflowSettings;
  records: RecordItem[];
  today: string;
  busy: boolean;
  currentUserId: string;
  onOpenTask: (id: string) => void;
  onOpenClient: (id: string) => void;
  onMarkRead: (ids: string[]) => Promise<void>;
  onRefresh: () => void;
  onCreateTask?: () => void;
  /** Owner and administrators: the « Analyse » view beside the overview. */
  canAnalyse?: boolean;
  onBrowseTasks: (selection: DashboardSelection) => void;
};

const ringLength = 2 * Math.PI * 17;

/** A number in its unit: a share in %, hours (minutes under one), an amount with the field's unit. */
function metricText(kind: MetricValue['kind'], value: number, tag: string, unit?: string) {
  const n = (v: number, digits = 1) => v.toLocaleString(tag, { maximumFractionDigits: digits });
  if (kind === 'share') return `${n(value * 100, 0)} %`;
  if (kind === 'hours') return value < 1 && value > 0 ? `${n(value * 60, 0)} min` : `${n(value)} h`;
  if (kind === 'count') return n(value, 0);
  return unit ? `${n(value, 2)} ${unit}` : n(value, 2);
}

export default function FlowPage({ records, today, busy, onOpenTask, onOpenClient, onRefresh, onCreateTask, onBrowseTasks, canAnalyse }: Props) {
  const { t, tag } = useI18n();
  const [view, setView] = useState<'overview' | 'analysis'>('overview');
  const process = useProcess();
  const [periodKey, setPeriodKey] = useState('month');
  const period = periodKey === 'previous' ? monthPeriod(shiftDay(today.slice(0, 8) + '01', -1)) : periodKey === '30' ? { from: shiftDay(today, -29), to: today } : monthPeriod(today);
  const parent = (id?: string) => records.find((r) => r.id === id);
  const clients = records.filter((r) => r.kind === 'client' && !r.archived);
  const live = records.filter((r) => r.kind === 'task' && !r.archived && !parent(r.clientId)?.archived && !parent(r.projectId)?.archived);
  // The dashboard is the client work; the agency's own tasks are counted apart and open their own page.
  const tasks = clientWork(live);
  const internalOpen = live.filter((task) => isInternalTask(task) && !isDone(task.status, process)).length;
  const approved = tasks.filter((task) => isDone(task.status, process)).length;
  const approvedShare = tasks.length ? Math.round((approved / tasks.length) * 100) : 0;
  const late = tasks.filter((task) => !!task.due && task.due < today && !isDone(task.status, process)).length;
  const next = tasks.filter((task) => !isDone(task.status, process)).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999')).slice(0, 6);
  const clientName = (id?: string) => clients.find((c) => c.id === id)?.name || t('Interne');
  const day = (iso: string, options: Intl.DateTimeFormatOptions) => new Date(`${iso}T12:00:00`).toLocaleDateString(tag, options);
  const periodLabel = `${day(period.from, { day: 'numeric', month: 'short' })} → ${day(period.to, { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const days: string[] = [];
  for (let d = period.from; d <= period.to; d = shiftDay(d, 1)) days.push(d);
  const rhythm = days.map((d) => ({ x: d, y: tasks.filter((task) => task.validatedAt && dayIn(new Date(task.validatedAt)) === d).length, label: day(d, { day: 'numeric', month: 'long' }) }));
  const validations = rhythm.reduce((total, point) => total + point.y, 0);

  // Each client's period: the content approved against the quota sold, or else against what is planned.
  const clientCards = clients.slice(0, 8).map((client) => {
    const { planned, approved, quota } = clientPeriodWork(records, client, period);
    const total = quota ?? planned;
    return { client, approved, total, toPlan: quota ? Math.max(0, quota - planned) : 0, share: total ? Math.min(1, approved / total) : 0 };
  });

  // The studio's own numbers (lib/dashboard.ts), for those who run it: each against its target.
  const numbers = canAnalyse ? computeDashboard(records, period, process) : [];

  const switcher = canAnalyse && <div className="live-switch dash-view" role="group" aria-label={t('Affichage')}>
    <button aria-pressed={view === 'overview'} onClick={() => setView('overview')}>{t('Vue d’ensemble')}</button>
    <button aria-pressed={view === 'analysis'} onClick={() => setView('analysis')}>{t('Analyse')}</button>
  </div>;
  if (view === 'analysis') return <div className="flow-page dash">
    {switcher}
    <h1 className="sr-only">{t('Tableau de bord')} · {t('Analyse')}</h1>
    <ReportsView records={records} today={today} onOpenTask={onOpenTask} />
  </div>;

  return <div className="flow-page dash">
    {switcher}
    <Surface asChild tone="inverse"><section className="dash-stage" aria-labelledby="dash-title">
      <svg className="dash-stage-mark" viewBox="0 0 200 200" aria-hidden="true">
        <circle cx="100" cy="100" r="78" fill="none" stroke="currentColor" strokeWidth="16" strokeLinecap="round" strokeDasharray="400 90" transform="rotate(-60 100 100)" />
        <circle cx="100" cy="100" r="22" fill="currentColor" />
      </svg>
      <header className="dash-stage-head">
        <div><p>{periodLabel}</p><h1 id="dash-title">{t('Tableau de bord')}</h1></div>
        <div className="inline">
          <DashboardPeriod value={periodKey} onChange={setPeriodKey} />
          <button className="icon-button" disabled={busy} onClick={onRefresh} aria-label={t('Actualiser')} title={t('Actualiser')}><RefreshCw size={15} className={busy ? 'spin' : ''} /></button>
          {onCreateTask && <button className="btn primary" onClick={onCreateTask}><Plus size={16} />{t('Nouvelle tâche')}</button>}
        </div>
      </header>
      <FlowPipeline tasks={tasks} onSelect={(status) => onBrowseTasks({ status })} />
      <div className="dash-stage-foot">
        <span className="dash-stat"><strong><CountUp value={approvedShare} />%</strong>{t('du travail validé')}</span>
        {late > 0
          ? <button className="dash-stat late" onClick={() => onBrowseTasks({ focus: 'late' })}><strong><CountUp value={late} /></strong>{t('en retard')}<ArrowUpRight size={14} /></button>
          : <span className="dash-stat"><CheckCircle2 size={16} />{t('Rien en retard')}</span>}
        {internalOpen > 0 && <button className="dash-stat" onClick={() => onBrowseTasks({ clientId: 'internal' })}><strong><CountUp value={internalOpen} /></strong>{t('tâches internes en cours')}<ArrowUpRight size={14} /></button>}
      </div>
    </section></Surface>

    <div className="dash-grid">
      <Surface asChild tone="default"><section className="dash-panel">
        <header><h2>{t('À faire maintenant')}</h2><button className="text-link" onClick={() => onBrowseTasks({ focus: 'active' })}>{t('Voir tout')}<ArrowUpRight size={14} /></button></header>
        <div className="dash-next">
          {next.map((task) => <button key={task.id} className="dash-row" onClick={() => onOpenTask(task.id)}>
            <span className="dash-row-main"><strong>{task.name}</strong><small>{clientName(task.clientId)}</small></span>
            {task.due && <span className={`dash-due ${task.due < today ? 'late' : task.due === today ? 'today' : ''}`}>{task.due === today ? t('Aujourd’hui') : day(task.due, { day: 'numeric', month: 'short' })}</span>}
            <Chip status={task.status} />
            <ChevronRight size={15} />
          </button>)}
          {!next.length && <p className="dash-empty"><CheckCircle2 size={20} />{t('Rien d’urgent : tout est à jour.')}</p>}
        </div>
      </section></Surface>
      <Surface asChild tone="default"><section className="dash-panel">
        <header><h2>{t('Rythme des validations')}</h2><span className="dash-total"><CountUp value={validations} /><small>{t('validations')}</small></span></header>
        <TrendArea data={rhythm} color="var(--t-brand)" height={200} xTickFormatter={(x) => day(x, { day: 'numeric', month: 'short' })} />
      </section></Surface>
    </div>

    {numbers.length > 0 && <section className="dash-numbers" aria-labelledby="dash-numbers-title">
      <h2 id="dash-numbers-title">{t('Vos chiffres')}</h2>
      <div className="dash-number-grid">
        {numbers.map((m, index) => {
          // The bar: the value against a scale a little past the larger of value and target; the tick is the target.
          const scale = Math.max(m.value ?? 0, m.target ?? 0) * 1.25 || 1;
          return <Surface asChild tone="default" key={m.id}><div className={`dash-number ${m.state ?? ''}`} style={{ '--i': index } as React.CSSProperties}>
            <span className="dash-number-label">{m.id in builtinMetrics ? t(m.label) : m.label}</span>
            <strong>{m.value === null ? '—' : metricText(m.kind, m.value, tag, m.unit)}</strong>
            <span className="dash-number-bar" aria-hidden="true">
              <i style={{ width: `${((m.value ?? 0) / scale) * 100}%` }} />
              {m.target !== undefined && <b style={{ insetInlineStart: `${(m.target / scale) * 100}%` }} />}
            </span>
            <small>{m.target === undefined ? t('Sans cible') : t('Cible {target}', { target: `${m.atMost ? '≤' : '≥'} ${metricText(m.kind, m.target, tag, m.unit)}` })}
              {m.state && <em>{m.state === 'good' ? t('Tenu') : t('À surveiller')}</em>}</small>
          </div></Surface>;
        })}
      </div>
    </section>}

    {clientCards.length > 0 && <section className="dash-clients" aria-labelledby="dash-clients-title">
      <h2 id="dash-clients-title">{t('Vos clients')}</h2>
      <div className="dash-client-grid">
        {clientCards.map(({ client, approved, total, toPlan, share }, index) => <Surface asChild tone="default" key={client.id}><button className="dash-client" style={{ '--i': index } as React.CSSProperties} onClick={() => onOpenClient(client.id)}>
          <ClientMark name={client.name} logo={client.logo} size="md" />
          <span className="dash-client-name"><strong>{client.name}</strong>
            <small>{total ? t('{a} sur {b} validés', { a: approved, b: total }) : t('Rien de prévu sur la période')}</small>
            {toPlan > 0 && <small className="dash-client-gap">{t('{n} à planifier', { n: toPlan })}</small>}</span>
          <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true"><circle cx="20" cy="20" r="17" className="track" /><circle cx="20" cy="20" r="17" className="arc" style={{ strokeDasharray: ringLength, strokeDashoffset: ringLength * (1 - share) }} transform="rotate(-90 20 20)" /></svg>
        </button></Surface>)}
      </div>
    </section>}
  </div>;
}

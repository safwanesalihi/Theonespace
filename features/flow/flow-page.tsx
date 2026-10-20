'use client';
// The dashboard, kept to what a studio acts on. One bold stage — the production flow on the dark of the
// One Core mark — then what to do now, the rhythm of approvals, and each client at a glance. The detailed
// numbers live where they are used (tasks, clients, the activity report), not here.
import { Surface } from "@/components/ui/surface";
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
import { computeMetrics, dayIn, monthPeriod, shiftDay } from '@/lib/flow';

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
  onBrowseTasks: (selection: DashboardSelection) => void;
};

const ringLength = 2 * Math.PI * 17;

export default function FlowPage({ records, today, busy, onOpenTask, onOpenClient, onRefresh, onCreateTask, onBrowseTasks }: Props) {
  const { t, tag } = useI18n();
  const [periodKey, setPeriodKey] = useState('month');
  const period = periodKey === 'previous' ? monthPeriod(shiftDay(today.slice(0, 8) + '01', -1)) : periodKey === '30' ? { from: shiftDay(today, -29), to: today } : monthPeriod(today);
  const parent = (id?: string) => records.find((r) => r.id === id);
  const clients = records.filter((r) => r.kind === 'client' && !r.archived);
  const tasks = records.filter((r) => r.kind === 'task' && !r.archived && !parent(r.clientId)?.archived && !parent(r.projectId)?.archived);
  const approved = tasks.filter((task) => task.status === 'Validé').length;
  const approvedShare = tasks.length ? Math.round((approved / tasks.length) * 100) : 0;
  const late = tasks.filter((task) => !!task.due && task.due < today && task.status !== 'Validé').length;
  const next = tasks.filter((task) => task.status !== 'Validé').sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999')).slice(0, 6);
  const clientName = (id?: string) => clients.find((c) => c.id === id)?.name || t('Interne');
  const day = (iso: string, options: Intl.DateTimeFormatOptions) => new Date(`${iso}T12:00:00`).toLocaleDateString(tag, options);
  const periodLabel = `${day(period.from, { day: 'numeric', month: 'short' })} → ${day(period.to, { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const days: string[] = [];
  for (let d = period.from; d <= period.to; d = shiftDay(d, 1)) days.push(d);
  const rhythm = days.map((d) => ({ x: d, y: tasks.filter((task) => task.validatedAt && dayIn(new Date(task.validatedAt)) === d).length, label: day(d, { day: 'numeric', month: 'long' }) }));
  const validations = rhythm.reduce((total, point) => total + point.y, 0);

  // Each client's month: what was delivered against what was sold, or else its share of work approved.
  const metrics = computeMetrics(records, period);
  const clientCards = clients.slice(0, 8).map((client) => {
    const metric = metrics.clients.find((m) => m.clientId === client.id);
    const own = tasks.filter((task) => task.clientId === client.id);
    const done = own.filter((task) => task.status === 'Validé').length;
    const quota = metric?.quota ?? null;
    const [value, total] = quota ? [metric?.delivered ?? 0, quota] : [done, own.length];
    return { client, value, total, quota: !!quota, share: total ? Math.min(1, value / total) : 0 };
  });

  return <div className="flow-page dash">
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

    {clientCards.length > 0 && <section className="dash-clients" aria-labelledby="dash-clients-title">
      <h2 id="dash-clients-title">{t('Vos clients')}</h2>
      <div className="dash-client-grid">
        {clientCards.map(({ client, value, total, quota, share }, index) => <Surface asChild tone="default" key={client.id}><button className="dash-client" style={{ '--i': index } as React.CSSProperties} onClick={() => onOpenClient(client.id)}>
          <ClientMark name={client.name} logo={client.logo} size="md" />
          <span className="dash-client-name"><strong>{client.name}</strong><small>{quota ? t('{a} sur {b} livrés', { a: value, b: total }) : t('{a} sur {b} validées', { a: value, b: total })}</small></span>
          <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true"><circle cx="20" cy="20" r="17" className="track" /><circle cx="20" cy="20" r="17" className="arc" style={{ strokeDasharray: ringLength, strokeDashoffset: ringLength * (1 - share) }} transform="rotate(-90 20 20)" /></svg>
        </button></Surface>)}
      </div>
    </section>}
  </div>;
}

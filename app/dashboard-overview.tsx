'use client';
import { Surface } from "@/components/ui/surface";
import { useState } from 'react';
import { ArrowUpRight, CheckCircle2, CheckSquare, ChevronRight, Clock, Send, SlidersHorizontal } from 'lucide-react';
import { DonutStat, TrendArea, type Slice } from '@/components/dashboard-charts';
import { useI18n } from '@/lib/i18n/locale-provider';
import { statusClass, statuses, type RecordItem, type Status } from '@/lib/model';
import { dayIn } from '@/lib/flow';

export type DashboardFocus = 'active' | 'review' | 'late' | 'done';
const statusColors: Record<Status, string> = { 'À faire': 'var(--t-chart-todo)', 'En cours': 'var(--t-chart-info)', 'En pause': 'var(--t-chart-paused)', 'À valider': 'var(--t-chart-doing)', Validé: 'var(--t-chart-done)' };
export type DashboardSelection = { focus?: DashboardFocus; status?: Status; clientId?: string };
type Props = { tasks: RecordItem[]; clients: RecordItem[]; today: string; period: { from: string; to: string }; onOpenTask: (id: string) => void; onBrowseTasks: (selection: DashboardSelection) => void };

export default function DashboardOverview({ tasks, clients, today, period, onOpenTask, onBrowseTasks }: Props) {
  const { t, tag } = useI18n();
  const [focus, setFocus] = useState<DashboardFocus>('active');
  const [status, setStatus] = useState('');
  const [clientId, setClientId] = useState('');
  const [group, setGroup] = useState<'status' | 'client'>('status');
  const [series, setSeries] = useState<'completed' | 'created'>('completed');
  const matches = (task: RecordItem, key: DashboardFocus) => key === 'review' ? task.status === 'À valider' : key === 'done' ? task.status === 'Validé' : key === 'late' ? !!task.due && task.due < today && task.status !== 'Validé' : task.status !== 'Validé';
  const filtered = tasks.filter((task) => status ? task.status === status : clientId ? task.clientId === clientId : matches(task, focus)).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  const name = (id?: string) => clients.find((client) => client.id === id)?.name || t('Interne');
  const statusSlices: Slice[] = statuses.map((key) => ({ key, label: t(key), value: tasks.filter((task) => task.status === key).length, color: statusColors[key] }));
  const clientSlices: Slice[] = [...clients.map((client, index) => ({ key: client.id, label: client.name, value: tasks.filter((task) => task.clientId === client.id).length, color: ['var(--t-chart-doing)', 'var(--t-chart-done)', 'var(--t-chart-info)', 'var(--t-chart-paused)', 'var(--t-chart-review)', 'var(--t-chart-todo)'][index % 6] })), { key: 'internal', label: t('Interne'), value: tasks.filter((task) => !task.clientId || task.clientId === 'internal').length, color: 'var(--t-chart-todo)' }].filter((item) => item.value > 0);
  const days = Array.from({ length: Math.round((Date.parse(period.to) - Date.parse(period.from)) / 86400000) + 1 }, (_, index) => new Date(Date.parse(period.from) + index * 86400000).toISOString().slice(0, 10));
  const trend = days.map((day) => ({ x: day, y: tasks.filter((task) => { const stamp = series === 'completed' ? task.validatedAt : task.createdAt; return stamp && dayIn(new Date(stamp)) === day; }).length, label: new Date(`${day}T12:00:00`).toLocaleDateString(tag, { day: 'numeric', month: 'long' }) }));
  const focusTitle = status ? t(status) : clientId ? name(clientId) : t(focus === 'review' ? 'À valider' : focus === 'late' ? 'En retard' : focus === 'done' ? 'Tâches validées' : 'Vos priorités');
  const chooseFocus = (key: DashboardFocus) => { setFocus(key); setStatus(''); setClientId(''); };
  return <div className="live-overview">
    <div className="live-metrics">
      {([
        ['active', 'Tâches actives', 'Faites avancer la production', CheckSquare],
        ['review', 'À valider', 'La prochaine décision', Send],
        ['late', 'En retard', 'À traiter en priorité', Clock],
        ['done', 'Tâches validées', 'Prêtes pour la suite', CheckCircle2],
      ] as const).map(([key, label, detail, Icon]) => <Surface asChild tone="default" key={key}><button className={`live-metric ${key}`} aria-pressed={!status && !clientId && focus === key} onClick={() => chooseFocus(key)}>
        <span className="live-metric-head"><span>{t(label)}</span><Icon size={18} /></span><strong>{String(tasks.filter((task) => matches(task, key)).length).padStart(2, '0')}</strong><span className="live-metric-foot">{t(detail)}<ArrowUpRight size={15} /></span>
      </button></Surface>)}
    </div>
    <div className="live-grid">
      <Surface asChild tone="default"><section className="live-panel live-focus">
        <header><div><span className="gold-eyebrow">{t('À VOUS DE JOUER')}</span><h2>{focusTitle}<span className="neutral-badge">{filtered.length}</span></h2></div><SlidersHorizontal size={18} /></header>
        <div className="live-switch" role="group" aria-label={t('Afficher les tâches')}>{(['active', 'review', 'late', 'done'] as const).map((key) => <button key={key} aria-pressed={!status && !clientId && focus === key} onClick={() => chooseFocus(key)}>{t(key === 'active' ? 'Actives' : key === 'review' ? 'À valider' : key === 'late' ? 'En retard' : 'Validées')}</button>)}</div>
        <div className="live-task-list" aria-live="polite">
          {filtered.slice(0, 4).map((task) => <button className="live-task" key={task.id} onClick={() => onOpenTask(task.id)}><span className={`live-task-dot ${statusClass[task.status || 'À faire']}`} /><span><strong>{task.name}</strong><small>{name(task.clientId)}{task.due && ` · ${new Date(`${task.due}T12:00:00`).toLocaleDateString(tag, { day: 'numeric', month: 'short' })}`}</small></span><ChevronRight size={16} /></button>)}
          {!filtered.length && <div className="live-empty"><CheckCircle2 size={25} /><p>{t('Aucune tâche dans cette sélection.')}</p><button className="text-link" onClick={() => chooseFocus('active')}>{t('Voir les tâches actives')}<ArrowUpRight size={14} /></button></div>}
        </div>
        <button className="live-all" onClick={() => onBrowseTasks(status ? { status: status as Status } : clientId ? { clientId } : { focus })}>{t('Ouvrir les tâches')}<ArrowUpRight size={15} /></button>
      </section></Surface>
      <Surface asChild tone="default"><section className="live-panel live-chart">
        <header><div><span className="gold-eyebrow">{t('LE RYTHME DU STUDIO')}</span><h2>{t('Activité')}</h2></div><span className="live-chart-total">{trend.reduce((total, point) => total + point.y, 0)}<small>{t(series === 'completed' ? 'validations' : 'créations')}</small></span></header>
        <div className="live-switch" role="group" aria-label={t('Série du graphique')}><button aria-pressed={series === 'completed'} onClick={() => setSeries('completed')}>{t('Validations')}</button><button aria-pressed={series === 'created'} onClick={() => setSeries('created')}>{t('Tâches créées')}</button></div>
        <TrendArea data={trend} color="var(--t-brand)" height={165} xTickFormatter={(day) => new Date(`${day}T12:00:00`).toLocaleDateString(tag, { day: 'numeric', month: 'short' })} />
        <div className="live-distribution"><div className="live-switch" role="group" aria-label={t('Répartition')}><button aria-pressed={group === 'status'} onClick={() => setGroup('status')}>{t('Par statut')}</button><button aria-pressed={group === 'client'} onClick={() => setGroup('client')}>{t('Par client')}</button></div><DonutStat data={group === 'status' ? statusSlices : clientSlices} centerLabel={t('Tâches')} size={120} selectedKey={group === 'status' ? status : clientId} onSelect={(key) => { if (group === 'status') { setStatus(status === key ? '' : key); setClientId(''); } else { setClientId(clientId === key ? '' : key); setStatus(''); } }} /></div>
      </section></Surface>
    </div>
  </div>;
}

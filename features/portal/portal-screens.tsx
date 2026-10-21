"use client";
// The client portal's main screens: home, the lists of deliverables and files, tasks by sub-project,
// and the publication calendar.
import { Surface } from "@/components/ui/surface";
import NetworkIcon from '@/components/network-icon';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ClientBriefBoard from '@/features/clients/client-brief';
import ClientImages from '@/features/clients/client-images';
import ClientMark from '@/features/clients/client-mark';
import { DonutStat } from '@/features/dashboard/dashboard-charts';
import TaskPriority from '@/features/tasks/task-priority';
import { shiftDay } from '@/lib/flow';
import { type RecordItem, dayKey } from '@/lib/model';
import { postStatus, statusLabels, targetsOf } from '@/lib/social';
import { Image, ArrowUpRight, CalendarClock, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock, FileText, List, Plus } from 'lucide-react';
import { Chip } from "./portal-chip";
import type { PortalContext } from "./use-portal";
import { PortalShoots } from "./portal-shoots";

export function HomeScreen({ ctx }: { ctx: PortalContext }) {
  const { client, copy, fmt, go, homeFocus, mode, navigate, pendingPosts, pname, posts, production, setHomeFocus, setShowBrief, setViewing, showBrief, t, tasks, toReview, today, user, waiting } = ctx;
  const who = mode === 'client' ? (user.name.includes('@') ? '' : user.name.split(' ')[0]) : (client.contact && client.contact !== 'Contact à renseigner' ? client.contact.split(' ')[0] : '');
  const weekEnd = shiftDay(today, 7);
  const lastWeek = shiftDay(today, -7);
  const productionPosts = posts.filter((post) => !post.publishedAt && post.approval?.state !== 'pending' && post.approval?.state !== 'approved');
  const doneTasks = tasks.filter((task) => task.status === 'Validé');
  const donePosts = posts.filter((post) => post.publishedAt || post.approval?.state === 'approved');
  const focusTasks = homeFocus === 'production' ? production : homeFocus === 'review' ? waiting : doneTasks;
  const focusPosts = homeFocus === 'production' ? productionPosts : homeFocus === 'review' ? pendingPosts : donePosts;
  const toApproveItems = [...waiting.map(t => ({...t, isPost: false})), ...pendingPosts.map(p => ({...p, isPost: true}))];
  const upcomingItems = [...tasks.filter(t => t.due && t.due >= today && t.due <= weekEnd && !t.publishedAt && t.status === 'Validé').map(t => ({...t, isPost: false})), ...posts.filter(p => p.due && p.due >= today && p.due <= weekEnd && !p.publishedAt && p.approval?.state === 'approved').map(p => ({...p, isPost: true}))].sort((a,b) => (a.due || '').localeCompare(b.due || ''));
  const recentPublished = [...tasks.filter(t => t.publishedAt && t.publishedAt >= lastWeek).map(t => ({...t, isPost: false})), ...posts.filter(p => p.publishedAt && p.publishedAt >= lastWeek).map(p => ({...p, isPost: true}))].sort((a,b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));

  return (
    <div className="portal-home">
      <Surface asChild tone="gold"><header className="ph-header">
        <div className="desktop-only"><ClientImages client={client} workspaceId="" canEdit={false} onChange={async () => false} onError={() => undefined} /></div>
        <div>
          <div className="eyebrow">{copy.dashboard}</div>
          <h1>{copy.hello(who || client.name)}</h1>
          <p className="ph-tagline">{copy.tagline}</p>
          <div className="ph-hero-actions"><button className="btn primary" onClick={() => go('calendar')}><CalendarDays size={16} />{copy.calendar}<ArrowUpRight size={15} /></button><button className="btn" onClick={() => go('request')}><Plus size={16} />{copy.request}</button></div>
        </div>
      </header></Surface>

      <div className="ph-summary">
        {[
          { label: copy.review, count: toReview, icon: CheckCircle2, target: 'review', tone: 'review' },
          { label: t('À paraître'), count: upcomingItems.length, icon: CalendarDays, target: 'calendar', tone: 'upcoming' },
          { label: t('En production'), count: production.length, icon: Clock, target: 'tasks', tone: 'production' },
        ].map(({ label, count, icon: Icon, target, tone }) => (
          <Surface asChild tone={tone === "review" ? "gold" : "default"} key={target}><button className={`ph-summary-card ${tone}`} onClick={() => go(target)}>
            <span className="ph-summary-icon"><Icon size={19} /></span>
            <span><small>{label}</small><strong>{count}</strong></span>
            <ArrowUpRight size={16} className="ph-summary-arrow" />
          </button></Surface>
        ))}
      </div>

      <PortalShoots ctx={ctx} />

      <Surface asChild tone="default"><section className="portal-brand-direction"><button className="portal-brief-toggle" aria-expanded={showBrief} aria-controls="portal-brand-brief" onClick={() => setShowBrief(!showBrief)}><span><ClientMark name={client.name} logo={client.logo} size="sm" /><span><strong>{t('Votre direction créative')}</strong><small>{t('Identité, objectifs et exigences de la marque')}</small></span></span><span>{t(showBrief ? 'Réduire' : 'Explorer le brief')}<ChevronRight size={16} /></span></button>{showBrief && <div id="portal-brand-brief"><ClientBriefBoard key={client.id} client={client} /></div>}</section></Surface>

      <Surface asChild tone="default"><section className="live-panel portal-live-progress">
        <header><div><span className="gold-eyebrow">{t('Votre projet prend vie')}</span><h2>{t('Du brief à la publication')}</h2></div><button className="text-link" onClick={() => go('tasks')}>{copy.seeAll}<ArrowUpRight size={14} /></button></header>
        <div className="portal-live-body">
          <DonutStat data={[
            { key: 'production', label: t('En production'), value: production.length + productionPosts.length, color: 'var(--t-chart-doing)' },
            { key: 'review', label: copy.review, value: toReview, color: 'var(--t-chart-review)' },
            { key: 'done', label: t('Validés ou publiés'), value: doneTasks.length + donePosts.length, color: 'var(--t-chart-done)' },
          ]} centerLabel={t('Contenus')} size={130} selectedKey={homeFocus} onSelect={(key) => setHomeFocus(key as typeof homeFocus)} />
          <div className="portal-focus-preview" aria-live="polite">
            <h3>{t(homeFocus === 'production' ? 'En production' : homeFocus === 'review' ? 'À valider' : 'Validés ou publiés')}</h3>
            {focusTasks.slice(0, 2).map((task) => <button key={task.id} onClick={() => navigate({ page: 'review', id: task.id })}><span>{task.name}</span><ArrowUpRight size={14} /></button>)}
            {focusPosts.slice(0, 2).map((post) => <button key={post.id} onClick={() => setViewing(post.id)}><span>{post.name}</span><ArrowUpRight size={14} /></button>)}
            {!focusTasks.length && !focusPosts.length && <p className="small-note">{t('Aucun contenu dans cette étape.')}</p>}
            <button className="text-link" onClick={() => go(homeFocus === 'review' ? 'review' : homeFocus === 'done' ? 'calendar' : 'tasks')}>{t('Explorer cette étape')}<ArrowUpRight size={14} /></button>
          </div>
        </div>
      </section></Surface>
      <Surface asChild tone="default"><section className="ph-section ph-urgent">
        <div className="ph-section-head">
          <h2>{t('À valider')} <span className="neutral-badge">{toApproveItems.length}</span></h2>
          {toApproveItems.length > 4 && <button className="text-link" onClick={() => go('review')}>{copy.seeAll}<ArrowUpRight size={14} /></button>}
        </div>
        {toApproveItems.length ? (
          <div className="ph-grid">
            {toApproveItems.slice(0, 4).map(item => (
              <Surface asChild tone="default" key={item.id}><button className="ph-card ph-card-urgent" onClick={() => item.isPost ? setViewing(item.id) : navigate({ page: 'review', id: item.id })}>
                <div className="ph-card-icon"><CheckCircle2 size={24} /></div>
                <div className="ph-card-body">
                  <strong>{item.name}</strong>
                  <small>{item.isPost ? t('Publication sociale') : t('Livrable')}</small>
                </div>
                <div className="ph-card-action">{copy.review} <ArrowUpRight size={14} /></div>
              </button></Surface>
            ))}
          </div>
        ) : (
          <div className="ph-empty">
            <CheckCircle2 size={32} />
            <p>{t('Tout est à jour ! Rien n’attend votre validation.')}</p>
          </div>
        )}
      </section></Surface>

      <div className="ph-row">
        <Surface asChild tone="default"><section className="ph-section">
          <div className="ph-section-head">
            <h2>{t('À paraître')} <span className="neutral-badge">{upcomingItems.length}</span></h2>
            <button className="text-link" onClick={() => go('calendar')}>{copy.calendar} <ArrowUpRight size={14}/></button>
          </div>
          {upcomingItems.length ? (
            <div className="task-rows">
              {upcomingItems.slice(0, 4).map(item => (
                <button key={item.id} className="task-line" onClick={() => item.isPost ? setViewing(item.id) : navigate({ page: 'review', id: item.id })}>
                  <span className="task-line-icon"><CalendarDays size={16} /></span>
                  <span className="task-line-name"><strong>{item.name}</strong><small>{fmt(item.due)}</small></span>
                </button>
              ))}
            </div>
          ) : <p className="small-note">{t('Rien de prévu cette semaine.')}</p>}
        </section></Surface>

        <Surface asChild tone="default"><section className="ph-section">
          <div className="ph-section-head">
            <h2>{t('En production')} <span className="neutral-badge">{production.length}</span></h2>
            <button className="text-link" onClick={() => go('tasks')}>{copy.seeAll} <ArrowUpRight size={14}/></button>
          </div>
          {production.length ? (
            <div className="task-rows">
              {production.slice(0, 4).map(t => (
                <button key={t.id} className="task-line" onClick={() => navigate({ page: 'review', id: t.id })}>
                  <span className="task-line-icon"><Clock size={16} /></span>
                  <span className="task-line-name"><strong>{t.name}</strong><small>{pname(t.projectId)}</small></span>
                  {t.priority && <TaskPriority priority={t.priority} />}
                <Chip status={t.status} copy={copy} />
                </button>
              ))}
            </div>
          ) : <p className="small-note">{t('Aucun contenu en production actuellement.')}</p>}
        </section></Surface>
      </div>

      <Surface asChild tone="default"><section className="ph-section">
        <div className="ph-section-head">
          <h2>{t('Récemment publié')}</h2>
        </div>
        {recentPublished.length ? (
          <div className="task-rows">
            {recentPublished.slice(0, 3).map(item => (
              <button key={item.id} className="task-line" onClick={() => item.isPost ? setViewing(item.id) : navigate({ page: 'review', id: item.id })}>
                <span className="task-line-icon"><Check size={16} className="text-green" /></span>
                <span className="task-line-name"><strong>{item.name}</strong><small>{t('Publié le {date}', { date: fmt(item.publishedAt?.slice(0, 10)) })}</small></span>
              </button>
            ))}
          </div>
        ) : <p className="small-note">{t('Rien n’a été publié récemment.')}</p>}
      </section></Surface>
    </div>
  );
}
export function ListScreen({ ctx, items, title, empty, emptyText, withPosts = false }: { ctx: PortalContext; items: RecordItem[]; title: string; empty: string; emptyText: string; withPosts?: boolean }) {
  const { client, copy, fmt, link, navigate, pendingPosts, pname, setViewing, t } = ctx;
  const shownPosts = withPosts ? pendingPosts : [];
  return (
    <div className="pc-page">
      <div className="page-heading">
        <h1>{title}</h1>
        <p>{client.name}</p>
      </div>

      {!!shownPosts.length && (
        <Surface asChild tone="default"><section className="ph-section">
          <div className="ph-section-head">
            <h2>{copy.postsToReview} <span className="neutral-badge">{shownPosts.length}</span></h2>
          </div>
          <div className="pc-list">
            {shownPosts.map(post => (
              <Surface asChild tone="default" key={post.id}><button className="pc-list-card" onClick={() => setViewing(post.id)}>
                <div className="pc-list-card-main">
                  <div className="pc-list-icon"><Image size={20} aria-hidden="true" /></div>
                  <div className="pc-list-card-content">
                    <strong>{post.name}</strong>
                    <small>{t('Publication sociale')} · {post.due ? fmt(post.due) : ''}</small>
                  </div>
                </div>
                <div className="pc-list-meta">
                  <span className="status s2">{t('À valider')}</span>
                  <span className="pc-list-action">{copy.openReview} <ArrowUpRight size={14}/></span>
                </div>
              </button></Surface>
            ))}
          </div>
        </section></Surface>
      )}

      {!!items.length && (
        <Surface asChild tone="default"><section className="ph-section">
          <div className="pc-list">
            {items.map(t => {
              const url = (t.status === 'À valider' || t.status === 'Validé') ? link(t) : '';
              return (
                <Surface asChild tone="default" key={t.id}><button className="pc-list-card" onClick={() => navigate({ page: 'review', id: t.id })}>
                  <div className="pc-list-card-main">
                    <div className="pc-list-icon"><FileText size={20} /></div>
                    <div className="pc-list-card-content">
                      <strong>{t.name}</strong>
                      <small>{[pname(t.projectId), t.sentAt ? copy.sentOn(fmt(t.sentAt, true)) : ''].filter(Boolean).join(' · ')}</small>
                    </div>
                  </div>
                  <div className="pc-list-meta">
                    {t.priority && <TaskPriority priority={t.priority} />}
                <Chip status={t.status} copy={copy} />
                    <span className="pc-list-action">{copy.openReview} <ArrowUpRight size={14}/></span>
                  </div>
                </button></Surface>
              );
            })}
          </div>
        </section></Surface>
      )}

      {!items.length && !shownPosts.length && (
        <div className="ph-empty">
          <CheckCircle2 size={40} className="text-green" />
          <div style={{marginTop: 8}}>
            <strong style={{fontSize: 18, color: 'var(--t-text)', display: 'block', marginBottom: 4}}>{empty}</strong>
            <span style={{color: 'var(--t-text-muted)'}}>{emptyText}</span>
          </div>
        </div>
      )}
    </div>
  );
}
export function TasksScreen({ ctx }: { ctx: PortalContext }) {
  const { client, copy, fmt, navigate, pname, projectFilter, projects, setProjectFilter, tasks } = ctx;
  const items = tasks.filter((t) => !projectFilter || t.projectId === projectFilter);
  return (
    <div className="pc-page">
      <div className="page-heading">
        <div className="heading-line">
          <h1>{copy.tasks}</h1>
          {projects.length > 1 && (
            <Select value={projectFilter || '__all'} onValueChange={(v) => setProjectFilter(v === '__all' ? '' : v)}>
              <SelectTrigger className="pick" aria-label={copy.colProject}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">{copy.allProjects}</SelectItem>
                {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
        <p>{client.name} · {copy.tasksCount(items.length)}</p>
      </div>

      {items.length ? (
        <div className="pc-list">
          {items.map(t => (
            <Surface asChild tone="default" key={t.id}><button className="pc-list-card" onClick={() => navigate({ page: 'review', id: t.id })}>
              <div className="pc-list-card-main">
                <div className="pc-list-icon"><Clock size={20} /></div>
                <div className="pc-list-card-content">
                  <strong>{t.name}</strong>
                  <small>
                    {pname(t.projectId)}
                    {t.publishedAt ? ` · ${copy.published} ${fmt(t.publishedAt)}` : t.due ? ` · Prévu le ${fmt(t.due)}` : ''}
                  </small>
                </div>
              </div>
              <div className="pc-list-meta">
                {t.priority && <TaskPriority priority={t.priority} />}
                <Chip status={t.status} copy={copy} />
                <span className="pc-list-action">Détails <ArrowUpRight size={14}/></span>
              </div>
            </button></Surface>
          ))}
        </div>
      ) : (
        <div className="ph-empty">
          <List size={40} style={{opacity: 0.5}} />
          <div style={{marginTop: 8}}>
            <strong style={{fontSize: 18, color: 'var(--t-text)', display: 'block', marginBottom: 4}}>{copy.noTasks}</strong>
            <span style={{color: 'var(--t-text-muted)'}}>Aucune tâche ne correspond à vos filtres.</span>
          </div>
        </div>
      )}
    </div>
  );
}
export function Calendar({ ctx }: { ctx: PortalContext }) {
  const { copy, dayDetailsRef, fmt, month, navigate, pname, posts, rtl, selectedDay, setMonth, setSelectedDay, setViewing, t, tasks, today } = ctx;
  const start = new Date(month); start.setDate(1); start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; });

  const postsByDay = new Map<string, RecordItem[]>();
  const tasksByDay = new Map<string, RecordItem[]>();
  for (const [records, index] of [[posts, postsByDay], [tasks, tasksByDay]] as const) {
    for (const record of records) {
      if (!record.due) continue;
      const bucket = index.get(record.due);
      if (bucket) bucket.push(record);
      else index.set(record.due, [record]);
    }
  }
  const selectDay = (key: string) => {
    const d = new Date(`${key}T12:00:00`);
    setSelectedDay(key);
    setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  };
  const moveMonth = (delta: number) => {
    const d = new Date(month.getFullYear(), month.getMonth() + delta, 1);
    selectDay(dayKey(d));
  };
  const selectedPosts = (postsByDay.get(selectedDay) || []).slice().sort((a,b) => (a.time || '').localeCompare(b.time || ''));
  const selectedTasks = (tasksByDay.get(selectedDay) || []).slice().sort((a,b) => (a.time || '').localeCompare(b.time || ''));

  return (
    <div className="pc-calendar-page">
      <Surface asChild tone="default"><div className="calendar-wrap">
        <div className="calendar-toolbar">
          <button className="btn" onClick={() => selectDay(today)}>{copy.today}</button>
          <button className="icon-button" aria-label={copy.previous} onClick={() => moveMonth(-1)}>{rtl ? <ChevronRight /> : <ChevronLeft />}</button>
          <button className="icon-button" aria-label={copy.next} onClick={() => moveMonth(1)}>{rtl ? <ChevronLeft /> : <ChevronRight />}</button>
          <h2>{month.toLocaleDateString(copy.locale, { month: 'long', year: 'numeric' })}</h2>
        </div>
        <div className="calendar-grid">
          <div className="weekdays">{copy.weekdays.map((d) => <span key={d}>{d}</span>)}</div>
          <div className="calendar-days">{days.map((d) => {
            const key = dayKey(d);
            const items = tasksByDay.get(key) || [];
            const dayPosts = postsByDay.get(key) || [];
            const isSelected = key === selectedDay;
            return <button type="button" className={`calendar-day ${d.getMonth() !== month.getMonth() ? 'outside' : ''} ${isSelected ? 'selected-day' : ''}`} key={key} onClick={() => {
              selectDay(key);
              if (window.matchMedia('(max-width: 767px)').matches) dayDetailsRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
            }} aria-pressed={isSelected} aria-current={key === today ? 'date' : undefined} aria-label={`${fmt(key)} · ${t('{count} contenus', { count: dayPosts.length + items.length })}`}>
              <span className="calendar-dots" aria-hidden="true">{dayPosts.length > 0 && <i className="cal-dot post-dot" />}{items.length > 0 && <i className="cal-dot task-dot" />}</span>
              <header><span className={key === today ? 'today' : ''}>{d.getDate()}</span></header>
              <div className="cal-day-items">
                {dayPosts.slice(0, 3).map(p => {
                  const thumb = p.media?.[0]?.thumb || p.media?.[0]?.url;
                  return <div key={p.id} className="cal-mini-post">
                    {thumb ? <div className="cal-mini-thumb" style={{backgroundImage: `url(${thumb})`}}></div> : <div className="cal-mini-thumb no-thumb"><Image size={12} aria-hidden="true" /></div>}
                    <span className="cal-mini-time">{p.time || '09:00'}</span>
                  </div>;
                })}
                {dayPosts.length > 3 && <div className="cal-more">+{dayPosts.length - 3}</div>}
                {items.length > 0 && <div className="cal-mini-task"><FileText size={10} /> {items.length} {copy.tasks}</div>}
              </div>
            </button>;
          })}</div>
        </div>
      </div></Surface>

      <Surface asChild tone="default"><div className="pc-day-details" ref={dayDetailsRef}>
        <div className="pc-day-heading">
          <div>
            <div className="eyebrow">{copy.calendar}</div>
            <h3 className="pc-day-title" aria-live="polite">{new Date(selectedDay + 'T12:00:00').toLocaleDateString(copy.locale, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
          </div>
          <div className="pc-day-nav">
            <button className="icon-button" aria-label={t('Jour précédent')} onClick={() => selectDay(shiftDay(selectedDay, -1))}>{rtl ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}</button>
            <button className="icon-button" aria-label={t('Jour suivant')} onClick={() => selectDay(shiftDay(selectedDay, 1))}>{rtl ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}</button>
          </div>
        </div>
        {selectedPosts.length === 0 && selectedTasks.length === 0 && (
          <div className="ph-empty"><CalendarClock size={32} style={{opacity: 0.5}} /><p>{t('Rien de prévu ce jour.')}</p></div>
        )}
        {selectedPosts.length > 0 && (
          <div className="pc-day-posts">
            {selectedPosts.map(p => {
              const targets = targetsOf(p);
              const thumb = p.media?.[0]?.thumb || p.media?.[0]?.url;
              return (
                <Surface asChild tone="default" key={p.id}><button className="pc-rich-card" onClick={() => setViewing(p.id)}>
                  <div className="pc-rich-media" style={thumb ? {backgroundImage: `url(${thumb})`, backgroundSize: 'cover', backgroundPosition: 'center'} : {}}>
                    {!thumb && <div className="pc-no-media"><Image size={24} aria-hidden="true" /></div>}
                    <div className="pc-rich-networks">{targets.map(x => <NetworkIcon key={x.network} network={x.network} size={14} />)}</div>
                  </div>
                  <div className="pc-rich-body">
                    <div className="pc-rich-time"><Clock size={12} /> {p.time || '09:00'}</div>
                    <strong>{p.name}</strong>
                    <span className={`post-status ${postStatus(p)}`}>{t(statusLabels[postStatus(p)])}</span>
                  </div>
                </button></Surface>
              )
            })}
          </div>
        )}
        {selectedTasks.length > 0 && (
          <div className="pc-list">
            {selectedTasks.map(t => (
              <Surface asChild tone="default" key={t.id}><button className="pc-list-card" onClick={() => navigate({ page: 'review', id: t.id })}>
                <div className="pc-list-card-main">
                  <div className="pc-list-icon"><FileText size={20} /></div>
                  <div className="pc-list-card-content">
                    <strong>{t.name}</strong>
                    <small>{pname(t.projectId)}</small>
                  </div>
                </div>
                <div className="pc-list-meta">
                  {t.priority && <TaskPriority priority={t.priority} />}
                  <Chip status={t.status} copy={copy} />
                </div>
              </button></Surface>
            ))}
          </div>
        )}
      </div></Surface>
    </div>
  );
}
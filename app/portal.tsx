'use client';
// The client portal: four read-only screens, a request form, the review page, and the client's own
// social accounts, which they connect themselves (app/social-accounts.tsx).
// Rendered for a signed-in client contact (mode "client") and for the studio's own preview (mode "preview").
import Copyright from '@/app/copyright';
import { brandLightLogoClass, brandPdfLogo, studioLabel, useBrand } from '@/app/brand-store';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Image, ArrowUpRight, BarChart3, CalendarClock, CalendarDays, CalendarRange, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock, Download, Eye, FileSignature, FileText, Home, Inbox, Link2, List, Loader2, MoreHorizontal, Plus, Send, Settings2, ShieldCheck, type LucideIcon } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import DatePicker from '@/app/date-picker';
import { Sidebar, SidebarProvider, SidebarHeader, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import Avatar from '@/app/profile-avatar';
import ClientMark from '@/app/client-mark';
import ClientImages from '@/app/client-images';
import ClientBriefBoard from '@/app/client-brief';
import { DonutStat } from '@/components/dashboard-charts';
import { type RecordItem, type DocStatus, type Priority, statusClass, safeLink, requestPlatforms, dayKey } from '@/lib/model';
import { flow, hoursLeft, revisionState, shiftDay } from '@/lib/flow';
import { portalCopy, portalLocaleFor, type PortalCopy } from '@/lib/portal-i18n';
import { computeTotals, docLabels, docStatusLabels } from '@/lib/documents';
import { buildDocumentPdf, downloadPdf } from '@/lib/document-pdf';
import { readStoredLocale } from '@/lib/i18n';
import { useI18n } from '@/app/locale-provider';
import SettingsDialog from '@/app/settings-dialog';
import VoiceRecorder, { uploadVoice } from '@/app/voice-recorder';
import TaskChat from '@/app/task-chat';
import { MeetingsList } from '@/app/meetings';
import PortalPlans from '@/app/content-plan-portal';
import NetworkIcon from '@/app/network-icon';
import PostPreview from '@/app/post-preview';
import { AccountsPanel, PagePicker, useConnectedAccounts } from '@/app/social-accounts';
import SocialReportView from '@/app/social-report';
import { captionFor, mediaOf, postStatus, statusLabels, targetsOf, type Network } from '@/lib/social';

export type PortalRoute = { page: string; id?: string; tab?: string };
type Props = {
  mode: 'client' | 'preview';
  records: RecordItem[];
  client: RecordItem;
  user: { id: string; name: string; email: string; avatar?: string | null };
  workspaceId?: string | null;
  /** Profile changes (name, picture) — resolves with the fresh user. */
  onProfile?: (changes: { name?: string; avatar?: string | null }) => Promise<{ id: string; name: string; email: string; avatar?: string | null } | undefined>;
  route: PortalRoute;
  today: string;
  busy: boolean;
  error: string;
  notice: string;
  navigate: (route: PortalRoute) => void;
  mutate: (body: unknown) => Promise<unknown>;
  onNotice: (text: string) => void;
  onError: (text: string) => void;
  onLeave: () => void;
};

function Chip({ status = 'À faire', copy }: { status?: RecordItem['status']; copy: PortalCopy }) {
  return <span className={`status ${statusClass[status]}`}>{copy.status[status]}</span>;
}
// Reuses the same four status chip colors (gray/amber/orange/green) for the five document statuses.
const docStatusClass: Record<DocStatus, string> = { draft: 's0', sent: 's1', accepted: 's3', paid: 's3', refused: 's2' };

function NavItem({ icon: Icon, label, active, badge, onClick }: { icon: LucideIcon; label: string; active?: boolean; badge?: number; onClick: () => void }) {
  const { setOpenMobile } = useSidebar();
  return <SidebarMenuItem><SidebarMenuButton isActive={active} className="nav-item" onClick={() => { onClick(); setOpenMobile(false); }}><Icon strokeWidth={1.5} /><span>{label}</span>{!!badge && <span className="counter">{badge}</span>}</SidebarMenuButton></SidebarMenuItem>;
}

// On a phone the sidebar gives way to a tab bar: the four things a client does from their phone
// (see what's new, approve, check the planning, ask for something), and "More" for the rest.
type Tab = { icon: LucideIcon; label: string; active: boolean; badge?: number; onClick: () => void };
function TabBar({ tabs, moreTabs, more }: { tabs: Tab[]; moreTabs: Tab[]; more: { label: string; active: boolean } }) {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  const button = (tab: Tab) => <button key={tab.label} type="button" className={tab.active ? 'active' : ''} aria-current={tab.active ? 'page' : undefined} onClick={tab.onClick}>
    <span className="portal-tab-icon"><tab.icon size={21} strokeWidth={1.7} />{!!tab.badge && <span className="portal-tab-badge">{tab.badge}</span>}</span>
    <span className="portal-tab-label">{tab.label}</span>
  </button>;
  return <nav className="portal-tabbar" aria-label={t('Navigation principale')}>
    {tabs.map(button)}
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={more.active ? 'active' : ''}>
          <span className="portal-tab-icon"><MoreHorizontal size={21} strokeWidth={1.7} /></span>
          <span className="portal-tab-label">{more.label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="p-2 w-48 mb-2" style={{ borderRadius: '14px', zIndex: 10000 }}>
        <div className="flex flex-col gap-1">
          {moreTabs.map(t => (
            <button key={t.label} type="button" className="flex items-center gap-3 p-3 text-sm font-medium w-full text-start rounded-md hover:bg-slate-100" onClick={() => { t.onClick(); setOpen(false); }}>
              <t.icon size={16} /> <span>{t.label}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  </nav>;
}

export default function Portal({ mode, records, client, user, workspaceId, route, today, busy, error, notice, navigate, mutate, onNotice, onError, onLeave, onProfile }: Props) {
  // The portal follows the app language (toggle in the sidebar). A client who never chose one starts in the
  // language recorded on their client file.
  const { locale, setLocale, t } = useI18n();
  // The studio this portal belongs to: its own name and logo when it is a company that signed up.
  const brand = useBrand();
  const studio = studioLabel(brand);
  const brandLogo = brandPdfLogo(brand);
  useEffect(() => { if (mode === 'client' && !readStoredLocale()) setLocale(portalLocaleFor(client.language)); }, [mode, client.language, setLocale]);
  const copy = portalCopy[locale];
  const rtl = copy.dir === 'rtl';
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t); }, []);
  const [dialog, setDialog] = useState<'approve' | 'changes' | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showBrief, setShowBrief] = useState(false);
  const [homeFocus, setHomeFocus] = useState<'production' | 'review' | 'done'>('production');
  const [confirm, setConfirm] = useState(false);
  const [text, setText] = useState('');
  const [clip, setClip] = useState<Blob | null>(null);
  const [request, setRequest] = useState<{ name: string; projectId: string; due: string; platforms: string[]; description: string; priority?: Priority }>({ name: '', projectId: '', due: '', platforms: [], description: '', priority: 'Moyenne' });
  const [formError, setFormError] = useState('');
  const [month, setMonth] = useState(() => { const d = new Date(`${today}T12:00:00`); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selectedDay, setSelectedDay] = useState(today);
  const dayDetailsRef = useRef<HTMLDivElement>(null);
  const [projectFilter, setProjectFilter] = useState('');
  const [pdfBusy, setPdfBusy] = useState('');
  const [viewing, setViewing] = useState<string | null>(null);
  const [postNetwork, setPostNetwork] = useState<Network | null>(null);
  const [postNote, setPostNote] = useState('');
  const [askingChanges, setAskingChanges] = useState<string | null>(null);
  // Back from a platform's login, the client lands on their accounts, where the answer is shown.
  const social = useConnectedAccounts(workspaceId, { onNotice, onError, onReturn: () => navigate({ page: 'portal', id: client.id, tab: 'accounts' }) });

  const projects = records.filter((r) => r.kind === 'project' && r.clientId === client.id && !r.archived);
  const tasks = records.filter((r) => r.kind === 'task' && r.clientId === client.id && !r.archived && (!r.projectId || projects.some((p) => p.id === r.projectId)));
  const waiting = tasks.filter((t) => t.status === 'À valider');
  // Social posts the studio scheduled (portalView sends no drafts); some wait for this client's approval.
  const posts = records.filter((r) => r.kind === 'editorial_post' && r.clientId === client.id).sort((a, b) => `${a.due} ${a.time}`.localeCompare(`${b.due} ${b.time}`));
  const pendingPosts = posts.filter((p) => p.approval?.state === 'pending' && !p.publishedAt);
  const toReview = waiting.length + pendingPosts.length;
  const production = tasks.filter((task) => task.status !== 'Validé' && task.status !== 'À valider');
  const files = tasks.filter((t) => !!link(t) && (t.status === 'À valider' || t.status === 'Validé'));
  // The inbox's requests, plus older ones that went straight to a task; a task made from a request isn't listed twice.
  const requestRecords = records.filter((r) => r.kind === 'request' && r.clientId === client.id);
  const myRequests = [...requestRecords, ...tasks.filter((t) => t.request && !requestRecords.some((r) => r.taskId === t.id))].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // Already scoped to this client by portalView() server-side; re-filtered here defensively, same as tasks/projects above.
  const documents = records.filter((r) => r.kind === 'document' && r.clientId === client.id && !r.archived).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const task = route.page === 'review' ? tasks.find((t) => t.id === route.id) ?? null : null;
  const tab = route.page === 'review' ? 'review' : route.tab || 'home';
  const meetingsToday = records.filter((r) => r.kind === 'meeting' && !r.cancelledAt && r.due === today).length;
  const pname = (id?: string) => projects.find((p) => p.id === id)?.name || '';
  const fmt = (iso?: string, withTime = false) => iso ? new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString(copy.locale, withTime ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : { day: 'numeric', month: 'short' }) : copy.noDate;
  function link(t: RecordItem) { return safeLink(t.deliverable || ''); }
  const go = (tab: string) => navigate({ page: 'portal', id: client.id, tab });

  async function decide(kind: 'approve' | 'changes') {
    if (!task) return;
    try {
      if (kind === 'approve') { await mutate({ action: 'approve', taskId: task.id }); onNotice(copy.approved); }
      else {
        if (!text.trim() && !clip) { setFormError(copy.changesPlaceholder); return; }
        const audio = clip && workspaceId ? await uploadVoice(clip, workspaceId) : undefined;
        await mutate({ action: 'request-changes', taskId: task.id, text, ...(audio ? { audio } : {}) });
        onNotice(copy.changesButton);
      }
      setDialog(null); setText(''); setClip(null); setConfirm(false); setFormError('');
    } catch (e) { setFormError(t((e as Error).message)); }
  }
  async function sendRequest(e: React.FormEvent) {
    e.preventDefault(); setFormError('');
    try {
      await mutate({ action: 'request', clientId: client.id, data: { ...request } });
      setRequest({ name: '', projectId: '', due: '', platforms: [], description: '', priority: 'Moyenne' });
      onNotice(copy.requestSent);
    } catch (e) { setFormError(t((e as Error).message)); }
  }

  async function answerPost(post: RecordItem, approve: boolean) {
    try {
      if (approve) await mutate({ action: 'post-approve', postId: post.id });
      else {
        if (!postNote.trim()) { onError(copy.postChangesPlaceholder); return; }
        await mutate({ action: 'post-changes', postId: post.id, text: postNote });
      }
      onNotice(approve ? copy.postApproved : copy.postChangesSent);
      setPostNote(''); setAskingChanges(null); setViewing(null);
    } catch (e) { onError(t((e as Error).message)); }
  }
  const planned = (p: RecordItem) => copy.postPlanned(fmt(p.due), p.time || '09:00');
  function PostCard({ post }: { post: RecordItem }) {
    const targets = targetsOf(post);
    const shown = targets.find((x) => x.network === postNetwork) ?? targets[0];
    const pending = post.approval?.state === 'pending' && !post.publishedAt;
    return <article className="post-card" key={post.id}>
      <header className="post-card-head">
        <div><strong>{post.name}</strong><small><CalendarDays size={12} /> {planned(post)}</small></div>
        <span className={`post-card-state ${post.publishedAt ? 'published' : post.approval?.state || 'scheduled'}`}>
          {post.publishedAt ? copy.postPublished : post.approval ? copy.postState[post.approval.state] : copy.postScheduled}
        </span>
      </header>
      {targets.length > 1 && <div className="post-card-networks" role="tablist">{targets.map((x) => <button key={x.network} type="button" role="tab" aria-selected={shown?.network === x.network} className={shown?.network === x.network ? 'selected' : ''} onClick={() => setPostNetwork(x.network)}><NetworkIcon network={x.network} size={14} /></button>)}</div>}
      {shown && <PostPreview target={shown} media={mediaOf(post)} caption={captionFor(post, shown)} account={client.name} />}
      {pending && (askingChanges === post.id
        ? <div className="post-card-changes">
            <textarea rows={3} maxLength={2000} value={postNote} placeholder={copy.postChangesPlaceholder} onChange={(e) => setPostNote(e.target.value)} autoFocus />
            <div className="post-card-actions"><button type="button" className="btn" disabled={busy} onClick={() => { setAskingChanges(null); setPostNote(''); }}>{copy.cancel}</button><button type="button" className="btn primary" disabled={busy || !postNote.trim()} onClick={() => void answerPost(post, false)}><Send size={15} />{copy.sendChanges}</button></div>
          </div>
        : <div className="post-card-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => { setPostNote(''); setAskingChanges(post.id); }}>{copy.postChanges}</button>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void answerPost(post, true)}><Check size={16} />{copy.postApprove}</button>
          </div>)}
    </article>;
  }

  function Countdown({ t }: { t: RecordItem }) {
    const left = hoursLeft(t, now);
    if (left === null) return null;
    return <div className="portal-clock"><Clock size={15} /><span>{copy.clock(Math.max(0, left))}</span></div>;
  }
  function Rounds({ t }: { t: RecordItem }) {
    const r = revisionState(t);
    return <p className="portal-rounds">{copy.rounds(r.used, r.included)}{r.overBudget ? ` · ${copy.roundsOver}` : r.lastIncluded ? ` · ${copy.roundsLast}` : ''}</p>;
  }
  function Card({ t }: { t: RecordItem }) {
    return <article className="review-card" key={t.id}>
      <div className="review-thumb"><FileText size={42} /><small>{copy.version.toUpperCase()}</small></div>
      <div>
        {t.priority && <span className={`flag-pill priority-${t.priority.toLowerCase()}`}>{t.priority}</span>}
                  <Chip status={t.status} copy={copy} />
        <h2>{t.name}</h2>
        <small>{pname(t.projectId)}{t.sentAt ? ` · ${copy.sentOn(fmt(t.sentAt, true))}` : ''}</small>
        <p>{t.description?.split('\n')[0]}</p>
        {t.status === 'À valider' && Countdown({ t })}
        <button className="btn" onClick={() => navigate({ page: 'review', id: t.id })}>{copy.openReview}<ArrowUpRight size={15} /></button>
      </div>
    </article>;
  }

  function Calendar() {
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
        <div className="calendar-wrap">
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
        </div>

        <div className="pc-day-details" ref={dayDetailsRef}>
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
                  <button key={p.id} className="pc-rich-card" onClick={() => setViewing(p.id)}>
                    <div className="pc-rich-media" style={thumb ? {backgroundImage: `url(${thumb})`, backgroundSize: 'cover', backgroundPosition: 'center'} : {}}>
                      {!thumb && <div className="pc-no-media"><Image size={24} aria-hidden="true" /></div>}
                      <div className="pc-rich-networks">{targets.map(x => <NetworkIcon key={x.network} network={x.network} size={14} />)}</div>
                    </div>
                    <div className="pc-rich-body">
                      <div className="pc-rich-time"><Clock size={12} /> {p.time || '09:00'}</div>
                      <strong>{p.name}</strong>
                      <span className={`post-status ${postStatus(p)}`}>{t(statusLabels[postStatus(p)])}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
          {selectedTasks.length > 0 && (
            <div className="pc-list">
              {selectedTasks.map(t => (
                <button key={t.id} className="pc-list-card" onClick={() => navigate({ page: 'review', id: t.id })}>
                  <div className="pc-list-card-main">
                    <div className="pc-list-icon"><FileText size={20} /></div>
                    <div className="pc-list-card-content">
                      <strong>{t.name}</strong>
                      <small>{pname(t.projectId)}</small>
                    </div>
                  </div>
                  <div className="pc-list-meta">
                    {t.priority && <span className={`flag-pill priority-${t.priority.toLowerCase()}`}>{t.priority}</span>}
                    <Chip status={t.status} copy={copy} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  function HomeScreen() {
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
        <header className="ph-header">
          <div className="desktop-only"><ClientImages client={client} workspaceId="" canEdit={false} onChange={async () => false} onError={() => undefined} /></div>
          <div>
            <div className="eyebrow">{copy.dashboard.toUpperCase()}</div>
            <h1>{copy.hello(who || client.name)}</h1>
            <p className="ph-tagline">{copy.tagline}</p>
            <div className="ph-hero-actions"><button className="btn primary" onClick={() => go('calendar')}><CalendarDays size={16} />{copy.calendar}<ArrowUpRight size={15} /></button><button className="btn" onClick={() => go('request')}><Plus size={16} />{copy.request}</button></div>
          </div>
        </header>

        <div className="ph-summary">
          {[
            { label: copy.review, count: toReview, icon: CheckCircle2, target: 'review', tone: 'review' },
            { label: t('À paraître'), count: upcomingItems.length, icon: CalendarDays, target: 'calendar', tone: 'upcoming' },
            { label: t('En production'), count: production.length, icon: Clock, target: 'tasks', tone: 'production' },
          ].map(({ label, count, icon: Icon, target, tone }) => (
            <button key={target} className={`ph-summary-card ${tone}`} onClick={() => go(target)}>
              <span className="ph-summary-icon"><Icon size={19} /></span>
              <span><small>{label}</small><strong>{count}</strong></span>
              <ArrowUpRight size={16} className="ph-summary-arrow" />
            </button>
          ))}
        </div>

        <section className="portal-brand-direction"><button className="portal-brief-toggle" aria-expanded={showBrief} aria-controls="portal-brand-brief" onClick={() => setShowBrief(!showBrief)}><span><ClientMark name={client.name} logo={client.logo} size="sm" /><span><strong>{t('Votre direction créative')}</strong><small>{t('Identité, objectifs et exigences de la marque')}</small></span></span><span>{t(showBrief ? 'Réduire' : 'Explorer le brief')}<ChevronRight size={16} /></span></button>{showBrief && <div id="portal-brand-brief"><ClientBriefBoard key={client.id} client={client} /></div>}</section>

        <section className="live-panel portal-live-progress">
          <header><div><span className="gold-eyebrow">{t('VOTRE PROJET PREND VIE')}</span><h2>{t('Du brief à la publication')}</h2></div><button className="text-link" onClick={() => go('tasks')}>{copy.seeAll}<ArrowUpRight size={14} /></button></header>
          <div className="portal-live-body">
            <DonutStat data={[
              { key: 'production', label: t('En production'), value: production.length + productionPosts.length, color: '#dcb65e' },
              { key: 'review', label: copy.review, value: toReview, color: '#af8133' },
              { key: 'done', label: t('Validés ou publiés'), value: doneTasks.length + donePosts.length, color: '#789a80' },
            ]} centerLabel={t('Contenus')} size={130} selectedKey={homeFocus} onSelect={(key) => setHomeFocus(key as typeof homeFocus)} />
            <div className="portal-focus-preview" aria-live="polite">
              <h3>{t(homeFocus === 'production' ? 'En production' : homeFocus === 'review' ? 'À valider' : 'Validés ou publiés')}</h3>
              {focusTasks.slice(0, 2).map((task) => <button key={task.id} onClick={() => navigate({ page: 'review', id: task.id })}><span>{task.name}</span><ArrowUpRight size={14} /></button>)}
              {focusPosts.slice(0, 2).map((post) => <button key={post.id} onClick={() => setViewing(post.id)}><span>{post.name}</span><ArrowUpRight size={14} /></button>)}
              {!focusTasks.length && !focusPosts.length && <p className="small-note">{t('Aucun contenu dans cette étape.')}</p>}
              <button className="text-link" onClick={() => go(homeFocus === 'review' ? 'review' : homeFocus === 'done' ? 'calendar' : 'tasks')}>{t('Explorer cette étape')}<ArrowUpRight size={14} /></button>
            </div>
          </div>
        </section>
        <section className="ph-section ph-urgent">
          <div className="ph-section-head">
            <h2>{t('À valider')} <span className="neutral-badge">{toApproveItems.length}</span></h2>
            {toApproveItems.length > 4 && <button className="text-link" onClick={() => go('review')}>{copy.seeAll}<ArrowUpRight size={14} /></button>}
          </div>
          {toApproveItems.length ? (
            <div className="ph-grid">
              {toApproveItems.slice(0, 4).map(item => (
                <button key={item.id} className="ph-card ph-card-urgent" onClick={() => item.isPost ? setViewing(item.id) : navigate({ page: 'review', id: item.id })}>
                  <div className="ph-card-icon"><CheckCircle2 size={24} /></div>
                  <div className="ph-card-body">
                    <strong>{item.name}</strong>
                    <small>{item.isPost ? t('Publication sociale') : t('Livrable')}</small>
                  </div>
                  <div className="ph-card-action">{copy.review} <ArrowUpRight size={14} /></div>
                </button>
              ))}
            </div>
          ) : (
            <div className="ph-empty">
              <CheckCircle2 size={32} />
              <p>{t('Tout est à jour ! Rien n’attend votre validation.')}</p>
            </div>
          )}
        </section>

        <div className="ph-row">
          <section className="ph-section">
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
          </section>

          <section className="ph-section">
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
                    {t.priority && <span className={`flag-pill priority-${t.priority.toLowerCase()}`}>{t.priority}</span>}
                  <Chip status={t.status} copy={copy} />
                  </button>
                ))}
              </div>
            ) : <p className="small-note">{t('Aucun contenu en production actuellement.')}</p>}
          </section>
        </div>

        <section className="ph-section">
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
        </section>
      </div>
    );
  }

  function ListScreen({ items, title, empty, emptyText, withPosts = false }: { items: RecordItem[]; title: string; empty: string; emptyText: string; withPosts?: boolean }) {
    const shownPosts = withPosts ? pendingPosts : [];
    return (
      <div className="pc-page">
        <div className="page-heading">
          <h1>{title}</h1>
          <p>{client.name}</p>
        </div>
        
        {!!shownPosts.length && (
          <section className="ph-section">
            <div className="ph-section-head">
              <h2>{copy.postsToReview} <span className="neutral-badge">{shownPosts.length}</span></h2>
            </div>
            <div className="pc-list">
              {shownPosts.map(post => (
                <button key={post.id} className="pc-list-card" onClick={() => setViewing(post.id)}>
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
                </button>
              ))}
            </div>
          </section>
        )}

        {!!items.length && (
          <section className="ph-section">
            <div className="pc-list">
              {items.map(t => {
                const url = (t.status === 'À valider' || t.status === 'Validé') ? link(t) : '';
                return (
                  <button key={t.id} className="pc-list-card" onClick={() => navigate({ page: 'review', id: t.id })}>
                    <div className="pc-list-card-main">
                      <div className="pc-list-icon"><FileText size={20} /></div>
                      <div className="pc-list-card-content">
                        <strong>{t.name}</strong>
                        <small>{pname(t.projectId)} {t.sentAt ? `· ${copy.sentOn(fmt(t.sentAt, true))}` : ''}</small>
                      </div>
                    </div>
                    <div className="pc-list-meta">
                      {t.priority && <span className={`flag-pill priority-${t.priority.toLowerCase()}`}>{t.priority}</span>}
                  <Chip status={t.status} copy={copy} />
                      <span className="pc-list-action">{copy.openReview} <ArrowUpRight size={14}/></span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
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

  function TasksScreen() {
    const items = tasks.filter((t) => !projectFilter || t.projectId === projectFilter).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
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
              <button key={t.id} className="pc-list-card" onClick={() => navigate({ page: 'review', id: t.id })}>
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
                  {t.priority && <span className={`flag-pill priority-${t.priority.toLowerCase()}`}>{t.priority}</span>}
                  <Chip status={t.status} copy={copy} />
                  <span className="pc-list-action">Détails <ArrowUpRight size={14}/></span>
                </div>
              </button>
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

  async function downloadDocument(doc: RecordItem) {
    setPdfBusy(doc.id);
    try {
      const bytes = await buildDocumentPdf({
        docType: doc.docType!, number: doc.number!, docStatus: doc.docStatus || 'draft', studioName: studio, logoUrl: brandPdfLogo(brand),
        clientName: client.name, issuedAt: doc.issuedAt, dueAt: doc.dueAt, validUntil: doc.validUntil,
        lineItems: doc.lineItems || [], taxRate: doc.taxRate, notes: doc.notes,
      });
      downloadPdf(bytes, `${doc.number}.pdf`);
    } catch { onError(copy.noDocuments); } finally { setPdfBusy(''); }
  }

  function DocumentsScreen() {
    return (
      <div className="pc-page">
        <div className="page-heading">
          <h1>{copy.documents}</h1>
          <p>{client.name}</p>
        </div>
        
        {documents.length ? (
          <div className="pc-list">
            {documents.map(doc => {
              const { total } = computeTotals(doc.lineItems || [], doc.taxRate);
              const statusColors = { draft: 's1', sent: 's2', paid: 's3', overdue: 's4', cancelled: 's5', accepted: 's3', refused: 's5' };
              const statusClass = statusColors[doc.docStatus || 'draft'];
              return (
                <div key={doc.id} className="pc-list-card" style={{cursor: 'default'}}>
                  <div className="pc-list-card-main">
                    <div className="pc-list-icon"><FileSignature size={20} /></div>
                    <div className="pc-list-card-content">
                      <strong>{t(docLabels[doc.docType || 'devis'])} {doc.number}</strong>
                      <small>{fmt(doc.issuedAt)} · {t(docStatusLabels[doc.docStatus || 'draft'])}</small>
                    </div>
                  </div>
                  <div className="pc-list-meta">
                    <strong style={{fontSize: 16}}>{total.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD</strong>
                    <span className={`status ${statusClass}`}>{t(docStatusLabels[doc.docStatus || 'draft'])}</span>
                    <button type="button" className="btn" aria-label={copy.download} disabled={!!pdfBusy} onClick={() => void downloadDocument(doc)}>
                      {pdfBusy === doc.id ? <Loader2 size={16} className="spin" /> : <Download size={16} />} Télécharger
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="ph-empty">
            <FileSignature size={40} style={{opacity: 0.5}} />
            <div style={{marginTop: 8}}>
              <strong style={{fontSize: 18, color: 'var(--t-text)', display: 'block', marginBottom: 4}}>Aucun document</strong>
              <span style={{color: 'var(--t-text-muted)'}}>Vous n&apos;avez pas encore de factures ou devis.</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  function RequestScreen() {
    return <>
      <div className="page-heading"><h1>{copy.requestTitle}</h1><p>{copy.requestText}</p></div>
      <div className="pc-page portal-request">
        <form onSubmit={sendRequest} className="form-fields">
          <label className="form-field"><span>{copy.requestName} *</span><input required maxLength={160} value={request.name} onChange={(e) => setRequest({ ...request, name: e.target.value })} /></label>
          <div className="form-pair">
            <label className="form-field"><span>{copy.requestProject}</span><Select value={request.projectId || '__none'} onValueChange={(v) => setRequest({ ...request, projectId: v === '__none' ? '' : v })}><SelectTrigger className="pick" aria-label={copy.requestProject}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none">{copy.choose}</SelectItem>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></label>
            <label className="form-field"><span>{copy.requestDate}</span><DatePicker label={copy.requestDate} value={request.due} onChange={(value) => setRequest({ ...request, due: value })} placeholder={copy.choose} /></label>
            <label className="form-field"><span>Priorité</span><Select value={request.priority || 'Moyenne'} onValueChange={(v) => setRequest({ ...request, priority: v as Priority })}><SelectTrigger className="pick"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Basse">Basse</SelectItem><SelectItem value="Moyenne">Moyenne</SelectItem><SelectItem value="Haute">Haute</SelectItem><SelectItem value="Urgente">Urgente</SelectItem></SelectContent></Select></label>
          </div>
          <fieldset className="form-field request-platforms">
            <span>{copy.requestPlatforms}</span>
            <div role="group" aria-label={copy.requestPlatforms}>
              {requestPlatforms.map((p) => {
                const on = request.platforms.includes(p);
                return <button type="button" key={p} aria-pressed={on} className={on ? 'selected' : ''} onClick={() => setRequest({ ...request, platforms: on ? request.platforms.filter((x) => x !== p) : [...request.platforms, p] })}>{on && <Check size={14} />}{copy.platformNames[p] ?? p}</button>;
              })}
            </div>
            <small>{copy.requestPlatformsHint}</small>
          </fieldset>
          <label className="form-field"><span>{copy.requestDescription}</span><textarea rows={5} maxLength={15000} value={request.description} onChange={(e) => setRequest({ ...request, description: e.target.value })} /></label>
          <small className="small-note">{copy.requestLockNote(flow.lockDays)}</small>
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <div className="inline"><button className="btn primary" disabled={busy}>{busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />}{copy.requestButton}</button></div>
        </form>
        <aside>
          <h3>{copy.myRequests.toUpperCase()}</h3>
          {myRequests.length ? <div className="task-rows">{myRequests.map((r) => {
            // A request in the inbox, or the task it became (older requests went straight to a task).
            const task = r.kind === 'task' ? r : tasks.find((t) => t.id === r.taskId);
            const state = r.kind === 'task' ? 'accepted' : r.requestStatus ?? 'new';
            const label = state === 'accepted' ? copy.requestAccepted : state === 'declined' ? copy.requestDeclined : copy.requestWaiting;
            const line = <><span className="task-line-icon"><Inbox size={16} /></span><span className="task-line-name"><strong>{r.name}</strong><small>{copy.requestedOn(fmt(r.request?.at))}{r.due ? ` · ${copy.dueOn(fmt(r.due))}` : ''}{r.platforms?.length ? ` · ${r.platforms.map((p) => copy.platformNames[p] ?? p).join(', ')}` : ''}</small>{state === 'declined' && r.decision?.reason && <small className="request-reason">{copy.requestReason} : {r.decision.reason}</small>}</span>{task ? <Chip status={task.status} copy={copy} /> : <span className={`request-state ${state}`}>{label}</span>}</>;
            return task ? <button className="task-line" key={r.id} onClick={() => navigate({ page: 'review', id: task.id })}>{line}</button> : <div className="task-line" key={r.id}>{line}</div>;
          })}</div> : <p className="small-note">{copy.noRequests}</p>}
        </aside>
      </div>
    </>;
  }

  function MeetingsScreen() {
    const myEmail = user.email || '';
    const myId = user.id || '';
    const filteredRecords = records.filter(r => {
      if (r.kind !== 'meeting') return true;
      if (!r.attendees || r.attendees.length === 0) return true;
      return r.attendees.includes(myId) || r.attendees.includes(myEmail);
    });
    return <>
      <div className="page-heading"><h1>{copy.meetings}</h1><p>{copy.meetingsText}</p></div>
      <MeetingsList records={filteredRecords} workspaceId={workspaceId ?? undefined} onError={onError} />
    </>;
  }

  // One item's thread, the same one the review page shows.
  function thread(taskId: string) {
    const messages = records.filter((r) => r.kind === 'comment' && r.taskId === taskId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return <TaskChat
      key={taskId}
      messages={messages}
      workspaceId={workspaceId ?? undefined}
      isMine={(c) => (c.authorId ? c.authorId === user.id : mode === 'client' && c.audience === 'client' && c.author === user.name)}
      senderLabel={(c) => (c.audience === 'client' ? client.name : studio)}
      canWrite
      busy={busy}
      onSend={async (message) => { await mutate({ action: 'comment', taskId, ...message }); }}
      onError={onError}
    />;
  }

  function PlanScreen() {
    if (!workspaceId) return null;
    return <PortalPlans workspaceId={workspaceId} clientId={client.id} copy={copy} records={records} onError={onError} renderThread={thread} />;
  }

  function StatsScreen() {
    return <>
      <div className="page-heading"><h1>{copy.stats}</h1><p>{copy.statsText}</p></div>
      {workspaceId && <SocialReportView records={records} clients={[client]} workspaceId={workspaceId} today={today} fixedClientId={client.id} canRefresh={false} onNotice={onNotice} onError={onError} />}
    </>;
  }

  function AccountsScreen() {
    return <>
      <div className="page-heading"><h1>{copy.accounts}</h1><p>{copy.accountsText}</p></div>
      {workspaceId && <AccountsPanel clients={[client]} accounts={social.accounts} available={social.available} workspaceId={workspaceId} fixedClientId={client.id} audience={mode === 'client' ? 'client' : 'studio'} onDisconnect={social.disconnect} />}
    </>;
  }

  function ReviewScreen() {
    if (!task) return <div className="portal-empty"><h2>{copy.notFound}</h2></div>;
    const comments = records.filter((r) => r.kind === 'comment' && r.taskId === task.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const url = link(task);
    const signOff = task.signOff;
    const actions = <>
      <button className="btn" disabled={busy} onClick={() => { setFormError(''); setDialog('changes'); }}>{copy.requestChanges}</button>
      <button className="btn primary" disabled={busy} onClick={() => { setFormError(''); setConfirm(false); setDialog('approve'); }}><Check size={16} />{copy.approve}</button>
    </>;
    return <>
      {task.status === 'À valider' && <div className="portal-actionbar mobile-only">{actions}</div>}
      <div className="pc-page">
      <button className="text-link back" onClick={() => go('review')}>{rtl ? <ArrowRight size={15} /> : <ArrowLeft size={15} />}{copy.back}</button>
      <div className="page-heading"><div className="heading-line"><h1>{task.name}</h1>{task.status === 'À valider' ? <div className="inline desktop-only">{actions}</div> : <Chip status={task.status} copy={copy} />}</div><p>{pname(task.projectId)}{task.priority ? ` · Priorité ${task.priority}` : ""}{task.due ? ` · ${copy.dueOn(fmt(task.due))}` : ''}</p></div>
      {task.status === 'À valider' && <div className="portal-clock-block">{Countdown({ t: task })}<small>{copy.clockRule(flow.validationHours)}</small>{Rounds({ t: task })}</div>}
      {signOff && <div className="portal-receipt"><ShieldCheck size={18} /><div><strong>{copy.receipt}</strong><dl><div><dt>{copy.receiptMode}</dt><dd>{signOff.mode === 'silence' ? copy.silence : signOff.mode === 'studio' ? copy.studio : copy.explicit}</dd></div><div><dt>{copy.receiptContact}</dt><dd>{signOff.by}{signOff.email ? ` · ${signOff.email}` : ''}</dd></div><div><dt>{copy.receiptWhen}</dt><dd>{fmt(signOff.at, true)}</dd></div><div><dt>{copy.receiptRound}</dt><dd>{signOff.round} / {flow.maxRevisionRounds}</dd></div></dl></div></div>}
      <div className="review-layout">
        <div className="review-canvas"><div className="external-file"><FileText size={50} /><h2>{copy.externalTitle}</h2><p>{copy.externalText}</p>{url ? <a className="btn" href={url} target="_blank" rel="noopener noreferrer">{copy.openFile}<ArrowUpRight size={16} /></a> : <p>{copy.noLink}</p>}</div></div>
        <aside>
          <TaskChat
            key={task.id}
            messages={comments}
            workspaceId={workspaceId ?? undefined}
            isMine={(c) => (c.authorId ? c.authorId === user.id : mode === 'client' && c.audience === 'client' && c.author === user.name)}
            senderLabel={(c) => (c.audience === 'client' ? client.name : studio)}
            canWrite
            busy={busy}
            onSend={async (message) => { await mutate({ action: 'comment', taskId: task.id, ...message }); }}
            onError={onError}
          />
        </aside>
      </div>
    </div>
    </>;
  }

  const title = tab === 'home' ? copy.home : tab === 'calendar' ? copy.calendar : tab === 'files' ? copy.files : tab === 'tasks' ? copy.tasks : tab === 'documents' ? copy.documents : tab === 'request' ? copy.request : tab === 'accounts' ? copy.accounts : tab === 'stats' ? copy.stats : tab === 'meetings' ? copy.meetings : tab === 'plan' ? copy.plan : copy.review;

  return <div dir={copy.dir} lang={locale} className={`portal-root ${rtl ? 'portal-rtl' : ''} ${route.page === 'review' ? 'portal-reviewing' : ''}`}>
    <SidebarProvider style={{ '--sidebar-width': '260px' } as React.CSSProperties}>
      <Sidebar className="tracker-sidebar" side={rtl ? 'right' : 'left'}>
        <SidebarHeader><div className="brand">{brandLogo ? <span className="brand-logo-box"><img className={brandLightLogoClass(brand)} src={brandLogo} alt={studio} /></span> : brand?.company ? <span className="brand-wordmark">{studio}</span> : <img className="sidebar-logo logo-white" src="/the-one-core-logo-light.svg" alt="The One Core" />}<div className="brand-client"><ClientMark name={client.name} logo={client.logo} size="md" /><div><strong>{client.name}</strong><small>{copy.portal}</small></div></div></div></SidebarHeader>
        <SidebarContent><SidebarGroup><SidebarGroupLabel>{copy.space.toUpperCase()}</SidebarGroupLabel><SidebarMenu>
          <NavItem icon={Home} label={copy.home} active={tab === 'home'} onClick={() => go('home')} />
          <NavItem icon={CheckCircle2} label={copy.review} active={tab === 'review'} badge={toReview} onClick={() => go('review')} />
          <NavItem icon={List} label={copy.tasks} active={tab === 'tasks'} onClick={() => go('tasks')} />
          <NavItem icon={CalendarDays} label={copy.calendar} active={tab === 'calendar'} onClick={() => go('calendar')} />
          <NavItem icon={CalendarRange} label={copy.plan} active={tab === 'plan'} onClick={() => go('plan')} />
          <NavItem icon={FileText} label={copy.files} active={tab === 'files'} onClick={() => go('files')} />
          <NavItem icon={FileSignature} label={copy.documents} active={tab === 'documents'} onClick={() => go('documents')} />
          <NavItem icon={Inbox} label={copy.request} active={tab === 'request'} onClick={() => go('request')} />
          <NavItem icon={CalendarClock} label={copy.meetings} active={tab === 'meetings'} badge={meetingsToday} onClick={() => go('meetings')} />
          <NavItem icon={BarChart3} label={copy.stats} active={tab === 'stats'} onClick={() => go('stats')} />
          <NavItem icon={Link2} label={copy.accounts} active={tab === 'accounts'} onClick={() => go('accounts')} />
        </SidebarMenu></SidebarGroup></SidebarContent>
        <SidebarFooter>
          {mode === 'preview' && <button className="btn" onClick={onLeave}><ArrowLeft size={15} />{copy.backToStudio}</button>}
          <div className="user-row"><button className="user-profile" onClick={() => setSettingsOpen(true)} aria-label={t('Paramètres')} title={t('Paramètres')}><Avatar name={user.name} avatar={user.avatar} /><div><strong>{user.name.includes('@') ? user.name.split('@')[0] : user.name}</strong><small>{mode === 'preview' ? t('Aperçu studio') : client.name}</small></div><Settings2 size={15} className="user-settings-icon" /></button></div>
          <Copyright short />
        </SidebarFooter>
      </Sidebar>
      <main className="workspace">
        <header className="topbar portal-topbar"><SidebarTrigger aria-label="Menu" className="desktop-only" /><span className="portal-topbar-client mobile-only"><ClientMark name={client.name} logo={client.logo} size="sm" /></span><span className="workspace-label"><Eye size={14} />{copy.portal}</span>{rtl ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}<span>{title}</span><div className="grow" />{busy && <span className="save-state"><Loader2 className="spin" size={13} />…</span>}</header>
        {mode === 'preview' && <div className="preview-banner"><Eye size={16} /><span>{copy.previewBanner}</span><button className="text-link" onClick={onLeave}>{copy.leave}<ArrowUpRight size={14} /></button></div>}
        <div className="page-content">
          {error && <div className="error-banner" role="alert"><span>{error}</span><button className="btn" onClick={() => onError('')}>OK</button></div>}
          {route.page === 'review' ? ReviewScreen() : tab === 'home' ? HomeScreen() : tab === 'calendar' ? <><div className="page-heading"><h1>{copy.calendar}</h1><p>{client.name}</p></div>{Calendar()}</> : tab === 'files' ? ListScreen({ items: files, title: copy.files, empty: copy.noFiles, emptyText: copy.noFilesText }) : tab === 'tasks' ? TasksScreen() : tab === 'documents' ? DocumentsScreen() : tab === 'request' ? RequestScreen() : tab === 'accounts' ? AccountsScreen() : tab === 'stats' ? StatsScreen() : tab === 'meetings' ? MeetingsScreen() : tab === 'plan' ? PlanScreen() : ListScreen({ items: waiting, title: copy.review, empty: copy.nothingWaiting, emptyText: copy.nothingWaitingText, withPosts: true })}
        </div>
      </main>
      {route.page !== 'review' && <TabBar
            tabs={[
              { icon: Home, label: copy.home, active: tab === 'home', onClick: () => go('home') },
              { icon: Inbox, label: copy.review, active: tab === 'review' || route.page === 'review', badge: toReview, onClick: () => go('review') },
              { icon: CalendarDays, label: copy.calendar, active: tab === 'calendar', onClick: () => go('calendar') },
              { icon: Send, label: copy.request, active: tab === 'request', onClick: () => go('request') }
            ]}
            moreTabs={[
              { icon: List, label: copy.tasks, active: tab === 'tasks', onClick: () => go('tasks') },
              { icon: CalendarRange, label: copy.plan, active: tab === 'plan', onClick: () => go('plan') },
              { icon: FileText, label: copy.files, active: tab === 'files', onClick: () => go('files') },
              { icon: FileSignature, label: copy.documents, active: tab === 'documents', onClick: () => go('documents') },
              { icon: CalendarClock, label: copy.meetings, active: tab === 'meetings', onClick: () => go('meetings') },
              { icon: BarChart3, label: copy.stats, active: tab === 'stats', onClick: () => go('stats') },
              { icon: Link2, label: copy.accounts, active: tab === 'accounts', onClick: () => go('accounts') }
            ]}
            more={{ label: copy.more, active: !['home', 'review', 'calendar', 'request'].includes(tab) }}
          />}
      {notice && <div className="toast" role="status"><CheckCircle2 size={17} />{notice}</div>}
      <PagePicker pending={social.pending} clientName={client.name} onCancel={social.cancelPick} onPick={social.pick} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} user={user} workspaceId={workspaceId ?? null} onSave={async (changes) => onProfile ? onProfile(changes) : undefined} onLogout={() => { setSettingsOpen(false); onLeave(); }} />
      <Dialog open={!!viewing} onOpenChange={(o) => { if (!o && !busy) { setViewing(null); setAskingChanges(null); } }}>
        <DialogContent className="tracker-modal post-viewer" dir={copy.dir}>
          <DialogHeader className="sr-only"><DialogTitle>{copy.publication}</DialogTitle><DialogDescription>{client.name}</DialogDescription></DialogHeader>
          {(() => { const post = posts.find((p) => p.id === viewing); return post ? PostCard({ post }) : null; })()}
        </DialogContent>
      </Dialog>
      <Dialog open={!!dialog} onOpenChange={(o) => { if (!o && !busy) { setDialog(null); setClip(null); } }}>
        <DialogContent className="tracker-modal post-viewer" dir={copy.dir}>
          <DialogHeader><DialogTitle>{dialog === 'approve' ? copy.approveTitle : copy.changesTitle}</DialogTitle><DialogDescription>{dialog === 'approve' ? copy.approveText(task?.name ?? '') : copy.changesText}</DialogDescription></DialogHeader>
          {dialog === 'approve' ? <label className="portal-confirm"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /><span>{copy.approveConfirm}</span></label>
            : <>
              <label className="form-field"><span>{copy.changesTitle}</span><textarea autoFocus rows={6} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} placeholder={copy.changesPlaceholder} /></label>
              {workspaceId && <div className="form-field"><span>{copy.voice.hint}</span><VoiceRecorder value={clip} onChange={setClip} disabled={busy} labels={copy.voice} /></div>}
            </>}
          {task && dialog === 'changes' && Rounds({ t: task })}
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <DialogFooter className="modal-footer"><button type="button" className="btn" disabled={busy} onClick={() => setDialog(null)}>{copy.cancel}</button><button className="btn primary" disabled={busy || (dialog === 'approve' && !confirm)} onClick={() => void decide(dialog!)}>{busy ? <Loader2 size={15} className="spin" /> : dialog === 'approve' ? <Check size={15} /> : <Send size={15} />}{dialog === 'approve' ? copy.approveButton : copy.changesButton}</button></DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  </div>;
}

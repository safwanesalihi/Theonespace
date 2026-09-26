'use client';
// The client portal: four read-only screens, a request form, the review page, and the client's own
// social accounts, which they connect themselves (app/social-accounts.tsx).
// Rendered for a signed-in client contact (mode "client") and for the studio's own preview (mode "preview").
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock, Download, Eye, FileSignature, FileText, Home, Inbox, Link2, List, Loader2, MoreHorizontal, Send, Settings2, ShieldCheck, type LucideIcon } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DatePicker from '@/app/date-picker';
import { Sidebar, SidebarProvider, SidebarHeader, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import Avatar from '@/app/profile-avatar';
import ClientMark from '@/app/client-mark';
import ClientImages from '@/app/client-images';
import { type RecordItem, type Status, type DocStatus, statuses, statusClass, safeLink, channels, dayKey } from '@/lib/model';
import { flow, hoursLeft, revisionState, shiftDay } from '@/lib/flow';
import { DonutStat, TrendArea, type Slice } from '@/components/dashboard-charts';
import { Progress } from '@/components/ui/progress';
import { portalCopy, portalLocaleFor, type PortalCopy } from '@/lib/portal-i18n';
import { computeTotals, docLabels, docStatusLabels } from '@/lib/documents';
import { buildDocumentPdf, downloadPdf } from '@/lib/document-pdf';
import { readStoredLocale } from '@/lib/i18n';
import { useI18n } from '@/app/locale-provider';
import SettingsDialog from '@/app/settings-dialog';
import VoiceRecorder, { uploadVoice } from '@/app/voice-recorder';
import AudioPlayer from '@/app/audio-player';
import NetworkIcon from '@/app/network-icon';
import PostPreview from '@/app/post-preview';
import { AccountsPanel, PagePicker, useConnectedAccounts } from '@/app/social-accounts';
import { captionFor, mediaOf, targetsOf, type Network } from '@/lib/social';

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
function TabBar({ tabs, more }: { tabs: Tab[]; more: { label: string; active: boolean } }) {
  const { setOpenMobile } = useSidebar();
  const button = (tab: Tab) => <button key={tab.label} type="button" className={tab.active ? 'active' : ''} aria-current={tab.active ? 'page' : undefined} onClick={tab.onClick}>
    <span className="portal-tab-icon"><tab.icon size={21} strokeWidth={1.7} />{!!tab.badge && <span className="portal-tab-badge">{tab.badge}</span>}</span>
    <span className="portal-tab-label">{tab.label}</span>
  </button>;
  return <nav className="portal-tabbar">
    {tabs.map(button)}
    {button({ icon: MoreHorizontal, label: more.label, active: more.active, onClick: () => setOpenMobile(true) })}
  </nav>;
}

export default function Portal({ mode, records, client, user, workspaceId, route, today, busy, error, notice, navigate, mutate, onNotice, onError, onLeave, onProfile }: Props) {
  // The portal follows the app language (toggle in the sidebar). A client who never chose one starts in the
  // language recorded on their client file.
  const { locale, setLocale, t } = useI18n();
  useEffect(() => { if (mode === 'client' && !readStoredLocale()) setLocale(portalLocaleFor(client.language)); }, [mode, client.language, setLocale]);
  const copy = portalCopy[locale];
  const rtl = copy.dir === 'rtl';
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t); }, []);
  const [dialog, setDialog] = useState<'approve' | 'changes' | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [text, setText] = useState('');
  const [clip, setClip] = useState<Blob | null>(null);
  const [comment, setComment] = useState('');
  const [commentClip, setCommentClip] = useState<Blob | null>(null);
  const [request, setRequest] = useState({ name: '', projectId: '', due: '', channel: '', description: '' });
  const [formError, setFormError] = useState('');
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
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
  const production = tasks.filter((t) => t.status === 'À faire' || t.status === 'En cours');
  const validatedThisMonth = tasks.filter((t) => t.status === 'Validé' && t.validatedAt && t.validatedAt.slice(0, 7) === today.slice(0, 7));
  const upcoming = tasks.filter((t) => t.due && t.due >= today && !t.publishedAt).sort((a, b) => a.due!.localeCompare(b.due!));
  const files = tasks.filter((t) => !!link(t) && (t.status === 'À valider' || t.status === 'Validé'));
  const myRequests = tasks.filter((t) => t.request).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const events = records.filter((r) => r.kind === 'event' && r.clientId === client.id && r.audience !== 'studio').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // Already scoped to this client by portalView() server-side; re-filtered here defensively, same as tasks/projects above.
  const documents = records.filter((r) => r.kind === 'document' && r.clientId === client.id && !r.archived).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const task = route.page === 'review' ? tasks.find((t) => t.id === route.id) ?? null : null;
  const tab = route.page === 'review' ? 'review' : route.tab || 'home';
  const pname = (id?: string) => projects.find((p) => p.id === id)?.name || '';
  const fmt = (iso?: string, withTime = false) => iso ? new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString(copy.locale, withTime ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' }) : copy.noDate;
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
    } catch (e) { setFormError((e as Error).message); }
  }
  async function sendComment(e: React.FormEvent) {
    e.preventDefault(); if (!task || (!comment.trim() && !commentClip)) return;
    try {
      const audio = commentClip && workspaceId ? await uploadVoice(commentClip, workspaceId) : undefined;
      await mutate({ action: 'comment', taskId: task.id, text: comment, ...(audio ? { audio } : {}) });
      setComment(''); setCommentClip(null);
    } catch (e) { onError((e as Error).message); }
  }
  async function sendRequest(e: React.FormEvent) {
    e.preventDefault(); setFormError('');
    try {
      await mutate({ action: 'request', clientId: client.id, data: { ...request } });
      setRequest({ name: '', projectId: '', due: '', channel: '', description: '' });
      onNotice(copy.requestSent);
    } catch (e) { setFormError((e as Error).message); }
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
    } catch (e) { onError((e as Error).message); }
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
    return <div className="calendar-wrap">
      <div className="calendar-toolbar">
        <button className="btn" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>{copy.today}</button>
        <button className="icon-button" aria-label={copy.previous} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>{rtl ? <ChevronRight /> : <ChevronLeft />}</button>
        <button className="icon-button" aria-label={copy.next} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>{rtl ? <ChevronLeft /> : <ChevronRight />}</button>
        <h2>{month.toLocaleDateString(copy.locale, { month: 'long', year: 'numeric' })}</h2>
      </div>
      <div className="calendar-grid desktop-only">
        <div className="weekdays">{copy.weekdays.map((d) => <span key={d}>{d}</span>)}</div>
        <div className="calendar-days">{days.map((d) => {
          const key = dayKey(d);
          const items = tasks.filter((t) => t.due === key);
          const dayPosts = posts.filter((p) => p.due === key);
          return <div className={`calendar-day ${d.getMonth() !== month.getMonth() ? 'outside' : ''}`} key={key}>
            <header><span className={key === today ? 'today' : ''}>{d.getDate()}</span></header>
            {items.map((t) => <button key={t.id} className="calendar-event" onClick={() => navigate({ page: 'review', id: t.id })}><strong>{t.name}</strong>{t.time && t.channel && <small>{t.time} · {t.channel}</small>}<Chip status={t.status} copy={copy} /></button>)}
            {dayPosts.map((p) => <button key={p.id} className="calendar-event portal-post-event" onClick={() => setViewing(p.id)}><strong>{p.name}</strong><small>{p.time || '09:00'} {targetsOf(p).map((x) => <NetworkIcon key={x.network} network={x.network} size={10} />)}</small>{p.approval?.state === 'pending' && !p.publishedAt && <span className="status s2">{copy.postState.pending}</span>}</button>)}
          </div>;
        })}</div>
      </div>
      {Agenda()}
    </div>;
  }

  // The same month as a list of days — a 42-cell grid is unreadable at phone width.
  function Agenda() {
    const prefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
    const inMonth = tasks.filter((t) => t.due?.startsWith(prefix)).sort((a, b) => (a.due! + (a.time || '')).localeCompare(b.due! + (b.time || '')));
    const monthPosts = posts.filter((p) => p.due?.startsWith(prefix));
    const days = [...new Set([...inMonth, ...monthPosts].map((t) => t.due!))].sort();
    return <div className="portal-agenda mobile-only">
      {days.length ? days.map((key) => <section key={key} className={key === today ? 'today' : key < today ? 'past' : ''}>
        <h3>{new Date(key + 'T12:00:00').toLocaleDateString(copy.locale, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
        {inMonth.filter((t) => t.due === key).map((t) => <button key={t.id} type="button" className="portal-agenda-item" onClick={() => navigate({ page: 'review', id: t.id })}>
          <span><strong>{t.name}</strong>{(t.time || t.channel) && <small>{[t.time, t.channel].filter(Boolean).join(' · ')}</small>}</span>
          <Chip status={t.status} copy={copy} />
        </button>)}
        {monthPosts.filter((p) => p.due === key).map((p) => <button key={p.id} type="button" className="portal-agenda-item portal-post-event" onClick={() => setViewing(p.id)}>
          <span><strong>{p.name}</strong><small>{p.time || '09:00'} {targetsOf(p).map((x) => <NetworkIcon key={x.network} network={x.network} size={11} />)}</small></span>
          {p.approval?.state === 'pending' && !p.publishedAt ? <span className="status s2">{copy.postState.pending}</span> : <span className="status s3">{p.publishedAt ? copy.postPublished : copy.postScheduled}</span>}
        </button>)}
      </section>) : <p className="small-note">{copy.nothingThisMonth}</p>}
    </div>;
  }

  function HomeScreen() {
    // Greet the person, not the studio: the signed-in contact, or the client's named contact in the studio preview.
    const who = mode === 'client' ? (user.name.includes('@') ? '' : user.name.split(' ')[0]) : (client.contact && client.contact !== 'Contact à renseigner' ? client.contact.split(' ')[0] : '');
    const month = today.slice(0, 7);
    const publishedThisMonth = tasks.filter((t) => t.publishedAt && t.publishedAt.slice(0, 7) === month);
    const quota = client.quota && /^\d+$/.test(client.quota) ? Number(client.quota) : null;
    const weekEnd = shiftDay(today, 6);
    const thisWeek = tasks.filter((t) => t.due && t.due >= today && t.due <= weekEnd && !t.publishedAt).sort((a, b) => a.due!.localeCompare(b.due!));
    const statusColors: Record<Status, string> = { 'À faire': '#8e96a3', 'En cours': '#e9c46a', 'En pause': '#6f86b8', 'À valider': '#E5A93C', 'Validé': '#3d8763' };
    const mixSlices: Slice[] = statuses.map((status) => ({ key: status, label: copy.status[status], value: tasks.filter((t) => t.status === status).length, color: statusColors[status] }));
    const monthlyTrend = Array.from({ length: 6 }, (_, i) => {
      const base = new Date(today + 'T12:00:00');
      const d = new Date(base.getFullYear(), base.getMonth() - (5 - i), 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return { x: key, y: tasks.filter((t) => t.publishedAt && t.publishedAt.slice(0, 7) === key).length, label: d.toLocaleDateString(copy.locale, { month: 'long', year: 'numeric' }) };
    });
    return <>
      <div className="desktop-only"><ClientImages client={client} workspaceId="" canEdit={false} onChange={async () => false} onError={() => undefined} /></div>
      <div className="page-heading"><div className="eyebrow">{copy.dashboard.toUpperCase()}</div><h1>{copy.hello(who || client.name)}</h1><p>{copy.tagline}</p></div>
      {!!pendingPosts.length && <div className="portal-banner active"><CheckCircle2 size={18} /><span>{copy.postsWaiting(pendingPosts.length)}</span><button className="btn primary" onClick={() => go('review')}>{copy.review}</button></div>}
      {(!!waiting.length || !pendingPosts.length) && <div className={`portal-banner ${waiting.length ? 'active' : ''}`}><CheckCircle2 size={18} /><span>{waiting.length ? copy.waiting(waiting.length) : copy.nothingWaiting}</span>{!!waiting.length && <button className="btn primary" onClick={() => go('review')}>{copy.review}</button>}</div>}
      <div className="portal-stats portal-stats-4 desktop-only">{[[copy.inProduction, production.length], [copy.review, waiting.length], [copy.validatedThisMonth, validatedThisMonth.length], [copy.publishedThisMonth, publishedThisMonth.length]].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{String(value).padStart(2, '0')}</strong></div>)}</div>

      <div className="portal-dashboard">
        <div className="portal-col">
          <section className="portal-card"><div className="section-head"><div><h2>{copy.review}<span className="neutral-badge">{waiting.length}</span></h2></div>{!!waiting.length && <button className="text-link" onClick={() => go('review')}>{copy.seeAll}<ArrowUpRight size={14} /></button>}</div>
            {waiting.length ? <div className="task-rows">{waiting.slice(0, 4).map((t) => <button className="task-line" key={t.id} onClick={() => navigate({ page: 'review', id: t.id })}><span className="task-line-icon"><FileText size={16} /></span><span className="task-line-name"><strong>{t.name}</strong><small>{pname(t.projectId)}{t.approvalDueAt ? ` · ${copy.clock(Math.max(0, hoursLeft(t, now) ?? 0))}` : ''}</small></span><Chip status={t.status} copy={copy} />{rtl ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}</button>)}</div> : <p className="small-note">{copy.nothingWaitingText}</p>}
          </section>
          <section className="portal-card"><div className="section-head"><div><h2>{copy.thisWeek}<span className="neutral-badge">{thisWeek.length}</span></h2></div><button className="text-link" onClick={() => go('calendar')}>{copy.calendar}<ArrowUpRight size={14} /></button></div>
            {thisWeek.length ? <div className="task-rows">{thisWeek.map((t) => <button className="task-line" key={t.id} onClick={() => navigate({ page: 'review', id: t.id })}><span className="task-line-icon"><CalendarDays size={16} /></span><span className="task-line-name"><strong>{t.name}</strong><small>{pname(t.projectId)}{t.channel ? ` · ${t.channel}` : ''}</small></span><Chip status={t.status} copy={copy} /><span className="due">{fmt(t.due)}</span></button>)}</div> : <p className="small-note">{copy.nothingThisWeek}</p>}
          </section>
          <section className="portal-card desktop-only"><div className="section-head"><div><h2>{copy.upcoming}</h2></div><button className="text-link" onClick={() => go('tasks')}>{copy.tasks}<ArrowUpRight size={14} /></button></div>
            {upcoming.length ? <div className="task-rows">{upcoming.slice(0, 6).map((t) => <button className="task-line" key={t.id} onClick={() => navigate({ page: 'review', id: t.id })}><span className="task-line-icon"><CalendarDays size={16} /></span><span className="task-line-name"><strong>{t.name}</strong><small>{pname(t.projectId)}</small></span><Chip status={t.status} copy={copy} /><span className="due">{fmt(t.due)}</span></button>)}</div> : <p className="small-note">{copy.noUpcoming}</p>}
          </section>
        </div>
        <div className="portal-col">
          <section className="portal-card portal-quota"><div className="section-head"><div><h2>{copy.quotaTitle}</h2><p>{new Date(today + 'T12:00:00').toLocaleDateString(copy.locale, { month: 'long', year: 'numeric' })}</p></div></div>
            {quota ? <><strong className="portal-quota-number">{publishedThisMonth.length}<small> / {quota}</small></strong><Progress value={Math.min(100, publishedThisMonth.length / quota * 100)} /><p className="small-note">{copy.quotaText(publishedThisMonth.length, quota)} · {copy.quotaLeft(quota - publishedThisMonth.length)}</p></> : <p className="small-note">{copy.noQuota}</p>}
          </section>
          <section className="portal-card desktop-only"><div className="section-head"><div><h2>{copy.statusMix}</h2></div></div>
            <div className="portal-mix"><DonutStat data={mixSlices} centerLabel={copy.tasks} /></div>
          </section>
          <section className="portal-card desktop-only"><div className="section-head"><div><h2>{copy.publishTrend}</h2></div></div>
            <div className="flow-panel-body"><TrendArea data={monthlyTrend} color="#E5A93C" height={168} xTickFormatter={(x) => new Date(`${x}-01T12:00:00`).toLocaleDateString(copy.locale, { month: 'short' })} /></div>
          </section>
          <section className="portal-card desktop-only"><div className="section-head"><div><h2>{copy.progressTitle}</h2></div></div>
            {projects.length ? <div className="portal-progress">{projects.map((p) => { const ts = tasks.filter((t) => t.projectId === p.id), done = ts.filter((t) => t.status === 'Validé').length; return <div key={p.id}><div className="portal-progress-head"><strong>{p.name}</strong><small>{copy.validatedOf(done, ts.length)}</small></div><Progress value={ts.length ? done / ts.length * 100 : 0} /></div>; })}</div> : <p className="small-note">{copy.noTasks}</p>}
          </section>
          <section className="portal-card desktop-only"><div className="section-head"><div><h2>{copy.activity}</h2></div></div>
            <div className="portal-activity">{events.slice(0, 6).map((e) => <div key={e.id}><span className={`portal-dot ${e.type}`} /><p>{e.name}<small>{fmt(e.createdAt, true)}</small></p></div>)}{!events.length && <p className="small-note">{copy.conversationStart}</p>}</div>
          </section>
        </div>
      </div>
    </>;
  }

  function ListScreen({ items, title, empty, emptyText, withPosts = false }: { items: RecordItem[]; title: string; empty: string; emptyText: string; withPosts?: boolean }) {
    const shownPosts = withPosts ? pendingPosts : [];
    return <>
      <div className="page-heading"><h1>{title}</h1><p>{client.name}</p></div>
      {!!shownPosts.length && <section className="post-review"><h2>{copy.postsToReview}<span className="neutral-badge">{shownPosts.length}</span></h2><div className="post-cards">{shownPosts.map((post) => PostCard({ post }))}</div></section>}
      {!!items.length && <div className="review-list">{items.map((t) => Card({ t }))}</div>}
      {!items.length && !shownPosts.length && <div className="portal-empty"><CheckCircle2 size={28} /><h2>{empty}</h2><p>{emptyText}</p></div>}
    </>;
  }

  function TasksScreen() {
    const items = tasks.filter((t) => !projectFilter || t.projectId === projectFilter).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
    return <>
      <div className="page-heading"><div className="heading-line"><h1>{copy.tasks}</h1>{projects.length > 1 && <Select value={projectFilter || '__all'} onValueChange={(v) => setProjectFilter(v === '__all' ? '' : v)}><SelectTrigger className="pick" aria-label={copy.colProject}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__all">{copy.allProjects}</SelectItem>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>}</div><p>{client.name} · {copy.tasksCount(items.length)}</p></div>
      {items.length ? <><div className="portal-cards mobile-only">{items.map((t) => <button key={t.id} type="button" className="portal-mobile-card" onClick={() => navigate({ page: 'review', id: t.id })}>
          <span><strong>{t.name}</strong><small>{[pname(t.projectId), t.publishedAt ? `${copy.published} · ${fmt(t.publishedAt)}` : t.due ? fmt(t.due) : ''].filter(Boolean).join(' · ')}</small></span>
          <Chip status={t.status} copy={copy} />
        </button>)}</div>
        <div className="database-card desktop-only"><div className="table-area"><Table className="portal-table"><TableHeader><TableRow><TableHead>{copy.colTask}</TableHead><TableHead>{copy.colProject}</TableHead><TableHead>{copy.colStatus}</TableHead><TableHead>{copy.colDate}</TableHead><TableHead>{copy.colFile}</TableHead></TableRow></TableHeader>
        <TableBody>{items.map((t) => { const url = (t.status === 'À valider' || t.status === 'Validé') ? link(t) : ''; return <TableRow key={t.id} className="portal-row" onClick={() => navigate({ page: 'review', id: t.id })}>
          <TableCell><strong>{t.name}</strong>{t.channel && <small> · {t.channel}</small>}</TableCell>
          <TableCell>{pname(t.projectId)}</TableCell>
          <TableCell><Chip status={t.status} copy={copy} /></TableCell>
          <TableCell>{t.publishedAt ? `${copy.published} · ${fmt(t.publishedAt)}` : t.due ? fmt(t.due) : copy.noDate}</TableCell>
          <TableCell onClick={(e) => e.stopPropagation()}>{url ? <a className="file-pill" href={url} target="_blank" rel="noopener noreferrer"><FileText size={13} />{copy.open}<ArrowUpRight size={12} /></a> : '—'}</TableCell>
        </TableRow>; })}</TableBody></Table></div></div></> : <div className="portal-empty"><List size={28} /><h2>{copy.noTasks}</h2></div>}
    </>;
  }

  async function downloadDocument(doc: RecordItem) {
    setPdfBusy(doc.id);
    try {
      const bytes = await buildDocumentPdf({
        docType: doc.docType!, number: doc.number!, docStatus: doc.docStatus || 'draft', studioName: 'The One Core',
        clientName: client.name, issuedAt: doc.issuedAt, dueAt: doc.dueAt, validUntil: doc.validUntil,
        lineItems: doc.lineItems || [], taxRate: doc.taxRate, notes: doc.notes,
      });
      downloadPdf(bytes, `${doc.number}.pdf`);
    } catch { onError(copy.noDocuments); } finally { setPdfBusy(''); }
  }

  function DocumentsScreen() {
    return <>
      <div className="page-heading"><h1>{copy.documents}</h1><p>{client.name}</p></div>
      {documents.length ? <><div className="portal-cards mobile-only">{documents.map((doc) => { const { total } = computeTotals(doc.lineItems || [], doc.taxRate); return <div key={doc.id} className="portal-mobile-card">
          <span><strong>{docLabels[doc.docType || 'devis']} {doc.number}</strong><small>{total.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD · {fmt(doc.issuedAt)}</small></span>
          <span className={`status ${docStatusClass[doc.docStatus || 'draft']}`}>{docStatusLabels[doc.docStatus || 'draft']}</span>
          <button type="button" className="icon-button" aria-label={copy.download} disabled={!!pdfBusy} onClick={() => void downloadDocument(doc)}>{pdfBusy === doc.id ? <Loader2 size={16} className="spin" /> : <Download size={16} />}</button>
        </div>; })}</div>
        <div className="database-card desktop-only"><div className="table-area"><Table className="portal-table"><TableHeader><TableRow><TableHead>{copy.colNumber}</TableHead><TableHead>{copy.colDocType}</TableHead><TableHead>{copy.colStatus}</TableHead><TableHead>{copy.colTotal}</TableHead><TableHead>{copy.colDate}</TableHead><TableHead /></TableRow></TableHeader>
        <TableBody>{documents.map((doc) => { const { total } = computeTotals(doc.lineItems || [], doc.taxRate); return <TableRow key={doc.id}>
          <TableCell><strong>{doc.number}</strong></TableCell>
          <TableCell>{docLabels[doc.docType || 'devis']}</TableCell>
          <TableCell><span className={`status ${docStatusClass[doc.docStatus || 'draft']}`}>{docStatusLabels[doc.docStatus || 'draft']}</span></TableCell>
          <TableCell>{total.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD</TableCell>
          <TableCell>{fmt(doc.issuedAt)}</TableCell>
          <TableCell onClick={(e) => e.stopPropagation()}><button className="file-pill" disabled={!!pdfBusy} onClick={() => void downloadDocument(doc)}>{pdfBusy === doc.id ? <Loader2 size={13} className="spin" /> : <Download size={13} />}{copy.download}</button></TableCell>
        </TableRow>; })}</TableBody></Table></div></div></> : <div className="portal-empty"><FileSignature size={28} /><h2>{copy.noDocuments}</h2><p>{copy.noDocumentsText}</p></div>}
    </>;
  }

  function RequestScreen() {
    return <>
      <div className="page-heading"><h1>{copy.requestTitle}</h1><p>{copy.requestText}</p></div>
      <div className="portal-request">
        <form onSubmit={sendRequest} className="form-fields">
          <label className="form-field"><span>{copy.requestName} *</span><input required maxLength={160} value={request.name} onChange={(e) => setRequest({ ...request, name: e.target.value })} /></label>
          <div className="form-pair">
            <label className="form-field"><span>{copy.requestProject}</span><Select value={request.projectId || '__none'} onValueChange={(v) => setRequest({ ...request, projectId: v === '__none' ? '' : v })}><SelectTrigger className="pick" aria-label={copy.requestProject}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none">{copy.choose}</SelectItem>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></label>
            <label className="form-field"><span>{copy.requestDate}</span><DatePicker label={copy.requestDate} value={request.due} onChange={(value) => setRequest({ ...request, due: value })} placeholder={copy.choose} /></label>
          </div>
          <label className="form-field"><span>{copy.requestChannel}</span><Select value={request.channel || '__none'} onValueChange={(v) => setRequest({ ...request, channel: v === '__none' ? '' : v })}><SelectTrigger className="pick" aria-label={copy.requestChannel}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none">{copy.choose}</SelectItem>{channels.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></label>
          <label className="form-field"><span>{copy.requestDescription}</span><textarea rows={5} maxLength={15000} value={request.description} onChange={(e) => setRequest({ ...request, description: e.target.value })} /></label>
          <small className="small-note">{copy.requestLockNote(flow.lockDays)}</small>
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <div className="inline"><button className="btn primary" disabled={busy}>{busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />}{copy.requestButton}</button></div>
        </form>
        <aside>
          <h3>{copy.myRequests.toUpperCase()}</h3>
          {myRequests.length ? <div className="task-rows">{myRequests.map((t) => <button className="task-line" key={t.id} onClick={() => navigate({ page: 'review', id: t.id })}><span className="task-line-icon"><Inbox size={16} /></span><span className="task-line-name"><strong>{t.name}</strong><small>{copy.requestedOn(fmt(t.request?.at))}{t.due ? ` · ${copy.dueOn(fmt(t.due))}` : ''}</small></span><Chip status={t.status} copy={copy} /></button>)}</div> : <p className="small-note">{copy.noRequests}</p>}
        </aside>
      </div>
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
      <button className="text-link back" onClick={() => go('review')}>{rtl ? <ArrowUpRight size={15} style={{ transform: 'rotate(180deg)' }} /> : <ArrowLeft size={15} />}{copy.back}</button>
      <div className="page-heading"><div className="heading-line"><h1>{task.name}</h1>{task.status === 'À valider' ? <div className="inline desktop-only">{actions}</div> : <Chip status={task.status} copy={copy} />}</div><p>{pname(task.projectId)}{task.due ? ` · ${copy.dueOn(fmt(task.due))}` : ''}</p></div>
      {task.status === 'À valider' && <div className="portal-clock-block">{Countdown({ t: task })}<small>{copy.clockRule(flow.validationHours)}</small>{Rounds({ t: task })}</div>}
      {signOff && <div className="portal-receipt"><ShieldCheck size={18} /><div><strong>{copy.receipt}</strong><dl><div><dt>{copy.receiptMode}</dt><dd>{signOff.mode === 'silence' ? copy.silence : signOff.mode === 'studio' ? copy.studio : copy.explicit}</dd></div><div><dt>{copy.receiptContact}</dt><dd>{signOff.by}{signOff.email ? ` · ${signOff.email}` : ''}</dd></div><div><dt>{copy.receiptWhen}</dt><dd>{fmt(signOff.at, true)}</dd></div><div><dt>{copy.receiptRound}</dt><dd>{signOff.round} / {flow.maxRevisionRounds}</dd></div></dl></div></div>}
      <div className="review-layout">
        <div className="review-canvas"><div className="external-file"><FileText size={50} /><h2>{copy.externalTitle}</h2><p>{copy.externalText}</p>{url ? <a className="btn" href={url} target="_blank" rel="noopener noreferrer">{copy.openFile}<ArrowUpRight size={16} /></a> : <p>{copy.noLink}</p>}</div></div>
        <aside>
          <section className="comments"><h2>{copy.comments}</h2>
            {comments.map((c) => <div className="comment" key={c.id}><Avatar name={c.author} /><div><strong>{c.author}</strong><small>{fmt(c.createdAt, true)}</small>{c.name && <p>{c.name}</p>}{c.audio && <div className="voice-message"><AudioPlayer src={`/api/assets/${c.audio}`} label={copy.voice.message} labels={copy.voice} /></div>}</div></div>)}
            {!comments.length && <p className="small-note">{copy.conversationStart}</p>}
            <form className="comment-composer" onSubmit={sendComment}><Avatar name={user.name} /><textarea maxLength={5000} rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={copy.writeComment} aria-label={copy.writeComment} /><button className="btn" disabled={busy || (!comment.trim() && !commentClip)} aria-label={copy.send}><Send size={16} /></button></form>
            {workspaceId && <VoiceRecorder value={commentClip} onChange={setCommentClip} disabled={busy} labels={copy.voice} />}
          </section>
        </aside>
      </div>
    </>;
  }

  const title = tab === 'home' ? copy.home : tab === 'calendar' ? copy.calendar : tab === 'files' ? copy.files : tab === 'tasks' ? copy.tasks : tab === 'documents' ? copy.documents : tab === 'request' ? copy.request : tab === 'accounts' ? copy.accounts : copy.review;

  return <div dir={copy.dir} lang={locale} className={`portal-root ${rtl ? 'portal-rtl' : ''} ${route.page === 'review' ? 'portal-reviewing' : ''}`}>
    <SidebarProvider style={{ '--sidebar-width': '260px' } as React.CSSProperties}>
      <Sidebar className="tracker-sidebar" side={rtl ? 'right' : 'left'}>
        <SidebarHeader><div className="brand"><img className="sidebar-logo logo-white" src="/the-one-core-logo-white.svg" alt="The One Core" /><div className="brand-client"><ClientMark name={client.name} logo={client.logo} size="md" /><div><strong>{client.name}</strong><small>{copy.portal}</small></div></div></div></SidebarHeader>
        <SidebarContent><SidebarGroup><SidebarGroupLabel>{copy.space.toUpperCase()}</SidebarGroupLabel><SidebarMenu>
          <NavItem icon={Home} label={copy.home} active={tab === 'home'} onClick={() => go('home')} />
          <NavItem icon={CheckCircle2} label={copy.review} active={tab === 'review'} badge={toReview} onClick={() => go('review')} />
          <NavItem icon={List} label={copy.tasks} active={tab === 'tasks'} onClick={() => go('tasks')} />
          <NavItem icon={CalendarDays} label={copy.calendar} active={tab === 'calendar'} onClick={() => go('calendar')} />
          <NavItem icon={FileText} label={copy.files} active={tab === 'files'} onClick={() => go('files')} />
          <NavItem icon={FileSignature} label={copy.documents} active={tab === 'documents'} onClick={() => go('documents')} />
          <NavItem icon={Inbox} label={copy.request} active={tab === 'request'} onClick={() => go('request')} />
          <NavItem icon={Link2} label={copy.accounts} active={tab === 'accounts'} onClick={() => go('accounts')} />
        </SidebarMenu></SidebarGroup></SidebarContent>
        <SidebarFooter>
          {mode === 'preview' && <button className="btn" onClick={onLeave}><ArrowLeft size={15} />{copy.backToStudio}</button>}
          <div className="user-row"><button className="user-profile" onClick={() => setSettingsOpen(true)} aria-label={t('Paramètres')} title={t('Paramètres')}><Avatar name={user.name} avatar={user.avatar} /><div><strong>{user.name.includes('@') ? user.name.split('@')[0] : user.name}</strong><small>{mode === 'preview' ? t('Aperçu studio') : client.name}</small></div><Settings2 size={15} className="user-settings-icon" /></button></div>
        </SidebarFooter>
      </Sidebar>
      <main className="workspace">
        <header className="topbar portal-topbar"><SidebarTrigger aria-label="Menu" className="desktop-only" /><span className="portal-topbar-client mobile-only"><ClientMark name={client.name} logo={client.logo} size="sm" /></span><span className="workspace-label"><Eye size={14} />{copy.portal}</span>{rtl ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}<span>{title}</span><div className="grow" />{busy && <span className="save-state"><Loader2 className="spin" size={13} />…</span>}</header>
        {mode === 'preview' && <div className="preview-banner"><Eye size={16} /><span>{copy.previewBanner}</span><button className="text-link" onClick={onLeave}>{copy.leave}<ArrowUpRight size={14} /></button></div>}
        <div className="page-content">
          {error && <div className="error-banner" role="alert"><span>{error}</span><button className="btn" onClick={() => onError('')}>OK</button></div>}
          {route.page === 'review' ? ReviewScreen() : tab === 'home' ? HomeScreen() : tab === 'calendar' ? <><div className="page-heading"><h1>{copy.calendar}</h1><p>{client.name}</p></div>{Calendar()}</> : tab === 'files' ? ListScreen({ items: files, title: copy.files, empty: copy.noFiles, emptyText: copy.noFilesText }) : tab === 'tasks' ? TasksScreen() : tab === 'documents' ? DocumentsScreen() : tab === 'request' ? RequestScreen() : tab === 'accounts' ? AccountsScreen() : ListScreen({ items: waiting, title: copy.review, empty: copy.nothingWaiting, emptyText: copy.nothingWaitingText, withPosts: true })}
        </div>
      </main>
      {route.page !== 'review' && <TabBar
        tabs={[
          { icon: Home, label: copy.home, active: tab === 'home', onClick: () => go('home') },
          { icon: CheckCircle2, label: copy.review, active: tab === 'review', badge: toReview, onClick: () => go('review') },
          { icon: CalendarDays, label: copy.calendar, active: tab === 'calendar', onClick: () => go('calendar') },
          { icon: Inbox, label: copy.requestShort, active: tab === 'request', onClick: () => go('request') },
        ]}
        more={{ label: copy.more, active: ['tasks', 'files', 'documents', 'accounts'].includes(tab) }}
      />}
      {notice && <div className="toast" role="status"><CheckCircle2 size={17} />{notice}</div>}
      <PagePicker pending={social.pending} clientName={client.name} onCancel={social.cancelPick} onPick={social.pick} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} user={user} workspaceId={workspaceId ?? null} onSave={async (changes) => onProfile ? onProfile(changes) : undefined} onLogout={() => { setSettingsOpen(false); onLeave(); }} />
      <Dialog open={!!viewing} onOpenChange={(o) => { if (!o && !busy) { setViewing(null); setAskingChanges(null); } }}>
        <DialogContent className="tracker-modal post-viewer" dir={copy.dir}>
          <DialogHeader><DialogTitle>{copy.publication}</DialogTitle><DialogDescription>{client.name}</DialogDescription></DialogHeader>
          {(() => { const post = posts.find((p) => p.id === viewing); return post ? PostCard({ post }) : null; })()}
        </DialogContent>
      </Dialog>
      <Dialog open={!!dialog} onOpenChange={(o) => { if (!o && !busy) { setDialog(null); setClip(null); } }}>
        <DialogContent className="tracker-modal" dir={copy.dir}>
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

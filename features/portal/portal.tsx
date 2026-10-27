"use client";
// The client portal: home, deliverables to review, tasks, the publication calendar, the content plan,
// files, documents, requests, meetings, social statistics and the client's own connected accounts.
// Rendered for a signed-in client contact (mode "client") and for the studio's own preview (mode
// "preview"). This file is the shell (sidebar, top bar, tab bar, dialogs); the state lives in
// use-portal.tsx and the screens in the portal-*.tsx modules.
import Copyright from '@/components/copyright';
import Avatar from '@/components/profile-avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sidebar, SidebarProvider, SidebarHeader, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import VoiceRecorder from '@/components/voice-recorder';
import ClientMark from '@/features/clients/client-mark';
import RequestEditDialog from '@/features/requests/request-edit-dialog';
import { PagePicker } from '@/features/social/social-accounts';
import { brandLogoClass, usePortalSurface } from '@/features/workspace/brand-store';
import NotificationBell from '@/features/workspace/notification-bell';
import SettingsDialog from '@/features/workspace/settings-dialog';
import { revisionState } from '@/lib/flow';
import { useI18n } from '@/lib/i18n/locale-provider';
import { type RecordItem } from '@/lib/model';
import { ArrowLeft, ArrowUpRight, BarChart3, CalendarClock, CalendarDays, CalendarRange, Check, CheckCircle2, ChevronLeft, ChevronRight, Eye, FileSignature, FileText, Home, Inbox, Link2, List, Loader2, MoreHorizontal, Send, Settings2, type LucideIcon } from 'lucide-react';
import { NoticeToaster } from '@/components/notice-toaster';
import { GlassLight } from '@/components/ui/glass-light';
import { SidebarDock } from '@/features/workspace/dock';
import { Sky } from '@/components/ui/sky';
import { useState } from 'react';
import { PostCard, Rounds } from "./portal-parts";
import { AccountsScreen, MeetingsScreen, PlanScreen, StatsScreen } from "./portal-panels";
import { DocumentsScreen } from "./portal-documents";
import { RequestScreen } from "./portal-request";
import { ReviewScreen } from "./portal-review";
import { Calendar, HomeScreen, ListScreen, TasksScreen } from "./portal-screens";
import { usePortal } from "./use-portal";
import SkipLink, { contentId } from "@/components/skip-link";

export type PortalRoute = { page: string; id?: string; tab?: string; detail?: string };
export type PortalProps = {
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
  onBack: () => void;
};

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

export default function Portal(props: PortalProps) {
  const ctx = usePortal(props);
  usePortalSurface();
  const { brand, brandLogo, busy, client, clip, confirm, copy, decide, dialog, editingRequest, error, files, formError, go, locale, meetingsToday, mode, mutate, navigate, notice, onError, onLeave, onNotice, onProfile, posts, projects, records, route, rtl, setAskingChanges, setClip, setConfirm, setDialog, setEditingRequest, setSettingsOpen, setText, setViewing, settingsOpen, social, studio, t, tab, task, text, title, toReview, user, viewing, waiting, workspaceId } = ctx;
  return <div dir={copy.dir} lang={locale} className={`portal-root ${rtl ? 'portal-rtl' : ''} ${route.page === 'review' ? 'portal-reviewing' : ''}`}>
    <SidebarProvider defaultOpen={false} style={{ '--sidebar-width': '260px' } as React.CSSProperties}>
      <SkipLink />
      <Sidebar className="tracker-sidebar" side={rtl ? 'right' : 'left'}>
        <SidebarHeader><div className="brand">{brandLogo ? <span className="brand-logo-box"><img className={brandLogoClass(brand)} src={brandLogo} alt={studio} /></span> : brand?.company ? <span className="brand-wordmark">{studio}</span> : <img className="sidebar-logo logo-white" src="/the-one-core-logo.svg" alt="The One Core" />}<div className="brand-client"><ClientMark name={client.name} logo={client.logo} size="md" /><div><strong>{client.name}</strong><small>{copy.portal}</small></div></div></div></SidebarHeader>
        <SidebarContent><SidebarGroup><SidebarGroupLabel>{copy.space}</SidebarGroupLabel><SidebarMenu>
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
      {/* On a computer the floating dock stands in for the sidebar, in the agency's colour (features/workspace/dock.css). */}
      <SidebarDock
        tabs={[
          { icon: Home, label: copy.home, active: tab === 'home', onClick: () => go('home') },
          { icon: CheckCircle2, label: copy.review, active: tab === 'review' || route.page === 'review', badge: toReview, onClick: () => go('review') },
          { icon: List, label: copy.tasks, active: tab === 'tasks', onClick: () => go('tasks') },
          { icon: CalendarDays, label: copy.calendar, active: tab === 'calendar', onClick: () => go('calendar') },
          { icon: FileText, label: copy.files, active: tab === 'files', onClick: () => go('files') },
          { icon: Inbox, label: copy.request, active: tab === 'request', onClick: () => go('request') },
        ]}
        mark={brandLogo ? <span className="dock-logo"><img className={brandLogoClass(brand)} src={brandLogo} alt={studio} /></span> : <span className="dock-agency">{studio.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>}
        user={user}
        onSettings={() => setSettingsOpen(true)}
      />
      <main className="workspace" id={contentId} tabIndex={-1}>
        <Sky />
        <GlassLight />
        <header className="topbar portal-topbar"><SidebarTrigger aria-label="Menu" className="desktop-only" /><span className="portal-topbar-client mobile-only"><ClientMark name={client.name} logo={client.logo} size="sm" /></span><span className="workspace-label"><Eye size={14} />{copy.portal}</span>{rtl ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}<span>{title}</span><div className="grow" />{busy && <span className="save-state"><Loader2 className="spin" size={13} />…</span>}<NotificationBell records={records} currentUserId={user.id} rtl={rtl} onMarkRead={ids => void mutate({ action: 'mark-read', ids }).catch(e => onError((e as Error).message))} onMarkAllRead={() => mutate({ action: 'mark-read', all: true })} onOpenTask={id => { const item = records.find(r => r.id === id); navigate(item?.kind === 'plan_item' ? { page: 'portal', id: client.id, tab: 'plan', detail: id } : { page: 'review', id }); }} /></header>
        {mode === 'preview' && <div className="preview-banner"><Eye size={16} /><span>{copy.previewBanner}</span><button className="text-link" onClick={onLeave}>{copy.leave}<ArrowUpRight size={14} /></button></div>}
        <div className="page-content">
          {error && <div className="error-banner" role="alert"><span>{error}</span><button className="btn" onClick={() => onError('')}>OK</button></div>}
          {route.page === 'review' ? <ReviewScreen ctx={ctx} /> : tab === 'home' ? <HomeScreen ctx={ctx} /> : tab === 'calendar' ? <><div className="page-heading"><h1>{copy.calendar}</h1><p>{client.name}</p></div><Calendar ctx={ctx} /></> : tab === 'files' ? <ListScreen ctx={ctx} items={files} title={copy.files} empty={copy.noFiles} emptyText={copy.noFilesText} /> : tab === 'tasks' ? <TasksScreen ctx={ctx} /> : tab === 'documents' ? <DocumentsScreen ctx={ctx} /> : tab === 'request' ? <RequestScreen ctx={ctx} /> : tab === 'accounts' ? <AccountsScreen ctx={ctx} /> : tab === 'stats' ? <StatsScreen ctx={ctx} /> : tab === 'meetings' ? <MeetingsScreen ctx={ctx} /> : tab === 'plan' ? <PlanScreen ctx={ctx} /> : <ListScreen ctx={ctx} items={waiting} title={copy.review} empty={copy.nothingWaiting} emptyText={copy.nothingWaitingText} withPosts={true} />}
        </div>
      </main>
      {route.page !== 'review' && <TabBar
            tabs={[
              { icon: Home, label: copy.home, active: tab === 'home', onClick: () => go('home') },
              { icon: Inbox, label: copy.tabReview, active: tab === 'review' || route.page === 'review', badge: toReview, onClick: () => go('review') },
              { icon: CalendarDays, label: copy.calendar, active: tab === 'calendar', onClick: () => go('calendar') },
              { icon: Send, label: copy.tabRequest, active: tab === 'request', onClick: () => go('request') }
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
      <NoticeToaster notice={notice} />
      <PagePicker pending={social.pending} clientName={client.name} onCancel={social.cancelPick} onPick={social.pick} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} user={user} workspaceId={workspaceId ?? null} onSave={async (changes) => onProfile ? onProfile(changes) : undefined} onLogout={() => { setSettingsOpen(false); onLeave(); }} />
      <Dialog open={!!viewing} onOpenChange={(o) => { if (!o && !busy) { setViewing(null); setAskingChanges(null); } }}>
        <DialogContent className="tracker-modal post-viewer" dir={copy.dir}>
          <DialogHeader className="sr-only"><DialogTitle>{copy.publication}</DialogTitle><DialogDescription>{client.name}</DialogDescription></DialogHeader>
          {(() => { const post = posts.find((p) => p.id === viewing); return post ? <PostCard key={post.id} ctx={ctx} post={post} /> : null; })()}
        </DialogContent>
      </Dialog>
      {editingRequest && <RequestEditDialog key={editingRequest.id} request={editingRequest} projects={projects} busy={busy} mutate={mutate} onClose={() => setEditingRequest(null)} onSaved={() => { setEditingRequest(null); onNotice(t('Demande mise à jour.')); }} />}

      <Dialog open={!!dialog} onOpenChange={(o) => { if (!o && !busy) { setDialog(null); setClip(null); } }}>
        <DialogContent className="tracker-modal post-viewer" dir={copy.dir}>
          <DialogHeader><DialogTitle>{dialog === 'approve' ? copy.approveTitle : copy.changesTitle}</DialogTitle><DialogDescription>{dialog === 'approve' ? copy.approveText(task?.name ?? '') : copy.changesText}</DialogDescription></DialogHeader>
          {dialog === 'approve' ? <label className="portal-confirm"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /><span>{copy.approveConfirm}</span></label>
            : <>
              <label className="form-field"><span>{copy.changesTitle}</span><textarea autoFocus rows={6} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} placeholder={copy.changesPlaceholder} /></label>
              {workspaceId && <div className="form-field"><span>{copy.voice.hint}</span><VoiceRecorder value={clip} onChange={setClip} disabled={busy} labels={copy.voice} /></div>}
            </>}
          {task && dialog === 'changes' && <Rounds ctx={ctx} t={task} />}
          {task && dialog === 'changes' && (task.revisionRound || 0) >= revisionState(task).included && <p className="small-note">{t('Les tours inclus sont utilisés. Cette demande sera chiffrée séparément ; aucun travail payant ne commence sans votre accord.')}</p>}
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <DialogFooter className="modal-footer"><button type="button" className="btn" disabled={busy} onClick={() => setDialog(null)}>{copy.cancel}</button><button className="btn primary" disabled={busy || (dialog === 'approve' && !confirm)} onClick={() => void decide(dialog!)}>{busy ? <Loader2 size={15} className="spin" /> : dialog === 'approve' ? <Check size={15} /> : <Send size={15} />}{dialog === 'approve' ? copy.approveButton : copy.changesButton}</button></DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  </div>;
}

"use client";
import { Children, useEffect, useState, useCallback, useRef, Fragment } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import {
  Home,
  Hourglass,
  Layers,
  ChevronUp,
  Maximize2,
  CheckSquare,
  Users,
  Activity,
  Search,
  Plus,
  ChevronRight,
  ChevronLeft,
  ArrowUpRight,
  ArrowLeft,
  CalendarDays,
  Columns3,
  List,
  FileText,
  Folder,
  Link as LinkIcon,
  Archive,
  Check,
  Clock,
  MoreHorizontal,
  Filter,
  RefreshCw,
  Eye,
  Lock,
  LogOut,
  Loader2,
  UserRound,
  Send,
  Briefcase,
  X,
  CheckCircle2,
  Gauge,
  Inbox,
  Sparkles,
  Bell,
  ShieldCheck,
  Megaphone,
  FileSignature,
  Unlock,
  Trash2,
  PenLine,
  ChevronDown,
  Building2,
  Library,
  CalendarClock,
  MessageSquare,
  ChartNoAxesCombined,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "@/app/locale-provider";
import { setBrand } from "@/app/brand-store";
import SubscriptionPanel, { PlanBanner, type PlanPayload } from "@/app/subscription-panel";
import PlatformPage from "@/app/platform-page";
import BrandSettings from "@/app/brand-settings";
import type { Brand } from "@/lib/branding";
import { AiFix } from "@/app/ai-assist";
import Assistant from "@/app/assistant";
import WorkspaceFrame, {
  type WorkspaceFrameOptions,
} from "@/app/workspace-frame";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
} from "@/components/ui/empty";
import {
  RecordItem,
  Status,
  statuses,
  deliverySteps,
  statusClass,
  dayKey,
  safeLink, Priority,
} from "@/lib/model";
import Login from "@/app/login";
import { signOut } from "@/lib/auth-client";
import Avatar from "@/app/profile-avatar";
import { useActivityBeat } from "@/app/activity-beat";
import { formatDuration } from "@/lib/time";
import TaskChat from "@/app/task-chat";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import MeetingsPage, { CallHost } from "@/app/meetings";
import RequestsInbox from "@/app/requests-inbox";
import IgAnalyzer from "@/app/ig-analyzer";
import DatePicker from "@/app/date-picker";
import TeamPage from "@/app/team";
import {
  memberName,
  canManageMembers,
  canSocial,
  isManager,
  isMemberRole,
  isPrintWorkspaceId,
  isCompanyWorkspaceId,
  type WorkspaceContext,
  type WorkspaceMember,
  type WorkspaceSummary,
  type MemberChange,
  type Invitation,
  isStudioRole,
  roleLabels,
} from "@/lib/workspace";
import type { Slice } from "@/components/dashboard-charts";
import ClientMark from "@/app/client-mark";
import ClientImages from "@/app/client-images";
import ClientDocuments from "@/app/client-documents";
import ContentPlanPage from "@/app/content-plan";
// Screens most people don't open on every visit load on demand, so the sign-in screen and the
// studio's home don't download the portal, the print workspace, charts or the Social hub first.
const PrintWorkspace = dynamic(() => import("@/app/print-workspace"));
const Portal = dynamic(() => import("@/app/portal"));
const ClientBriefBoard = dynamic(() => import("@/app/client-brief"));
const SocialHub = dynamic(() => import("@/app/social-hub"));
const FlowPage = dynamic(() => import("@/app/flow-page"));
const ActivityPage = dynamic(() => import("@/app/activity-page"));
const LibraryPage = dynamic(() => import("@/app/library-page"));
const Annex = dynamic(() => import("@/app/annex"));
const TimeRecords = dynamic(() => import("@/app/time-records"));
// The home charts pull in the charting library: loaded once the home page actually shows them.
const DonutStat = dynamic(() => import("@/components/dashboard-charts").then((m) => m.DonutStat));
const TrendArea = dynamic(() => import("@/components/dashboard-charts").then((m) => m.TrendArea));
import {
  courtOf,
  courtLabels,
  flow,
  gatesFor,
  hoursLeft,
  revisionState,
  insideLock,
  dayIn,
  isEventRecipient,
  isEventUnreadFor,
  isPublishable,
  shiftDay,
  type Court,
} from "@/lib/flow";
type Route = { page: string; id?: string; tab?: string };
const offlineMessage = "Connexion au serveur impossible. Vérifiez votre connexion internet, puis réessayez : votre texte est conservé.";
type Modal = {
  type:
    | "task"
    | "client"
    | "project"
    | "archive"
    | "feedback"
    | "approve"
    | "delete";
  record?: RecordItem;
  status?: Status;
  date?: string;
};
type Form = Record<string, string>;
type Mutation = Record<string, unknown> & {
  data?: Partial<RecordItem>;
  action?: string;
  kind?: string;
};
type ApiPayload = {
  id?: string;
  records: RecordItem[];
  user: { id: string; name: string; email: string; avatar?: string | null };
  workspace: WorkspaceContext;
  members: WorkspaceMember[];
  workspaces: WorkspaceSummary[];
  today?: string;
  mailConfigured?: boolean;
  mediaStorage?: boolean;
  platformOwner?: boolean;
  brand?: Brand;
  plan?: PlanPayload;
  invitation?: Invitation;
  sent?: boolean;
  emailCount?: number;
  whatsapp?: { sent: boolean; error?: string };
  error?: string;
  code?: string;
};
const statusSymbols = ["○", "◐", "‖", "●", "✓"];
const MIN_SIDEBAR_WIDTH = 190;
const MAX_SIDEBAR_WIDTH = 420;
function CourtChip({ task }: { task: RecordItem }) {
  const { t: tr } = useI18n();
  const c: Court = courtOf(task);
  return (
    <span className={`court ${c}`} title={tr("Qui doit agir")}>
      <i />
      {tr(courtLabels[c])}
    </span>
  );
}
// Per-person time-tracking: group raw start/end entries by who logged them, summing closed spans
// plus the live span for anyone still running (nowMs lets the caller freeze or live-tick the total).
function timerTotals(
  entries: { userId: string; name: string; start: string; end?: string }[] = [],
  nowMs: number,
) {
  const byUser = new Map<
    string,
    { userId: string; name: string; ms: number; running: boolean }
  >();
  for (const e of entries) {
    const ms = Math.max(
      0,
      (e.end ? new Date(e.end).getTime() : nowMs) - new Date(e.start).getTime(),
    );
    const prev = byUser.get(e.userId);
    byUser.set(e.userId, {
      userId: e.userId,
      name: e.name,
      ms: (prev?.ms || 0) + ms,
      running: !!prev?.running || !e.end,
    });
  }
  return [...byUser.values()].sort((a, b) => b.ms - a.ms);
}
// Read-only breakdown of the time logged on a task. The clock itself is driven by the task's
// status: moving it to "En cours" starts an entry, moving it away stops it (see `patch`).
function TimeTracker({ task }: { task: RecordItem }) {
  const { t: tr } = useI18n();
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  const totals = timerTotals(task.timeEntries, nowMs);
  return (
    <div className="time-tracker">
      {totals.length > 0 ? (
        <ul className="time-breakdown">
          {totals.map((p) => (
            <li key={p.userId}>
              <span>
                {p.name}
                {p.running ? ` · ${tr("en cours")}` : ""}
              </span>
              <strong>{formatDuration(p.ms)}</strong>
            </li>
          ))}
          {totals.length > 1 && (
            <li className="time-total">
              <span>{tr("Total")}</span>
              <strong>
                {formatDuration(totals.reduce((sum, p) => sum + p.ms, 0))}
              </strong>
            </li>
          )}
        </ul>
      ) : (
        <p className="empty-state">{tr("Aucun temps enregistré pour cette tâche.")}</p>
      )}
    </div>
  );
}
function Chip({ status = "À faire" }: { status?: Status }) {
  const { t: tr } = useI18n();
  return (
    <span className={`status ${statusClass[status]}`}>
      <span aria-hidden="true">{statusSymbols[statuses.indexOf(status)]}</span>
      {tr(status)}
    </span>
  );
}

function StatusPick({
  task,
  disabled,
  allowApproval = true,
  member = false,
  onChange,
}: {
  // Only the status and the name are read, so the inline "new task" row — a partial record that
  // has no id yet — can use the same control as a saved task.
  task: { status?: Status; name?: string };
  disabled?: boolean;
  allowApproval?: boolean;
  member?: boolean;
  onChange: (s: Status) => void;
}) {
  const { t: tr } = useI18n();
  return (
    <Select
      value={task.status || "À faire"}
      disabled={disabled}
      onValueChange={(v) => {
        if (v !== task.status) onChange(v as Status);
      }}
    >
      <SelectTrigger
        aria-label={tr("Changer le statut de {name}", { name: task.name ?? "" })}
        className={`status-pick ${statusClass[task.status || "À faire"]}`}
      >
        <span
          className={`status ${statusClass[task.status || "À faire"]}`}
        >
          <span aria-hidden="true">
            {statusSymbols[statuses.indexOf(task.status || "À faire")]}
          </span>
          {tr(task.status || "À faire")}
          <ChevronDown size={11} className="status-caret" />
        </span>
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {(member
          ? statuses.filter(
              (s) =>
                s === "À faire" ||
                s === "En cours" ||
                s === "En pause" ||
                s === "À valider" ||
                s === task.status,
            )
          : allowApproval
            ? [...statuses]
            : statuses.filter((s) => s !== "À valider" && s !== "Validé")
        ).map((s) => (
          <SelectItem key={s} value={s}>
            <span className="inline">
              <span aria-hidden="true">
                {statusSymbols[statuses.indexOf(s)]}
              </span>
              {tr(s)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function Pick({
  value,
  onChange,
  items,
  label,
  emptyLabel = "—",
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  items: string[] | { value: string; label: string }[];
  label: string;
  emptyLabel?: string;
  disabled?: boolean;
}) {
  const { t: tr } = useI18n();
  return (
    <Select
      disabled={disabled}
      value={value || "__none"}
      onValueChange={(v) => onChange(v === "__none" ? "" : v)}
    >
      <SelectTrigger aria-label={label} className="pick">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none">{emptyLabel}</SelectItem>
        {items.map((i) =>
          typeof i === "string" ? (
            <SelectItem key={i} value={i}>
              {tr(i)}
            </SelectItem>
          ) : (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ),
        )}
      </SelectContent>
    </Select>
  );

}
function AssigneePick({
  value,
  onChange,
  items,
  label,
  emptyLabel = "—",
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  items: { value: string; avatar?: string | null; hint?: string }[];
  label: string;
  emptyLabel?: string;
  disabled?: boolean;
}) {
  return (
    <Select
      disabled={disabled}
      value={value || "__none"}
      onValueChange={(v) => onChange(v === "__none" ? "" : v)}
    >
      <SelectTrigger aria-label={label} className="pick assignee-pick">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none">{emptyLabel}</SelectItem>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>
            <span className="inline">
              <Avatar name={i.value} avatar={i.avatar} />
              {i.value}
              {i.hint && <small className="assignee-hint">{i.hint}</small>}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function Blank({
  title = "Aucun élément",
  text = "Les éléments apparaîtront ici.",
  action,
}: {
  title?: string;
  text?: string;
  action?: React.ReactNode;
}) {
  const { t: tr } = useI18n();
  return (
    <Empty className="empty-state">
      <EmptyHeader>
        <EmptyMedia>
          <CheckSquare size={32} />
        </EmptyMedia>
        <EmptyTitle>{tr(title)}</EmptyTitle>
        <EmptyDescription>{tr(text)}</EmptyDescription>
      </EmptyHeader>
      {action}
    </Empty>
  );
}
function NavItem({
  icon: Icon,
  label,
  onClick,
  active,
  badge,
  badgeTitle,
  badgeTone,
  mark,
  dragId,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  active?: boolean;
  badge?: number;
  badgeTitle?: string;
  badgeTone?: "client";
  mark?: React.ReactNode;
  dragId?: string;
}) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenuItem
      draggable={!!dragId}
      onDragStart={dragId ? (e) => { e.dataTransfer.setData("text/plain", dragId); e.currentTarget.style.opacity = "0.5"; } : undefined}
      onDragEnd={dragId ? (e) => { e.currentTarget.style.opacity = "1"; } : undefined}
    >
      <SidebarMenuButton
        isActive={active}
        onClick={() => {
          onClick();
          setOpenMobile(false);
        }}
        className="nav-item"
      >
        {mark ?? <Icon strokeWidth={1.5} />}
        <span>{label}</span>
        {!!badge && (
          <span className={`counter${badgeTone ? ` counter-${badgeTone}` : ""}`} title={badgeTitle} aria-label={badgeTitle}>
            {badgeTone === "client" && <Hourglass size={11} aria-hidden="true" />}
            {badge}
          </span>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
type QuickFilter = "" | "active" | "mine" | "late" | "week" | "review" | "nodate";
type GroupBy = "none" | "status" | "client" | "assignee" | "due";
const navGroupsKey = "the-one.nav-groups";
/** Which sidebar groups are folded, remembered in this browser: group id → the page it was folded on. */

const navLayoutKey = "the-one.nav-layout";
function useNavLayout() {
  const [layout, setLayout] = useState(() => {
    try {
      const stored = localStorage.getItem(navLayoutKey);
      if (stored) return JSON.parse(stored);
    } catch {}
    return {
      tasks: "work", internal: "work", requests: "work",
      social: "content", ig: "content", library: "content",
      meetings: "studio", team: "studio", activity: "studio", platform: "studio"
    };
  });
  return [layout, (l: Record<string, string>) => { setLayout(l); localStorage.setItem(navLayoutKey, JSON.stringify(l)); }];
}

function useNavGroups() {
  const [closed, setClosed] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem(navGroupsKey) || "{}"); } catch { return {}; }
  });
  const toggle = useCallback((id: string, open: boolean, here: string) => {
    setClosed((current) => {
      const next = { ...current };
      if (open) next[id] = here; else delete next[id];
      try { localStorage.setItem(navGroupsKey, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, []);
  return { closed, toggle };
}
/**
 * A folding group of the sidebar. Open unless folded; a folded group opens again by itself when you
 * reach one of its pages from elsewhere. Folded, it shows the sum of its counters. Empty groups (nothing
 * for this role) aren't drawn.
 */
function NavGroup({ id, label, badge, badgeTitle, active, here, closedAt, onToggle, action, children, onDropItem }: {
  id: string; label: string; badge: number; badgeTitle?: string; active: boolean; here: string; closedAt?: string;
  onToggle: (id: string, open: boolean, here: string) => void; action?: React.ReactNode; children: React.ReactNode;
  onDropItem?: (itemId: string, groupId: string) => void;
}) {
  const items = Children.toArray(children);
  if (!items.length && !onDropItem) return null;
  const open = closedAt === undefined || (active && closedAt !== here);
  return (
    <SidebarGroup 
      className={`nav-group${open ? " open" : ""}`}
      onDragOver={onDropItem ? (e) => { e.preventDefault(); e.currentTarget.classList.add("drop-target"); } : undefined}
      onDragLeave={onDropItem ? (e) => { e.currentTarget.classList.remove("drop-target"); } : undefined}
      onDrop={onDropItem ? (e) => {
        e.preventDefault();
        e.currentTarget.classList.remove("drop-target");
        const itemId = e.dataTransfer.getData("text/plain");
        if (itemId && onDropItem) onDropItem(itemId, id);
      } : undefined}
    >
      <div className="nav-group-head">
        <button type="button" className="nav-group-toggle" aria-expanded={open} onClick={() => onToggle(id, open, here)}>
          <span>{label}</span>
          {!open && badge > 0 && <span className={`counter${id === "clients" ? " counter-client" : ""}`} title={badgeTitle}>{id === "clients" && <Hourglass size={11} aria-hidden="true" />}{badge}</span>}
          <ChevronRight size={15} className="nav-group-chevron" aria-hidden="true" />
        </button>
        {action}
      </div>
      {open && <SidebarMenu>{items}</SidebarMenu>}
    </SidebarGroup>
  );
}
function Heading({
  emoji,
  title,
  subtitle,
  action,
  mark,
}: {
  emoji: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  mark?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      {mark ?? (
        <span className="page-symbol" aria-hidden="true">
          {emoji === "🗂️" ? (
            <Users size={22} />
          ) : emoji === "✅" ? (
            <CheckSquare size={22} />
          ) : (
            <Folder size={22} />
          )}
        </span>
      )}
      <div className="heading-line">
        <h1>{title}</h1>
        {action}
      </div>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}

export default function Tracker() {
  const { t: tr, tag, rtl } = useI18n();
  const [records, setRecords] = useState<RecordItem[]>([]),
    [user, setUser] = useState<{
      id: string;
      name: string;
      email: string;
      avatar?: string | null;
    }>({ id: "", name: "", email: "" }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [auth, setAuth] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceContext | null>(null),
    [members, setMembers] = useState<WorkspaceMember[]>([]),
    [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  // Id of the workspace switchWorkspace() is mid-request for, so render can show a neutral loading
  // screen instead of the workspace being left — `workspace` state doesn't update to the new one
  // until its load() resolves, so without this the old workspace's UI stays on screen meanwhile.
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const switchingRef = useRef<string | null>(null);
  const [today, setToday] = useState(() => dayIn(new Date()));
  const [lockPrompt, setLockPrompt] = useState<Mutation | null>(null),
    [courtFilter, setCourtFilter] = useState(""),
    [noAccess, setNoAccess] = useState(false),
    [changePassword, setChangePassword] = useState(false),
    [mailConfigured, setMailConfigured] = useState(false),
    [platformOwner, setPlatformOwner] = useState(false),
    [plan, setPlan] = useState<PlanPayload | null>(null),
    [mediaStorage, setMediaStorage] = useState(false);
  const [clientNotice, setClientNotice] = useState<{ id: string; name: string } | null>(null);
  const [clientNoticeNews, setClientNoticeNews] = useState("");
  const [clientNoticeBusy, setClientNoticeBusy] = useState(false);
  const [clientNoticeError, setClientNoticeError] = useState("");
  const [clientNoticeSent, setClientNoticeSent] = useState(0);
  const workspaceIdRef = useRef<string | null>(null);
  // load() reads the translator through a ref so its identity never changes: the UI language resolves
  // after mount, and a load() recreated by that used to re-run the initial fetch a second time.
  const trRef = useRef(tr);
  useEffect(() => {
    trRef.current = tr;
  }, [tr]);
  // Non-silent loads in flight. `loading` stays on until the last of them settles, so a superseded
  // request (dropped as stale below) can't switch it off while its successor is still running.
  const pendingLoadsRef = useRef(0);
  // Bumped on every load() call; a response only gets applied if it's still the latest one issued.
  // Without this, a slow background poll for the workspace you just switched *away* from can resolve
  // after the switch's own request and silently overwrite it back — the fetches race, not the state.
  // mutate() has its own analogous guard, keyed off workspaceIdRef instead (see mutate() below).
  const loadSeqRef = useRef(0);
  const etagRef = useRef<string | null>(null);
  // Ids of studio alert events already seen, so polling only toasts genuinely new ones.
  const knownAlertIdsRef = useRef<Set<string> | null>(null);
  const [route, setRoute] = useState<Route>({ page: "home" }),
    [view, setView] = useState("table"),
    [query, setQuery] = useState(""),
    [statusFilter, setStatusFilter] = useState<Status | "">(""),
    [assigneeFilter, setAssigneeFilter] = useState(""),
    [filterOpen, setFilterOpen] = useState(false),
    [sort, setSort] = useState("due"),
    // The task list's quick chip, grouping (and folded groups), and the task open in the side panel.
    [quick, setQuick] = useState<QuickFilter>(""),
    [groupBy, setGroupBy] = useState<GroupBy>("none"),
    [folded, setFolded] = useState<Set<string>>(() => new Set()),
    [peekId, setPeekId] = useState<string | null>(null),
    [showArchived, setShowArchived] = useState(false),
    [month, setMonth] = useState(
      () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    ),
    [calendarMode, setCalendarMode] = useState("month");
  const [inlineTask, setInlineTask] = useState<Partial<RecordItem> & { view?: string } | null>(null);
  const [modal, setModal] = useState<Modal | null>(null),
    [form, setForm] = useState<Form>({}),
    [formError, setFormError] = useState(""),
    [searchOpen, setSearchOpen] = useState(false),
    [globalQuery, setGlobalQuery] = useState("");
  // The sidebar width is a per-browser convenience, remembered locally per person. Starting from
  // the static default (not reading localStorage here) keeps the server and the first client
  // render identical; the stored width is applied client-side just after mount.
  const [sidebarWidth, setSidebarWidth] = useState(260);
  // Kanban drag feedback: which card is being dragged, and which column it's currently over.
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null),
    [dragOverStatus, setDragOverStatus] = useState<string | null>(null);
  useEffect(() => {
    let saved = NaN;
    try {
      saved = Number(localStorage.getItem("the-one.sidebarWidth"));
    } catch {
      /* private mode */
    }
    if (saved >= MIN_SIDEBAR_WIDTH && saved <= MAX_SIDEBAR_WIDTH) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only localStorage read after mount
      setSidebarWidth(saved);
    }
  }, []);
  const onSidebarResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = sidebarWidth;
      let current = startWidth;
      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        current = Math.min(
          MAX_SIDEBAR_WIDTH,
          Math.max(MIN_SIDEBAR_WIDTH, startWidth + (rtl ? -delta : delta)),
        );
        setSidebarWidth(current);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        try {
          localStorage.setItem("the-one.sidebarWidth", String(current));
        } catch {
          /* private mode */
        }
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [sidebarWidth, rtl],
  );
  const navigate = useCallback((r: Route) => {
    setRoute(r);
    setQuery("");
    setQuick("");
    setPeekId(null);
    setStatusFilter("");
    setAssigneeFilter("");
    setShowArchived(false);
    setCourtFilter("");
    setFormError("");
    window.location.hash = [r.page, r.id || "", r.tab || ""]
      .map(encodeURIComponent)
      .join("/");
    window.scrollTo(0, 0);
  }, []);
  useEffect(() => {
    const read = () => {
      const [page, id, tab] = window.location.hash
        .slice(1)
        .split("/")
        .map((part) => {
          try {
            return decodeURIComponent(part);
          } catch {
            return "";
          }
        });
      if (page) setRoute({ page, id, tab });
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  // Studio members without management rights have no pilotage, annex or portal preview. Clients live in the portal and keep those routes.
  // Time in, time out and time on screen, for the owner's « Activité » page.
  useActivityBeat(workspace?.id);
  // Synchronize the externally loaded role with browser navigation.
  useEffect(() => {
    if (!workspace) return;
    const role = workspace.role;
    if (
      role !== "client" &&
      !isManager(role) &&
      ["flow", "annex", "portal", "review"].includes(route.page)
    )
      // eslint-disable-next-line react-hooks/set-state-in-effect -- redirect after external membership resolves
      navigate({ page: "home" });
    if (role !== "owner" && route.page === "activity")
      navigate({ page: "home" });
    if (!canSocial(role) && (route.page === "social" || (route.page === "client" && route.tab === "editorial")))
      navigate({ page: "home" });
    if (role === "client" && !["portal", "review"].includes(route.page))
      navigate({ page: "portal", id: workspace.clientId || "", tab: "home" });
  }, [workspace, route.page, route.tab, navigate]);
  const load = useCallback(
    async (silent = false) => {
      const seq = ++loadSeqRef.current;
      if (!silent) {
        pendingLoadsRef.current += 1;
        setLoading(true);
        setError("");
      }
      try {
        if (!workspaceIdRef.current) {
          try {
            workspaceIdRef.current =
              sessionStorage.getItem("the-one.workspace");
          } catch {
            /* private mode */
          }
        }
        const res = await fetch("/api/records", {
          headers: {
            ...(workspaceIdRef.current ? { "X-Workspace-Id": workspaceIdRef.current } : {}),
            // A background poll asks "anything new?": 304 means no, and nothing is re-rendered.
            ...(silent && etagRef.current ? { "If-None-Match": etagRef.current } : {}),
          },
        });
        if (res.status === 304) return;
        const data: ApiPayload = await res.json();
        // A newer load() has started since this one was sent (e.g. a workspace switch, or the next
        // background poll) — its response will land separately; applying this older one now would
        // clobber fresher state with stale data, so just drop it.
        if (seq !== loadSeqRef.current) return;
        if (res.status === 401) {
          if (silent) return;
          setAuth(true);
          setRecords([]);
          setMembers([]);
          setWorkspace(null);
          workspaceIdRef.current = null;
          try {
            sessionStorage.removeItem("the-one.workspace");
          } catch {
            /* private mode */
          }
          return;
        }
        if (res.status === 403) {
          if (silent) return;
          setRecords([]);
          setMembers([]);
          setWorkspace(null);
          workspaceIdRef.current = null;
          try {
            sessionStorage.removeItem("the-one.workspace");
          } catch {
            /* private mode */
          }
          if (data.code === "no-workspace") {
            setNoAccess(true);
            return;
          }
          if (data.code === "password-change-required") {
            setChangePassword(true);
            return;
          }
        }
        if (!res.ok) throw Error(data.error);
        // Instant-enough alerts: toast any studio event (new client, new assignment, a comment…)
        // that showed up since the last poll, without re-alerting on ones already seen or read.
        // client-added stays a broadcast; task-assigned/comment only toast for their actual recipient.
        const alerts = data.records.filter(
          (r) =>
            r.kind === "event" &&
            r.audience !== "client" &&
            isEventUnreadFor(r, data.user.id) &&
            (r.type === "client-added" ||
              ((r.type === "task-assigned" || r.type === "comment") && isEventRecipient(r, data.user.id))),
        );
        const seen = knownAlertIdsRef.current;
        if (seen) {
          const fresh = alerts.filter((r) => !seen.has(r.id));
          if (fresh.length === 1) setNotice(fresh[0].name);
          else if (fresh.length > 1)
            setNotice(trRef.current("{n} nouvelles notifications", { n: fresh.length }));
        }
        knownAlertIdsRef.current = new Set(alerts.map((r) => r.id));
        etagRef.current = res.headers.get("ETag");
        setRecords(data.records);
        setUser(data.user);
        setWorkspace(data.workspace);
        setMembers(data.members);
        setWorkspaces(data.workspaces || []);
        if (data.today) setToday(data.today);
        if (typeof data.mailConfigured === "boolean")
          setMailConfigured(data.mailConfigured);
        if (typeof data.platformOwner === "boolean")
          setPlatformOwner(data.platformOwner);
        if (typeof data.mediaStorage === "boolean") setMediaStorage(data.mediaStorage);
        if (data.brand) setBrand({ ...data.brand, company: isCompanyWorkspaceId(data.workspace.id) });
        setPlan(data.plan ?? null);
        workspaceIdRef.current = data.workspace.id;
        try {
          sessionStorage.setItem("the-one.workspace", data.workspace.id);
        } catch {
          /* private mode */
        }
        setAuth(false);
        setNoAccess(false);
        setChangePassword(false);
      } catch (e) {
        if (!silent)
          setError(e instanceof Error && e.message ? e.message : "Chargement impossible.");
      } finally {
        if (!silent) {
          pendingLoadsRef.current -= 1;
          if (pendingLoadsRef.current === 0) setLoading(false);
        }
      }
    },
    [],
  );
  // Initial authenticated fetch synchronizes the UI with the server.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial external data fetch
    void load();
  }, [load]);
  // Poll for new studio alerts (client added, task assigned…) while the tab is open and visible.
  // Paused during a workspace switch: a poll issued after the switch's own request would make that
  // request "stale" (see loadSeqRef) and the switch screen would drop before the target arrived.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible" && workspaceIdRef.current && !switchingRef.current)
        void load(true);
    }, 5000);
    return () => clearInterval(id);
  }, [load]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  async function mutate(body: unknown) {
    setBusy(true);
    setError("");
    const requestedWorkspaceId = workspaceIdRef.current;
    try {
      // A dropped connection makes fetch throw « Failed to fetch »: say what happened, in words.
      const res = await fetch("/api/records", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(requestedWorkspaceId
            ? { "X-Workspace-Id": requestedWorkspaceId }
            : {}),
        },
        body: JSON.stringify(body),
      }).catch(() => { throw new Error(offlineMessage); });
      const data: ApiPayload = await res.json().catch(() => ({ error: res.ok ? undefined : offlineMessage }) as ApiPayload);
      // This save was sent against whatever workspace was active when it started. If a switch has
      // since moved on, applying this response now would silently drag the UI back to the workspace
      // it was for — so the caller still gets its result, but shared state doesn't.
      const current = workspaceIdRef.current === requestedWorkspaceId;
      if (res.status === 401 && current) {
        setAuth(true);
        setRecords([]);
        setMembers([]);
        setWorkspace(null);
        workspaceIdRef.current = null;
      }
      if (!res.ok) {
        const err = Error(data.error) as Error & { code?: string };
        err.code = data.code;
        throw err;
      }
      if (current) {
        if (Array.isArray(data.records)) setRecords(data.records);
        if (data.members) setMembers(data.members);
        if (data.workspace) {
          setWorkspace(data.workspace);
          workspaceIdRef.current = data.workspace.id;
          try {
            sessionStorage.setItem("the-one.workspace", data.workspace.id);
          } catch {
            /* private mode */
          }
        }
        if (data.workspaces) setWorkspaces(data.workspaces);
        if (data.today) setToday(data.today);
        if (data.brand && data.workspace) setBrand({ ...data.brand, company: isCompanyWorkspaceId(data.workspace.id) });
        if (data.workspace) setPlan(data.plan ?? null);
      }
      return data;
    } finally {
      setBusy(false);
    }
  }
  // J−7 lock: an admin gets a confirmation instead of a dead end.
  async function save(body: Mutation) {
    try {
      return await mutate(body);
    } catch (e) {
      if (
        (e as { code?: string }).code === "lock" &&
        workspace &&
        canManageMembers(workspace.role)
      )
        setLockPrompt(body);
      throw e;
    }
  }
  async function switchWorkspace(id: string) {
    workspaceIdRef.current = id;
    switchingRef.current = id;
    setSwitchingTo(id);
    navigate({ page: "home" });
    try {
      await load();
    } finally {
      switchingRef.current = null;
      setSwitchingTo(null);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      await signOut();
    } catch (e) {
      setError(tr((e as Error).message));
      setBusy(false);
    }
  }
  async function changeMember(change: MemberChange) {
    const data = await mutate(change);
    setNotice(
      tr(
        change.action === "remove-member"
          ? "Accès retiré. Les contributions sont conservées."
          : change.action === "invite-member"
            ? data?.invitation?.sent
              ? "Invitation envoyée."
              : "Accès créé."
            : change.action === "renew-invitation"
              ? data?.invitation?.sent
                ? "Nouveau mot de passe temporaire envoyé."
                : "Nouveau mot de passe temporaire généré."
              : change.action === "set-member-titles"
                ? "Métiers mis à jour."
                : change.action === "set-print-access"
                  ? "Accès Impression mis à jour."
                  : "Rôle mis à jour.",
      ),
    );
    return data?.invitation;
  }
  const clean = (r: RecordItem) => {
    const d: Record<string, unknown> = { ...r };
    [
      "id",
      "kind",
      "revision",
      "createdAt",
      "history",
      "sentAt",
      "validatedAt",
      "author",
      "approvalDueAt",
      "revisionRound",
      "signOff",
      "publishedAt",
      "lockOverride",
      "reminders",
      "request",
      "timeEntries",
    ].forEach((k) => delete d[k]);
    return d;
  };
  async function update(
    r: RecordItem,
    changes: Partial<RecordItem>,
    message = tr("Modification enregistrée"),
  ) {
    try {
      const saved = await save({
        action: "update",
        id: r.id,
        kind: r.kind,
        revision: r.revision,
        data: { ...clean(r), ...changes },
      });
      setNotice(message);
      // Sending a task for approval can also message the client on WhatsApp; say what happened.
      if (saved?.whatsapp) {
        if (saved.whatsapp.sent) setNotice(tr("Envoyé en validation · client prévenu sur WhatsApp"));
        else setError(tr(saved.whatsapp.error || "L’envoi WhatsApp a échoué."));
      }

      if (changes.status && changes.status !== r.status) {
        // Leaving « En cours » stops every clock on the task server-side, as part of the save.
        if (changes.status === "En cours") {
          await act({ action: "start-timer", taskId: r.id }, tr("Chronomètre démarré"));
        } else if (changes.status === "En pause") {
          setNotice(tr("Tâche en pause · chronomètre arrêté"));
        } else if (r.status === "En cours" && !saved?.whatsapp) {
          setNotice(tr("Chronomètre arrêté"));
        }
      }

      return true;
    } catch (e) {
      setError(tr((e as Error).message));
      return false;
    }
  }
  async function act(body: Mutation, message: string) {
    try {
      await mutate(body);
      setNotice(message);
      return true;
    } catch (e) {
      setError(tr((e as Error).message));
      return false;
    }
  }
  const clients = records.filter((r) => r.kind === "client"),
    projects = records.filter((r) => r.kind === "project");
  const owner = workspace?.role === "owner";
  const writable =
    !!workspace &&
    (["owner", "admin"].includes(workspace.role) ||
      isMemberRole(workspace.role));
  // Who runs the Social hub (posts, scheduling, statistics): owner, admins, social media managers.
  const social = !!workspace && canSocial(workspace.role);
  const reloadSilently = useCallback(() => void load(true), [load]);
  const navGroups = useNavGroups();
  const [navLayout, setNavLayout] = useNavLayout();
  
  // Tasks ticked in the table, for deleting several at once.
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(() => new Set());
  const manager = !!workspace && isManager(workspace.role),
    member = !!workspace && isMemberRole(workspace.role);
  // A member's only edit on a task is the deliverable link; every other field stays locked.
  const memberTaskOnly = member && modal?.type === "task" && !!modal.record;
  const archived = (r: RecordItem) =>
    !!r.archived ||
    !!clients.find((c) => c.id === r.clientId)?.archived ||
    !!projects.find((p) => p.id === r.projectId)?.archived;
  const tasks = records.filter((r) => r.kind === "task" && !archived(r));
  const allTasks = records.filter((r) => r.kind === "task");
  const assigneeOptions = [
    ...new Set([
      ...members.filter((m) => isStudioRole(m.role)).map(memberName),
      ...allTasks.map((t) => t.assignee || "").filter(Boolean),
    ]),
  ];
  const client = clients.find((c) => c.id === route.id) || null;
  const task = allTasks.find((t) => t.id === route.id) || null;
  const currentClient =
    route.page === "portal"
      ? clients.find((c) => c.id === route.id)
      : route.page === "review"
        ? clients.find((c) => c.id === task?.clientId)
        : client;
  const portal = route.page === "portal" || route.page === "review";
  const reviewTasks = tasks.filter((t) => t.status === "À valider"),
    late = tasks.filter((t) => t.due && t.due < today && t.status !== "Validé");
  const cname = (id?: string) =>
    id === "internal" ? "Agence" : clients.find((c) => c.id === id)?.name || tr("Client");
  const avatarOf = (name?: string) =>
    name
      ? members.find((m) => memberName(m) === name || m.email === name)?.avatar
      : undefined;
  const titlesOf = (name?: string) =>
    (name && members.find((m) => memberName(m) === name || m.email === name)?.titles) || [];
  const pname = (id?: string) =>
    projects.find((p) => p.id === id)?.name || tr("Aucun sous-projet");
  const dateLabel = (date?: string) =>
    date
      ? new Date(date + "T12:00:00").toLocaleDateString(tag, {
          day: "numeric",
          month: "short",
        })
      : tr("Sans date");
  const timeLabel = (date?: string) =>
    date
      ? new Date(date).toLocaleString(tag, {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit", hourCycle: "h23",
        })
      : "";
  const link = (t: RecordItem) => safeLink(t.deliverable || "");
  const baseFiltered = (() => {
    let list = allTasks.filter((t) =>
      showArchived ? archived(t) : !archived(t),
    );
    if (route.page === "client")
      list = list.filter((t) => t.clientId === route.id);
    if (route.page === "internal")
      list = list.filter((t) => t.clientId === "internal");
    if (route.page === "tasks" && route.tab !== "all")
      list = list.filter((t) => t.clientId !== "internal");
    if (statusFilter) list = list.filter((t) => t.status === statusFilter);
    if (assigneeFilter)
      list = list.filter((t) => t.assignee === assigneeFilter);
    if (courtFilter) list = list.filter((t) => courtOf(t) === courtFilter);
    if (query)
      list = list.filter((t) =>
        `${t.name} ${cname(t.clientId)} ${t.assignee}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      );
    return list.sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name, tag)
        : sort === "status"
          ? statuses.indexOf(a.status!) - statuses.indexOf(b.status!)
          : (a.due || "9999").localeCompare(b.due || "9999"),
    );
  })();
  // Quick chips on the task list (Mes tâches, En retard…), counted on the list as filtered above.
  const isMineTask = (t: RecordItem) =>
    t.assigneeId ? t.assigneeId === user.id : !!t.assignee && [user.name, user.email].some((v) => v && v.toLowerCase() === t.assignee!.trim().toLowerCase());
  const quickTests: Record<Exclude<QuickFilter, "">, (t: RecordItem) => boolean> = {
    active: (t) => t.status !== "Validé",
    mine: isMineTask,
    late: (t) => !!t.due && t.due < today && t.status !== "Validé",
    week: (t) => !!t.due && t.due >= today && t.due <= shiftDay(today, 6) && t.status !== "Validé",
    review: (t) => t.status === "À valider",
    nodate: (t) => !t.due && t.status !== "Validé",
  };
  const filtered = quick ? baseFiltered.filter(quickTests[quick]) : baseFiltered;
  // In the task side panel, ↑/↓ (or k/j) go to the previous/next task of the list; not while typing.
  const peekList = useRef<string[]>([]);
  useEffect(() => { peekList.current = filtered.map((t) => t.id); });
  useEffect(() => {
    if (!peekId) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      const step = e.key === "ArrowDown" || e.key === "j" ? 1 : e.key === "ArrowUp" || e.key === "k" ? -1 : 0;
      if (!step) return;
      const ids = peekList.current, next = ids[ids.indexOf(peekId) + step];
      if (next) { e.preventDefault(); setPeekId(next); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [peekId]);
  function open(
    type: Modal["type"],
    record?: RecordItem,
    defaults: { status?: Status; date?: string } = {},
  ) {
    if (!writable) {
      setError(tr("Votre rôle est en lecture seule."));
      return;
    }
    if (type === "client" && !record && !owner) {
      setError(tr("Seul le propriétaire peut ajouter des clients."));
      return;
    }
    if (type === "client" && record && !manager) {
      setError(
        tr(
          "Seuls le propriétaire et les administrateurs peuvent modifier la fiche d’un client.",
        ),
      );
      return;
    }
    if (type === "task" && !record && (!workspace || !manager)) {
      setError(
        tr("Les tâches sont créées par le propriétaire ou un administrateur."),
      );
      return;
    }
    setModal({ type, record, ...defaults });
    setFormError("");
    setForm(
      record
        ? ({
            ...Object.fromEntries(
              Object.entries(clean(record)).filter(
                ([, v]) => typeof v === "string",
              ),
            ),
            evergreen: record.evergreen ? "true" : "",
            publishable: record.publishable === false ? "false" : "",
            postApproval: record.postApproval ? "true" : "",
            ...(type === "client" && record.brief ? { description: record.brief.overview } : {}),
          } as Form)
        : (() => {
            const clientId = route.page === "internal" ? "internal" : (client?.id || clients.find((c) => !c.archived)?.id || "");
            return {
              clientId,
              projectId:
                projects.find((p) => p.clientId === clientId && !p.archived)
                  ?.id || "",
              name: "",
              status: defaults.status || "À faire",
              source: "",
              due: defaults.date || shiftDay(today, flow.lockDays + 1),
              assignee: "",
              description: "",
              language: "Français",
            };
          })(),
    );
  }
  const set = (key: string, value: string) =>
    setForm((p) => ({
      ...p,
      [key]: value,
      ...(key === "clientId"
        ? {
            projectId:
              projects.find((x) => x.clientId === value && !x.archived)?.id ||
              "",
          }
        : {}),
    }));
    async function submitInlineTask() {
    if (!inlineTask || !inlineTask.name?.trim()) {
      setInlineTask(null);
      return;
    }
    setBusy(true);
    try {
      const data: Record<string, unknown> = {
        name: inlineTask.name.trim(),
        clientId: inlineTask.clientId || "internal",
        projectId: inlineTask.projectId || "",
        priority: inlineTask.priority || "Moyenne",
        status: inlineTask.status || "À faire",
        assignee: inlineTask.assignee || "",
        due: inlineTask.due || "",
        evergreen: false,
        publishable: true,
      };
      const result = await save({ action: "create", kind: "task", id: crypto.randomUUID(), data });
      setInlineTask(null);
      setNotice(tr("Tâche ajoutée"));
      // Navigate to the new task so the user can fill in more details if needed
      if (result?.id) navigate({ page: "task", id: result.id });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }


  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!modal) return;
    setFormError("");
    try {
      if (modal.type === "archive") {
        await mutate({
          action: "update",
          id: modal.record!.id,
          kind: modal.record!.kind,
          revision: modal.record!.revision,
          data: { ...clean(modal.record!), archived: !modal.record!.archived },
        });
        setModal(null);
        setNotice(
          tr(modal.record!.archived ? "Élément restauré" : "Élément archivé"),
        );
        return;
      }
      if (modal.type === "delete") {
        const t = modal.record!;
        await mutate({
          action: "delete",
          kind: t.kind,
          id: t.id,
          revision: t.revision,
        });
        setModal(null);
        setNotice(
          tr(
            t.kind === "client" ? "Client supprimé" : "Tâche supprimée",
          ),
        );
        if (route.page === "task" && route.id === t.id)
          navigate({ page: "tasks" });
        if (route.page === "client" && route.id === t.id)
          navigate({ page: "clients" });
        return;
      }
      if (modal.type === "feedback" || modal.type === "approve") {
        const t = modal.record!;
        if (modal.type === "feedback" && !form.feedback?.trim())
          throw Error(tr("Précisez les modifications demandées."));
        const status = modal.type === "approve" ? "Validé" : "En cours";
        // Studio preview actions are explicitly attributed to the signed-in owner.
        if (modal.type === "feedback")
          await mutate({
            action: "request-changes",
            taskId: t.id,
            text: form.feedback,
          });
        else await mutate({ action: "approve", taskId: t.id });
        void status;
        setModal(null);
        setNotice(
          tr(
            modal.type === "approve"
              ? "Validation enregistrée depuis le studio · reçu créé"
              : "Retours enregistrés · tour de modifications compté",
          ),
        );
        return;
      }
      const data: Record<string, unknown> = { ...form };
      if (modal.type === "task") {
        if (!data.clientId) throw Error(tr("Choisissez un client."));
        data.evergreen = form.evergreen === "true";
        data.publishable = form.publishable !== "false";
      } else {
        delete data.evergreen;
        delete data.publishable;
      }
      if (modal.type === "client") data.postApproval = form.postApproval === "true";
      else delete data.postApproval;
      const result = await save({
        action: modal.record ? "update" : "create",
        kind: modal.type,
        id: modal.record?.id,
        revision: modal.record?.revision,
        data,
      });
      setModal(null);
      setNotice(
        tr(
          modal.record ? "Modifications enregistrées" : "Création enregistrée",
        ),
      );
      if (result?.whatsapp) {
        if (result.whatsapp.sent) setNotice(tr("Envoyé en validation · client prévenu sur WhatsApp"));
        else setError(tr(result.whatsapp.error || "L’envoi WhatsApp a échoué."));
      }
      if (modal.type === "client") navigate({ page: "client", id: result.id });
      if (modal.type === "task") navigate({ page: "task", id: result.id });
    } catch (e) {
      setFormError(tr((e as Error).message));
    }
  }
  useEffect(() => {
    const mc = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: { signal: AbortSignal },
          ) => unknown;
        };
      }
    ).modelContext;
    if (!mc?.registerTool) return;
    const lifecycle = new AbortController();
    const tool = {
      name: "list_tracker_tasks",
      title: tr("Lister les tâches"),
      description: tr(
        "Lire les tâches actives de l’espace, éventuellement filtrées par statut.",
      ),
      inputSchema: {
        type: "object",
        properties: { status: { type: "string", enum: [...statuses] } },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute(input: unknown) {
        const i = input as { status?: Status };
        if (
          !i ||
          typeof i !== "object" ||
          Object.keys(i).some((k) => k !== "status") ||
          (i.status && !statuses.includes(i.status))
        )
          throw Error(tr("Filtre invalide"));
        return tasks
          .filter((t) => !i.status || t.status === i.status)
          .map((t) => ({
            id: t.id,
            name: t.name,
            status: t.status,
            due: t.due,
          }));
      },
    };
    try {
      Promise.resolve(
        mc.registerTool(tool, { signal: lifecycle.signal }),
      ).catch(() => {});
    } catch {}
    return () => lifecycle.abort();
  }, [tasks, tr]);
  function renderTaskRows({
    items,
    compact = false,
  }: {
    items: RecordItem[];
    compact?: boolean;
  }) {
    return items.length ? (
      <div className="task-rows">
        {items.map((t) => (
          <button
            className="task-line"
            key={t.id}
            onClick={() => navigate({ page: "task", id: t.id })}
          >
            <span className="task-line-icon">
              <FileText size={16} />
            </span>
            <span className="task-line-name">
              <strong>{t.name}</strong>
              <small>
                {cname(t.clientId)}
                {!compact && ` / ${pname(t.projectId)}`}
              </small>
            </span>
            <Chip status={t.status} />
            <CourtChip task={t} />
            <span className="task-line-assignee">
              <Avatar name={t.assignee} avatar={avatarOf(t.assignee)} />
            </span>
            <span
              className={`due ${t.due && t.due < today && t.status !== "Validé" ? "overdue" : ""}`}
            >
              {dateLabel(t.due)}
            </span>
            <ChevronRight size={15} />
          </button>
        ))}
      </div>
    ) : (
      <Blank
        title={tr("Tout est à jour")}
        text={tr("Aucune tâche dans cette sélection.")}
      />
    );
  }
  // ---- the task list: due dates in words, groups, quick chips, and the side panel
  const dueInfo = (t: RecordItem): { tone: "none" | "done" | "late" | "today" | "soon" | "later"; label: string } => {
    if (!t.due) return { tone: "none", label: tr("Sans date") };
    if (t.status === "Validé") return { tone: "done", label: dateLabel(t.due) };
    const days = Math.round((Date.parse(`${t.due}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
    if (days < 0) return { tone: "late", label: tr("En retard · {n} j", { n: -days }) };
    if (days === 0) return { tone: "today", label: tr("Aujourd’hui") };
    if (days === 1) return { tone: "soon", label: tr("Demain") };
    return { tone: days <= 6 ? "soon" : "later", label: dateLabel(t.due) };
  };
  const duePill = (t: RecordItem) => {
    const d = dueInfo(t);
    return <span className={`due-pill ${d.tone}`}>{d.tone === "late" && <Clock size={11} />}{d.label}</span>;
  };
  function groupTasks(items: RecordItem[]): { key: string; label: string; mark?: React.ReactNode; items: RecordItem[] }[] {
    const out = new Map<string, { key: string; label: string; mark?: React.ReactNode; items: RecordItem[]; order: string }>();
    for (const t of items) {
      let key: string, label: string, order: string, mark: React.ReactNode = null;
      if (groupBy === "status") { const s = t.status ?? "À faire"; key = `s:${s}`; label = tr(s); order = String(statuses.indexOf(s)).padStart(2, "0"); mark = <Chip status={s} />; label = ""; }
      else if (groupBy === "client") { const c = clients.find((x) => x.id === t.clientId); key = `c:${t.clientId}`; label = cname(t.clientId); order = t.clientId === "internal" ? "0" : `1${label.toLowerCase()}`; mark = c ? <ClientMark name={c.name} logo={c.logo} size="sm" /> : null; }
      else if (groupBy === "assignee") { key = `a:${t.assignee || ""}`; label = t.assignee || tr("Non assigné"); order = t.assignee ? `0${label.toLowerCase()}` : "1"; mark = <Avatar name={t.assignee} avatar={avatarOf(t.assignee)} />; }
      else {
        const tone = dueInfo(t).tone;
        const bucket = tone === "late" ? ["0", "En retard"] : tone === "today" ? ["1", "Aujourd’hui"] : tone === "soon" ? ["2", "Cette semaine"] : tone === "later" ? ["3", "Plus tard"] : tone === "done" ? ["5", "Validées"] : ["4", "Sans date"];
        key = `d:${bucket[0]}`; label = tr(bucket[1]); order = bucket[0];
      }
      if (!out.has(key)) out.set(key, { key, label, mark, items: [], order });
      out.get(key)!.items.push(t);
    }
    return [...out.values()].sort((a, b) => a.order.localeCompare(b.order));
  }
  function QuickChips() {
    const chips: [QuickFilter, string][] = [["", "Toutes"], ["active", "Actives"], ["mine", "Mes tâches"], ["late", "En retard"], ["week", "Cette semaine"], ["review", "À valider"], ["nodate", "Sans date"]];
    return (
      <div className="quick-chips" role="group" aria-label={tr("Filtres rapides")}>
        {chips.map(([key, label]) => {
          // Approved tasks are done: they don't count.
          const n = (key ? baseFiltered.filter(quickTests[key]) : baseFiltered).filter((t) => t.status !== "Validé").length;
          if (key && !n && quick !== key) return null;
          return (
            <button key={key || "all"} type="button" className={`quick-chip${quick === key ? " on" : ""}${key === "late" ? " warn" : ""}`} aria-pressed={quick === key} onClick={() => setQuick(key)}>
              {tr(label)}<small>{n}</small>
            </button>
          );
        })}
        {view === "table" && (
          <label className="group-pick">
            <Layers size={14} />
            <select value={groupBy} onChange={(e) => { setGroupBy(e.target.value as GroupBy); setFolded(new Set()); }} aria-label={tr("Grouper par")}>
              <option value="none">{tr("Sans groupe")}</option>
              <option value="status">{tr("Grouper par statut")}</option>
              <option value="client">{tr("Grouper par client")}</option>
              <option value="assignee">{tr("Grouper par personne")}</option>
              <option value="due">{tr("Grouper par échéance")}</option>
            </select>
          </label>
        )}
      </div>
    );
  }
  function PeekPanel() {
    const t = peekId ? allTasks.find((x) => x.id === peekId) : undefined;
    const index = t ? filtered.findIndex((x) => x.id === t.id) : -1;
    const go = (step: number) => { const next = filtered[index + step]; if (next) setPeekId(next.id); };

    const c = t ? clients.find((x) => x.id === t.clientId) : undefined;
    return (
      <Sheet open={!!t} onOpenChange={(o) => { if (!o) setPeekId(null); }}>
        <SheetContent side={rtl ? "left" : "right"} className="peek-panel" showCloseButton={false}>
          {t && <>
            <div className="peek-head">
              <div className="peek-nav">
                <button type="button" className="icon-button" aria-label={tr("Tâche précédente")} title={tr("Tâche précédente (↑)")} disabled={index <= 0} onClick={() => go(-1)}><ChevronUp size={16} /></button>
                <button type="button" className="icon-button" aria-label={tr("Tâche suivante")} title={tr("Tâche suivante (↓)")} disabled={index < 0 || index >= filtered.length - 1} onClick={() => go(1)}><ChevronDown size={16} /></button>
                {index >= 0 && <small>{index + 1} / {filtered.length}</small>}
              </div>
              <div className="inline">
                <button type="button" className="btn" onClick={() => navigate({ page: "task", id: t.id })}><Maximize2 size={14} />{tr("Ouvrir")}</button>
                <button type="button" className="icon-button" aria-label={tr("Fermer")} onClick={() => setPeekId(null)}><X size={16} /></button>
              </div>
            </div>
            <div className="peek-body">
              <p className="peek-client">{c ? <ClientMark name={c.name} logo={c.logo} size="sm" /> : null}{cname(t.clientId)}{t.projectId ? ` / ${pname(t.projectId)}` : ""}</p>
              <SheetTitle className="peek-title">{t.name}</SheetTitle>
              <SheetDescription className="sr-only">{tr("Aperçu de la tâche")}</SheetDescription>
              <dl className="peek-props">
                <div><dt>{tr("Statut")}</dt><dd>
                  <StatusPick allowApproval={manager} member={member} task={t} disabled={archived(t) || busy || workspace?.role === "viewer"}
                    onChange={(s) => void update(t, { status: s }, tr("Statut : {status}", { status: tr(s) }))} />
                </dd></div>
                <div><dt>{tr("Échéance")}</dt><dd>{duePill(t)}</dd></div>
                <div><dt>{tr("Assigné")}</dt><dd className="inline"><Avatar name={t.assignee} avatar={avatarOf(t.assignee)} />{t.assignee || tr("Non assigné")}</dd></div>
                <div><dt>{tr("Camp")}</dt><dd><CourtChip task={t} /></dd></div>
                {link(t) && <div><dt>{tr("Livrable")}</dt><dd><a className="file-pill" href={link(t)} target="_blank" rel="noopener noreferrer"><FileText size={13} />{tr("Ouvrir")}<ArrowUpRight size={12} /></a></dd></div>}
              </dl>
              {t.description && <p className="peek-description">{t.description}</p>}
              <div className="peek-actions">
                <button type="button" className="btn" disabled={!writable || archived(t)} onClick={() => open("task", t)}><PenLine size={14} />{tr("Modifier")}</button>
              </div>
              <div className="peek-chat">
                <TaskChat
                  key={t.id}
                  messages={records.filter((r) => r.kind === "comment" && r.taskId === t.id)}
                  workspaceId={workspace?.id}
                  isMine={(m) => !!m.authorId && m.authorId === user.id}
                  senderLabel={(m) => {
                    if (m.audience === "client") return tr("Client");
                    const role = members.find((x) => x.userId === m.authorId)?.role;
                    return role ? tr(roleLabels[role]) : undefined;
                  }}
                  canWrite={writable && !archived(t)}
                  busy={busy}
                  onSend={async (message) => { await mutate({ action: "comment", taskId: t.id, ...message }); }}
                  onError={setError}
                />
              </div>
            </div>
          </>}
        </SheetContent>
      </Sheet>
    );
  }
  function TaskTable({ items }: { items: RecordItem[] }) {
    // A modern list rather than a spreadsheet: one line per task — its status, title and what matters
    // about it underneath — then who, when and where it stands. Selection only for those who may delete.
    const selecting = manager;
    const picked = items.filter((t) => selectedTasks.has(t.id));
    const allPicked = !!items.length && picked.length === items.length;
    const toggle = (id: string) => setSelectedTasks((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    const deletePicked = async () => {
      if (!window.confirm(tr("Supprimer {n} tâches, avec leurs commentaires ? C’est définitif.", { n: picked.length }))) return;
      try {
        await mutate({ action: "delete-many", kind: "task", items: picked.map((t) => ({ id: t.id, revision: t.revision })) });
        setSelectedTasks(new Set());
        setNotice(tr("{n} tâches supprimées.", { n: picked.length }));
      } catch (e) {
        setError(tr((e as Error).message));
      }
    };
    const comments = new Map<string, number>();
    for (const r of records) if (r.kind === "comment" && r.taskId) comments.set(r.taskId, (comments.get(r.taskId) ?? 0) + 1);
    const groups = groupBy === "none" ? null : groupTasks(items);
    const timeOf = (t: RecordItem) => timerTotals(t.timeEntries, Date.now()).reduce((acc, x) => acc + x.ms, 0);
    const row = (t: RecordItem) => {
      const c = clients.find((x) => x.id === t.clientId);
      const status = t.status ?? "À faire";
      const spent = owner || manager ? timeOf(t) : 0;
      return (
        <div key={t.id} role="row" className={`tl-row${selectedTasks.has(t.id) ? " selected" : ""}${peekId === t.id ? " peeked" : ""}${status === "Validé" ? " done" : ""}`}>
          {selecting && (
            <input type="checkbox" className="row-check" checked={selectedTasks.has(t.id)} aria-label={tr("Sélectionner {name}", { name: t.name })} onChange={() => toggle(t.id)} />
          )}
          <span className={`tl-dot ${statusClass[status]}`} title={tr(status)} aria-hidden="true" />
          <button type="button" className="tl-main" onClick={() => setPeekId(t.id)} title={tr("Aperçu")}>
            <strong>{t.name}</strong>
            <span className="tl-meta">
              {c ? <ClientMark name={c.name} logo={c.logo} size="sm" /> : <Briefcase size={13} />}
              <span className="tl-client">{cname(t.clientId)}</span>
              {t.projectId && <span className="tl-sep">{pname(t.projectId)}</span>}
              {!!comments.get(t.id) && <span className="tl-icon" title={tr("Commentaires")}><MessageSquare size={12} />{comments.get(t.id)}</span>}
              {link(t) && <span className="tl-icon" title={tr("Livrable")}><LinkIcon size={12} /></span>}
              {spent > 0 && <span className="tl-icon" title={tr("Temps")}><Clock size={12} />{formatDuration(spent)}</span>}
              {t.priority && <span className="flag-pill">{tr(t.priority)}</span>}
              {t.request && <span className="flag-pill"><Inbox size={11} />{tr("Demande")}</span>}
              {t.evergreen && <span className="flag-pill" title={tr("Réserve evergreen")}><Sparkles size={11} /></span>}
              {t.publishable === false && <span className="flag-pill"><PenLine size={11} />{tr("Interne")}</span>}
              {revisionState(t).overBudget && <span className="flag-pill warn">{tr("Hors forfait")}</span>}
            </span>
          </button>
          <span className="tl-court"><CourtChip task={t} /></span>
          <span className="tl-person" title={t.assignee || tr("Non assigné")}><Avatar name={t.assignee} avatar={avatarOf(t.assignee)} /></span>
          <span className="tl-due">{duePill(t)}</span>
          <span className="tl-status">
            <StatusPick
              allowApproval={manager}
              member={member}
              task={t}
              disabled={archived(t) || busy || workspace?.role === "viewer"}
              onChange={(s) => void update(t, { status: s }, tr("Statut : {status}", { status: tr(s) }))}
            />
          </span>
          <span className="row-actions">
            <button className="icon-button" aria-label={tr("Modifier {name}", { name: t.name })} disabled={!writable || archived(t)} onClick={() => open("task", t)}>
              <PenLine size={14} />
            </button>
            {manager && (
              <button className="icon-button danger" aria-label={tr("Supprimer {name}", { name: t.name })} onClick={() => open("delete", t)}>
                <Trash2 size={14} />
              </button>
            )}
          </span>
        </div>
      );
    };
    return (
      <>
        {selecting && picked.length > 0 && (
          <div className="bulk-bar" role="toolbar" aria-label={tr("Sélection")}>
            <strong>{tr("{n} sélectionnées", { n: picked.length })}</strong>
            <button type="button" className="btn ghost" onClick={() => setSelectedTasks(new Set())}>{tr("Désélectionner")}</button>
            <button type="button" className="btn danger primary" disabled={busy} onClick={() => void deletePicked()}><Trash2 size={14} />{tr("Supprimer")}</button>
          </div>
        )}
        <div className="task-list" role="table" aria-label={tr("Tâches")}>
          <div className="tl-head" role="row">
            {selecting && (
              <input type="checkbox" className="row-check" checked={allPicked} aria-label={tr("Tout sélectionner")}
                ref={(el) => { if (el) el.indeterminate = picked.length > 0 && !allPicked; }}
                onChange={() => setSelectedTasks(allPicked ? new Set() : new Set(items.map((t) => t.id)))} />
            )}
            <span className="tl-head-main">
              {(() => {
                const open = items.filter((t) => t.status !== "Validé").length, done = items.length - open;
                return <>{open === 1 ? tr("1 tâche") : tr("{n} tâches", { n: open })}{done > 0 && <em className="tl-head-done">{tr("+ {n} validées", { n: done })}</em>}</>;
              })()}
            </span>
            <span className="tl-court">{tr("Camp")}</span>
            <span className="tl-person">{tr("Qui")}</span>
            <span className="tl-due">{tr("Échéance")}</span>
            <span className="tl-status">{tr("Statut")}</span>
            <span className="row-actions" />
          </div>
          {groups
            ? groups.map((g) => (
                <section key={`group:${g.key}`} className="tl-group">
                  <button type="button" className="group-toggle" aria-expanded={!folded.has(g.key)} onClick={() => setFolded((cur) => { const next = new Set(cur); if (next.has(g.key)) next.delete(g.key); else next.add(g.key); return next; })}>
                    <ChevronRight size={15} className="group-chevron" />
                    {g.mark}
                    <span>{g.label}</span>
                    <small>{g.items.filter((t) => t.status !== "Validé").length || g.items.length}</small>
                  </button>
                  {!folded.has(g.key) && g.items.map(row)}
                </section>
              ))
            : items.map(row)}
          {inlineTask?.view === "table" && (
            <div className="tl-add-form">
              <input
                type="text"
                autoFocus
                className="inline-input"
                placeholder={tr("Nom de la tâche...")}
                value={inlineTask.name || ""}
                onChange={(e) => setInlineTask({ ...inlineTask, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") void submitInlineTask(); if (e.key === "Escape") setInlineTask(null); }}
              />
              <StatusPick allowApproval={manager} member={member} task={inlineTask} onChange={(st) => setInlineTask({ ...inlineTask, status: st })} />
                    <Select 
                      disabled={!!currentClient} 
                      value={inlineTask.clientId || "internal"} 
                      onValueChange={v => setInlineTask({...inlineTask, clientId: v, projectId: ""})}
                    >
                      <SelectTrigger className="inline-input w-full h-8 px-2" aria-label={tr("Client")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {!currentClient && <SelectItem value="internal">{tr("Interne")}</SelectItem>}
                        {(currentClient ? [currentClient] : clients.filter(c => !c.archived)).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={inlineTask.projectId || "none"} onValueChange={v => setInlineTask({...inlineTask, projectId: v === "none" ? "" : v})}>
                      <SelectTrigger className="inline-input w-full h-8 px-2" aria-label={tr("Projet")}>
                        <SelectValue placeholder={tr("Projet")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{tr("Aucun")}</SelectItem>
                        {projects
                           .filter(p => !p.archived && (
                             inlineTask.clientId && inlineTask.clientId !== "internal" 
                               ? p.clientId === inlineTask.clientId 
                               : (!p.clientId || p.clientId === "internal")
                           ))
                           .map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={inlineTask.assignee || "unassigned"} onValueChange={v => setInlineTask({...inlineTask, assignee: v === "unassigned" ? "" : v})}>
                      <SelectTrigger className="inline-input w-full h-8 px-2" aria-label={tr("Assigné")}>
                        <SelectValue>
                          {inlineTask.assignee ? (
                            <span className="flex items-center gap-2">
                              <Avatar name={inlineTask.assignee} avatar={avatarOf(inlineTask.assignee)} />
                              <span className="truncate">{inlineTask.assignee}</span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">{tr("Non assigné")}</span>
                          )}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">{tr("Non assigné")}</SelectItem>
                        {members.filter((m) => isStudioRole(m.role)).map(m => (
                          <SelectItem key={m.userId} value={m.name || "unknown"}>
                            <span className="flex items-center gap-2">
                              <Avatar name={m.name || "?"} avatar={m.avatar} />
                              {m.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
              <DatePicker className="inline-input" label={tr("Échéance")} value={inlineTask.due || ""} onChange={(v) => setInlineTask({ ...inlineTask, due: v })} placeholder="jj/mm/aaaa" />
              <Select value={inlineTask.priority || "Moyenne"} onValueChange={(v) => setInlineTask({ ...inlineTask, priority: v as Priority })}>
                <SelectTrigger className="inline-input w-28 h-8 px-2" aria-label={tr("Priorité")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Basse">{tr("Basse")}</SelectItem>
                  <SelectItem value="Moyenne">{tr("Moyenne")}</SelectItem>
                  <SelectItem value="Haute">{tr("Haute")}</SelectItem>
                  <SelectItem value="Urgente">{tr("Urgente")}</SelectItem>
                </SelectContent>
              </Select>
              <button className="btn primary" onClick={() => void submitInlineTask()}><Check size={14} /> {tr("Valider")}</button>
              <button className="icon-button" aria-label={tr("Annuler")} onClick={() => setInlineTask(null)}><X size={16} /></button>
            </div>
          )}
          {!items.length && (
            <Blank
              title={tr("Aucune tâche trouvée")}
              text={
                manager
                  ? "Créez une tâche ou ajustez les filtres."
                  : "Aucune tâche assignée ou à prendre ici. Ajustez les filtres ou attendez la prochaine attribution."
              }
            />
          )}
          {manager && inlineTask?.view !== "table" && (
            <button
              className="add-row tl-add"
              disabled={busy}
              onClick={() => setInlineTask({ view: "table", status: statusFilter || "À faire", clientId: currentClient?.id || "internal" })}
            >
              <Plus size={15} />
              {tr("Nouvelle tâche")}
            </button>
          )}
        </div>
      </>
    );
  }
  function Board() {
    return (
      <div className="board">
        {statuses.map((s) => {
          const draggingTask = tasks.find((t) => t.id === draggingTaskId);
          // Members may only move a task to "En cours" or "À valider". Owner/admin can move a
          // task anywhere. Everyone else (viewer) can't reach "À valider" or "Validé" manually.
          const statusReachable = member
            ? s === "En cours" || s === "En pause" || s === "À valider"
            : manager || (s !== "À valider" && s !== "Validé");
          const dropAllowed =
            !!draggingTask &&
            writable &&
            !busy &&
            !archived(draggingTask) &&
            draggingTask.status !== s &&
            statusReachable;
          return (
            <section
              className={`board-column ${dragOverStatus === s ? (dropAllowed ? "drag-over" : "drag-over-blocked") : ""}`}
              key={s}
              onDragEnter={(e) => {
                e.preventDefault();
                setDragOverStatus(s);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = dropAllowed ? "move" : "none";
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node))
                  setDragOverStatus(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverStatus(null);
                const t = tasks.find(
                  (t) => t.id === e.dataTransfer.getData("text/plain"),
                );
                if (
                  t &&
                  writable &&
                  !busy &&
                  !archived(t) &&
                  t.status !== s &&
                  statusReachable
                )
                  void update(t, { status: s });
              }}
            >
              <header>
                <Chip status={s} />
                <small>{filtered.filter((t) => t.status === s).length}</small>
                {manager && (
                  <button
                    aria-label={tr("Créer une tâche {status}", {
                      status: tr(s),
                    })}
                    onClick={() => setInlineTask({ view: "board", status: s, clientId: currentClient?.id || "internal" })}
                  >
                    <Plus size={16} />
                  </button>
                )}
              </header>
              {filtered
                .filter((t) => t.status === s)
                .map((t) => (
                  <article
                    key={t.id}
                    className={`board-card ${draggingTaskId === t.id ? "dragging" : ""}`}
                    draggable={writable && !showArchived && !busy}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", t.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDraggingTaskId(t.id);
                    }}
                    onDragEnd={() => {
                      setDraggingTaskId(null);
                      setDragOverStatus(null);
                    }}
                  >
                    <small className="board-client">
                      {(() => { const c = clients.find((x) => x.id === t.clientId); return c ? <ClientMark name={c.name} logo={c.logo} size="sm" /> : null; })()}
                      {cname(t.clientId)}
                    </small>
                    <button
                      className="board-name"
                      onClick={() => setPeekId(t.id)}
                    >
                      {t.name}
                    </button>
                    {link(t) && (
                      <a
                        className="file-pill"
                        href={link(t)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <FileText size={13} />
                        {tr("Livrable")}
                        <ArrowUpRight size={12} />
                      </a>
                    )}
                    <footer>
                      <Avatar name={t.assignee} avatar={avatarOf(t.assignee)} />
                      {duePill(t)}
                      {(() => { const n = records.filter((r) => r.kind === "comment" && r.taskId === t.id).length; return n ? <span className="row-comments"><MessageSquare size={12} />{n}</span> : null; })()}
                      <CourtChip task={t} />
                      <button
                        aria-label={tr("Modifier {name}", { name: t.name })}
                        disabled={!writable || archived(t)}
                        onClick={() => open("task", t)}
                      >
                        <MoreHorizontal size={17} />
                      </button>
                    </footer>
                    {s === "À valider" && (
                      <div className={`flag-pill ${Math.round(hoursLeft(t, new Date()) ?? 0) <= 24 ? 'warn' : ''}`}>
                        <Clock size={11} />{" "}
                        {tr("Tacite dans {n} h", {
                          n: Math.max(
                            0,
                            Math.round(hoursLeft(t, new Date()) ?? 0),
                          ),
                        })}
                      </div>
                    )}
                    {s === "Validé" && t.publishedAt && (
                      <div className="flag-pill">
                        <CheckCircle2 size={11} />{" "}
                        {tr("Publié le {date}", {
                          date: dateLabel(t.publishedAt.slice(0, 10)),
                        })}
                      </div>
                    )}
                  </article>
                ))}
              {manager && (
                <>
                  {inlineTask?.view === "board" && inlineTask?.status === s && (
                    <div className="board-inline-add">
                      <input
                        autoFocus
                        type="text"
                        className="inline-input w-full"
                        placeholder={tr("Nom de la tâche...")}
                        value={inlineTask.name || ""}
                        onChange={(e) => setInlineTask({ ...inlineTask, name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void submitInlineTask();
                          if (e.key === "Escape") setInlineTask(null);
                        }}
                      />
                      <div className="board-inline-actions">
                        <button className="btn primary" onClick={() => void submitInlineTask()}>
                          <Check size={13} /> {tr("Ajouter")}
                        </button>
                        <button className="icon-button" onClick={() => setInlineTask(null)}>
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                  <button
                    className="add-row"
                    onClick={() => setInlineTask({ view: "board", status: s, clientId: currentClient?.id || "internal" })}
                  >
                    <Plus size={14} />
                    {tr("Nouvelle tâche")}
                  </button>
                </>
              )}
            </section>
          );
        })}
      </div>
    );
  }
  function renderCalendar({
    items,
    readOnly = false,
  }: {
    items: RecordItem[];
    readOnly?: boolean;
  }) {
    const start = new Date(month);
    start.setDate(1);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    if (calendarMode === "week") {
      start.setTime(month.getTime());
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    }
    const days = Array.from(
      { length: calendarMode === "week" ? 7 : 42 },
      (_, i) => {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        return d;
      },
    );
    return (
      <div className="calendar-wrap">
        <div className="calendar-toolbar">
          <button className="btn" onClick={() => setMonth(new Date())}>
            {tr("Aujourd’hui")}
          </button>
          <button
            className="icon-button"
            aria-label={tr("Période précédente")}
            onClick={() =>
              setMonth(
                new Date(
                  month.getFullYear(),
                  month.getMonth() - (calendarMode === "month" ? 1 : 0),
                  calendarMode === "month" ? 1 : month.getDate() - 7,
                ),
              )
            }
          >
            <ChevronLeft />
          </button>
          <button
            className="icon-button"
            aria-label={tr("Période suivante")}
            onClick={() =>
              setMonth(
                new Date(
                  month.getFullYear(),
                  month.getMonth() + (calendarMode === "month" ? 1 : 0),
                  calendarMode === "month" ? 1 : month.getDate() + 7,
                ),
              )
            }
          >
            <ChevronRight />
          </button>
          <h2>
            {month.toLocaleDateString(tag, { month: "long", year: "numeric" })}
          </h2>
          <div className="grow" />
          <Tabs value={calendarMode} onValueChange={setCalendarMode}>
            <TabsList>
              <TabsTrigger value="month">{tr("Mois")}</TabsTrigger>
              <TabsTrigger value="week">{tr("Semaine")}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="calendar-grid">
          <div className="weekdays">
            {["Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam.", "Dim."].map(
              (d) => (
                <span key={d}>{tr(d)}</span>
              ),
            )}
          </div>
          <div className="calendar-days">
            {days.map((d) => {
              const key = dayKey(d);
              const events = items.filter((t) => t.due === key);
              return (
                <div
                  className={`calendar-day ${d.getMonth() !== month.getMonth() ? "outside" : ""}`}
                  key={key}
                >
                  <header>
                    <span className={key === today ? "today" : ""}>
                      {d.getDate()}
                    </span>
                    {!readOnly && manager && (
                      <button
                        aria-label={tr("Créer une tâche le {day}", { day: key })}
                        onClick={() =>
                          setInlineTask({ view: "calendar", due: key, status: "À faire", clientId: currentClient?.id || "internal" })
                        }
                      >
                        <Plus size={13} />
                      </button>
                    )}
                  </header>
                  {events.map((t) => (
                    <button
                      key={t.id}
                      className="calendar-event"
                      onClick={() => navigate({ page: readOnly ? "review" : "task", id: t.id })}
                    >
                      <strong>{t.name}</strong>
                      <Chip status={t.status} />
                    </button>
                  ))}
                  {inlineTask?.view === "calendar" && inlineTask?.due === key && (
                    <div className="calendar-inline-add">
                      <input
                        autoFocus
                        type="text"
                        className="inline-input w-full"
                        placeholder={tr("Nom de la tâche...")}
                        value={inlineTask.name || ""}
                        onChange={(e) => setInlineTask({ ...inlineTask, name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void submitInlineTask();
                          if (e.key === "Escape") setInlineTask(null);
                        }}
                      />
                      <div className="board-inline-actions">
                        <button className="btn primary" style={{fontSize:11, padding:"2px 6px"}} onClick={() => void submitInlineTask()}>
                          <Check size={11} /> {tr("OK")}
                        </button>
                        <button className="icon-button" onClick={() => setInlineTask(null)}>
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }
  function Toolbar() {
    return (
      <div className="database-toolbar">
        <Tabs value={view} onValueChange={setView}>
          <TabsList variant="line">
            <TabsTrigger value="table">
              <List size={16} />
              {tr("Table")}
            </TabsTrigger>
            <TabsTrigger value="board">
              <Columns3 size={16} />
              {tr("Tableau")}
            </TabsTrigger>
            <TabsTrigger value="calendar">
              <CalendarDays size={16} />
              {tr("Calendrier")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="toolbar-actions">
          <label className="search-input">
            <Search size={15} />
            <input
              aria-label={tr("Rechercher une tâche")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tr("Rechercher…")}
            />
          </label>
          <button
            className={`btn ghost ${filterOpen ? "selected" : ""}`}
            onClick={() => setFilterOpen(!filterOpen)}
          >
            <Filter size={15} />
            {tr("Filtrer")}
            {(statusFilter || assigneeFilter || courtFilter) && (
              <span className="filter-dot" />
            )}
          </button>
          <Pick
            label={tr("Trier les tâches")}
            value={sort}
            onChange={setSort}
            items={[
              { value: "due", label: tr("Échéance") },
              { value: "name", label: tr("Nom") },
              { value: "status", label: tr("Statut") },
            ]}
          />
          {manager && (
            <button className="btn primary" onClick={() => open("task")}>
              <Plus size={16} />
              {tr("Nouveau")}
            </button>
          )}
        </div>
      </div>
    );
  }
  function TaskDatabase() {
    return (
      <>
        {Toolbar()}
        {QuickChips()}
        {PeekPanel()}
        {filterOpen && (
          <div className="filters">
            <span>{tr("Statut")}</span>
            <Pick
              label={tr("Filtrer par statut")}
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as Status | "")}
              items={[...statuses]}
              emptyLabel={tr("Tous")}
            />
            <span>{tr("Assigné")}</span>
            <Pick
              label={tr("Filtrer par personne")}
              value={assigneeFilter}
              onChange={setAssigneeFilter}
              items={assigneeOptions}
              emptyLabel={tr("Tous")}
            />
            <span>{tr("Camp")}</span>
            <Pick
              label={tr("Filtrer par camp")}
              value={courtFilter}
              onChange={setCourtFilter}
              items={[
                { value: "studio", label: tr("Studio") },
                { value: "client", label: tr("Client") },
                { value: "done", label: tr("Terminé") },
              ]}
              emptyLabel={tr("Tous")}
            />
            <button
              className="btn ghost"
              onClick={() => {
                setStatusFilter("");
                setAssigneeFilter("");
                setCourtFilter("");
                setShowArchived(false);
              }}
            >
              {tr("Réinitialiser")}
            </button>
            <button
              className={`btn ${showArchived ? "selected" : ""}`}
              onClick={() => setShowArchived(!showArchived)}
            >
              <Archive size={14} />
              {tr(
                showArchived ? "Archives affichées" : "Afficher les archives",
              )}
            </button>
          </div>
        )}
        {view === "table" ? (
          TaskTable({ items: filtered })
        ) : view === "board" ? (
          Board()
        ) : (
          // The tasks' own calendar: their due dates. What goes out, and when, is the Plan éditorial's.
          renderCalendar({ items: filtered.filter((t) => !!t.due) })
        )}
      </>
    );
  }
  // The studio's numbers: on the Tableau de bord for those who have it, on the home page for the others.
  function StudioMetrics() {
    const active = tasks.filter((t) => t.status !== "Validé"),
      completed = tasks.filter((t) => t.status === "Validé");
    return (
        <div className="metric-grid">
          {(
            [
              [
                "Tâches actives",
                active.length,
                CheckSquare,
                "À faire et en cours de livraison",
              ],
              [
                "À valider",
                reviewTasks.length,
                Send,
                "Dans la file de validation",
              ],
              ["En retard", late.length, Clock, "À traiter en priorité"],
              [
                "Tâches validées",
                completed.length,
                CheckCircle2,
                "Livrables approuvés",
              ],
            ] as [string, number, LucideIcon, string][]
          ).map(([label, value, Icon, detail], index) => (
            <button className={`metric-card${index === 0 ? " gold" : ""}`} key={label} onClick={() => { navigate({ page: "tasks" }); if (index === 1) setQuick("review"); else if (index === 2) setQuick("late"); else if (index === 3) setStatusFilter("Validé"); else setQuick("active"); }}>
              <div className="metric-label">
                <span>{tr(label)}</span>
                <span className="metric-icon">
                  <Icon size={18} />
                </span>
              </div>
              <strong>{String(value).padStart(2, "0")}</strong>
              <small>{tr(detail)}</small>
            </button>
          ))}
        </div>
    );
  }
  function StudioCharts() {
    if (!records.length) return null;
    return (() => {
            const statusColors: Record<Status, string> = {
              "À faire": "#8e96a3",
              "En cours": "#e9c46a",
              "En pause": "#6f86b8",
              "À valider": "#E5A93C",
              Validé: "#3d8763",
            };
            const statusSlices: Slice[] = statuses.map((s) => ({
              key: s,
              label: tr(s),
              value: tasks.filter((t) => t.status === s).length,
              color: statusColors[s],
            }));
            const weeks = Array.from({ length: 8 }, (_, i) =>
              shiftDay(today, -7 * (7 - i)),
            );
            const weeklyTrend = weeks.map((weekStart) => {
              const weekEnd = shiftDay(weekStart, 6);
              return {
                x: weekStart,
                y: tasks.filter(
                  (t) =>
                    t.validatedAt &&
                    dayIn(new Date(t.validatedAt)) >= weekStart &&
                    dayIn(new Date(t.validatedAt)) <= weekEnd,
                ).length,
                label: `${dateLabel(weekStart)} – ${dateLabel(weekEnd)}`,
              };
            });
            return (
              <div className="chart-row">
                <section className="work-panel">
                  <div className="section-head">
                    <div>
                      <h2>{tr("Répartition des tâches")}</h2>
                      <p>{tr("Toutes les tâches visibles, par statut.")}</p>
                    </div>
                  </div>
                  <div className="flow-panel-body">
                    <DonutStat data={statusSlices} centerLabel={tr("Tâches")} />
                  </div>
                </section>
                <section className="work-panel">
                  <div className="section-head">
                    <div>
                      <h2>{tr("Validations")}</h2>
                      <p>{tr("Tâches validées, semaine par semaine.")}</p>
                    </div>
                  </div>
                  <div className="flow-panel-body">
                    <TrendArea
                      data={weeklyTrend}
                      color="#3d8763"
                      height={182}
                      xTickFormatter={dateLabel}
                    />
                  </div>
                </section>
              </div>
            );
          })();
  }
  function HomePage() {
    const active = tasks.filter((t) => t.status !== "Validé"),
      mine = active
        .slice()
        .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
    const
      // The whole name, not its first word: an account named after the studio ("The One Core")
      // would otherwise be greeted as "Bonjour, The".
      greetingName =
        user.name.includes("@") || user.name === workspace?.name ? "" : user.name;
    return (
      <div className="dashboard">
        <div className="dashboard-heading">
          <div>
            <div className="eyebrow">{tr("VOTRE ESPACE DE TRAVAIL")}</div>
            <h1>
              {greetingName
                ? tr("Bonjour, {name}", { name: greetingName })
                : tr("Bonjour")}
              <span className="greeting-dot">.</span>
            </h1>
            <p>
              {tr(
                member
                  ? "Les tâches qui vous sont assignées et celles à prendre."
                  : "Ce qui vous attend aujourd’hui : vos tâches, les validations et les alertes.",
              )}
            </p>
          </div>
          <div className="dashboard-actions">
            <span className="date-tag">
              <CalendarDays size={15} />
              {new Date().toLocaleDateString(tag, {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
            {manager && (
              <button className="btn primary" onClick={() => open("task")}>
                <Plus size={17} />
                {tr("Nouvelle tâche")}
              </button>
            )}
          </div>
        </div>
        {!manager && StudioMetrics()}
        {!records.length ? (
          <div className="onboarding-grid">
            <section className="onboarding-card">
              <span className="onboarding-icon">
                <Folder size={28} />
              </span>
              <div className="eyebrow">{tr("UN NOUVEAU DÉPART")}</div>
              <h2>
                {tr("Faites de la place")}
                <br />
                {tr("à votre prochain projet.")}
              </h2>
              <p>
                {tr(
                  "Un client, un brief, une équipe. Tout commence par votre première mission.",
                )}
              </p>
              <div className="inline">
                {owner && (
                  <button
                    className="btn primary"
                    onClick={() => open("client")}
                  >
                    <Plus size={16} />
                    {tr("Ajouter mon premier client")}
                  </button>
                )}
              </div>
            </section>
            <section className="setup-card">
              <div className="section-head">
                <h2>{tr("Votre studio, organisé.")}</h2>
                <span className="neutral-badge">{tr("3 étapes")}</span>
              </div>
              {[
                [
                  "01",
                  "Ajoutez vos clients",
                  "Le brief et les informations au même endroit.",
                ],
                [
                  "02",
                  "Structurez vos missions",
                  "Un sous-projet pour chaque objectif.",
                ],
                [
                  "03",
                  "Faites avancer le travail",
                  "De la première idée à la validation.",
                ],
              ].map(([n, title, text]) => (
                <div className="setup-step" key={n}>
                  <span>{n}</span>
                  <div>
                    <strong>{tr(title)}</strong>
                    <p>{tr(text)}</p>
                  </div>
                </div>
              ))}
              <div className="setup-footer">
                <Lock size={14} />
                {tr("Votre espace est privé et prêt à accueillir vos projets.")}
              </div>
            </section>
          </div>
        ) : (
          <div className="dashboard-grid">
            <section className="work-panel">
              <div className="section-head">
                <div>
                  <h2>
                    {tr("Vos priorités")}
                    <span className="neutral-badge">{active.length}</span>
                  </h2>
                  <p>{tr("Les prochaines tâches à faire avancer.")}</p>
                </div>
                <button
                  className="btn"
                  onClick={() => navigate({ page: "tasks" })}
                >
                  {tr("Tout voir")}
                  <ArrowUpRight size={14} />
                </button>
              </div>
              {renderTaskRows({ items: mine.slice(0, 6), compact: true })}
            </section>
            <section className="review-panel">
              <div className="section-head">
                <div>
                  <h2>{tr("À valider")}</h2>
                  <p>{tr("La prochaine étape est chez le client.")}</p>
                </div>
                <span className="review-count">{reviewTasks.length}</span>
              </div>
              {reviewTasks.length ? (
                <div className="approval-list">
                  {reviewTasks.slice(0, 3).map((t) => (
                    <button
                      key={t.id}
                      onClick={() => navigate({ page: "task", id: t.id })}
                    >
                      <span className="approval-icon">
                        <FileText size={19} />
                      </span>
                      <span>
                        <small>{cname(t.clientId)}</small>
                        <strong>{t.name}</strong>
                        <span className="approval-date">
                          <Clock size={12} />
                          {dateLabel(t.due)}
                        </span>
                      </span>
                      <ArrowUpRight size={15} />
                    </button>
                  ))}
                </div>
              ) : (
                <Blank
                  title={tr("Tout est à jour")}
                  text={tr("Aucun livrable en attente de validation.")}
                />
              )}
              <button
                className="review-all"
                onClick={() => {
                  navigate({ page: "tasks" });
                  setStatusFilter("À valider");
                }}
              >
                {tr("Voir la file de validation")}
                <ChevronRight size={16} />
              </button>
            </section>
          </div>
        )}
        {!!records.length && (
          <TimeRecords
            tasks={allTasks}
            members={members}
            userId={user.id}
            scope={member ? "own" : "team"}
            clientName={cname}
            onOpenTask={(id) => navigate({ page: "task", id })}
            onPause={
              workspace?.role !== "viewer"
                ? (t) => void update(t, { status: "En pause" })
                : undefined
            }
          />
        )}
        {!manager && StudioCharts()}
        {(() => {
          const alerts = records
            .filter(
              (r) =>
                r.kind === "event" &&
                r.audience !== "client" &&
                (!r.recipients || isEventRecipient(r, user.id)) &&
                isEventUnreadFor(r, user.id),
            )
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          // Requests waiting in the inbox (managers decide), and older ones that went straight to a task.
          const requests = [
            ...(manager ? records.filter((r) => r.kind === "request" && (r.requestStatus ?? "new") === "new") : []),
            ...tasks.filter((t) => t.request && t.status === "À faire"),
          ];
          return alerts.length || requests.length ? (
            <section className="alerts-panel">
              <div className="section-head">
                <div>
                  <h2>
                    {tr("À traiter")}
                    <span className="neutral-badge">
                      {alerts.length + requests.length}
                    </span>
                  </h2>
                  <p>
                    {tr("Horloges, verrou J−{n}, demandes clients.", {
                      n: flow.lockDays,
                    })}
                  </p>
                </div>
                {manager && (
                  <button
                    className="btn"
                    onClick={() => navigate({ page: "flow" })}
                  >
                    <Gauge size={14} />
                    {tr("Tableau de bord")}
                  </button>
                )}
              </div>
              <div className="alerts-list">
                {requests.slice(0, 3).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => navigate(t.kind === "request" ? { page: "requests" } : { page: "task", id: t.id })}
                  >
                    <span className="flow-event-icon">
                      <Inbox size={15} />
                    </span>
                    <span>
                      <small>
                        {tr("Demande · {client}", {
                          client: cname(t.clientId),
                        })}
                      </small>
                      <strong>
                        {t.name}
                        {t.due
                          ? tr(" · pour le {date}", { date: dateLabel(t.due) })
                          : ""}
                      </strong>
                    </span>
                    <ChevronRight size={15} />
                  </button>
                ))}
                {alerts.slice(0, 5).map((e) => (
                  <button
                    key={e.id}
                    onClick={() => {
                      if (e.taskId) navigate({ page: "task", id: e.taskId });
                      else if (e.requestId) navigate({ page: "requests" });
                      void mutate({ action: "mark-read", ids: [e.id] }).catch(
                        () => {},
                      );
                    }}
                  >
                    <span className={`flow-event-icon ${e.type}`}>
                      {e.type === "lock" ? (
                        <Lock size={15} />
                      ) : e.type === "reminder" ? (
                        <Bell size={15} />
                      ) : e.type === "auto-approved" ? (
                        <CheckCircle2 size={15} />
                      ) : e.type === "client-added" ? (
                        <Building2 size={15} />
                      ) : e.type === "task-assigned" ? (
                        <UserRound size={15} />
                      ) : e.type === "comment" ? (
                        <MessageSquare size={15} />
                      ) : (
                        <Clock size={15} />
                      )}
                    </span>
                    <span>
                      <small>
                        {tr(
                          e.type === "auto-approved"
                            ? "Validation tacite"
                            : e.type === "reminder"
                              ? "Rappel"
                              : e.type === "sweep"
                                ? "Balayage J−1"
                                : e.type === "lock"
                                  ? "Verrou J−7"
                                  : e.type === "request"
                                    ? "Demande"
                                    : e.type === "client-added"
                                      ? "Nouveau client"
                                      : e.type === "task-assigned"
                                        ? "Assignation"
                                        : e.type === "comment"
                                          ? "Commentaire"
                                          : "Décision",
                        )}{" "}
                        · {timeLabel(e.createdAt)}
                      </small>
                      <strong>{e.name}</strong>
                    </span>
                    <ChevronRight size={15} />
                  </button>
                ))}
              </div>
            </section>
          ) : null;
        })()}
        {!!records.length && (
          <section className="client-overview">
            <div className="section-head">
              <div>
                <h2>
                  {tr("Vos clients")}
                  <span className="neutral-badge">
                    {clients.filter((c) => !c.archived).length}
                  </span>
                </h2>
                <p>{tr("Des relations qui font avancer le studio.")}</p>
              </div>
              <button
                className="text-link"
                onClick={() => navigate({ page: "clients" })}
              >
                {tr("Tous les clients")}
                <ArrowUpRight size={15} />
              </button>
            </div>
            <div className="client-strip">
              {clients
                .filter((c) => !c.archived)
                .slice(0, 4)
                .map((c) => (
                  <button
                    key={c.id}
                    onClick={() => navigate({ page: "client", id: c.id })}
                  >
                    <ClientMark name={c.name} logo={c.logo} />
                    <span>
                      <strong>{c.name}</strong>
                      <small>
                        {tr("{n} tâches actives", {
                          n: tasks.filter((t) => t.clientId === c.id).length,
                        })}
                      </small>
                    </span>
                    <ArrowUpRight size={16} />
                  </button>
                ))}
            </div>
          </section>
        )}
      </div>
    );
  }
  function ClientsPage() {
    const list = clients.filter(
      (c) =>
        !!c.archived === showArchived &&
        c.name.toLowerCase().includes(query.toLowerCase()),
    );
    return (
      <>
        <Heading
          emoji="🗂️"
          title={tr("Clients")}
          subtitle={tr(
            "{n} clients actifs — chaque relation, au même endroit.",
            { n: clients.filter((c) => !c.archived).length },
          )}
        />
        <div className="client-toolbar">
          <label className="search-input">
            <Search size={16} />
            <input
              placeholder={tr("Rechercher un client…")}
              aria-label={tr("Rechercher un client")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="grow" />
          {owner && (
            <button className="btn primary" onClick={() => open("client")}>
              <Plus size={16} />
              {tr("Nouveau client")}
            </button>
          )}
        </div>
        <div className="clients-grid">
          {list.map((c) => {
            const ts = tasks.filter((t) => t.clientId === c.id);
            return (
              <button
                className="client-card"
                key={c.id}
                onClick={() => navigate({ page: "client", id: c.id })}
              >
                <header>
                  <ClientMark name={c.name} logo={c.logo} size="lg" />
                  <ArrowUpRight size={18} />
                </header>
                <h2>{c.name}</h2>
                <p>
                  {c.sector || tr("Secteur à renseigner")} ·{" "}
                  {c.city || tr("Ville à renseigner")}
                </p>
                <div className="client-counts">
                  <span>
                    <strong>{ts.length}</strong>
                    {tr("Tâches")}
                  </span>
                  <span>
                    <strong>
                      {ts.filter((t) => t.status === "À valider").length}
                    </strong>
                    {tr("À valider")}
                  </span>
                  <span>
                    <strong>
                      {ts.filter((t) => t.status === "Validé").length}
                    </strong>
                    {tr("Validées")}
                  </span>
                </div>
                <footer>
                  <Avatar
                    name={ts[0]?.assignee || "Studio"}
                    avatar={avatarOf(ts[0]?.assignee)}
                  />
                  <small>
                    {tr("Créé le {date}", {
                      date: dateLabel(c.createdAt.slice(0, 10)),
                    })}
                  </small>
                </footer>
              </button>
            );
          })}
        </div>
        {!list.length && (
          <Blank
            title={
              showArchived ? tr("Aucun client archivé") : tr("Aucun client")
            }
            text={tr(
              owner
                ? "Ajoutez votre premier client pour organiser son travail."
                : "Seul le propriétaire peut ajouter des clients.",
            )}
          />
        )}
        <button
          className="add-row"
          onClick={() => setShowArchived(!showArchived)}
        >
          <Archive size={16} />
          {showArchived
            ? tr("Afficher les clients actifs")
            : tr("Archivés ({n})", {
                n: clients.filter((c) => c.archived).length,
              })}
          <ChevronRight size={14} />
        </button>
      </>
    );
  }
  function ClientPage() {
    if (!client) return <Blank title={tr("Client introuvable")} />;
    const tab = route.tab || "overview",
      ps = projects.filter((p) => p.clientId === client.id && !p.archived);
    return (
      <>
        {tab === "overview" && (
          <ClientImages
            client={client}
            workspaceId={workspace?.id || ""}
            canEdit={manager && !client.archived}
            onChange={(changes, message) => update(client, changes, message)}
            onError={setError}
          />
        )}
        <Heading
          emoji="📁"
          title={client.name}
          subtitle={`${client.sector || tr("Client")} · ${client.city || ""}${client.archived ? tr(" · Archivé") : ""}`}
          mark={
            tab === "overview" ? (
              <span
                className="page-symbol page-symbol-hidden"
                aria-hidden="true"
              />
            ) : (
              <ClientMark
                name={client.name}
                logo={client.logo}
                size="lg"
                className="page-symbol-mark"
              />
            )
          }
          action={
            <div className="inline">
              {manager && !client.archived && (
                <button
                  className="btn"
                  onClick={() => {
                    setClientNoticeNews("");
                    setClientNoticeError("");
                    setClientNoticeSent(0);
                    setClientNotice({ id: client.id, name: client.name });
                  }}
                >
                  <Bell size={15} />
                  {tr("Notifier le client")}
                </button>
              )}
              <button
                className="btn"
                disabled={!manager}
                onClick={() => open("client", client)}
              >
                {tr("Modifier la fiche")}
              </button>
            </div>
          }
        />
        <Tabs
          value={tab}
          onValueChange={(tab) =>
            navigate({ page: "client", id: client.id, tab })
          }
        >
          <TabsList variant="line" className="client-tabs">
            <TabsTrigger value="overview"><Sparkles size={15} />{tr("Aperçu")}</TabsTrigger>
            <TabsTrigger value="projects">
              <Folder size={15} />{tr("Sous-projets")} <small>{ps.length}</small>
            </TabsTrigger>
            <TabsTrigger value="tasks"><CheckSquare size={15} />{tr("Tâches")}</TabsTrigger>
            {social && <TabsTrigger value="editorial"><Megaphone size={15} />{tr("Social")}</TabsTrigger>}
            {social && <TabsTrigger value="plan"><CalendarDays size={15} />{tr("Plan Éditorial")}</TabsTrigger>}
            {owner && (
              <TabsTrigger value="documents">
                <FileText size={15} />{tr("Devis & factures")}
              </TabsTrigger>
            )}
          </TabsList>
        </Tabs>
        {tab === "overview" ? (
          <><ClientBriefBoard key={client.id} client={client} canEdit={manager && !client.archived} onSave={(brief, revision) => update({ ...client, revision: revision ?? client.revision }, { brief }, tr("Brief enregistré"))} /><div className="detail-split">
            <article>
              <div className="section-head">
                <h2>{tr("Sous-projets en cours")}</h2>
                <button
                  className="text-link"
                  onClick={() =>
                    navigate({ page: "client", id: client.id, tab: "projects" })
                  }
                >
                  {tr("Voir tout")}
                  <ArrowUpRight size={14} />
                </button>
              </div>
              {ps.map((p) => (
                <button
                  className="project-brief-row"
                  key={p.id}
                  onClick={() => {
                    navigate({ page: "client", id: client.id, tab: "tasks" });
                    setQuery("");
                  }}
                >
                  <Folder size={17} />
                  {p.name}
                  <small>
                    {tr("{n} tâches", {
                      n: tasks.filter((t) => t.projectId === p.id).length,
                    })}
                  </small>
                  <ChevronRight size={14} />
                </button>
              ))}
              {!ps.length && (
                <button
                  className="btn"
                  disabled={!writable}
                  onClick={() => open("project")}
                >
                  <Plus size={15} />
                  {tr("Nouveau sous-projet")}
                </button>
              )}
            </article>
            <aside>
              <h3>{tr("INFORMATIONS CLIENT")}</h3>
              <dl className="properties">
                {(
                  [
                    ["Contact", client.contact],
                    ["E-mail", client.email],
                    ["WhatsApp", client.whatsapp],
                    ["Secteur", client.sector],
                    ["Ville", client.city],
                    ["Langue", client.language ? tr(client.language) : ""],
                    ["Contenus vendus / mois", client.quota || "—"],
                    ["Publications", client.postApproval ? tr("Validées par le client") : tr("Publiées par le studio")],
                    [
                      "Accès portail",
                      members
                        .filter(
                          (m) =>
                            m.role === "client" && m.clientId === client.id,
                        )
                        .map(memberName)
                        .join(", ") ||
                        tr(manager ? "Aucun · inviter depuis Équipe" : "Aucun"),
                    ],
                    ["Créé le", dateLabel(client.createdAt.slice(0, 10))],
                  ] as [string, string | undefined][]
                ).map(([l, v]) => (
                  <div key={l}>
                    <dt>{tr(l)}</dt>
                    <dd>{v || "—"}</dd>
                  </div>
                ))}
              </dl>
              {manager && (
                <div className="aside-actions">
                  <button
                    className="btn"
                    onClick={() =>
                      navigate({ page: "portal", id: client.id, tab: "home" })
                    }
                  >
                    <Eye size={16} />
                    {tr("Aperçu du portail client")}
                    <ArrowUpRight size={15} />
                  </button>
                  <button
                    className="btn"
                    onClick={() => navigate({ page: "annex", id: client.id })}
                  >
                    <FileSignature size={16} />
                    {tr("Annexe contractuelle")}
                  </button>
                  <button
                    className="btn ghost"
                    onClick={() => open("archive", client)}
                  >
                    <Archive size={16} />
                    {tr(
                      client.archived
                        ? "Restaurer le client"
                        : "Archiver le client",
                    )}
                  </button>
                  {client.archived && owner && (
                    <button
                      className="btn danger"
                      onClick={() => setModal({ type: "delete", record: client })}
                    >
                      <Trash2 size={16} />
                      {tr("Supprimer définitivement")}
                    </button>
                  )}
                </div>
              )}
            </aside>
          </div></>
        ) : tab === "projects" ? (
          <>
            <div className="section-head">
              <h2>
                {ps.length === 1
                  ? tr("1 sous-projet")
                  : tr("{n} sous-projets", { n: ps.length })}
              </h2>
              <button className="btn primary" onClick={() => open("project")}>
                <Plus size={16} />
                {tr("Nouveau sous-projet")}
              </button>
            </div>
            {ps.map((p) => {
              const ts = tasks.filter((t) => t.projectId === p.id),
                done = ts.filter((t) => t.status === "Validé").length;
              return (
                <div className="project-row" key={p.id}>
                  <span className="client-mark">
                    <Folder size={20} />
                  </span>
                  <button
                    disabled={!writable}
                    onClick={() => open("project", p)}
                  >
                    <strong>{p.name}</strong>
                    <small>
                      {p.description || tr("Ajouter une description")}
                    </small>
                  </button>
                  <span>{tr("{n} tâches", { n: ts.length })}</span>
                  <div className="project-progress">
                    <Progress
                      value={ts.length ? (done / ts.length) * 100 : 0}
                    />
                    <small>
                      {tr("{done}/{total} validées", {
                        done,
                        total: ts.length,
                      })}
                    </small>
                  </div>
                  {manager && (
                    <button
                      className="icon-button"
                      aria-label={tr("Archiver {name}", { name: p.name })}
                      onClick={() => open("archive", p)}
                    >
                      <Archive size={16} />
                    </button>
                  )}
                </div>
              );
            })}
            {!ps.length && (
              <Blank
                title={tr("Le premier sous-projet vous attend")}
                text={tr(
                  "Un sous-projet regroupe les tâches d’une même mission.",
                )}
              />
            )}
            <details className="archived-projects">
              <summary>
                {tr("Sous-projets archivés ({n})", {
                  n: projects.filter(
                    (p) => p.clientId === client.id && p.archived,
                  ).length,
                })}
              </summary>
              {projects
                .filter((p) => p.clientId === client.id && p.archived)
                .map((p) => (
                  <div className="link-row" key={p.id}>
                    {p.name}
                    <button className="btn" onClick={() => open("archive", p)}>
                      {tr("Restaurer")}
                    </button>
                  </div>
                ))}
            </details>
          </>
        ) : tab === "tasks" ? (
          TaskDatabase()
        ) : tab === "plan" && social && workspace ? (
          <ContentPlanPage
            workspaceId={workspace.id}
            clientId={client.id}
            clientName={client.name}
            onNotice={setNotice}
            onError={setError}
            onOpenTask={(id) => navigate({ page: "task", id })}
            onRecordsChanged={reloadSilently}
          />
        ) : tab === "documents" && owner ? (
          <ClientDocuments
            client={client}
            records={records}
            busy={busy}
            onChange={mutate}
            onError={setError}
          />
        ) : tab === "editorial" && social && workspace ? (
          <SocialHub
            records={records}
            workspaceId={workspace.id}
            today={today}
            fixedClientId={client.id}
            mediaStorage={mediaStorage}
            mutate={mutate}
            reload={() => load(true)}
            onNotice={setNotice}
            onError={setError}
          />
        ) : null}
      </>
    );
  }
  function Comments() {
    if (!task) return null;
    return (
      <TaskChat
        key={task.id}
        messages={records.filter((r) => r.kind === "comment" && r.taskId === task.id)}
        workspaceId={workspace?.id}
        isMine={(c) => !!c.authorId && c.authorId === user.id}
        senderLabel={(c) => {
          if (c.audience === "client") return tr("Client");
          const role = members.find((m) => m.userId === c.authorId)?.role;
          return role ? tr(roleLabels[role]) : undefined;
        }}
        canWrite={writable && !archived(task)}
        busy={busy}
        onSend={async (message) => {
          await mutate({ action: "comment", taskId: task.id, ...message });
        }}
        onDelete={manager ? async (message) => { await mutate({ action: "comment-delete", id: message.id }); } : undefined}
        onError={setError}
      />
    );
  }
  function TaskPage() {
    if (!task) return <Blank title={tr("Tâche introuvable")} />;
    return (
      <>
        <button
          className="text-link back"
          onClick={() => navigate({ page: "tasks" })}
        >
          <ArrowLeft size={15} />
          {tr("Toutes les tâches")}
        </button>
        <Heading
          emoji="📝"
          title={task.name}
          subtitle={`${cname(task.clientId)} / ${pname(task.projectId)}${task.priority ? ` · Priorité ${task.priority}` : ""}`}
          action={
            <div className="inline">
              {manager && (
                <button
                  className="btn ghost danger"
                  aria-label={tr("Supprimer la tâche")}
                  title={tr("Supprimer")}
                  onClick={() => open("delete", task)}
                >
                  <Trash2 size={15} />
                </button>
              )}
              {manager && (
                <button className="btn" onClick={() => open("archive", task)}>
                  <Archive size={15} />
                  {tr(task.archived ? "Restaurer" : "Archiver")}
                </button>
              )}
              <button
                className="btn"
                disabled={!writable || archived(task)}
                onClick={() => open("task", task)}
              >
                <PenLine size={15} />
                {tr("Modifier")}
              </button>
              {task.status === "À valider" && manager && !archived(task) && (
                <>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => open("feedback", task)}
                  >
                    <RefreshCw size={15} />
                    {tr("Retours client")}
                  </button>
                  <button
                    className="btn primary"
                    disabled={busy}
                    onClick={() => open("approve", task)}
                  >
                    <Check size={15} />
                    {tr("Valider (accord reçu)")}
                  </button>
                </>
              )}
              {task.status === "Validé" &&
                !task.publishedAt &&
                !task.evergreen &&
                isPublishable(task) && (
                  <button
                    disabled={busy || archived(task)}
                    className="btn primary"
                    onClick={() =>
                      act(
                        { action: "publish", taskId: task.id },
                        tr("Contenu marqué publié"),
                      )
                    }
                  >
                    <Megaphone size={15} />
                    {tr("Marquer publié")}
                  </button>
                )}
            </div>
          }
        />
        <div className="task-state">
          <Chip status={task.status} />
          <CourtChip task={task} />
          {task.publishedAt && (
            <span className="flag-pill ok">
              <Megaphone size={11} />
              {tr("Publié le {date}", { date: timeLabel(task.publishedAt) })}
            </span>
          )}
          {task.evergreen && (
            <span className="flag-pill">
              <Sparkles size={11} />
              {tr("Réserve evergreen")}
            </span>
          )}
          {task.publishable === false && (
            <span className="flag-pill">
              <PenLine size={11} />
              {tr("Travail interne · non publié")}
            </span>
          )}
          {task.request && (
            <span className="flag-pill">
              <Inbox size={11} />
              {tr("Demande portail · {by}", { by: task.request.by })}
            </span>
          )}
          {revisionState(task).overBudget && (
            <span className="flag-pill warn">
              {tr("Hors forfait · tour {n}", { n: revisionState(task).used })}
            </span>
          )}
          {task.lockOverride && (
            <span className="flag-pill">
              <Unlock size={11} />
              {tr("Verrou J−{n} levé", { n: flow.lockDays })}
            </span>
          )}
          {archived(task) && (
            <span className="small-note">
              {tr(
                "Archivée · restaurez les éléments parents avant de reprendre le travail.",
              )}
            </span>
          )}
          {task.status === "À valider" && (
            <span className="small-note">
              <Clock size={12} />{" "}
              {tr(
                "Chez le client depuis le {since} · validation tacite dans {hours} h ({due})",
                {
                  since: timeLabel(task.sentAt),
                  hours: Math.max(
                    0,
                    Math.round(hoursLeft(task, new Date()) ?? 0),
                  ),
                  due: timeLabel(task.approvalDueAt),
                },
              )}
            </span>
          )}
        </div>
        {(() => {
          if (!isPublishable(task)) return null;
          const gates = gatesFor(task, today);
          return gates.length ? (
            <div className="gates">
              {gates.map((g) => (
                <div
                  key={g.key}
                  className={g.reached ? "reached" : g.late ? "late" : ""}
                >
                  <span>
                    {g.reached ? (
                      <Check size={12} />
                    ) : g.late ? (
                      <X size={12} />
                    ) : (
                      <Clock size={12} />
                    )}
                  </span>
                  <strong>{tr(g.label)}</strong>
                  <small>
                    J−{flow.gates.find((x) => x.key === g.key)!.offset} ·{" "}
                    {dateLabel(g.day)}
                  </small>
                </div>
              ))}
              <div className="gate-publish">
                <span>
                  <Megaphone size={12} />
                </span>
                <strong>{tr("Publication")}</strong>
                <small>
                  J · {dateLabel(task.due)}
                  {insideLock(task.due, today) && !task.sentAt
                    ? tr(" · dans la fenêtre gelée")
                    : ""}
                </small>
              </div>
            </div>
          ) : (
            <div className="gates none">
              <Sparkles size={13} />
              <span>
                {tr(
                  task.evergreen
                    ? "Contenu de réserve : sans date, prêt à combler un trou du calendrier."
                    : "Sans date de publication — les jalons apparaîtront une fois la date fixée.",
                )}
              </span>
              {!task.due && task.status === "Validé" && !task.publishedAt && (
                <button
                  className="btn"
                  disabled={busy || archived(task)}
                  onClick={() =>
                    update(
                      task,
                      { evergreen: !task.evergreen },
                      tr(
                        task.evergreen
                          ? "Retiré de la réserve"
                          : "Placé dans la réserve evergreen",
                      ),
                    )
                  }
                >
                  <Sparkles size={14} />
                  {tr(
                    task.evergreen
                      ? "Retirer de la réserve"
                      : "Mettre en réserve evergreen",
                  )}
                </button>
              )}
            </div>
          );
        })()}
        <div className="workflow">
          {deliverySteps.map((s, i) => {
            // A paused task is still "En cours" as far as the delivery milestones go.
            const reached = deliverySteps.indexOf(
              task.status === "En pause" ? "En cours" : (task.status as (typeof deliverySteps)[number]),
            );
            return (
              <div key={s} className={i <= reached ? "reached" : ""}>
                <span className={i === reached ? "current" : ""}>
                  {i < reached ? <Check size={14} /> : i + 1}
                </span>
                <strong>{tr(s)}</strong>
              </div>
            );
          })}
        </div>
        <div className="detail-split">
          <article>
            <div className="section-head">
              <h2>{tr("Brief")}</h2>
            </div>
            <p className="document-copy">
              {task.description || tr("Aucun brief renseigné.")}
            </p>
            <div className="section-head second">
              <h2>{tr("Livrable")}</h2>
            </div>
            <div className="deliverable">
              <div className="doc-thumb">
                <FileText size={30} />
              </div>
              <div>
                <strong>
                  {tr(link(task) ? "Fichier de livraison" : "Aucun livrable")}
                </strong>
                <small>
                  {task.deliverable ||
                    tr("Collez le lien de votre fichier pour le faire valider.")}
                </small>
                <div className="inline">
                  {link(task) && (
                    <a
                      className="btn"
                      href={link(task)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ArrowUpRight size={15} />
                      {tr("Ouvrir")}
                    </a>
                  )}
                  <button
                    className="btn"
                    disabled={archived(task)}
                    onClick={() => open("task", task)}
                  >
                    {tr(link(task) ? "Remplacer" : "Ajouter un lien")}
                  </button>
                  {task.status === "À valider" && manager && (
                    <button
                      className="btn"
                      onClick={() => navigate({ page: "review", id: task.id })}
                    >
                      <Eye size={15} />
                      {tr("Aperçu de la revue")}
                    </button>
                  )}
                </div>
              </div>
            </div>
            {Comments()}
          </article>
          <aside>
            <h3>{tr("PROPRIÉTÉS")}</h3>
            <dl className="properties">
              {[
                ["Client", cname(task.clientId)],
                ["Sous-projet", pname(task.projectId)],
                ["Assigné", task.assignee || tr("Non assigné")],
                ["Publication", dateLabel(task.due)],
                ["Canal", task.channel || "—"],
                [
                  "Tours de retours",
                  `${revisionState(task).used} / ${flow.maxRevisionRounds}${revisionState(task).overBudget ? tr(" · hors forfait") : ""}`,
                ],
                ["Créée le", dateLabel(task.createdAt.slice(0, 10))],
              ].map(([l, v]) => (
                <div key={l}>
                  <dt>{tr(l)}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
              <div>
                <dt>{tr("Lien de brief")}</dt>
                <dd>
                  {task.source && safeLink(task.source) ? (
                    <a
                      href={safeLink(task.source)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-link"
                    >
                      {tr("Ouvrir le brief")}
                      <ArrowUpRight size={14} />
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt>{tr("Statut")}</dt>
                <dd>
                  <Pick
                    label={tr("Statut de la tâche")}
                    value={task.status!}
                    onChange={(s) => {
                      if (s) void update(task, { status: s as Status });
                    }}
                    items={
                      manager
                        ? [...statuses]
                        : member
                          ? statuses.filter(
                              (s) =>
                                s === "À faire" ||
                                s === "En cours" ||
                                s === "En pause" ||
                                s === "À valider" ||
                                s === task.status,
                            )
                          : statuses.filter(
                              (s) =>
                                s !== "Validé" &&
                                (s !== "À valider" ||
                                  task.status === "À valider"),
                            )
                    }
                  />
                </dd>
              </div>
            </dl>
            {task.signOff && (
              <div className="receipt">
                <ShieldCheck size={16} />
                <div>
                  <strong>{tr("Reçu de validation")}</strong>
                  <small>
                    {tr(
                      task.signOff.mode === "silence"
                        ? "Validation tacite — délai écoulé"
                        : task.signOff.mode === "studio"
                          ? "Validation depuis le studio"
                          : "Validation explicite du client",
                    )}
                  </small>
                  <small>
                    {task.signOff.by}
                    {task.signOff.email ? ` · ${task.signOff.email}` : ""}
                  </small>
                  <small>
                    {timeLabel(task.signOff.at)} ·{" "}
                    {task.signOff.round === 1
                      ? tr("1 tour utilisé")
                      : tr("{n} tours utilisés", { n: task.signOff.round })}
                  </small>
                </div>
              </div>
            )}
            {(owner || manager) && writable && (
              <>
                <h3>{tr("TEMPS")}</h3>
                <TimeTracker task={task} />
              </>
            )}
            <h3 className="history-heading">{tr("HISTORIQUE")}</h3>
            <div className="history">
              {task.history
                ?.slice()
                .reverse()
                .map((e, i) => (
                  <div key={i}>
                    <span />
                    <p>
                      {e.text}
                      <small>{timeLabel(e.date)}</small>
                    </p>
                  </div>
                ))}
            </div>
          </aside>
        </div>
      </>
    );
  }
  const modalTitle = tr(
    modal?.type === "delete"
      ? modal.record?.kind === "client"
        ? "Supprimer ce client"
        : "Supprimer cette tâche"
      : modal?.type === "archive"
        ? modal.record?.archived
          ? "Restaurer cet élément"
          : "Archiver cet élément"
        : modal?.type === "approve"
          ? "Valider ce livrable"
          : modal?.type === "feedback"
            ? "Demander des modifications"
            : modal?.type === "client"
              ? modal.record
                ? "Modifier le client"
                : "Nouveau client"
              : modal?.type === "project"
                ? modal.record
                  ? "Modifier le sous-projet"
                  : "Nouveau sous-projet"
                : modal?.record
                    ? "Modifier la tâche"
                    : "Nouvelle tâche",
  );
  const routeTitle =
    route.page === "home"
      ? tr("Accueil")
      : route.page === "tasks"
        ? tr("Tâches")
        : route.page === "clients"
          ? tr("Clients")
          : route.page === "team"
            ? tr("Équipe")
            : route.page === "activity"
              ? tr("Activité")
            : route.page === "social"
              ? tr("Social")
            : route.page === "meetings"
              ? tr("Réunions")
            : route.page === "requests"
              ? tr("Demandes")
            : route.page === "ig"
              ? tr("Analyse Instagram")
            : route.page === "platform"
              ? tr("Plateforme")
            : route.page === "library"
              ? tr("Bibliothèque")
              : route.page === "flow"
                ? tr("Tableau de bord")
                : route.page === "annex"
                  ? tr("Annexe contractuelle")
                  : client?.name || task?.name || tr("Espace");
  // Before the first /api/records reply comes back, we don't yet know whether the visitor is
  // signed in — auth defaults to false, so without this the studio shell would flash on screen
  // for everyone, logged in or not, right before swapping to the login screen.
  if (!workspace && !auth && !noAccess && !changePassword && (loading || !error)) {
    return (
      <div className="boot-screen">
        <div className="boot-container">
          <img
            className="auth-logo"
            src="/the-one-core-logo.svg"
            alt="The One Core"
          />
          <div className="boot-progress-bar" />
          <p className="boot-status">
            {tr("Ouverture de votre espace…")}
            <small>{tr("Un instant, vos projets arrivent.")}</small>
          </p>
        </div>
      </div>
    );
  }
  // A workspace switch in flight (switchingTo is set for the duration of switchWorkspace()):
  // `workspace` state is still the workspace being left until the target's load() resolves, so
  // rendering that stale tree (e.g. Space's studio UI, mid-switch to Print) would flash the wrong
  // workspace's content. Show the target's branding and a spinner instead, inside the app's look.
  // `switchingTo` clears once the switch's request settles; on a failure the old workspace stays
  // (with the error shown), so the screen is tied to "target not loaded yet" rather than the flag alone.
  if (switchingTo && workspace?.id !== switchingTo) {
    const target = workspaces.find((w) => w.id === switchingTo);
    const toPrint = isPrintWorkspaceId(switchingTo);
    return (
      <div className="switch-screen" role="status" aria-live="polite">
        <Image
          className="switch-logo"
          src={toPrint ? "/the-one-print-logo-new.png" : "/the-one-core-logo.svg"}
          alt={toPrint ? "The One Print" : "The One Core"}
          width={588}
          height={138}
          priority
        />
        <p>
          <Loader2 size={16} className="spin" />
          {tr("Ouverture de {name}…", { name: target?.name ?? (toPrint ? "The One Print" : "The One Space") })}
        </p>
      </div>
    );
  }
  if (auth) return <Login />;
  if (changePassword) return <Login initialStep="change-password" />;
  if (noAccess)
    return (
      <div className="auth-screen">
        <div className="auth-form google-login">
          <img
            className="auth-logo"
            src="/the-one-core-logo.svg"
            alt="The One Core"
          />
          <h1>
            {tr("Accès sur invitation")}
            <span className="wordmark-dot">.</span>
          </h1>
          <p>
            {tr(
              "Votre compte ({email}) n’a pas d’espace attribué. Demandez au studio de vous inviter.",
              { email: user.email || tr("connecté") },
            )}
          </p>
          <div className="inline">
            <button className="btn primary" disabled={busy} onClick={logout}>
              <LogOut size={15} />
              {tr("Se déconnecter")}
            </button>
            <button className="btn" onClick={() => void load()}>
              <RefreshCw size={15} />
              {tr("Réessayer")}
            </button>
          </div>
        </div>
        <div className="auth-flow" />
      </div>
    );
  // The studio shell needs a workspace. Reaching this point without one means the load failed
  // (network, server error, an access that was revoked…): say so, with a way out, instead of
  // rendering an empty shell.
  if (!workspace)
    return (
      <div className="auth-screen">
        <div className="auth-form google-login">
          <Image
            className="auth-logo"
            src="/the-one-core-logo.svg"
            alt="The One Core"
            width={588}
            height={138}
          />
          <h1>
            {tr("Espace indisponible")}
            <span className="wordmark-dot">.</span>
          </h1>
          <p>{error || tr("Chargement impossible.")}</p>
          <div className="inline">
            <button className="btn primary" disabled={loading} onClick={() => void load()}>
              <RefreshCw size={15} />
              {tr("Réessayer")}
            </button>
            <button className="btn" disabled={busy} onClick={logout}>
              <LogOut size={15} />
              {tr("Se déconnecter")}
            </button>
          </div>
        </div>
        <div className="auth-flow" />
      </div>
    );
  const frameOptions: WorkspaceFrameOptions = {
    workspace,
    workspaces,
    user,
    busy: busy || loading,
    sidebarWidth,
    onResizeStart: onSidebarResizeStart,
    onWidthChange: setSidebarWidth,
    onSwitch: (id) => void switchWorkspace(id),
    // The print workspace is the studio's own (The One Print): not offered to companies that signed up.
    onCreatePrint: !platformOwner ? undefined : async () => {
      await mutate({ action: "create-print-workspace" });
      navigate({ page: "home" });
    },
    onProfile: async (changes) => {
      const data = await mutate({ action: "update-profile", ...changes });
      if (data.user) setUser(data.user);
      setNotice(tr("Profil mis à jour"));
      return data.user;
    },
    onLogout: () => void logout(),
  };
  // The floating assistant, on every screen of a workspace (studio, portal, print).
  // The assistant, and the call in progress (it goes on while moving around the app).
  const assistant = workspace ? <><Assistant workspaceId={workspace.id} role={workspace.role} page={route.page} name={user.name} onChanged={() => void load(true)} /><CallHost /></> : null;
  if (workspace && isPrintWorkspaceId(workspace.id)) {
    return (
      <>
      <PrintWorkspace
        frameOptions={frameOptions}
        key={workspace.id}
        records={records}
        workspace={workspace}
        workspaces={workspaces}
        members={members}
        user={user}
        busy={busy}
        loading={loading}
        error={error}
        today={today}
        mailConfigured={mailConfigured}
        mutate={mutate}
        onSwitch={switchWorkspace}
        onRefresh={() => void load()}
        onMember={changeMember}
        onLogout={() => void logout()}
      />
      {assistant}
      </>
    );
  }
  if (workspace?.role === "client") {
    const own = clients.find((c) => c.id === workspace.clientId);
    if (loading || !own)
      return (
        <div className="loading portal-loading">
          {loading ? (
            <Skeleton className="h-10 w-48" />
          ) : (
            <Blank
              title={tr("Accès client indisponible")}
              text={error || tr("Contactez le studio.")}
            />
          )}
        </div>
      );
    const r =
      route.page === "review" || route.page === "portal"
        ? route
        : { page: "portal", id: own.id, tab: "home" };
    return (
      <>
      <Portal
        mode="client"
        records={records}
        client={own}
        user={user}
        workspaceId={workspace?.id}
        onProfile={async (changes) => {
          const data = await mutate({ action: "update-profile", ...changes });
          if (data.user) setUser(data.user);
          setNotice(tr("Profil mis à jour"));
          return data.user;
        }}
        route={r}
        today={today}
        busy={busy}
        error={error}
        notice={notice}
        navigate={navigate}
        mutate={mutate}
        onNotice={setNotice}
        onError={setError}
        onLeave={logout}
      />
      {assistant}
      </>
    );
  }
  if (portal && currentClient)
    return (
      <>
      <Portal
        mode="preview"
        records={records}
        client={currentClient}
        user={user}
        workspaceId={workspace?.id}
        onProfile={async (changes) => {
          const data = await mutate({ action: "update-profile", ...changes });
          if (data.user) setUser(data.user);
          setNotice(tr("Profil mis à jour"));
          return data.user;
        }}
        route={route}
        today={today}
        busy={busy}
        error={error}
        notice={notice}
        navigate={navigate}
        mutate={mutate}
        onNotice={setNotice}
        onError={setError}
        onLeave={() => navigate({ page: "client", id: currentClient.id })}
      />
      {assistant}
      </>
    );
  return (
    <>
    <WorkspaceFrame
      {...frameOptions}
      tabs={[
        { icon: Home, label: tr("Accueil"), active: route.page === "home", onClick: () => navigate({ page: "home" }) },
        {
          icon: CheckSquare, label: tr("Tâches"), active: ["tasks", "task", "internal"].includes(route.page),
          badge: tasks.filter((t) => t.status === "À valider").length, onClick: () => navigate({ page: "tasks" }),
        },
        ...(social ? [{ icon: Megaphone, label: tr("Social"), active: route.page === "social", onClick: () => navigate({ page: "social" }) }] : []),
        { icon: Building2, label: tr("Clients"), active: route.page === "clients" || route.page === "client", onClick: () => navigate({ page: "clients" }) },
        ...(social ? [] : [{ icon: Users, label: tr("Équipe"), active: route.page === "team", onClick: () => navigate({ page: "team" }) }]),
      ]}
      notifications={records}
      onMarkNotificationsRead={(ids) => void mutate({ action: "mark-read", ids }).catch(() => {})}
      onOpenNotificationTask={(taskId) => navigate({ page: "task", id: taskId })}
      onOpenNotificationMeeting={() => navigate({ page: "meetings" })}
      onOpenNotificationRequests={() => navigate({ page: "requests" })}
      navigation={
        <>
          <>
            <SidebarGroup>
              <SidebarMenu>
                <NavItem
                  icon={Search}
                  label={tr("Rechercher")}
                  onClick={() => setSearchOpen(true)}
                />
                {manager && (
                  <NavItem
                    icon={Plus}
                    label={tr("Nouveau")}
                    onClick={() => open("task")}
                  />
                )}
              </SidebarMenu>
              <span className="keyboard-hint">{tr("⌘ K")}</span>
            </SidebarGroup>
            {(() => {
              // The sidebar in folding groups: the group of the page you're on opens by itself, a folded
              // group shows the sum of its counters, and each group remembers whether you folded it.
              const here = `${route.page}:${route.id ?? ""}`;
              const counts = {
                internal: tasks.filter((t) => t.clientId === "internal" && t.status !== "Validé").length,
                tasks: tasks.filter((t) => t.clientId !== "internal" && t.status !== "Validé").length,
                requests: manager ? records.filter((r) => r.kind === "request" && (r.requestStatus ?? "new") === "new").length : 0,
                meetings: records.filter((r) => r.kind === "meeting" && !r.cancelledAt && r.due === today).length,
                flow: manager ? records.filter((r) => r.kind === "event" && r.audience !== "client" && (!r.recipients || isEventRecipient(r, user.id)) && isEventUnreadFor(r, user.id)).length : 0,
              };
              const toReview = (clientId: string) => tasks.filter((t) => t.clientId === clientId && t.status === "À valider").length;
              const liveClients = clients.filter((c) => !c.archived);
              const group = (id: string, label: string, pages: string[], badge: number, items: React.ReactNode[], action?: React.ReactNode, droppable = false) => (
                <NavGroup id={id} label={label} badge={badge} badgeTitle={id === "clients" ? tr("{n} tâches à valider par les clients", { n: badge }) : undefined} active={pages.includes(route.page)} here={here} closedAt={navGroups.closed[id]} onToggle={navGroups.toggle} action={action} onDropItem={droppable ? (itemId, groupId) => setNavLayout({...navLayout, [itemId]: groupId}) : undefined}>
                  {items}
                </NavGroup>
              );
              
              const availableItems = {
                tasks: <NavItem dragId="tasks" key="tasks" icon={CheckSquare} label={tr("Tâches")} active={route.page === "tasks" || route.page === "task"} badge={counts.tasks} onClick={() => navigate({ page: "tasks" })} />,
                internal: <NavItem dragId="internal" key="internal" icon={Briefcase} label={tr("Tâches internes")} active={route.page === "internal"} badge={counts.internal} onClick={() => navigate({ page: "internal" })} />,
                requests: manager ? <NavItem dragId="requests" key="requests" icon={Inbox} label={tr("Demandes")} active={route.page === "requests"} badge={counts.requests} onClick={() => navigate({ page: "requests" })} /> : null,
                meetings: <NavItem dragId="meetings" key="meetings" icon={CalendarClock} label={tr("Réunions")} active={route.page === "meetings"} badge={counts.meetings} onClick={() => navigate({ page: "meetings" })} />,
                social: social ? <NavItem dragId="social" key="social" icon={Megaphone} label={tr("Social")} active={route.page === "social"} onClick={() => navigate({ page: "social" })} /> : null,
                ig: manager ? <NavItem dragId="ig" key="ig" icon={ChartNoAxesCombined} label={tr("Analyse Instagram")} active={route.page === "ig"} onClick={() => navigate({ page: "ig" })} /> : null,
                library: <NavItem dragId="library" key="library" icon={Library} label={tr("Bibliothèque")} active={route.page === "library"} onClick={() => navigate({ page: "library" })} />,
                team: <NavItem dragId="team" key="team" icon={Users} label={tr("Équipe")} active={route.page === "team"} onClick={() => navigate({ page: "team" })} />,
                activity: owner ? <NavItem dragId="activity" key="activity" icon={Activity} label={tr("Activité")} active={route.page === "activity"} onClick={() => navigate({ page: "activity" })} /> : null,
                platform: platformOwner && workspace && !isCompanyWorkspaceId(workspace.id) ? <NavItem dragId="platform" key="platform" icon={Building2} label={tr("Plateforme")} active={route.page === "platform"} onClick={() => navigate({ page: "platform" })} /> : null,
              };

              const groupDefs = [
                { id: "work", label: tr("Production") },
                { id: "content", label: tr("Contenu") },
                { id: "studio", label: tr("Studio") },
              ];

              return <>
                <SidebarGroup>
                  <SidebarMenu>
                    <NavItem icon={Home} label={tr("Accueil")} active={route.page === "home"} onClick={() => navigate({ page: "home" })} />
                    {manager && <NavItem icon={Gauge} label={tr("Tableau de bord")} active={route.page === "flow" || route.page === "annex"} badge={counts.flow} onClick={() => navigate({ page: "flow" })} />}
                  </SidebarMenu>
                </SidebarGroup>
                
                {groupDefs.map(g => {
                  const pageKeys = Object.entries(navLayout).filter(([, gId]) => gId === g.id).map(([page]) => page);
                  const items = pageKeys.map(k => availableItems[k as keyof typeof availableItems]).filter(Boolean);
                  if (!items.length) return null;
                  let badge = 0;
                  for (const key of pageKeys) if (key in counts) badge += (counts as Record<string, number>)[key] || 0;
                  return <Fragment key={g.id}>{group(g.id, g.label, pageKeys, badge, items, undefined, true)}</Fragment>;
                })}
                {group("clients", `${tr("Clients")} · ${liveClients.length}`, ["clients", "client"], liveClients.reduce((n, c) => n + toReview(c.id), 0), [
                  <NavItem key="all" icon={Building2} label={tr("Tous les clients")} active={route.page === "clients"} onClick={() => navigate({ page: "clients" })} />,
                  ...liveClients.map((c) => (
                    <NavItem
                      icon={Folder}
                      mark={c.logo ? <ClientMark name={c.name} logo={c.logo} size="sm" /> : undefined}
                      key={c.id}
                      label={c.name}
                      badge={toReview(c.id)}
                      badgeTone="client"
                      badgeTitle={toReview(c.id) === 1 ? tr("1 tâche à valider par le client") : tr("{n} tâches à valider par le client", { n: toReview(c.id) })}
                      active={route.page === "client" && route.id === c.id}
                      onClick={() => navigate({ page: "client", id: c.id })}
                    />
                  )),
                ], owner ? (
                  <button className="section-plus" aria-label={tr("Ajouter un client")} title={tr("Ajouter un client")} onClick={() => open("client")}>
                    <Plus size={14} />
                  </button>
                ) : undefined)}

                

                
              </>;
            })()}
          </>
        </>
      }
    >
      <main className="workspace">
        <header className="topbar">
          <SidebarTrigger aria-label={tr("Afficher le menu")} />
          <span className="workspace-label">
            <Briefcase size={14} />
            {workspace.name}
          </span>
          <ChevronRight size={13} />
          <span>{routeTitle}</span>
          <div className="grow" />
          <button
            className="top-search"
            onClick={() => setSearchOpen(true)}
            aria-label={tr("Rechercher dans le studio")}
          >
            <Search size={16} />
            <span>{tr("Rechercher…")}</span>
            <kbd>{tr("⌘ K")}</kbd>
          </button>
          {busy ? (
            <span className="save-state">
              <Loader2 className="spin" size={13} />
              {tr("Enregistrement…")}
            </span>
          ) : (
            <span className="save-state">
              <Lock size={12} />
              {tr("Privé")}
            </span>
          )}
          <button
            className="icon-button"
            aria-label={tr("Actualiser les données")}
            onClick={() => void load()}
          >
            <RefreshCw size={15} />
          </button>
        </header>
        <div className="page-content">
          <PlanBanner plan={plan} manager={!!manager} onOpen={() => navigate({ page: "team" })} />
          {error && (
            <div className="error-banner" role="alert">
              <span>{tr(error)}</span>
              <button className="btn" onClick={() => void load()}>
                {tr("Actualiser")}
              </button>
              <button
                aria-label={tr("Fermer l’erreur")}
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {loading ? (
            <div className="loading">
              <Skeleton className="h-10 w-48" />
              <Skeleton className="h-5 w-80" />
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : route.page === "home" ? (
            HomePage()
          ) : route.page === "tasks" || route.page === "internal" ? (
            <>
              <Heading
                emoji={route.page === "internal" ? "🏢" : "✅"}
                title={route.page === "internal" ? tr("Tâches internes") : tr("Tâches")}
                subtitle={route.page === "internal" ? tr("Gérez les tâches internes de l'agence.") : tr("Organisez les priorités. Faites avancer chaque projet.")}
              />
              {TaskDatabase()}
            </>
          ) : route.page === "clients" ? (
            ClientsPage()
          ) : route.page === "client" ? (
            ClientPage()
          ) : route.page === "task" ? (
            TaskPage()
          ) : route.page === "requests" && manager ? (
            <RequestsInbox
              records={records}
              clients={clients}
              members={members}
              today={today}
              busy={busy}
              mutate={mutate}
              onNotice={setNotice}
              onError={setError}
              onOpenTask={(id) => navigate({ page: "task", id })}
            />
          ) : route.page === "platform" && platformOwner ? (
            <PlatformPage onNotice={setNotice} onError={setError} />
          ) : route.page === "ig" && manager && workspace ? (
            <IgAnalyzer workspaceId={workspace.id} onError={setError} />
          ) : route.page === "meetings" ? (
            <MeetingsPage
              records={records}
              clients={clients}
              members={members}
              workspaceId={workspace?.id}
              userId={user.id}
              role={workspace?.role ?? "viewer"}
              busy={busy}
              mutate={mutate}
              onNotice={setNotice}
              onError={setError}
            />
          ) : route.page === "team" ? (
            <>
              {manager && plan?.subscription && (
                <SubscriptionPanel
                  plan={plan}
                  owner={workspace?.role === "owner"}
                  onRequest={(id) => mutate({ action: "request-plan", plan: id })}
                  onNotice={setNotice}
                  onError={setError}
                />
              )}
              {manager && workspace && !isPrintWorkspaceId(workspace.id) && (
                <BrandSettings
                  workspaceId={workspace.id}
                  onSave={(changes) => mutate({ action: "set-brand", ...changes })}
                  onNotice={setNotice}
                  onError={setError}
                />
              )}
              <TeamPage
                workspace={workspace}
                members={members}
                clients={clients}
                currentUserId={user.id}
                busy={busy}
                mailConfigured={mailConfigured}
                onChange={changeMember}
                onRefresh={load}
              />
            </>
          ) : route.page === "social" && social && workspace ? (
            <SocialHub
              records={records}
              workspaceId={workspace.id}
              today={today}
              mediaStorage={mediaStorage}
              mutate={mutate}
              reload={() => load(true)}
              onNotice={setNotice}
              onError={setError}
            />
          ) : route.page === "activity" && owner && workspace ? (
            <ActivityPage workspaceId={workspace.id} members={members} today={today} />
          ) : route.page === "library" && workspace ? (
            <LibraryPage
              records={records}
              workspaceId={workspace.id}
              userId={user.id}
              userName={user.name}
              role={workspace.role}
              busy={busy}
              onChange={mutate}
            />
          ) : route.page === "flow" ? (
            <FlowPage
              onCreateTask={manager ? () => open("task") : undefined}
              onBrowseTasks={({ focus, status, clientId }) => {
                navigate(clientId ? clientId === 'internal' ? { page: "internal" } : { page: "client", id: clientId, tab: "tasks" } : { page: "tasks", tab: "all" });
                if (status) setStatusFilter(status);
                else if (focus === 'review') setQuick('review');
                else if (focus === 'late') setQuick('late');
                else if (focus === 'done') setStatusFilter('Validé');
                else if (focus === 'active') setQuick('active');
              }}
              records={records}
              today={today}
              busy={busy}
              currentUserId={user.id}
              onOpenTask={(id) => navigate({ page: "task", id })}
              onOpenClient={(id) => navigate({ page: "client", id })}
              onMarkRead={async (ids) => {
                try {
                  await mutate({ action: "mark-read", ids });
                } catch (e) {
                  setError(tr((e as Error).message));
                }
              }}
              onRefresh={load}
            />
          ) : route.page === "annex" ? (
            <Annex
              studio={workspace?.name || "The One Core"}
              client={client?.name}
              onBack={() =>
                navigate(
                  client ? { page: "client", id: client.id } : { page: "flow" },
                )
              }
            />
          ) : (
            <Blank
              title={tr("Page introuvable")}
              action={
                <button
                  className="btn"
                  onClick={() => navigate({ page: "home" })}
                >
                  {tr("Retour à l’accueil")}
                </button>
              }
            />
          )}{" "}
        </div>
      </main>
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {notice}
        </div>
      )}
      <Dialog
        open={!!modal}
        onOpenChange={(o) => {
          if (!o && !busy) setModal(null);
        }}
      >
        <DialogContent className="tracker-modal">
          <DialogHeader>
            <DialogTitle>{modalTitle}</DialogTitle>
            <DialogDescription>
              {tr(
                modal?.type === "delete"
                  ? modal.record?.kind === "client"
                    ? "Définitif : le client et toutes ses données associées seront supprimés."
                    : "Définitif : la tâche, ses commentaires et son historique disparaissent. Pour la garder hors des vues actives, préférez « Archiver »."
                  : modal?.type === "archive"
                    ? "L’historique est conservé. Vous pourrez restaurer cet élément."
                    : modal?.type === "approve" || modal?.type === "feedback"
                      ? "Décision reçue hors portail (WhatsApp, réunion…), enregistrée au nom du studio et tracée dans l’historique."
                      : "Les modifications sont enregistrées dans votre espace privé.",
              )}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit}>
            {modal?.type === "delete" ? (
              <p className="confirm-copy">
                {tr("Supprimer « {name} » ?", {
                  name: modal.record?.name ?? "",
                })}
              </p>
            ) : modal?.type === "archive" ? (
              <p className="confirm-copy">
                {tr(
                  modal.record?.archived
                    ? "Restaurer « {name} » ?"
                    : "Archiver « {name} » ?",
                  { name: modal.record?.name ?? "" },
                )}{" "}
                {modal.record?.kind !== "task" && !modal.record?.archived
                  ? tr("Ses éléments associés seront masqués des vues actives.")
                  : ""}
              </p>
            ) : modal?.type === "approve" ? (
              <p className="confirm-copy">
                {tr(
                  "Confirmer la validation de « {name} » ? Le statut passera à « Validé ».",
                  { name: modal.record?.name ?? "" },
                )}
              </p>
            ) : modal?.type === "feedback" ? (
              <label className="form-field">
                <span>
                  {tr("Modifications demandées")}
                  {writable && (
                    <AiFix value={form.feedback || ""} kind="feedback" workspaceId={workspace?.id} onChange={(v) => set("feedback", v)} />
                  )}
                </span>
                <textarea
                  autoFocus
                  required
                  maxLength={5000}
                  rows={6}
                  value={form.feedback || ""}
                  onChange={(e) => set("feedback", e.target.value)}
                  placeholder={tr("Précisez ce qui doit être ajusté…")}
                />
              </label>
            ) : (
              <div className="form-fields">
                {memberTaskOnly && (
                  <p className="confirm-copy">
                    {tr(
                      "En tant que membre, vous ne pouvez modifier que le lien livrable et le statut de « {name} ».",
                      { name: modal?.record?.name ?? "" },
                    )}
                  </p>
                )}
                {memberTaskOnly && (
                  <label className="form-field">
                    <span>{tr("Statut")}</span>
                    <Pick
                      label={tr("Statut")}
                      value={form.status || "À faire"}
                      onChange={(v) => set("status", v || "À faire")}
                      items={[
                        ...new Set([
                          "À faire",
                          "En cours",
                          "À valider",
                          form.status || "À faire",
                        ]),
                      ]}
                    />
                  </label>
                )}
                {!memberTaskOnly && (
                  <label className="form-field title-field">
                    <span>
                      {tr("Nom *")}
                      {writable && modal?.type === "task" && (
                        <AiFix value={form.name || ""} kind="task" workspaceId={workspace?.id} onChange={(v) => set("name", v)} />
                      )}
                    </span>
                    <input
                      autoFocus
                      required
                      maxLength={160}
                      value={form.name || ""}
                      onChange={(e) => set("name", e.target.value)}
                      placeholder={tr(
                        modal?.type === "task" ? "Nom de la tâche" : "Nom",
                      )}
                    />
                  </label>
                )}
                {modal?.type !== "client" && !memberTaskOnly && form.clientId !== "internal" && (
                  <label className="form-field">
                    <span>{tr("Client *")}</span>
                    <Pick
                      label={tr("Client")}
                      value={form.clientId || ""}
                      onChange={(v) => set("clientId", v)}
                      items={clients
                        .filter((c) => !c.archived)
                        .map((c) => ({ value: c.id, label: c.name }))}
                    />
                  </label>
                )}
                {modal?.type === "task" && !memberTaskOnly && form.clientId !== "internal" && (
                  <label className="form-field">
                    <span>{tr("Sous-projet")}</span>
                    <Pick
                      label={tr("Sous-projet")}
                      emptyLabel={tr("Aucun sous-projet")}
                      value={form.projectId || ""}
                      onChange={(v) => set("projectId", v)}
                      items={projects
                        .filter(
                          (p) => p.clientId === form.clientId && !p.archived,
                        )
                        .map((p) => ({ value: p.id, label: p.name }))}
                    />
                  </label>
                )}
                {modal?.type === "task" && !memberTaskOnly && (
                  <>
                    <div className="form-pair">
                      <label className="form-field">
                        <span>{tr("Assigné")}</span>
                        <AssigneePick
                          label={tr("Assigné")}
                          emptyLabel={tr("Non assigné")}
                          value={form.assignee || ""}
                          onChange={(v) => set("assignee", v)}
                          items={[
                            ...new Set([
                              // Only the studio's people: a client contact is never assigned a task.
                              ...members.filter((m) => isStudioRole(m.role)).map(memberName),
                              ...(form.assignee ? [form.assignee] : []),
                            ]),
                          ].map((value) => ({
                            value,
                            avatar: avatarOf(value),
                            hint: titlesOf(value).map((title) => tr(title)).join(" · "),
                          }))}
                        />
                      </label>
                      <label className="form-field">
                        <span>{tr("Échéance")}</span>
                        <DatePicker
                          label={tr("Échéance")}
                          value={form.due || ""}
                          onChange={(value) => set("due", value)}
                        />
                      </label>
                      <label className="form-field">
                        <span>{tr("Priorité")}</span>
                        <Select value={form.priority || "Moyenne"} onValueChange={(v) => set("priority", v)}>
                          <SelectTrigger className="pick" aria-label={tr("Priorité")}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Basse">{tr("Basse")}</SelectItem>
                            <SelectItem value="Moyenne">{tr("Moyenne")}</SelectItem>
                            <SelectItem value="Haute">{tr("Haute")}</SelectItem>
                            <SelectItem value="Urgente">{tr("Urgente")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </label>
                    </div>
                    <div className="form-pair">
                      <label className="form-field">
                        <span>{tr("Lien de brief")}</span>
                        <input
                          type="url"
                          maxLength={2000}
                          value={form.source || ""}
                          onChange={(e) => set("source", e.target.value)}
                          placeholder="https://…"
                        />
                        <small>
                          {tr(
                            "Lien vers le brief, le message ou la demande client.",
                          )}
                        </small>
                      </label>
                      <label className="form-field">
                        <span>{tr("Statut")}</span>
                        <Pick
                          label={tr("Statut")}
                          value={form.status || "À faire"}
                          onChange={(v) => set("status", v || "À faire")}
                          items={[...statuses]}
                        />
                      </label>
                    </div>
                  </>
                )}
                {modal?.type === "task" && (
                  <label className="form-field">
                    <span>{tr("Livrable")}</span>
                    <input
                      type="url"
                      maxLength={2000}
                      value={form.deliverable || ""}
                      onChange={(e) => set("deliverable", e.target.value)}
                      placeholder="https://…"
                    />
                    {memberTaskOnly && (
                      <small>
                        {tr(
                          "Ajouter un lien envoie automatiquement la tâche en validation.",
                        )}
                      </small>
                    )}
                  </label>
                )}
                {modal?.type === "task" && !memberTaskOnly && (
                  <>
                    <label className="form-check">
                      <input
                        type="checkbox"
                        checked={form.publishable !== "false"}
                        onChange={(e) =>
                          set("publishable", e.target.checked ? "" : "false")
                        }
                      />
                      <span>
                        <strong>{tr("Contenu publiable")}</strong>
                        <small>
                          {tr(
                            "Vidéo, affiche, post… Décochez pour un travail interne (copywriting, prémontage) : hors plan éditorial, sans jalons ni verrou.",
                          )}
                        </small>
                      </span>
                    </label>
                    <label className="form-check">
                      <input
                        type="checkbox"
                        checked={form.evergreen === "true"}
                        onChange={(e) =>
                          set("evergreen", e.target.checked ? "true" : "")
                        }
                      />
                      <span>
                        <strong>{tr("Réserve evergreen")}</strong>
                        <small>
                          {tr(
                            "Contenu sans date, validé à l’avance pour combler un trou du calendrier.",
                          )}
                        </small>
                      </span>
                    </label>
                    {form.due &&
                      form.publishable !== "false" &&
                      insideLock(form.due, today) &&
                      form.due !== modal.record?.due && (
                        <p className="lock-note">
                          <Lock size={13} />
                          {tr(
                            "Verrou J−{n} : cette date tombe dans la semaine gelée.",
                            { n: flow.lockDays },
                          )}{" "}
                          {canManageMembers(workspace?.role || "viewer")
                            ? tr(
                                "Vous pourrez lever le verrou à l’enregistrement.",
                              )
                            : tr("Un administrateur devra lever le verrou.")}
                        </p>
                      )}
                  </>
                )}
                {modal?.type === "client" && (
                  <>
                    <div className="form-pair">
                      <label className="form-field">
                        <span>{tr("Secteur")}</span>
                        <input
                          value={form.sector || ""}
                          onChange={(e) => set("sector", e.target.value)}
                        />
                      </label>
                      <label className="form-field">
                        <span>{tr("Ville")}</span>
                        <input
                          value={form.city || ""}
                          onChange={(e) => set("city", e.target.value)}
                        />
                      </label>
                    </div>
                    <div className="form-pair">
                      <label className="form-field">
                        <span>{tr("Contact principal")}</span>
                        <input
                          value={form.contact || ""}
                          onChange={(e) => set("contact", e.target.value)}
                        />
                      </label>
                      <label className="form-field">
                        <span>{tr("E-mail")}</span>
                        <input
                          type="email"
                          value={form.email || ""}
                          onChange={(e) => set("email", e.target.value)}
                        />
                      </label>
                    </div>
                    <label className="form-field">
                      <span>{tr("WhatsApp")}</span>
                      <input
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        maxLength={30}
                        value={form.whatsapp || ""}
                        onChange={(e) => set("whatsapp", e.target.value)}
                        placeholder="+212 6 12 34 56 78"
                      />
                      <small>
                        {tr("Reçoit un message WhatsApp chaque fois qu’un contenu est prêt à valider. Format international.")}
                      </small>
                    </label>
                    <label className="check-field">
                      <input
                        type="checkbox"
                        checked={form.postApproval === "true"}
                        onChange={(e) => set("postApproval", e.target.checked ? "true" : "")}
                      />
                      <span>
                        <strong>{tr("Le client valide ses publications")}</strong>
                        <small>{tr("Chaque publication programmée attend sa validation dans son portail avant de partir.")}</small>
                      </span>
                    </label>
                    <div className="form-pair">
                      <label className="form-field">
                        <span>{tr("Contenus vendus / mois")}</span>
                        <input
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={3}
                          value={form.quota || ""}
                          onChange={(e) =>
                            set("quota", e.target.value.replace(/\D/g, ""))
                          }
                          placeholder={tr("ex. 12")}
                        />
                        <small>
                          {tr("Sert au ratio « livré vs vendu » du pilotage.")}
                        </small>
                      </label>
                      <label className="form-field">
                        <span>{tr("Langue du portail")}</span>
                        <Pick
                          label={tr("Langue")}
                          value={form.language || "Français"}
                          onChange={(v) => set("language", v || "Français")}
                          items={["Français", "English", "العربية"]}
                        />
                      </label>
                    </div>
                    <label className="form-field">
                      <span>{tr("Dossier partagé")}</span>
                      <input
                        type="url"
                        value={form.drive || ""}
                        onChange={(e) => set("drive", e.target.value)}
                        placeholder="https://…"
                      />
                    </label>
                    <label className="form-field">
                      <span>{tr("Lien du contrat")}</span>
                      <input
                        type="url"
                        value={form.contract || ""}
                        onChange={(e) => set("contract", e.target.value)}
                        placeholder="https://…"
                      />
                    </label>
                  </>
                )}
                {!memberTaskOnly && (
                  <label className="form-field">
                    <span>
                      {tr(modal?.type === "client" ? "La marque" : "Description")}
                      {writable && (
                        <AiFix value={form.description || ""} kind="brief" workspaceId={workspace?.id} onChange={(v) => set("description", v)} />
                      )}
                    </span>
                    <textarea
                      rows={4}
                      maxLength={15000}
                      value={form.description || ""}
                      onChange={(e) => set("description", e.target.value)}
                      placeholder={tr("Objectifs, références et consignes…")}
                    />
                  </label>
                )}

              </div>
            )}
            {formError && (
              <p role="alert" className="form-error">
                {formError}
              </p>
            )}
            <DialogFooter className="modal-footer">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => setModal(null)}
              >
                {tr("Annuler")}
              </button>
              <button
                className={`btn primary ${modal?.type === "delete" ? "danger" : ""}`}
                disabled={busy}
              >
                {busy ? (
                  <>
                    <Loader2 size={15} className="spin" />
                    {tr("Enregistrement…")}
                  </>
                ) : (
                  tr(
                    modal?.type === "delete"
                      ? "Supprimer définitivement"
                      : modal?.type === "archive"
                        ? modal.record?.archived
                          ? "Restaurer"
                          : "Archiver"
                        : modal?.type === "approve"
                          ? "Confirmer la validation"
                          : modal?.type === "feedback"
                            ? "Enregistrer les retours"
                            : modal?.record
                              ? "Enregistrer"
                              : modal?.type === "task"
                                ? "Créer la tâche"
                                : "Créer",
                  )
                )}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="tracker-modal search-modal">
          <DialogHeader>
            <DialogTitle>{tr("Rechercher dans l’espace")}</DialogTitle>
            <DialogDescription>
              {tr("Clients, sous-projets et tâches.")}
            </DialogDescription>
          </DialogHeader>
          <label className="search-input">
            <Search size={18} />
            <input
              autoFocus
              value={globalQuery}
              onChange={(e) => setGlobalQuery(e.target.value)}
              placeholder={tr("Nom d’une tâche, d’un client…")}
              aria-label={tr("Recherche globale")}
            />
          </label>
          <div className="search-results">
            {records
              .filter(
                (r) =>
                  ["client", "task", "project"].includes(r.kind) &&
                  !archived(r) &&
                  r.name.toLowerCase().includes(globalQuery.toLowerCase()),
              )
              .slice(0, 15)
              .map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    navigate({
                      page: r.kind === "task" ? "task" : "client",
                      id: r.kind === "project" ? r.clientId : r.id,
                      tab: r.kind === "project" ? "projects" : undefined,
                    });
                    setSearchOpen(false);
                  }}
                >
                  {r.kind === "task" ? (
                    <FileText size={16} />
                  ) : (
                    <Folder size={16} />
                  )}
                  <span>
                    {r.name}
                    <small>
                      {tr(
                        r.kind === "task"
                          ? "Tâche"
                          : r.kind === "project"
                            ? "Sous-projet"
                            : "Client",
                      )}
                    </small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))}
            {!records.some(
              (r) =>
                ["client", "task", "project"].includes(r.kind) &&
                !archived(r) &&
                r.name.toLowerCase().includes(globalQuery.toLowerCase()),
            ) && <p>{tr("Aucun résultat.")}</p>}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!lockPrompt}
        onOpenChange={(o) => {
          if (!o && !busy) setLockPrompt(null);
        }}
      >
        <DialogContent className="tracker-modal">
          <DialogHeader>
            <DialogTitle>
              {tr("Lever le verrou J−{n} ?", { n: flow.lockDays })}
            </DialogTitle>
            <DialogDescription>
              {tr(
                "Le calendrier est gelé {days} jours avant chaque publication. Lever le verrou pour « {name} » ({date}) sera inscrit dans l’historique.",
                {
                  days: flow.lockDays,
                  name: lockPrompt?.data?.name ?? "",
                  date: lockPrompt?.data?.due ?? "",
                },
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="modal-footer">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => setLockPrompt(null)}
            >
              {tr("Annuler")}
            </button>
            <button
              className="btn primary"
              disabled={busy}
              onClick={async () => {
                if (!lockPrompt) return;
                try {
                  const r = await mutate({ ...lockPrompt, lockOverride: true });
                  setLockPrompt(null);
                  setModal(null);
                  setFormError("");
                  if (lockPrompt.action === "create" && lockPrompt.kind === "task") setInlineTask(null);
                  setNotice(
                    tr(
                      lockPrompt.action === "create"
                        ? "Verrou levé · contenu créé"
                        : "Verrou levé · modification enregistrée",
                    ),
                  );
                  if (lockPrompt.action === "create" && r?.id)
                    navigate({ page: "task", id: r.id });
                } catch (e) {
                  setError(tr((e as Error).message));
                }
              }}
            >
              <Unlock size={15} />
              {tr("Lever le verrou")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!clientNotice}
        onOpenChange={(o) => {
          if (!o && !clientNoticeBusy) setClientNotice(null);
        }}
      >
        <DialogContent className="tracker-modal">
          <DialogHeader>
            <DialogTitle>
              {tr("Notifier {name}", { name: clientNotice?.name ?? "" })}
            </DialogTitle>
            <DialogDescription>
              {tr(
                "Un e-mail part vers les accès portail de ce client (ou sa fiche, à défaut), avec ses éléments en attente de validation et l’actualité ci-dessous.",
              )}
            </DialogDescription>
          </DialogHeader>
          {!mailConfigured ? (
            <p className="form-error" role="alert">
              {tr("L’envoi d’e-mail n’est pas configuré pour cet espace.")}
            </p>
          ) : (
            <div className="form-fields">
              <div className="form-field">
                <span>{tr("À valider")}</span>
                {(() => {
                  const pending = tasks.filter(
                    (t) => t.clientId === clientNotice?.id && t.status === "À valider",
                  );
                  return pending.length ? (
                    <ul className="notice-pending-list">
                      {pending.map((t) => (
                        <li key={t.id}>{t.name}</li>
                      ))}
                    </ul>
                  ) : (
                    <small>{tr("Rien en attente de validation pour ce client.")}</small>
                  );
                })()}
              </div>
              <label className="form-field">
                <span>{tr("Actualités")}</span>
                <textarea
                  rows={4}
                  maxLength={2000}
                  value={clientNoticeNews}
                  disabled={clientNoticeBusy}
                  onChange={(e) => setClientNoticeNews(e.target.value)}
                  placeholder={tr("Un mot pour le client (optionnel)…")}
                />
              </label>
              {clientNoticeError && (
                <p className="form-error" role="alert">
                  {clientNoticeError}
                </p>
              )}
              {!!clientNoticeSent && (
                <p className="confirm-copy">
                  {tr("Envoyé à {n} adresse(s).", { n: clientNoticeSent })}
                </p>
              )}
            </div>
          )}
          <DialogFooter className="modal-footer">
            <button
              type="button"
              className="btn"
              disabled={clientNoticeBusy}
              onClick={() => setClientNotice(null)}
            >
              {tr("Fermer")}
            </button>
            {mailConfigured && (
              <button
                className="btn primary"
                disabled={clientNoticeBusy}
                onClick={async () => {
                  if (!clientNotice) return;
                  setClientNoticeBusy(true);
                  setClientNoticeError("");
                  try {
                    const r = await mutate({
                      action: "notify-client",
                      clientId: clientNotice.id,
                      news: clientNoticeNews,
                    });
                    setClientNoticeSent(r.emailCount || 1);
                  } catch (e) {
                    setClientNoticeError(tr((e as Error).message));
                  } finally {
                    setClientNoticeBusy(false);
                  }
                }}
              >
                <Bell size={15} />
                {clientNoticeBusy ? tr("Envoi…") : tr("Envoyer")}
              </button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WorkspaceFrame>
    {assistant}
    </>
  );
}

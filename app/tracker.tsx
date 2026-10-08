"use client";
import { formatTimestamp } from "@/lib/time";
import { whatsappFormatHint, whatsappInputMaxLength } from "@/lib/whatsapp-number";
import { useEffect, useState, useCallback, useRef, useMemo, Fragment } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import { Home, CheckSquare, Users, Activity, Search, Plus, ChevronRight, FileText, Folder, Clock, RefreshCw, Lock, LogOut, Loader2, Briefcase, X, CheckCircle2, Gauge, Inbox, Bell, Megaphone, Unlock, Building2, Library, CalendarClock, ChartNoAxesCombined } from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-provider";
import SubscriptionPanel, { PlanBanner } from "@/features/plans/subscription-panel";
import PlatformPage from "@/features/platform/platform-page";
import BrandSettings from "@/features/workspace/brand-settings";
import { AiFix } from "@/features/assistant/ai-assist";
import Assistant from "@/features/assistant/assistant";
import NotificationBell from "@/features/workspace/notification-bell";
import WorkspaceFrame, {
  type WorkspaceFrameOptions,
} from "@/features/workspace/workspace-frame";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { RecordItem, Status, statuses, safeLink } from "@/lib/model";
import Login from "@/features/auth/login";
import { useActivityBeat } from "@/features/activity/activity-beat";
import MeetingsPage, { CallHost } from "@/features/meetings/meetings";
import RequestsInbox from "@/features/requests/requests-inbox";
import IgAnalyzer from "@/features/ig-analyzer/ig-analyzer";
import DatePicker from "@/components/date-picker";
import TeamPage from "@/features/team/team";
import { memberName, canManageMembers, canSocial, isManager, isMemberRole, isPrintWorkspaceId, isCompanyWorkspaceId, type MemberChange, isStudioRole } from "@/lib/workspace";
import ClientMark from "@/features/clients/client-mark";
// Screens most people don't open on every visit load on demand, so the sign-in screen and the
// studio's home don't download the portal, the print workspace, charts or the Social hub first.
const PrintWorkspace = dynamic(() => import("@/features/printing/print-workspace"));
const Portal = dynamic(() => import("@/features/portal/portal"));
const SocialHub = dynamic(() => import("@/features/social/social-hub"));
const FlowPage = dynamic(() => import("@/features/flow/flow-page"));
const ActivityPage = dynamic(() => import("@/features/activity/activity-page"));
const LibraryPage = dynamic(() => import("@/features/library/library-page"));
const Annex = dynamic(() => import("@/features/flow/annex"));
import { flow, insideLock, isEventRecipient, isEventUnreadFor, shiftDay } from "@/lib/flow";
import { taskReturnRoute } from "@/lib/navigation";
import { useWorkspaceNavigation } from "@/features/workspace/use-workspace-navigation";
import { useWorkspaceSession, type Mutation } from "@/features/workspace/use-workspace-session";
import { AssigneePick, Pick } from "@/features/tasks/task-controls";
import { archivedIndex, dueTone, filterTasks, quickTests as taskQuickTests, type DueTone } from "@/features/tasks/model";
import { TaskDatabase } from "@/features/tasks/task-database";
import { TaskPage } from "@/features/tasks/task-page";
import { HomePage } from "@/features/dashboard/home-page";
import { ClientsPage } from "@/features/clients/clients-page";
import { ClientPage } from "@/features/clients/client-page";
import { useTaskListView } from "@/features/tasks/use-task-list-view";
import type { StudioActions, StudioData, StudioLookups, StudioRoles } from "@/features/workspace/screen-props";
import { NavGroup, NavItem, useNavGroups, useNavLayout, useSidebarWidth } from "@/features/workspace/sidebar-nav";
import { Blank } from "@/components/empty-state";
import { Heading } from "@/components/page-heading";
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

export default function Tracker() {
  const { t: tr, tag, rtl } = useI18n();
  const {
    workflowSettings, workflowRevision, records, user, setUser, loading, error, setError, auth, busy, setBusy, notice, setNotice,
    workspace, members, workspaces, switchingTo, today, noAccess, changePassword, mailConfigured, platformOwner, plan, mediaStorage,
    load, mutate, switchWorkspace: openWorkspace, logout,
  } = useWorkspaceSession();
  const [lockPrompt, setLockPrompt] = useState<Mutation | null>(null);
  const [clientNotice, setClientNotice] = useState<{ id: string; name: string } | null>(null);
  const [clientNoticeNews, setClientNoticeNews] = useState("");
  const [clientNoticeBusy, setClientNoticeBusy] = useState(false);
  const [clientNoticeError, setClientNoticeError] = useState("");
  const [clientNoticeSent, setClientNoticeSent] = useState(0);
  const list = useTaskListView();
  const {
    query, statusFilter, setStatusFilter, assigneeFilter, courtFilter, sort, quick, setQuick,
    peekId, setPeekId, showArchived, inlineTask, setInlineTask, listView, defaultListView, restoreListView: restoreList,
  } = list;
  const [modal, setModal] = useState<Modal | null>(null),
    [form, setForm] = useState<Form>({}),
    [formError, setFormError] = useState(""),
    [searchOpen, setSearchOpen] = useState(false),
    [globalQuery, setGlobalQuery] = useState("");
  const restoreListView = useCallback((saved: typeof defaultListView) => { restoreList(saved); setFormError(""); }, [restoreList]);
  const { sidebarWidth, setSidebarWidth, onSidebarResizeStart } = useSidebarWidth(rtl);
  const { route, navigate, goBack } = useWorkspaceNavigation({ workspaceId: workspace?.id ?? null, view: listView, defaultView: defaultListView, restoreView: restoreListView });
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
      navigate({ page: "home" });
    if (role !== "owner" && route.page === "activity")
      navigate({ page: "home" });
    if (!canSocial(role) && (route.page === "social" || (route.page === "client" && route.tab === "editorial")))
      navigate({ page: "home" });
    if (!isManager(role) && route.page === "client" && route.tab === "files")
      navigate({ page: "client", id: route.id, tab: "overview" });
    if (role === "client" && !["portal", "review"].includes(route.page))
      navigate({ page: "portal", id: workspace.clientId || "", tab: "home" });
  }, [workspace, route.page, route.tab, navigate]);
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
    await openWorkspace(id, () => navigate({ page: "home" }));
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
              : change.action === "set-member-whatsapp"
                ? "Numéro WhatsApp enregistré."
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
        if (saved.whatsapp.sent) setNotice(tr("Envoyé en validation · WhatsApp accepté par Meta"));
        else setError(tr(saved.whatsapp.error || "L’envoi WhatsApp a échoué."));
      }

      if (saved?.assignmentWhatsapp?.sent) setNotice(tr("Assignation enregistrée · WhatsApp accepté par Meta"));

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
      const result = await mutate(body);
      setNotice(message);
      if (result.whatsapp?.sent || result.assignmentWhatsapp?.sent) setNotice(tr("Notification WhatsApp acceptée par Meta"));
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

  const manager = !!workspace && isManager(workspace.role),
    member = !!workspace && isMemberRole(workspace.role);
  // A member's only edit on a task is the deliverable link; every other field stays locked.
  const memberTaskOnly = member && modal?.type === "task" && !!modal.record;
  const archived = useMemo(() => archivedIndex(records), [records]);
  const tasks = records.filter((r) => r.kind === "task" && !archived(r));
  const allTasks = records.filter((r) => r.kind === "task");
  const assigneeOptions = [
    ...new Set([
      ...members.filter((m) => isStudioRole(m.role)).map(memberName),
      ...allTasks.map((t) => t.assignee || "").filter(Boolean),
    ]),
  ];
  const client = clients.find((c) => c.id === route.id) || null;
  const task = records.find((r) => (r.kind === "task" || r.kind === "plan_item") && r.id === route.id) || null;
  const currentClient =
    route.page === "portal"
      ? clients.find((c) => c.id === route.id)
      : route.page === "review"
        ? clients.find((c) => c.id === task?.clientId)
        : client;
  const portal = route.page === "portal" || route.page === "review";
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
      ? formatTimestamp(date, tag, {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit", hourCycle: "h23",
        })
      : "";
  const link = (t: RecordItem) => safeLink(t.deliverable || "");
  const baseFiltered = filterTasks(
    allTasks,
    { showArchived, route, statusFilter, assigneeFilter, courtFilter, query, sort },
    { archived, cname, tag },
  );
  // Quick chips on the task list (Mes tâches, En retard…), counted on the list as filtered above.
  const quickTests = taskQuickTests(user, today);
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
  }, [peekId, setPeekId]);
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
          goBack(taskReturnRoute(t.clientId));
        if (route.page === "client" && route.id === t.id)
          goBack({ page: "clients" }, (r) => r.page !== "client" && r.page !== "portal" && r.page !== "review");
        return;
      }
      if (modal.type === "feedback" || modal.type === "approve") {
        const t = modal.record!;
        if (modal.type === "feedback" && !form.feedback?.trim())
          throw Error(tr("Précisez les modifications demandées."));
        let extraPending = false;
        // Studio preview actions are explicitly attributed to the signed-in owner.
        if (modal.type === "feedback") {
          const reply = await mutate({ action: "request-changes", taskId: t.id, text: form.feedback });
          extraPending = !!reply.extraRequestId;
        } else await mutate({ action: "approve", taskId: t.id });
        setModal(null);
        setNotice(
          tr(
            modal.type === "approve"
              ? "Validation enregistrée depuis le studio · reçu créé"
              : extraPending ? "Demande hors forfait enregistrée. Le livrable est en pause jusqu’à l’accord sur le devis extra." : "Retours enregistrés · tour de modifications compté",
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
        if (result.whatsapp.sent) setNotice(tr("Envoyé en validation · WhatsApp accepté par Meta"));
        else setError(tr(result.whatsapp.error || "L’envoi WhatsApp a échoué."));
      }
      if (result?.assignmentWhatsapp?.sent) setNotice(tr("Assignation enregistrée · WhatsApp accepté par Meta"));
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
  // ---- the task list: due dates in words, groups, quick chips, and the side panel
  const dueInfo = (t: RecordItem): { tone: DueTone; label: string } => {
    const { tone, days } = dueTone(t, today);
    if (tone === "none") return { tone, label: tr("Sans date") };
    if (tone === "late") return { tone, label: tr("En retard · {n} j", { n: -days! }) };
    if (tone === "today") return { tone, label: tr("Aujourd’hui") };
    if (tone === "soon" && days === 1) return { tone, label: tr("Demain") };
    return { tone, label: dateLabel(t.due) };
  };
  const duePill = (t: RecordItem) => {
    const d = dueInfo(t);
    return <span className={`due-pill ${d.tone}`}>{d.tone === "late" && <Clock size={11} />}{d.label}</span>;
  };
  const studioData: StudioData = { records, clients, projects, tasks, allTasks, members, user, workspace, today, busy, mediaStorage, workflowSettings };
  const roles: StudioRoles = { owner, manager, member, writable, social };
  const lookups: StudioLookups = { archived, cname, pname, avatarOf, titlesOf, dateLabel, timeLabel, link, dueInfo, duePill };
  const studioActions: StudioActions = { navigate, goBack, open, update, act, mutate, setError, setNotice, load, reloadSilently };
  const openClientNotice = (c: RecordItem) => {
    setClientNoticeNews("");
    setClientNoticeError("");
    setClientNoticeSent(0);
    setClientNotice({ id: c.id, name: c.name });
  };
  const taskDatabase = () => (
    <TaskDatabase data={studioData} roles={roles} lookups={lookups} actions={studioActions} list={list}
      baseFiltered={baseFiltered} filtered={filtered} quickTests={quickTests} assigneeOptions={assigneeOptions}
      currentClient={currentClient} submitInlineTask={submitInlineTask} />
  );
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
    workflowSettings, workflowRevision,
    onWorkflowSave: async (data, revision) => { const reply = await mutate({ action: "set-workflow-settings", data, revision }); setNotice(tr("Règles de validation mises à jour")); return reply.workflowRevision!; },
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
  const assistant = workspace ? <><Assistant key={`${workspace.id}:${workspace.role}`} workspaceId={workspace.id} role={workspace.role} page={route.page} name={user.name} onChanged={() => void load(true)} /><CallHost onChanged={() => void load(true)} onNotice={setNotice} /></> : null;
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
        onBack={() => goBack({ page: "portal", id: own.id, tab: "tasks" })}
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
        onBack={() => goBack({ page: "portal", id: currentClient.id, tab: "tasks" })}
        mutate={mutate}
        onNotice={setNotice}
        onError={setError}
        onLeave={() => goBack({ page: "client", id: currentClient.id }, (r) => r.page !== "portal" && r.page !== "review")}
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
        ...(manager ? [{
          icon: Inbox, label: tr("Demandes"), active: route.page === "requests",
          badge: records.filter((r) => r.kind === "request" && (r.requestStatus ?? "new") === "new").length,
          onClick: () => navigate({ page: "requests" }),
        }] : []),
        ...(social ? [{ icon: Megaphone, label: tr("Social"), active: route.page === "social", onClick: () => navigate({ page: "social" }) }] : []),
        { icon: Building2, label: tr("Clients"), active: route.page === "clients" || route.page === "client", onClick: () => navigate({ page: "clients" }) },
        ...(social ? [] : [{ icon: Users, label: tr("Équipe"), active: route.page === "team", onClick: () => navigate({ page: "team" }) }]),
      ]}
      navigation={
        <>
          <>
            <SidebarGroup>
              <SidebarMenu>
                <NavItem
                  icon={Search}
                  label={tr("Rechercher")}
                  shortcut="⌘ K"
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
            </SidebarGroup>
            {(() => {
              // The sidebar in folding groups: the group of the page you're on opens by itself, a folded
              // group shows the sum of its counters, and each group remembers whether you folded it.
              const here = `${route.page}:${route.id ?? ""}`;
              const counts = {
                internal: tasks.filter((t) => t.clientId === "internal" && t.status !== "Validé").length,
                tasks: tasks.filter((t) => t.clientId !== "internal" && t.status !== "Validé").length,
                requests: manager ? records.filter((r) => r.kind === "request" && (r.requestStatus ?? "new") === "new").length : 0,
                meetings: records.filter((r) => r.kind === "meeting" && !r.cancelledAt && !r.endedAt && r.due === today).length,
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
                  <button className="section-plus" data-sidebar-dismiss aria-label={tr("Ajouter un client")} title={tr("Ajouter un client")} onClick={() => open("client")}>
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
            <kbd aria-hidden="true"><bdi dir="ltr">⌘ K</bdi></kbd>
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
          <NotificationBell
            records={records}
            currentUserId={user.id}
            rtl={rtl}
            onMarkRead={(ids) => void mutate({ action: "mark-read", ids }).catch(() => {})}
            onMarkAllRead={() => mutate({ action: "mark-read", all: true })}
            onOpenTask={(id) => navigate({ page: "task", id })}
            onOpenMeeting={() => navigate({ page: "meetings" })}
            onOpenRequests={() => navigate({ page: "requests" })}
          />
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
            <HomePage data={studioData} roles={roles} lookups={lookups} actions={studioActions} list={list} />
          ) : route.page === "tasks" || route.page === "internal" ? (
            <>
              <Heading
                emoji={route.page === "internal" ? "🏢" : "✅"}
                title={route.page === "internal" ? tr("Tâches internes") : tr("Tâches")}
                subtitle={route.page === "internal" ? tr("Gérez les tâches internes de l'agence.") : tr("Organisez les priorités. Faites avancer chaque projet.")}
              />
              {taskDatabase()}
            </>
          ) : route.page === "clients" ? (
            <ClientsPage data={studioData} roles={roles} lookups={lookups} actions={studioActions} listView={list} />
          ) : route.page === "client" ? (
            <ClientPage client={client} route={route} data={studioData} roles={roles} lookups={lookups} actions={studioActions} list={list}
              onNotifyClient={openClientNotice} onDeleteClient={(c) => setModal({ type: "delete", record: c })} renderTasks={taskDatabase} />
          ) : route.page === "task" ? (
            <TaskPage task={task} data={studioData} roles={roles} lookups={lookups} actions={studioActions} />
          ) : route.page === "requests" && manager ? (
            <RequestsInbox
              canQuote={owner}
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
              workflowSettings={workflowSettings}
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
              workflowSettings={client?.effectiveWorkflow ?? workflowSettings}
              studio={workspace?.name || "The One Core"}
              client={client?.name}
              onBack={() =>
                goBack(
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
                      <span id="client-whatsapp-label">{tr("WhatsApp")}</span>
                      <input
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        dir="ltr"
                        aria-labelledby="client-whatsapp-label"
                        aria-describedby="client-whatsapp-format"
                        maxLength={whatsappInputMaxLength}
                        value={form.whatsapp || ""}
                        onChange={(e) => set("whatsapp", e.target.value)}
                        placeholder="0612345678"
                      />
                      <small id="client-whatsapp-format">{tr(whatsappFormatHint)}</small>
                      <small>
                        {tr("Reçoit un message WhatsApp chaque fois qu’un contenu est prêt à valider.")}
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

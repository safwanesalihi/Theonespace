"use client";
// The studio's sidebar navigation (search, new task, home and dashboard, the folding page groups a
// person can rearrange, and every live client with what waits for their approval) and the top bar.
import { behaviourOf, groupIds, groupLabels, isDone, pageIds, pageLabels, type PageId } from "@/lib/process";
import { useProcess } from "@/features/workspace/process-context";
import { Fragment } from "react";
import { SidebarGroup, SidebarMenu, SidebarTrigger } from "@/components/ui/sidebar";
import ClientMark from "@/features/clients/client-mark";
import NotificationBell from "@/features/workspace/notification-bell";
import { NavGroup, NavItem, useNavGroups, useNavLayout } from "@/features/workspace/sidebar-nav";
import { isEventRecipient, isEventUnreadFor } from "@/lib/flow";
import { useI18n } from "@/lib/i18n/locale-provider";
import { isCompanyWorkspaceId } from "@/lib/workspace";
import { Home, CheckSquare, Users, Activity, Search, Plus, ChevronRight, Folder, RefreshCw, Lock, Loader2, Briefcase, Gauge, Inbox, Megaphone, Building2, Library, CalendarClock, ChartNoAxesCombined, UserSearch, Camera, Handshake, SlidersHorizontal } from "lucide-react";
import type { RecordItem } from "@/lib/model";
import type { WorkspaceRoute } from "@/lib/navigation";
import type { StudioData, StudioRoles } from "@/features/workspace/screen-props";
import type { WorkspacePayload } from "@/features/workspace/use-workspace-session";

export function StudioNavigation({ route, data, roles, platformOwner, navigate, onSearch, onNew, onAddClient }: {
  route: WorkspaceRoute;
  data: Pick<StudioData, "records" | "clients" | "tasks" | "today" | "user" | "workspace">;
  roles: Pick<StudioRoles, "owner" | "manager" | "social">;
  platformOwner: boolean;
  navigate: (route: WorkspaceRoute) => void;
  onSearch: () => void;
  onNew: () => void;
  onAddClient: () => void;
}) {
  const { t: tr } = useI18n();
  const { records, clients, tasks, today, user, workspace } = data;
  const process = useProcess();
  const { owner, manager, social } = roles;
  const navGroups = useNavGroups();
  // The studio's pages (lib/process.ts): which are used, their names and groups.
  const on = (id: string) => process.pages[id as PageId]?.on !== false;
  const name = (id: PageId) => process.pages[id]?.label?.trim() || tr(pageLabels[id]);
  const [navLayout, setNavLayout] = useNavLayout({ ...Object.fromEntries(pageIds.map((id) => [id, process.pages[id].group])), platform: "studio" });
  return (
    <>
      <SidebarGroup>
        <SidebarMenu>
          <NavItem
            icon={Search}
            label={tr("Rechercher")}
            shortcut="⌘ K"
            onClick={onSearch}
          />
          {manager && (
            <NavItem
              icon={Plus}
              label={tr("Nouveau")}
              onClick={onNew}
            />
          )}
        </SidebarMenu>
      </SidebarGroup>
      {(() => {
        // The sidebar in folding groups: the group of the page you're on opens by itself, a folded
        // group shows the sum of its counters, and each group remembers whether you folded it.
        const here = `${route.page}:${route.id ?? ""}`;
        const counts = {
          internal: tasks.filter((t) => t.clientId === "internal" && !isDone(t.status, process)).length,
          tasks: tasks.filter((t) => t.clientId !== "internal" && !isDone(t.status, process)).length,
          requests: manager ? records.filter((r) => r.kind === "request" && (r.requestStatus ?? "new") === "new").length : 0,
          meetings: records.filter((r) => r.kind === "meeting" && !r.cancelledAt && !r.endedAt && r.due === today).length,
          shoots: records.filter((r) => r.kind === "shoot" && !r.cancelledAt && !r.endedAt && r.due === today).length,
          crm: manager ? records.filter((r) => r.kind === "prospect" && !!r.due && r.due <= today && r.prospectStage !== "won" && r.prospectStage !== "lost").length : 0,
          flow: manager ? records.filter((r) => r.kind === "event" && r.audience !== "client" && (!r.recipients || isEventRecipient(r, user.id)) && isEventUnreadFor(r, user.id)).length : 0,
        };
        const toReview = (clientId: string) => tasks.filter((t) => t.clientId === clientId && behaviourOf(t.status, process) === "client").length;
        const liveClients = clients.filter((c) => !c.archived);
        const group = (id: string, label: string, pages: string[], badge: number, items: React.ReactNode[], action?: React.ReactNode, droppable = false) => (
          <NavGroup id={id} label={label} badge={badge} badgeTitle={id === "clients" ? tr("{n} tâches à valider par les clients", { n: badge }) : undefined} active={pages.includes(route.page)} here={here} closedAt={navGroups.closed[id]} onToggle={navGroups.toggle} action={action} onDropItem={droppable ? (itemId, groupId) => setNavLayout({...navLayout, [itemId]: groupId}) : undefined}>
            {items}
          </NavGroup>
        );

        const availableItems = {
          tasks: <NavItem dragId="tasks" key="tasks" icon={CheckSquare} label={name("tasks")} active={route.page === "tasks" || route.page === "task"} badge={counts.tasks} onClick={() => navigate({ page: "tasks" })} />,
          internal: <NavItem dragId="internal" key="internal" icon={Briefcase} label={name("internal")} active={route.page === "internal"} badge={counts.internal} onClick={() => navigate({ page: "internal" })} />,
          requests: manager ? <NavItem dragId="requests" key="requests" icon={Inbox} label={name("requests")} active={route.page === "requests"} badge={counts.requests} onClick={() => navigate({ page: "requests" })} /> : null,
          shoots: <NavItem dragId="shoots" key="shoots" icon={Camera} label={name("shoots")} active={route.page === "shoots"} badge={counts.shoots} onClick={() => navigate({ page: "shoots" })} />,
          meetings: <NavItem dragId="meetings" key="meetings" icon={CalendarClock} label={name("meetings")} active={route.page === "meetings"} badge={counts.meetings} onClick={() => navigate({ page: "meetings" })} />,
          crm: manager ? <NavItem dragId="crm" key="crm" icon={Handshake} label={name("crm")} active={route.page === "crm"} badge={counts.crm} onClick={() => navigate({ page: "crm" })} /> : null,
          social: social ? <NavItem dragId="social" key="social" icon={Megaphone} label={name("social")} active={route.page === "social"} onClick={() => navigate({ page: "social" })} /> : null,
          ig: manager ? <NavItem dragId="ig" key="ig" icon={ChartNoAxesCombined} label={name("ig")} active={route.page === "ig"} onClick={() => navigate({ page: "ig" })} /> : null,
          "ig-search": manager ? <NavItem dragId="ig-search" key="ig-search" icon={UserSearch} label={name("ig-search")} active={route.page === "ig-search"} onClick={() => navigate({ page: "ig-search" })} /> : null,
          library: <NavItem dragId="library" key="library" icon={Library} label={name("library")} active={route.page === "library"} onClick={() => navigate({ page: "library" })} />,
          team: <NavItem dragId="team" key="team" icon={Users} label={name("team")} active={route.page === "team"} onClick={() => navigate({ page: "team" })} />,
          activity: owner ? <NavItem dragId="activity" key="activity" icon={Activity} label={name("activity")} active={route.page === "activity"} onClick={() => navigate({ page: "activity" })} /> : null,
          platform: platformOwner && workspace && !isCompanyWorkspaceId(workspace.id) ? <NavItem dragId="platform" key="platform" icon={Building2} label={tr("Plateforme")} active={route.page === "platform"} onClick={() => navigate({ page: "platform" })} /> : null,
        };

        const groupDefs = [
          ...groupIds.map((id) => ({ id, label: process.groups[id]?.label?.trim() || tr(groupLabels[id]) })),
        ];

        return <>
          <SidebarGroup>
            <SidebarMenu>
              <NavItem icon={Home} label={tr("Accueil")} active={route.page === "home"} onClick={() => navigate({ page: "home" })} />
              {owner && <NavItem icon={SlidersHorizontal} label={tr("Personnaliser")} active={route.page === "customize"} onClick={() => navigate({ page: "customize" })} />}
              {manager && <NavItem icon={Gauge} label={tr("Tableau de bord")} active={route.page === "flow" || route.page === "annex"} badge={counts.flow} onClick={() => navigate({ page: "flow" })} />}
            </SidebarMenu>
          </SidebarGroup>

          {groupDefs.map(g => {
            const pageKeys = Object.entries(navLayout).filter(([page, gId]) => gId === g.id && on(page)).map(([page]) => page);
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
            <button className="section-plus" data-sidebar-dismiss aria-label={tr("Ajouter un client")} title={tr("Ajouter un client")} onClick={onAddClient}>
              <Plus size={14} />
            </button>
          ) : undefined)}




        </>;
      })()}
    </>
  );
}

export function StudioTopbar({ workspaceName, routeTitle, busy, records, userId, rtl, onSearch, onRefresh, mutate, navigate }: {
  workspaceName: string;
  routeTitle: string;
  busy: boolean;
  records: RecordItem[];
  userId: string;
  rtl: boolean;
  onSearch: () => void;
  onRefresh: () => void;
  mutate: (body: unknown) => Promise<WorkspacePayload>;
  navigate: (route: WorkspaceRoute) => void;
}) {
  const { t: tr } = useI18n();
  return (
    <header className="topbar">
      <SidebarTrigger aria-label={tr("Afficher le menu")} />
      <span className="workspace-label">
        <Briefcase size={14} />
        {workspaceName}
      </span>
      <ChevronRight size={13} />
      <span>{routeTitle}</span>
      <div className="grow" />

      <button
        className="top-search"
        onClick={onSearch}
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
        onClick={onRefresh}
      >
        <RefreshCw size={15} />
      </button>
      <NotificationBell
        records={records}
        currentUserId={userId}
        rtl={rtl}
        onMarkRead={(ids) => void mutate({ action: "mark-read", ids }).catch(() => {})}
        onMarkAllRead={() => mutate({ action: "mark-read", all: true })}
        onOpenTask={(id) => navigate({ page: "task", id })}
        onOpenMeeting={() => navigate({ page: "meetings" })}
        onOpenRequests={() => navigate({ page: "requests" })}
      />
    </header>
  );
}

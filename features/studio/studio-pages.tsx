"use client";
// The studio's pages, by route: home, tasks, clients, a client, a task, requests, platform, Instagram
// analysis, meetings, team, social, activity, library, dashboard and the contractual annex. Each page
// gets only what it needs; the ones most people don't open on every visit load on demand.
import { Blank } from "@/components/empty-state";
import { Heading } from "@/components/page-heading";
import { Skeleton } from "@/components/ui/skeleton";
import IgAnalyzer from "@/features/ig-analyzer/ig-analyzer";
import IgSearch from "@/features/ig-analyzer/ig-search";
import MeetingsPage from "@/features/meetings/meetings";
import SubscriptionPanel, { PlanBanner } from "@/features/plans/subscription-panel";
import PlatformPage from "@/features/platform/platform-page";
import RequestsInbox from "@/features/requests/requests-inbox";
import TeamPage from "@/features/team/team";
import BrandSettings from "@/features/workspace/brand-settings";
import { useI18n } from "@/lib/i18n/locale-provider";
import { X } from "lucide-react";
import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import type { RecordItem } from "@/lib/model";
import type { WorkspaceRoute } from "@/lib/navigation";
import type { Invitation, MemberChange } from "@/lib/workspace";
import type { PlanPayload } from "@/features/plans/subscription-panel";
import { ClientPage } from "@/features/clients/client-page";
import { ClientsPage } from "@/features/clients/clients-page";
import { HomePage } from "@/features/dashboard/home-page";
import { TaskPage } from "@/features/tasks/task-page";
import type { TaskListView } from "@/features/tasks/use-task-list-view";
import type { ScreenProps } from "@/features/workspace/screen-props";
const SocialHub = dynamic(() => import("@/features/social/social-hub"));
const ShootsPage = dynamic(() => import("@/features/shoots/shoots-page"));
const CrmPage = dynamic(() => import("@/features/crm/crm-page"));
const FlowPage = dynamic(() => import("@/features/flow/flow-page"));
const ActivityPage = dynamic(() => import("@/features/activity/activity-page"));
const LibraryPage = dynamic(() => import("@/features/library/library-page"));
const Annex = dynamic(() => import("@/features/flow/annex"));

export function StudioPages({ route, client, task, loading, error, plan, platformOwner, mailConfigured, data, roles, lookups, actions, list, changeMember, onNotifyClient, onDeleteClient, renderTasks }: ScreenProps & {
  route: WorkspaceRoute;
  /** The client and the task the route points at, if any. */
  client: RecordItem | null;
  task: RecordItem | null;
  loading: boolean;
  error: string;
  plan: PlanPayload | null;
  platformOwner: boolean;
  mailConfigured: boolean;
  list: TaskListView;
  changeMember: (change: MemberChange) => Promise<Invitation | undefined>;
  onNotifyClient: (client: RecordItem) => void;
  onDeleteClient: (client: RecordItem) => void;
  renderTasks: () => ReactNode;
}) {
  const { t: tr } = useI18n();
  const { records, clients, members, user, workspace, today, busy, mediaStorage, workflowSettings } = data;
  const { owner, manager, social } = roles;
  const { navigate, goBack, open, mutate, setError, setNotice, load } = actions;
  const { setStatusFilter, setQuick } = list;
  return (
    <>
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
        <HomePage data={data} roles={roles} lookups={lookups} actions={actions} list={list} />
      ) : route.page === "tasks" || route.page === "internal" ? (
        <>
          <Heading
            emoji={route.page === "internal" ? "🏢" : "✅"}
            title={route.page === "internal" ? tr("Tâches internes") : tr("Tâches")}
            subtitle={route.page === "internal" ? tr("Gérez les tâches internes de l'agence.") : tr("Organisez les priorités. Faites avancer chaque projet.")}
          />
          {renderTasks()}
        </>
      ) : route.page === "clients" ? (
        <ClientsPage data={data} roles={roles} lookups={lookups} actions={actions} listView={list} />
      ) : route.page === "client" ? (
        <ClientPage client={client} route={route} data={data} roles={roles} lookups={lookups} actions={actions} list={list}
          onNotifyClient={onNotifyClient} onDeleteClient={onDeleteClient} renderTasks={renderTasks} />
      ) : route.page === "task" ? (
        <TaskPage task={task} data={data} roles={roles} lookups={lookups} actions={actions} />
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
        <IgAnalyzer key={route.id ?? ""} workspaceId={workspace.id} onError={setError} initial={route.id} />
      ) : route.page === "ig-search" && manager && workspace ? (
        <IgSearch workspaceId={workspace.id} onError={setError} onAnalyze={(username) => navigate({ page: "ig", id: username })} />
      ) : route.page === "shoots" ? (
        <ShootsPage
          records={records}
          clients={clients}
          members={members}
          userId={user.id}
          role={workspace?.role ?? "viewer"}
          today={today}
          busy={busy}
          mutate={mutate}
          onNotice={setNotice}
          onError={setError}
        />
      ) : route.page === "crm" && manager ? (
        <CrmPage
          records={records}
          role={workspace?.role ?? "viewer"}
          today={today}
          busy={busy}
          mutate={mutate}
          onNotice={setNotice}
          onError={setError}
          onOpenClient={(id) => navigate({ page: "client", id })}
        />
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
          {manager && workspace && (
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
          canAnalyse={manager}
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
      )}
    </>
  );
}

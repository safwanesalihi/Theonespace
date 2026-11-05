"use client";
// The studio's pages, by route: home, tasks, a client, a task, requests, platform, Instagram analysis,
// meetings, settings, social, activity, library, dashboard and the contractual annex. Each page
// gets only what it needs; the ones most people don't open on every visit load on demand.
import { firstOf, type PageId } from "@/lib/process";
import { offersBuild } from "@/lib/agency-builder";
import { useProcess } from "@/features/workspace/process-context";
import { Blank } from "@/components/empty-state";
import { Heading } from "@/components/page-heading";
import { Skeleton } from "@/components/ui/skeleton";
import { PlanBanner } from "@/features/plans/subscription-panel";
import IgAnalyzer from "@/features/ig-analyzer/ig-analyzer";
import IgSearch from "@/features/ig-analyzer/ig-search";
import MeetingsPage from "@/features/meetings/meetings";
import PlatformPage from "@/features/platform/platform-page";
import RequestsInbox from "@/features/requests/requests-inbox";
import type { WorkflowSettings } from "@/lib/workflow-settings";
import { useI18n } from "@/lib/i18n/locale-provider";
import { X } from "lucide-react";
import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import type { RecordItem } from "@/lib/model";
import type { WorkspaceRoute } from "@/lib/navigation";
import type { Invitation, MemberChange } from "@/lib/workspace";
import type { PlanPayload } from "@/features/plans/subscription-panel";
import { ClientPage } from "@/features/clients/client-page";
import { HomePage } from "@/features/dashboard/home-page";
import { StudioSettings, type DriveResult } from "@/features/studio/studio-settings";
import type { ProfileUser } from "@/features/workspace/settings-dialog";
import { TaskPage } from "@/features/tasks/task-page";
import type { TaskListView } from "@/features/tasks/use-task-list-view";
import type { ScreenProps } from "@/features/workspace/screen-props";
const SocialHub = dynamic(() => import("@/features/social/social-hub"));
const ShootsPage = dynamic(() => import("@/features/shoots/shoots-page"));
const BuildAgency = dynamic(() => import("@/features/customize/build-agency"));
const CrmPage = dynamic(() => import("@/features/crm/crm-page"));
const FlowPage = dynamic(() => import("@/features/flow/flow-page"));
const ActivityPage = dynamic(() => import("@/features/activity/activity-page"));
const LibraryPage = dynamic(() => import("@/features/library/library-page"));
const Annex = dynamic(() => import("@/features/flow/annex"));

export function StudioPages({ route, client, task, loading, error, plan, platformOwner, mailConfigured, data, roles, lookups, actions, list, changeMember, onNotifyClient, onDeleteClient, renderTasks, workflowRevision, onWorkflowSave, onProfile, onLogout, driveResult }: ScreenProps & {
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
  workflowRevision: number;
  onWorkflowSave: (data: WorkflowSettings, revision: number) => Promise<number>;
  onProfile: (changes: { name?: string; avatar?: string | null }) => Promise<ProfileUser | undefined>;
  onLogout: () => void;
  driveResult?: DriveResult;
}) {
  const { t: tr } = useI18n();
  const studioProcess = useProcess();
  const { records, clients, members, user, workspace, today, busy, mediaStorage, workflowSettings } = data;
  const { owner, manager, social } = roles;
  const { navigate, goBack, open, mutate, setError, setNotice, load } = actions;
  const { setStatusFilter, setQuick } = list;
  // A new agency's owner first builds their agency (features/customize/build-agency.tsx), once.
  const build = !loading && offersBuild({ workspaceId: workspace?.id, owner: !!owner, process: studioProcess, processRevision: data.processRevision, hasWork: records.some((r) => r.kind === "task" || r.kind === "client") });
  return (
    <>
      {build && <BuildAgency data={data} actions={actions} onDone={() => navigate({ page: "home" })} />}
      <PlanBanner plan={plan} manager={!!manager} onOpen={() => navigate({ page: "settings", tab: "plan" })} />
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
      ) : route.page in studioProcess.pages && !studioProcess.pages[route.page as PageId].on ? (
        // A page the studio turned off (lib/process.ts pages): its links are gone, an old link lands here.
        <Blank title={tr("Cette page n’est pas utilisée dans ce studio.")} text={tr("Le propriétaire peut la réactiver dans « Personnaliser ».")} />
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
          mayPlan={roles.can("meetings")}
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
      ) : route.page === "settings" ? (
        <StudioSettings
          route={route}
          plan={plan}
          mailConfigured={mailConfigured}
          data={data}
          roles={roles}
          lookups={lookups}
          actions={actions}
          list={list}
          changeMember={changeMember}
          workflowRevision={workflowRevision}
          onWorkflowSave={onWorkflowSave}
          onProfile={onProfile}
          onLogout={onLogout}
          driveResult={driveResult}
        />
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
          onCreateTask={roles.can("tasks.create") ? () => open("task") : undefined}
          canAnalyse={manager}
          onBrowseTasks={({ focus, status, clientId }) => {
            navigate(clientId ? clientId === 'internal' ? { page: "internal" } : { page: "client", id: clientId, tab: "tasks" } : { page: "tasks" });
            if (status) setStatusFilter(status);
            else if (focus === 'review') setQuick('review');
            else if (focus === 'late') setQuick('late');
            else if (focus === 'done') setStatusFilter(firstOf(studioProcess, 'done') ?? '');
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
          heading
          title={tr("Page introuvable")}
          text={tr("Ce lien ne mène à aucune page de votre espace.")}
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

"use client";
// The signed-in app (app/page.tsx). It holds the session, the navigation and the task list's view,
// derives the workspace's data once, and composes the screens: a client gets their portal, the print
// workspace its own app, and the studio the frame with its navigation, pages and dialogs.
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Building2, CheckSquare, Home, Inbox, Megaphone, Users } from "lucide-react";
import { NoticeToaster } from "@/components/notice-toaster";
import { Blank } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { GlassLight } from "@/components/ui/glass-light";
import { Sky } from "@/components/ui/sky";
import { useI18n } from "@/lib/i18n/locale-provider";
import { canSocial, isManager, isMemberRole, type WorkspaceContext } from "@/lib/workspace";
import { useActivityBeat } from "@/features/activity/activity-beat";
import Assistant from "@/features/assistant/assistant";
import Login from "@/features/auth/login";
import { CallHost } from "@/features/meetings/meetings";
import { TaskDatabase } from "@/features/tasks/task-database";
import { usePeekKeyboard } from "@/features/tasks/use-peek-keyboard";
import { useTaskListTool } from "@/features/tasks/use-task-list-tool";
import { useTaskListView } from "@/features/tasks/use-task-list-view";
import type { StudioActions, StudioData, StudioRoles } from "@/features/workspace/screen-props";
import type { WorkflowSettings } from "@/lib/workflow-settings";
import { useSidebarWidth } from "@/features/workspace/sidebar-nav";
import { BackgroundPanel, setBackgroundReport } from "@/features/workspace/background-work";
import { useWorkspaceNavigation } from "@/features/workspace/use-workspace-navigation";
import { useWorkspaceSession, type SessionUser } from "@/features/workspace/use-workspace-session";
import WorkspaceFrame, { type WorkspaceFrameOptions } from "@/features/workspace/workspace-frame";
import { ClientNoticeDialog, useClientNotice } from "./client-notice-dialog";
import { recordActions } from "./record-actions";
import { LockPromptDialog, RecordEditorDialog, recordEditor, useEditorState } from "./record-editor";
import { SearchDialog, useSearchShortcut } from "./search-dialog";
import { BootScreen, NoAccessScreen, SwitchScreen, UnavailableScreen } from "./session-screens";
import { StudioNavigation, StudioTopbar } from "./studio-navigation";
import { StudioPages } from "./studio-pages";
import { useRouteGuard } from "./use-route-guard";
import { useStudioModel } from "./use-studio-model";
import { contentId } from "@/components/skip-link";
// Screens most people don't open on every visit load on demand, so the sign-in screen and the
// studio's home don't download the portal first.
const Portal = dynamic(() => import("@/features/portal/portal"));

/** What the signed-in person may do in this workspace. */
function rolesOf(workspace: WorkspaceContext | null): StudioRoles {
  return {
    owner: workspace?.role === "owner",
    manager: !!workspace && isManager(workspace.role),
    member: !!workspace && isMemberRole(workspace.role),
    writable: !!workspace && (["owner", "admin"].includes(workspace.role) || isMemberRole(workspace.role)),
    // Who runs the Social hub (posts, scheduling, statistics): owner, admins, social media managers.
    social: !!workspace && canSocial(workspace.role),
  };
}

export default function StudioApp() {
  const { t: tr, tag, rtl } = useI18n();
  const {
    workflowSettings, workflowRevision, records, user, setUser, loading, error, setError, auth, busy, setBusy, notice, setNotice,
    workspace, members, workspaces, switchingTo, today, noAccess, changePassword, mailConfigured, platformOwner, plan, mediaStorage,
    load, mutate, switchWorkspace: openWorkspace, logout,
  } = useWorkspaceSession();
  // Work left running in the background (publishing, the AI, Instagram) tells how it ended here.
  useEffect(() => { setBackgroundReport({ notice: setNotice, error: setError }); }, [setNotice, setError]);
  const list = useTaskListView();
  const editorState = useEditorState();
  const clientNotice = useClientNotice();
  const [searchOpen, setSearchOpen] = useState(false);
  // Going back or forward restores the list's view and clears a form error left on screen.
  const { restoreListView: restoreList, listView, defaultListView } = list;
  const { setFormError } = editorState;
  const restoreListView = useCallback((saved: typeof defaultListView) => { restoreList(saved); setFormError(""); }, [restoreList, setFormError]);
  const { sidebarWidth, setSidebarWidth, onSidebarResizeStart } = useSidebarWidth(rtl);
  const { route, navigate, goBack } = useWorkspaceNavigation({ workspaceId: workspace?.id ?? null, view: listView, defaultView: defaultListView, restoreView: restoreListView });
  // Time in, time out and time on screen, for the owner's « Activité » page.
  useActivityBeat(workspace?.id);
  useRouteGuard(workspace, route, navigate);
  useSearchShortcut(setSearchOpen);
  const model = useStudioModel({ records, members, user, today, route, list, tr, tag });
  const { clients, projects, tasks, allTasks, lookups, client, task, currentClient } = model;
  usePeekKeyboard(model.filtered, list.peekId, list.setPeekId);
  useTaskListTool(tasks, tr);
  const reloadSilently = useCallback(() => void load(true), [load]);

  const roles = rolesOf(workspace);
  const { manager, social } = roles;
  const editor = recordEditor(editorState, { workspace, roles, route, client, clients, projects, today, mutate, navigate, goBack, setError, setNotice, tr });
  const { changeMember, update, act, submitInlineTask } = recordActions({
    mutate, save: editor.save, setBusy, setError, setNotice, navigate, inlineTask: list.inlineTask, setInlineTask: list.setInlineTask, tr,
  });
  const data: StudioData = { records, clients, projects, tasks, allTasks, members, user, workspace, today, busy, mediaStorage, workflowSettings };
  const actions: StudioActions = { navigate, goBack, open: editor.open, update, act, mutate, setError, setNotice, load, reloadSilently };
  async function switchWorkspace(id: string) {
    await openWorkspace(id, () => navigate({ page: "home" }));
  }
  const onProfile = async (changes: Parameters<WorkspaceFrameOptions["onProfile"]>[0]): Promise<SessionUser> => {
    const reply = await mutate({ action: "update-profile", ...changes });
    if (reply.user) setUser(reply.user);
    setNotice(tr("Profil mis à jour"));
    return reply.user;
  };
  const taskDatabase = () => (
    <TaskDatabase data={data} roles={roles} lookups={lookups} actions={actions} list={list}
      baseFiltered={model.baseFiltered} filtered={model.filtered} quickTests={model.quickTests} assigneeOptions={model.assigneeOptions}
      currentClient={currentClient} submitInlineTask={submitInlineTask}
      nothingYet={!tasks.some((t) => (route.page === "internal" ? t.clientId === "internal" : currentClient ? t.clientId === currentClient.id : true))} />
  );

  if (!workspace && !auth && !noAccess && !changePassword && (loading || !error)) return <BootScreen />;
  // `switchingTo` clears once the switch's request settles; on a failure the old workspace stays
  // (with the error shown), so the screen is tied to "target not loaded yet" rather than the flag alone.
  if (switchingTo && workspace?.id !== switchingTo) {
    return <SwitchScreen name={workspaces.find((w) => w.id === switchingTo)?.name} />;
  }
  if (auth) return <Login />;
  if (changePassword) return <Login initialStep="change-password" />;
  if (noAccess) return <NoAccessScreen email={user.email} busy={busy} onLogout={logout} onRetry={() => void load()} />;
  if (!workspace) return <UnavailableScreen error={error} loading={loading} busy={busy} onRetry={() => void load()} onLogout={logout} />;

  // The workspace's validation rules, saved from « Paramètres de l'agence » (workflow-settings-panel.tsx).
  const saveWorkflow = async (settings: WorkflowSettings, revision: number) => { const reply = await mutate({ action: "set-workflow-settings", data: settings, revision }); setNotice(tr("Règles de validation mises à jour")); return reply.workflowRevision!; };
  const frameOptions: WorkspaceFrameOptions = {
    workspace,
    workspaces,
    user,
    busy: busy || loading,
    sidebarWidth,
    onResizeStart: onSidebarResizeStart,
    onWidthChange: setSidebarWidth,
    onSwitch: (id) => void switchWorkspace(id),
    onProfile,
    onLogout: () => void logout(),
  };
  // The floating assistant, and the call in progress (it goes on while moving around the app), on every
  // screen of a workspace: studio and portal.
  const assistant = <><Assistant key={`${workspace.id}:${workspace.role}`} workspaceId={workspace.id} role={workspace.role} page={route.page} name={user.name} onChanged={() => void load(true)} /><CallHost onChanged={() => void load(true)} onNotice={setNotice} /></>;

  if (workspace.role === "client") {
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
        workspaceId={workspace.id}
        onProfile={onProfile}
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
  // A manager previewing a client's portal (or a deliverable's review page).
  if ((route.page === "portal" || route.page === "review") && currentClient)
    return (
      <>
      <Portal
        mode="preview"
        records={records}
        client={currentClient}
        user={user}
        workspaceId={workspace.id}
        onProfile={onProfile}
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

  const routeTitle =
    route.page === "home"
      ? tr("Accueil")
      : route.page === "tasks"
        ? tr("Tâches")
        : route.page === "clients"
          ? tr("Clients")
          : route.page === "team"
            ? tr("Équipe")
          : route.page === "internal"
            ? tr("Tâches internes")
          : route.page === "settings"
            ? tr("Paramètres de l’agence")
            : route.page === "activity"
              ? tr("Activité")
            : route.page === "social"
              ? tr("Social")
            : route.page === "meetings"
              ? tr("Réunions")
            : route.page === "shoots"
              ? tr("Shootings")
            : route.page === "crm"
              ? tr("CRM")
            : route.page === "requests"
              ? tr("Demandes")
            : route.page === "ig"
              ? tr("Analyse Instagram")
            : route.page === "ig-search"
              ? tr("Recherche Instagram")
            : route.page === "platform"
              ? tr("Plateforme")
            : route.page === "library"
              ? tr("Bibliothèque")
              : route.page === "flow"
                ? tr("Tableau de bord")
                : route.page === "annex"
                  ? tr("Annexe contractuelle")
                  : client?.name || task?.name || tr("Espace");
  return (
    <>
    <WorkspaceFrame
      {...frameOptions}
      onSearch={() => setSearchOpen(true)}
      tabs={[
        { icon: Home, label: tr("Accueil"), active: route.page === "home", onClick: () => navigate({ page: "home" }) },
        {
          icon: CheckSquare, label: tr("Tâches"), active: ["tasks", "task", "internal"].includes(route.page),
          badge: tasks.filter((t) => t.status === "À valider" || (manager && t.status === "Validation interne")).length, onClick: () => navigate({ page: "tasks" }),
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
        <StudioNavigation
          route={route}
          data={data}
          roles={roles}
          platformOwner={platformOwner}
          navigate={navigate}
          onSearch={() => setSearchOpen(true)}
          onNew={() => editor.open("task")}
          onAddClient={() => editor.open("client")}
        />
      }
    >
      <main className="workspace" id={contentId} tabIndex={-1}>
        <Sky />
        <GlassLight />
        <StudioTopbar
          workspaceName={workspace.name}
          routeTitle={routeTitle}
          busy={busy}
          records={records}
          userId={user.id}
          rtl={rtl}
          trialDaysLeft={roles.manager && plan?.state.phase === "trial" ? plan.state.daysLeft ?? null : null}
          onSearch={() => setSearchOpen(true)}
          mutate={mutate}
          navigate={navigate}
        />
        <div className="page-content">
          <StudioPages
            route={route}
            client={client}
            task={task}
            loading={loading}
            error={error}
            plan={plan}
            platformOwner={platformOwner}
            mailConfigured={mailConfigured}
            data={data}
            roles={roles}
            lookups={lookups}
            actions={actions}
            list={list}
            changeMember={changeMember}
            onNotifyClient={clientNotice.openClientNotice}
            onDeleteClient={(c) => editor.setModal({ type: "delete", record: c })}
            renderTasks={taskDatabase}
            workflowRevision={workflowRevision}
            onWorkflowSave={saveWorkflow}
          />{" "}
        </div>
      </main>
      <NoticeToaster notice={notice} />
      <RecordEditorDialog editor={editor} data={data} roles={roles} lookups={lookups} />
      <SearchDialog searchOpen={searchOpen} setSearchOpen={setSearchOpen} records={records} archived={lookups.archived} navigate={navigate} />
      <LockPromptDialog editor={editor} busy={busy} mutate={mutate} navigate={navigate} setError={setError} setNotice={setNotice} setInlineTask={list.setInlineTask} />
      <ClientNoticeDialog state={clientNotice} mailConfigured={mailConfigured} tasks={tasks} mutate={mutate} />
    </WorkspaceFrame>
    <BackgroundPanel />
    {assistant}
    </>
  );
}

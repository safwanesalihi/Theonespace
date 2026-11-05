"use client";
// The signed-in app (app/(app)/page.tsx). It holds the session, the navigation and the task list's view,
// derives the workspace's data once, and composes the screens: a client gets their portal, the print
// workspace its own app, and the studio the frame with its navigation, pages and dialogs.
import { useCallback, useEffect, useState } from "react";
import { can } from '@/lib/roles';
import dynamic from "next/dynamic";
import { Gauge, Home } from "lucide-react";
import { iconOf, pageIcons } from "@/components/choice-icon";
import { isEventRecipient, isEventUnreadFor } from "@/lib/flow";
import { NoticeToaster } from "@/components/notice-toaster";
import { Blank } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { GlassLight } from "@/components/ui/glass-light";
import { Sky } from "@/components/ui/sky";
import { useI18n } from "@/lib/i18n/locale-provider";
import { isManager, isMemberRole, type WorkspaceContext } from "@/lib/workspace";
import { useActivityBeat } from "@/features/activity/activity-beat";
import Assistant from "@/features/assistant/assistant";
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
import { behaviourOf } from "@/lib/process";
import { isInternalTasks } from "@/lib/navigation";
import { ProcessProvider } from "@/features/workspace/process-context";
import { useWorkspaceSession, type SessionUser } from "@/features/workspace/use-workspace-session";
import WorkspaceFrame, { type FrameTab, type WorkspaceFrameOptions } from "@/features/workspace/workspace-frame";
import { ClientNoticeDialog, useClientNotice } from "./client-notice-dialog";
import { recordActions } from "./record-actions";
import { LockPromptDialog, RecordEditorDialog, recordEditor, useEditorState } from "./record-editor";
import { SearchDialog, useSearchShortcut } from "./search-dialog";
import { BootScreen, NoAccessScreen, SwitchScreen, UnavailableScreen } from "./session-screens";
import type { BootBrand } from "@/lib/boot-brand";
import { StudioNavigation, StudioTopbar } from "./studio-navigation";
import { StudioPages } from "./studio-pages";
import { useRouteGuard } from "./use-route-guard";
import { useStudioModel } from "./use-studio-model";
import type { DriveResult } from "./studio-settings";
import { contentId } from "@/components/skip-link";
// Screens most people don't open on every visit load on demand, so the sign-in screen and the
// studio's home don't download the portal first.
const Portal = dynamic(() => import("@/features/portal/portal"));
// Only for a session that ended or a password still to choose: not in every signed-in visit's bundle.
const Login = dynamic(() => import("@/features/auth/login"), { loading: () => <BootScreen /> });

/** What the signed-in person may do in this workspace. */
function rolesOf(workspace: WorkspaceContext | null): StudioRoles {
  return {
    owner: workspace?.role === "owner",
    manager: !!workspace && isManager(workspace.role),
    member: !!workspace && isMemberRole(workspace.role),
    writable: !!workspace && (["owner", "admin"].includes(workspace.role) || isMemberRole(workspace.role)),
    // Who runs the Social hub (posts, scheduling, statistics): owner, admins, social media managers,
    // and anyone whose studio role allows it (lib/roles.ts).
    social: !!workspace && can(workspace, "social"),
    can: (permission) => !!workspace && can(workspace, permission),
    studioRoleId: workspace?.studioRoleId ?? null,
  };
}

export default function StudioApp({ bootBrand }: { bootBrand?: BootBrand | null } = {}) {
  const { t: tr, tag, rtl } = useI18n();
  const {
    workflowSettings, workflowRevision, process: studioProcess, processRevision, records, user, setUser, loading, error, setError, auth, busy, setBusy, notice, setNotice,
    workspace, members, workspaces, switchingTo, today, noAccess, changePassword, mailConfigured, platformOwner, plan, mediaStorage, instagram,
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
  // A Drive connection started in Settings returns there; a client callback is handled on its Files tab.
  const [driveResult, setDriveResult] = useState<DriveResult>();
  const workspaceId = workspace?.id; const workspaceRole = workspace?.role;
  useEffect(() => {
    if (!workspaceId || workspaceRole === "client") return;
    const url = new URL(window.location.href);
    if (/^#client\/[^/]+\/files$/.test(url.hash)) return;
    const error = url.searchParams.get("driveError"); const connected = url.searchParams.has("driveConnected");
    if (!error && !connected) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- consume a completed external OAuth navigation
    setDriveResult({ ...(error ? { error } : {}), connected });
    url.searchParams.delete("driveError"); url.searchParams.delete("driveConnected");
    window.history.replaceState(window.history.state, "", url);
    navigate({ page: "settings", tab: "drive" });
  }, [workspaceId, workspaceRole, navigate]);
  useSearchShortcut(setSearchOpen);
  const model = useStudioModel({ records, members, user, today, route, list, tr, tag, studioProcess });
  const { clients, projects, tasks, allTasks, lookups, client, task, currentClient } = model;
  usePeekKeyboard(model.filtered, list.peekId, list.setPeekId);
  useTaskListTool(tasks, tr, studioProcess);
  const reloadSilently = useCallback(() => void load(true), [load]);

  const roles = rolesOf(workspace);
  const { manager, social, owner } = roles;
  const editor = recordEditor(editorState, { workspace, studioProcess, roles, route, client, clients, projects, today, mutate, navigate, goBack, setError, setNotice, tr });
  const { changeMember, update, act, submitInlineTask } = recordActions({
    studioProcess,
    mutate, save: editor.save, setBusy, setError, setNotice, navigate, inlineTask: list.inlineTask, setInlineTask: list.setInlineTask, tr,
  });
  const data: StudioData = { records, clients, projects, tasks, allTasks, members, user, workspace, today, busy, mediaStorage, workflowSettings, workflowRevision, processRevision };
  const actions: StudioActions = { navigate, goBack, open: editor.open, update, act, mutate, setError, setNotice, load, reloadSilently };
  async function switchWorkspace(id: string) {
    await openWorkspace(id, () => navigate({ page: "home" }));
  }
  const onProfile = async (changes: { name?: string; avatar?: string | null }): Promise<SessionUser> => {
    const reply = await mutate({ action: "update-profile", ...changes });
    if (reply.user) setUser(reply.user);
    setNotice(tr("Profil mis à jour"));
    return reply.user;
  };
  const taskDatabase = () => (
    <TaskDatabase data={data} roles={roles} lookups={lookups} actions={actions} list={list}
      baseFiltered={model.baseFiltered} filtered={model.filtered} quickTests={model.quickTests} assigneeOptions={model.assigneeOptions}
      currentClient={currentClient} submitInlineTask={submitInlineTask}
      nothingYet={!tasks.some((t) => (isInternalTasks(route) ? t.clientId === "internal" : currentClient ? t.clientId === currentClient.id : true))}
      needsClient={!isInternalTasks(route) && !clients.some((c) => !c.archived)}
      scope={route.page === "tasks" ? {
        value: route.tab === "internal" || route.tab === "all" ? route.tab : "",
        set: (scope) => navigate(scope ? { page: "tasks", tab: scope } : { page: "tasks" }),
      } : undefined} />
  );

  if (!workspace && !auth && !noAccess && !changePassword && (loading || !error)) return <BootScreen brand={bootBrand} />;
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
    onOpenSettings: () => navigate({ page: "settings", tab: "profile" }),
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
      <ProcessProvider value={studioProcess}>
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
      </ProcessProvider>
    );

  const routeTitle =
    route.page === "home"
      ? tr("Accueil")
      : route.page === "tasks"
        ? (studioProcess.pages["tasks"].label?.trim() || tr("Tâches"))
          : route.page === "settings"
            ? tr("Paramètres")
            : route.page === "activity"
              ? (studioProcess.pages["activity"].label?.trim() || tr("Activité"))
            : route.page === "social"
              ? (studioProcess.pages["social"].label?.trim() || tr("Social"))
            : route.page === "meetings"
              ? (studioProcess.pages["meetings"].label?.trim() || tr("Réunions"))
            : route.page === "shoots"
              ? (studioProcess.pages["shoots"].label?.trim() || tr("Shootings"))
            : route.page === "crm"
              ? (studioProcess.pages["crm"].label?.trim() || tr("CRM"))
            : route.page === "requests"
              ? (studioProcess.pages["requests"].label?.trim() || tr("Demandes"))
            : route.page === "ig"
              ? (studioProcess.pages["ig"].label?.trim() || tr("Instagram"))
            : route.page === "platform"
              ? (platformOwner ? tr("Plateforme") : tr("Page introuvable"))
            : route.page === "library"
              ? (studioProcess.pages["library"].label?.trim() || tr("Bibliothèque"))
              : route.page === "flow"
                ? tr("Tableau de bord")
                : route.page === "annex"
                  ? tr("Annexe contractuelle")
                  : client?.name || task?.name || tr("Espace");
  // The pages used every day: the dock on a computer (all of these), the bottom bar on a phone (four, then « Plus »).
  const homeTab: FrameTab = { icon: Home, label: tr("Accueil"), active: route.page === "home", onClick: () => navigate({ page: "home" }) };
  const tasksTab: FrameTab = {
    icon: iconOf(studioProcess.pages.tasks.icon) ?? pageIcons.tasks, label: studioProcess.pages.tasks.label?.trim() || tr("Tâches"), active: ["tasks", "task"].includes(route.page),
    badge: tasks.filter((t) => behaviourOf(t.status, studioProcess) === "client" || (manager && behaviourOf(t.status, studioProcess) === "internal")).length, onClick: () => navigate({ page: "tasks" }),
  };
  const requestsTab: FrameTab | null = manager && studioProcess.pages.requests.on ? {
    icon: iconOf(studioProcess.pages.requests.icon) ?? pageIcons.requests, label: studioProcess.pages.requests.label?.trim() || tr("Demandes"), active: route.page === "requests",
    badge: records.filter((r) => r.kind === "request" && (r.requestStatus ?? "new") === "new").length,
    onClick: () => navigate({ page: "requests" }),
  } : null;
  const socialTab: FrameTab | null = social && studioProcess.pages.social.on ? { icon: iconOf(studioProcess.pages.social.icon) ?? pageIcons.social, label: studioProcess.pages.social.label?.trim() || tr("Social"), active: route.page === "social", onClick: () => navigate({ page: "social" }) } : null;
  // On a phone the owner and administrators get Tableau de bord in place of Demandes, and the owner Activité in
  // place of Social (an administrator may not open Activité, so keeps Social). Demandes and Social stay under
  // « Plus ». Each counter is its own page's: the dashboard counts its unread events, as in the sidebar.
  const flowTab: FrameTab | null = manager ? {
    icon: Gauge, label: tr("Tableau de bord"), active: route.page === "flow" || route.page === "annex",
    badge: records.filter((r) => r.kind === "event" && r.audience !== "client" && (!r.recipients || isEventRecipient(r, user.id)) && isEventUnreadFor(r, user.id)).length,
    onClick: () => navigate({ page: "flow" }),
  } : null;
  // In the dock the dashboard sits right under home (the team and the clients are categories of Settings).
  const dockTabs = [homeTab, flowTab, tasksTab, requestsTab, socialTab].filter((tab): tab is FrameTab => !!tab);
  const activityTab: FrameTab | null = owner && studioProcess.pages.activity.on ? { icon: iconOf(studioProcess.pages.activity.icon) ?? pageIcons.activity, label: studioProcess.pages.activity.label?.trim() || tr("Activité"), active: route.page === "activity", onClick: () => navigate({ page: "activity" }) } : null;
  const preferred = manager ? [homeTab, tasksTab, flowTab, activityTab ?? socialTab] : dockTabs;
  const phoneTabs = [...preferred, ...dockTabs].filter((tab, i, all): tab is FrameTab => !!tab && all.findIndex((t) => t?.label === tab.label) === i).slice(0, 4);
  return (
    <ProcessProvider value={studioProcess}>
    <WorkspaceFrame
      {...frameOptions}
      onSearch={() => setSearchOpen(true)}
      tabs={dockTabs}
      phoneTabs={phoneTabs}
      navigation={
        <StudioNavigation
          route={route}
          data={data}
          roles={roles}
          platformOwner={platformOwner}
          instagram={instagram}
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
            onProfile={onProfile}
            onLogout={() => void logout()}
            driveResult={driveResult}
          // The person's own WhatsApp number (also editable on the team's list).
          whatsapp={{
            value: members.find((m) => m.userId === user.id)?.whatsapp ?? "",
            onSave: async (whatsapp: string) => { await changeMember({ action: "set-member-whatsapp", userId: user.id, whatsapp }); },
          }}
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
    </ProcessProvider>
  );
}

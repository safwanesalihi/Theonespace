"use client";
// The signed-in workspace session: loading the workspace (with a stale-response guard, ETag polling and
// alert toasts), applying saves, switching workspace and signing out. Everything the studio screens
// read about « who, where and what » comes from here; the screens only render it.
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/locale-provider";
import { signOut } from "@/lib/auth-client";
import type { Brand } from "@/lib/branding";
import { dayIn, isEventRecipient, isEventUnreadFor } from "@/lib/flow";
import type { RecordItem } from "@/lib/model";
import { sendRecordMutation } from "@/lib/records-client";
import { appNow } from "@/lib/time";
import { defaultWorkflowSettings, type WorkflowSettings } from "@/lib/workflow-settings";
import { WorkspaceLoader } from "@/lib/workspace-loader";
import { isCompanyWorkspaceId, type Invitation, type WorkspaceContext, type WorkspaceMember, type WorkspaceSummary } from "@/lib/workspace";
import type { PlanPayload } from "@/features/plans/subscription-panel";
import { forgetBrand, setBrand } from "./brand-store";

/** What /api/records answers: the whole page payload, or a part of it plus an action's result. */
export type WorkspacePayload = {
  workflowSettings?: WorkflowSettings; workflowRevision?: number;
  message?: RecordItem;
  id?: string;
  extraRequestId?: string;
  records: RecordItem[];
  user: SessionUser;
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
  assignmentWhatsapp?: { sent: boolean; error?: string };
  error?: string;
  code?: string;
};
export type SessionUser = { id: string; name: string; email: string; avatar?: string | null };
/** A change sent to /api/records. */
export type Mutation = Record<string, unknown> & {
  data?: Partial<RecordItem>;
  action?: string;
  kind?: string;
};

/** The tab's workspace, kept across reloads of this tab only. */
const workspaceStorageKey = "the-one.workspace";
const rememberWorkspace = (id: string) => {
  try { sessionStorage.setItem(workspaceStorageKey, id); } catch { /* private mode */ }
};
const forgetWorkspace = () => {
  try { sessionStorage.removeItem(workspaceStorageKey); } catch { /* private mode */ }
};
/** How often the open, visible page asks for changes (answered 304 when there are none). */
const pollMs = 5000;
/** How long a notice stays on screen. */
const noticeMs = 4500;

export function useWorkspaceSession() {
  const { t: tr } = useI18n();
  const [workflowSettings, setWorkflowSettings] = useState<WorkflowSettings>(defaultWorkflowSettings);
  const [workflowRevision, setWorkflowRevision] = useState(0);
  const [records, setRecords] = useState<RecordItem[]>([]),
    [user, setUser] = useState<SessionUser>({ id: "", name: "", email: "" }),
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
  const [today, setToday] = useState(() => dayIn(appNow()));
  const [noAccess, setNoAccess] = useState(false),
    [changePassword, setChangePassword] = useState(false),
    [mailConfigured, setMailConfigured] = useState(false),
    [platformOwner, setPlatformOwner] = useState(false),
    [plan, setPlan] = useState<PlanPayload | null>(null),
    [mediaStorage, setMediaStorage] = useState(false);
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
  const workspaceLoader = useRef(new WorkspaceLoader<WorkspacePayload>());
  // Bumped on every load() call; a response only gets applied if it's still the latest one issued.
  // Without this, a slow background poll for the workspace you just switched *away* from can resolve
  // after the switch's own request and silently overwrite it back — the fetches race, not the state.
  // mutate() has its own analogous guard, keyed off workspaceIdRef instead (see mutate() below).
  const loadSeqRef = useRef(0);
  const etagRef = useRef<string | null>(null);
  // Ids of studio alert events already seen, so polling only toasts genuinely new ones.
  const knownAlertIdsRef = useRef<Set<string> | null>(null);
  // Changes in flight: the root keeps `data-busy` until the last one is answered.
  const pendingMutations = useRef(0);

  const load = useCallback(
    async (silent = false) => {
      // Slow initial reads must finish before polling starts; otherwise every five-second poll
      // would invalidate the sign-in response and keep a client on the loading screen forever.
      // A poll waits while a change is in flight: its older snapshot would undo an edit already on screen.
      if (silent && (pendingLoadsRef.current > 0 || workspaceLoader.current.pending || pendingMutations.current > 0)) return;
      const seq = ++loadSeqRef.current;
      if (!silent) {
        pendingLoadsRef.current += 1;
        setLoading(true);
        setError("");
      }
      try {
        if (!workspaceIdRef.current) {
          try {
            workspaceIdRef.current = sessionStorage.getItem(workspaceStorageKey);
          } catch {
            /* private mode */
          }
        }
        const result = await workspaceLoader.current.read({ workspaceId: workspaceIdRef.current, etag: etagRef.current, silent });
        if (!result) return;
        const { response: res, data } = result;
        if (res.status === 304) return;
        if (!data) return;
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
          forgetWorkspace();
          return;
        }
        if (res.status === 403) {
          if (silent) return;
          setRecords([]);
          setMembers([]);
          setWorkspace(null);
          workspaceIdRef.current = null;
          forgetWorkspace();
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
        setWorkflowSettings(data.workflowSettings ?? defaultWorkflowSettings);
        setWorkflowRevision(data.workflowRevision ?? 0);
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
        rememberWorkspace(data.workspace.id);
        setAuth(false);
        setNoAccess(false);
        setChangePassword(false);
      } catch (e) {
        if (!silent)
          setError(trRef.current(e instanceof Error && e.message ? e.message : "Chargement impossible."));
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
    const reader = workspaceLoader.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial external data fetch
    void load();
    return () => reader.cancel();
  }, [load]);
  // Poll for new studio alerts (client added, task assigned…) while the tab is open and visible.
  // Paused during a workspace switch: a poll issued after the switch's own request would make that
  // request "stale" (see loadSeqRef) and the switch screen would drop before the target arrived.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible" && workspaceIdRef.current && !switchingRef.current)
        void load(true);
    }, pollMs);
    return () => clearInterval(id);
  }, [load]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), noticeMs);
    return () => clearTimeout(t);
  }, [notice]);

  /**
   * Sends one change and applies the answer (unless the person has switched workspace meanwhile).
   * Two things keep a click from feeling frozen while the server answers: the control that was pressed
   * shows it is working (`data-pending`, a spinner in place — styles/design-system.css) and the rest of
   * the page keeps its look (`data-busy` on the root); an edit to a record shows at once, and the
   * server's answer then replaces it (or the screen goes back to how it was, with the error).
   */
  async function mutate(body: unknown) {
    const chat = !!body && typeof body === 'object' && 'action' in body && body.action === 'comment' && 'chatOnly' in body && body.chatOnly === true;
    const pressed = !chat && typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      && document.activeElement.matches('button, [role=button], [role=menuitem]') ? document.activeElement : null;
    if (!chat) {
      setBusy(true);
      pendingMutations.current += 1;
      document.documentElement.setAttribute('data-busy', '');
      pressed?.setAttribute('data-pending', '');
    }
    setError("");
    const requestedWorkspaceId = workspaceIdRef.current;
    let before: RecordItem[] | null = null;
    const edit = body as { action?: unknown; id?: unknown; data?: unknown };
    if (!chat && edit && edit.action === 'update' && typeof edit.id === 'string' && edit.data && typeof edit.data === 'object') {
      setRecords((current) => {
        before = current;
        return current.map((record) => (record.id === edit.id ? { ...record, ...(edit.data as Partial<RecordItem>) } : record));
      });
    }
    try {
      const { data, ...res } = await sendRecordMutation<WorkspacePayload>(body, requestedWorkspaceId);
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
        if (before && current) setRecords(before);
        const err = Error(data.error) as Error & { code?: string };
        err.code = data.code;
        throw err;
      }
      if (current) {
        // A workspace poll started before this save may still hold an older snapshot.
        ++loadSeqRef.current; workspaceLoader.current.cancel(); etagRef.current = null;
        const whatsappErrors = [data.whatsapp, data.assignmentWhatsapp].filter(result => result && !result.sent).map(result => result!.error || tr('L’envoi WhatsApp a échoué.'));
        if (whatsappErrors.length) setError(whatsappErrors.join(' · '));
        if (Array.isArray(data.records)) setRecords(data.records);
        // A chat message is answered alone (the compact path): merged into what is on screen.
        else if (data.message) setRecords(records => [...records.filter(r => r.id !== data.message!.id), data.message!]);
        if (data.workflowSettings) setWorkflowSettings(data.workflowSettings);
        if (data.workflowRevision !== undefined) setWorkflowRevision(data.workflowRevision);
        if (data.members) setMembers(data.members);
        if (data.workspace) {
          setWorkspace(data.workspace);
          workspaceIdRef.current = data.workspace.id;
          rememberWorkspace(data.workspace.id);
        }
        if (data.workspaces) setWorkspaces(data.workspaces);
        if (data.today) setToday(data.today);
        if (data.brand && data.workspace) setBrand({ ...data.brand, company: isCompanyWorkspaceId(data.workspace.id) });
        if (data.workspace) setPlan(data.plan ?? null);
      }
      return data;
    } catch (error) {
      if (before && workspaceIdRef.current === requestedWorkspaceId) setRecords(before);
      throw error;
    } finally {
      if (!chat) {
        setBusy(false);
        pressed?.removeAttribute('data-pending');
        pendingMutations.current -= 1;
        if (!pendingMutations.current) document.documentElement.removeAttribute('data-busy');
      }
    }
  }

  /**
   * Opens another workspace: a neutral loading screen shows until it arrives (polling pauses meanwhile).
   * `beforeLoad` runs once the switch is under way, before the request — the caller's navigation.
   */
  async function switchWorkspace(id: string, beforeLoad?: () => void) {
    workspaceIdRef.current = id;
    switchingRef.current = id;
    setSwitchingTo(id);
    beforeLoad?.();
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
      forgetBrand();
      await signOut();
    } catch (e) {
      setError(tr((e as Error).message));
      setBusy(false);
    }
  }

  return {
    workflowSettings, workflowRevision, records, user, setUser, loading, error, setError, auth, busy, setBusy, notice, setNotice,
    workspace, members, workspaces, switchingTo, today, noAccess, changePassword, mailConfigured, platformOwner, plan, mediaStorage,
    load, mutate, switchWorkspace, logout,
  };
}

// What every studio screen receives from the shell (features/studio/studio-app.tsx), as four explicit
// groups instead of a closure: the workspace's data, the person's permissions, the lookups derived
// from the records, and the actions a screen may take.
import type { ReactNode } from "react";
import type { RecordItem, Status } from "@/lib/model";
import type { WorkspaceRoute } from "@/lib/navigation";
import type { WorkflowSettings } from "@/lib/workflow-settings";
import type { WorkspaceContext, WorkspaceMember } from "@/lib/workspace";
import type { DueTone } from "@/features/tasks/model";
import type { Mutation, SessionUser, WorkspacePayload } from "./use-workspace-session";

/** The workspace as the screens read it. */
export type StudioData = {
  records: RecordItem[];
  clients: RecordItem[];
  projects: RecordItem[];
  /** Tasks outside the archive (neither archived nor under an archived client or sub-project). */
  tasks: RecordItem[];
  /** Every task, archived ones included. */
  allTasks: RecordItem[];
  members: WorkspaceMember[];
  user: SessionUser;
  workspace: WorkspaceContext | null;
  /** Today in Casablanca, as the server last said. */
  today: string;
  /** A save is in flight. */
  busy: boolean;
  mediaStorage: boolean;
  workflowSettings: WorkflowSettings;
};

/** What the signed-in person may do in this workspace (lib/workspace.ts roles). */
export type StudioRoles = {
  owner: boolean;
  /** Owner or administrator. */
  manager: boolean;
  /** Creative, social media manager or print operator. */
  member: boolean;
  /** May edit (owners, administrators and members; not viewers). */
  writable: boolean;
  /** May use the Social hub (owner, administrators, social media managers). */
  social: boolean;
};

/** Names, labels and states derived from the records. */
export type StudioLookups = {
  archived: (record: RecordItem) => boolean;
  /** A client's name ("Agence" for internal work). */
  cname: (clientId?: string) => string;
  /** A sub-project's name. */
  pname: (projectId?: string) => string;
  avatarOf: (name?: string) => string | null | undefined;
  titlesOf: (name?: string) => string[];
  dateLabel: (day?: string) => string;
  timeLabel: (timestamp?: string) => string;
  /** The task's deliverable link, when it is a safe URL. */
  link: (task: RecordItem) => string;
  dueInfo: (task: RecordItem) => { tone: DueTone; label: string };
  duePill: (task: RecordItem) => ReactNode;
};

export type EditorType = "task" | "client" | "project" | "archive" | "feedback" | "approve" | "delete";

/** What a screen can do. */
export type StudioActions = {
  navigate: (route: WorkspaceRoute) => void;
  goBack: (fallback: WorkspaceRoute, matches?: (route: WorkspaceRoute) => boolean) => void;
  /** Opens the record editor (or a confirmation) when the person may. */
  open: (type: EditorType, record?: RecordItem, defaults?: { status?: Status; date?: string }) => void;
  /** Saves changes to a record and tells the person what happened (false when it failed). */
  update: (record: RecordItem, changes: Partial<RecordItem>, message?: string) => Promise<boolean>;
  /** Sends an action and shows `message` once it is done (false when it failed). */
  act: (body: Mutation, message: string) => Promise<boolean>;
  mutate: (body: unknown) => Promise<WorkspacePayload>;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
  load: (silent?: boolean) => Promise<void>;
  reloadSilently: () => void;
};

// The typed context every /api/records action receives, and the shape of one step of the action chain.
import { can } from '@/lib/roles';
import type { AppUser } from '@/lib/auth';
import type { Db } from '@/lib/database';
import { insertRecord } from '@/lib/flow-server';
import type { RecordItem } from '@/lib/model';
import type { Process } from '@/lib/process';
import { isMemberRole, type WorkspaceContext } from '@/lib/workspace';
import { response, signInUrl } from './http';
import { isMine, payload } from './payload';
import { updateAtRevision } from './store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- action dispatch reads loosely typed fields, each validated by its action
export type ActionBody = Record<string, any>;

export type ActionContext = {
  req: Request;
  body: ActionBody;
  user: AppUser;
  /** The signed-in user's id: the `owner` column of the rows they write. */
  owner: string;
  /** Their display name, as written into history, events and receipts. */
  actor: string;
  /** Mutable: renaming a company's workspace updates it for the answer. */
  workspace: WorkspaceContext;
  db: Db;
  /** One timestamp and one Casablanca day for the whole request. */
  now: string;
  today: string;
  /** The studio's process (lib/process.ts): its statuses and what each one does. */
  studioProcess: Process;
  /** The workspace's rows when the request started (only the task's thread for compact chat actions). */
  rows: RecordItem[];
  /** A chat message sent from the task conversation: answered with the message alone. */
  compactComment: boolean;
  /** This request's origin, for links in WhatsApp messages. */
  origin: string;
  /** The sign-in page link for e-mails (AUTH_URL, else this origin). */
  signInUrl: string;
  /** The full page payload (re-read after the write), plus extra fields: what most actions answer. */
  result(extra?: Record<string, unknown>): Promise<Response>;
  /** A task (or a plan idea) this person may act on, with none of its parents archived; null otherwise. */
  findTask(id: unknown, kind?: 'plan_item'): RecordItem | null;
  /** Optimistic save of one record read in `rows`: false when it changed meanwhile. */
  saveTask(before: RecordItem, after: RecordItem): Promise<boolean>;
  /** Inserts a record; events are written as 'system'. */
  insert(record: RecordItem, ignoreConflict?: boolean): Promise<unknown>;
};

/**
 * One step of the ordered action chain. `actions` and `when` select the requests it handles; `run`
 * answers them, or returns null to pass the request on (only the print workspace gate does).
 */
export type ActionStep = {
  actions?: readonly string[];
  when?: (ctx: ActionContext) => boolean;
  run: (ctx: ActionContext) => Promise<Response | null>;
};

type ContextInput = Pick<ActionContext, 'req' | 'body' | 'user' | 'workspace' | 'db' | 'now' | 'today' | 'rows' | 'compactComment' | 'studioProcess'>;

export function createActionContext(input: ContextInput): ActionContext {
  const { req, user, workspace, db } = input;
  const owner = user.userId;
  const parentArchived = (rows: RecordItem[], task: RecordItem) =>
    !!task.archived || !!rows.find((r) => r.id === task.clientId)?.archived || !!rows.find((r) => r.id === task.projectId)?.archived;
  return {
    ...input,
    owner,
    actor: user.fullName || user.displayName,
    origin: new URL(req.url).origin,
    signInUrl: signInUrl(req),
    result: async (extra = {}) => response({ ...(await payload(workspace, user)), ...extra }),
    findTask(id, kind) {
      const task = input.rows.find((r) => r.id === id && r.kind === (kind ?? 'task'));
      if (!task || parentArchived(input.rows, task)) return null;
      if (workspace.role === 'client' && task.clientId !== workspace.clientId) return null;
      if (isMemberRole(workspace.role) && kind === 'plan_item' && !task.assigneeId && !task.assignee?.trim()) return null;
      if (isMemberRole(workspace.role) && !can(workspace, 'tasks.all') && !isMine(user, task)) return null;
      return task;
    },
    saveTask: (before, after) => updateAtRevision(db, workspace.id, before.id, before.revision, after),
    insert(record, ignoreConflict = false) {
      const statement = insertRecord(record, record.kind === 'event' ? 'system' : owner, workspace.id, ignoreConflict);
      return db.query(statement.text, statement.params);
    },
  };
}

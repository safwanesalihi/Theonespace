// "En pause" is a side state, not a delivery milestone: work has started and stopped. It sits next
// to "En cours" because that is where a task leaves from and returns to — the workflow stepper on
// the task page skips it (see `deliverySteps`), and moving into it stops the person's clock.
export const statuses = ['À faire', 'En cours', 'En pause', 'À valider', 'Validé'] as const;
/** The four milestones a deliverable actually passes through, for the task page's stepper. */
export const deliverySteps = ['À faire', 'En cours', 'À valider', 'Validé'] as const;
// The status chip's CSS class. Deliberately NOT derived from the index in `statuses`: every
// stylesheet colours .s0–.s3 as à faire / en cours / à valider / validé, and inserting the pause
// at index 2 would have silently repainted every "À valider" and "Validé" chip in the app.
export const statusClass: Record<(typeof statuses)[number], string> = {
  'À faire': 's0', 'En cours': 's1', 'En pause': 's-paused', 'À valider': 's2', 'Validé': 's3',
};
export const channels = ['Instagram', 'Facebook', 'TikTok'] as const;
// Formats an editorial_post can take. The platform list is editable per workspace (kind 'platform'); formats are not.
export const postTypes = ['Post', 'Story', 'Reel', 'Carrousel', 'Vidéo'] as const;
export type Status = typeof statuses[number];

// Immutable receipt written when a deliverable is validated (The One Flow §2.4 sign-off record).
export type SignOff = {
  mode: 'explicit' | 'silence' | 'studio';
  by: string;
  email?: string;
  at: string;
  round: number;
};

// Written by the publishing automation for one platform of an editorial post (see /api/editorial/queue).
export type PublishResult = {
  ok: boolean;
  at: string;
  externalId?: string;  // the platform's own id for the post (Instagram media id, Facebook post id)
  url?: string;         // permalink when the platform returns one
  error?: string;       // the platform's reason when `ok` is false; tried again on the next run
  pending?: boolean;    // Instagram is still processing the upload (videos); finished by the next run
  containerId?: string; // the Instagram container being processed, while `pending`
  childIds?: string[];  // Instagram carousel: its items, while they are still being processed
  manual?: boolean;     // marked as published by hand (networks the app doesn't post to itself)
  by?: string;          // who marked it
};

// A published post's numbers on one network, read from the platform (lib/social-insights.ts). Each network
// reports a different subset: Instagram reach and saves, Facebook reactions, TikTok and YouTube views…
export type PostStats = {
  views?: number; reach?: number; likes?: number; comments?: number; shares?: number; saves?: number;
  at: string;          // when they were read
  error?: string;      // why they couldn't be read (the post was deleted, the account needs reconnecting…)
};

export const libraryCategories = ['prompt', 'asset', 'plugin', 'preset', 'website'] as const;
export type LibraryCategory = typeof libraryCategories[number];
export const docTypes = ['devis', 'facture', 'contract'] as const;
export type DocType = typeof docTypes[number];
export const docStatuses = ['draft', 'sent', 'accepted', 'refused', 'paid'] as const;
export type DocStatus = typeof docStatuses[number];
export type LineItem = { description: string; quantity: number; unitPrice: number };
// A company client's legal details for the "Facturé à" block of a devis/facture. `taxId` is the IF.
export type BillingDetails = { company: string; address: string; rc: string; ice: string; taxId: string };

export type RecordItem = {
  id: string;
  kind: 'client' | 'project' | 'task' | 'comment' | 'event' | 'library' | 'document' | 'print_order' | 'print_transaction' | 'print_document' | 'editorial_post' | 'platform';
  // Printing records use the same workspace-scoped store, without studio client entities.
  orderId?: string;
  counterparty?: string;
  counterpartyType?: 'customer' | 'supplier';
  direction?: 'in' | 'out';
  amountCents?: number;
  transactionDate?: string;
  expenseCategory?: string;
  orderStatus?: 'new' | 'production' | 'ready' | 'delivered' | 'cancelled';
  quantity?: number;
  revision: number;
  name: string;
  clientId?: string;
  projectId?: string;
  taskId?: string;
  assignee?: string;
  assigneeId?: string; // stable identity; display-name changes never alter access
  due?: string;
  source?: string;
  deliverable?: string;
  description?: string;
  status?: Status;
  archived?: boolean;
  contact?: string;
  email?: string;
  whatsapp?: string;  // client: international number (+212…) that gets the "ready to approve" message
  city?: string;
  sector?: string;
  language?: string;
  drive?: string;
  contract?: string;
  // client: where the publishing automation posts for this client (see /api/editorial/queue).
  instagramId?: string;     // Instagram Business account id (numeric)
  facebookPageId?: string;  // Facebook Page id (numeric)
  youtubeChannel?: string;  // legacy: fed the n8n publisher's YouTube branch; no longer read
  channel?: string;
  channels?: string[]; // editorial_post: platform ids this post targets (ids, not names — see lib/model.ts's `platform` kind)
  mediaUrl?: string;   // editorial_post: public URL of the photo/video to publish (lib/media-storage.ts)
  publishResults?: Record<string, PublishResult>; // editorial_post: outcome per platform id (lib/editorial-publish.ts)
  stats?: Record<string, PostStats>; // editorial_post: numbers per network once published (lib/social-insights.ts)
  mediaType?: 'image' | 'video'; // editorial_post: what `mediaUrl` points to
  mediaPath?: string;  // editorial_post: the file's path in storage, so it can be removed with the post
  publishingAt?: string; // editorial_post: a publish run holds the post while it talks to Meta
  postType?: string;   // editorial_post: one of `postTypes`, '' when unset (posts made before the Social hub)
  targets?: import('@/lib/social').SocialTarget[]; // editorial_post: networks, format and caption per network (lib/social.ts)
  media?: import('@/lib/social').SocialMedia[];    // editorial_post: photos and videos, in order
  socialState?: 'draft' | 'scheduled';             // editorial_post: planned only, or to go out at its date and time
  approval?: import('@/lib/social').PostApproval;  // editorial_post: the client's answer, when the client approves posts
  postApproval?: boolean; // client: their posts wait for their approval in the portal before going out
  time?: string;
  author?: string;
  authorId?: string; // comment: stable identity of who wrote it; mirrors task.assigneeId
  audio?: string;    // comment: voice message, an 'audio' asset id (see /api/assets)
  createdAt: string;
  sentAt?: string;
  validatedAt?: string;
  history?: { text: string; date: string }[];
  // The One Flow fields
  quota?: string;              // client: items sold per month
  logo?: string;               // client: asset id (see /api/assets)
  banner?: string;             // client: asset id
  approvalDueAt?: string;      // task: stored end of the 48h clock, never recomputed
  revisionRound?: number;      // task: client "request changes" rounds used
  signOff?: SignOff;           // task: validation receipt
  publishedAt?: string;        // task: when the item actually went out · editorial_post: set once every platform succeeded
  evergreen?: boolean;         // task: undated reserve item
  publishable?: boolean;       // task: false for internal work (copywriting, prémontage…) that is never published
  lockOverride?: boolean;      // task: created/re-dated inside J−7 by an admin
  reminders?: string[];        // task: reminder keys already emitted
  request?: { by: string; email?: string; at: string }; // task: came from the portal request form
  timeEntries?: { userId: string; name: string; start: string; end?: string }[]; // task: per-person time log; no `end` = currently running
  // event fields
  type?: 'reminder' | 'auto-approved' | 'sweep' | 'lock' | 'request' | 'decision' | 'client-added' | 'task-assigned' | 'comment' | 'whatsapp' | 'post';
  postId?: string;        // event: the social post it is about
  audience?: 'studio' | 'client' | 'both';
  read?: boolean;         // shared read state — only for events with no `recipients` (unchanged broadcast events)
  recipients?: string[];  // event: specific user ids this notification is for; absence = broadcast (use `read` above)
  readBy?: string[];      // event: which of `recipients` has read it, per person
  // library fields — internal resources, every studio role (owner/admin/creative/viewer), never the client
  category?: LibraryCategory;
  content?: string;   // prompt text (category === 'prompt')
  link?: string;       // external URL for asset/plugin/preset (category !== 'prompt')
  // document fields (devis/facture/contract) — owner + that document's own client only
  docType?: DocType;
  number?: string;      // immutable once created, e.g. "FACTURE-2026-0001"
  seq?: number;          // raw per-docType-per-year sequence backing `number`
  docStatus?: DocStatus;
  issuedAt?: string;
  dueAt?: string;         // facture: payment due date
  validUntil?: string;    // devis/contract: offer validity date
  lineItems?: LineItem[];
  taxRate?: number;       // percentage
  notes?: string;
  billing?: BillingDetails; // set when the client is a company (RC, ICE, IF, address on the document)
};
export function initials(name:string){return name.split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase();}
export function dayKey(d:Date){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
export function safeLink(v:string){try {const u=new URL(v);return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}}

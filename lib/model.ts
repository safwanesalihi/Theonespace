// "En pause" is a side state, not a delivery milestone: work has started and stopped. It sits next
// to "En cours" because that is where a task leaves from and returns to — the workflow stepper on
// the task page skips it (see `deliverySteps`), and moving into it stops the person's clock.
// "Validation interne" is the studio's own check: a deliverable stops there until the owner or an
// administrator sends it to the client (« À valider ») or returns it with a private note.
export const statuses = ['À faire', 'En cours', 'En pause', 'Validation interne', 'À valider', 'Validé'] as const;
/** The five milestones a deliverable actually passes through, for the task page's stepper. */
export const deliverySteps = ['À faire', 'En cours', 'Validation interne', 'À valider', 'Validé'] as const;
// The status chip's CSS class. Deliberately NOT derived from the index in `statuses`: every
// stylesheet colours .s0–.s3 as à faire / en cours / à valider / validé, and inserting the pause
// at index 2 would have silently repainted every "À valider" and "Validé" chip in the app.
export const statusClass: Record<(typeof statuses)[number], string> = {
  'À faire': 's0', 'En cours': 's1', 'En pause': 's-paused', 'Validation interne': 's-internal', 'À valider': 's2', 'Validé': 's3',
};
export const channels = ['Instagram', 'Facebook', 'TikTok'] as const;
// Where a client's content request should go out (portal form, several allowed).
export const requestPlatforms = ['Instagram', 'Facebook', 'TikTok', 'YouTube', 'LinkedIn', 'Site web', 'Impression', 'Autre'] as const;
// Formats an editorial_post can take. The platform list is editable per workspace (kind 'platform'); formats are not.
export const postTypes = ['Post', 'Story', 'Reel', 'Carrousel', 'Vidéo'] as const;
export const priorities = ["Basse", "Moyenne", "Haute", "Urgente"] as const;
export type Priority = "Basse" | "Moyenne" | "Haute" | "Urgente";
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
  pending?: boolean;    // the network is still processing the upload (videos, Facebook Reels); finished by the next run
  containerId?: string; // while `pending`: the Instagram container, the Facebook Reel's video or the TikTok publish id
  childIds?: string[];  // Instagram carousel: its items, while they are still being processed · several stories: the containers still to publish
  storyIds?: string[];  // a post of several stories: the ones out so far, in order (never sent twice)
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
/** A file sent in a task's conversation: a 'file' asset (/api/assets/{id}) and what it was called. */
export type Attachment = { id: string; name: string; type: string; size: number };
export type ChatMention = { userId: string; name: string; start: number; end: number };
export type LineItem = { description: string; quantity: number; unitPrice: number };
// A company client's legal details for the "Facturé à" block of a devis/facture. `taxId` is the IF.
export type BillingDetails = { company: string; address: string; rc: string; ice: string; taxId: string };

export type RecordItem = {
  id: string;
  kind: 'client' | 'project' | 'task' | 'comment' | 'event' | 'library' | 'document' | 'print_order' | 'print_transaction' | 'print_document' | 'editorial_post' | 'platform' | 'meeting' | 'request' | 'plan_item';
  // Printing records use the same workspace-scoped store, without studio client entities.
  orderId?: string;
  counterparty?: string;
  counterpartyType?: 'customer' | 'supplier';
  direction?: 'in' | 'out';
  amountCents?: number;
  unitPriceCents?: number;
  transactionDate?: string;
  expenseCategory?: string;
  orderStatus?: 'new' | 'production' | 'ready' | 'delivered' | 'cancelled';
  quantity?: number;
  quantityUnit?: 'unit' | 'm' | 'm2'; // print order: pieces, or metres / m² of material
  revision: number;
  name: string;
  clientId?: string;
  projectId?: string;
  taskId?: string;
  mentions?: ChatMention[]; // comment: validated people and UTF-16 spans in its text
  replyTo?: string; // comment: id of the message of the same thread this one answers (a quoted reply)
  assignee?: string;
  assigneeId?: string; // stable identity; display-name changes never alter access
  due?: string;
  source?: string;
  deliverable?: string;
  description?: string;
  brief?: import('./client-brief').ClientBrief;
  serviceScope?: import('./client-pipeline').ServiceScope; // client working offer; document immutable scope snapshot
  workflowTerms?: import('./client-pipeline').WorkflowSnapshot; // document: captured server-side when issued
  sourceDocumentId?: string; // contract/invoice derived from an accepted quote
  documentPurpose?: 'base' | 'extra';
  documentDecision?: { by: string; userId: string; email?: string; at: string; method: 'portal' | 'studio'; status: 'accepted' | 'refused' };
  scopeFormat?: import('./client-pipeline').ScopeFormat;
  scopeUnits?: number; // one story frame is one unit
  commercialTreatment?: 'included' | 'extra';
  extraQuoteId?: string; // paid extra: explicit accepted quote, never tacit approval
  revisionTaskId?: string; // request: an additional round on an existing deliverable
  pendingExtraRequestId?: string; // task paused while its additional round is priced
  priority?: Priority;
  status?: Status;
  archived?: boolean;
  contact?: string;
  email?: string;
  whatsapp?: string;  // client: international number (+212…) that gets the "ready to approve" message
  whatsappMessageId?: string; // studio event: Meta acceptance reference, not a delivery receipt
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
  repeat?: import('@/lib/social-repeat').PostRepeat; // editorial_post: a series, published again on each of its days (lib/social-repeat.ts)
  repeatOf?: string;  // editorial_post: the series this post is one day's copy of
  repeatExceptions?: Record<string, import('@/lib/social-repeat').SeriesException>; // editorial_post series: one date skipped or with its own title/text, by day
  postApproval?: boolean; // client: their posts wait for their approval in the portal before going out
  time?: string;
  author?: string;
  authorId?: string; // comment: stable identity of who wrote it; mirrors task.assigneeId
  deliveredAt?: string; // comment: first acknowledgement by another task participant's browser
  seenAt?: string;      // comment: first acknowledgement while visible to another participant
  audio?: string;    // comment: voice message, an 'audio' asset id (see /api/assets)
  attachments?: Attachment[]; // comment: original media, documents and other private 'file' assets
  deletedAt?: string;          // comment: removed by the owner or an admin (its text, voice and files are gone)
  deletedBy?: string;          // comment: who removed it
  createdAt: string;
  sentAt?: string;
  validatedAt?: string;
  history?: { text: string; date: string; internal?: boolean }[]; // internal: a studio-only step, never shown to the client
  // The One Flow fields
  quota?: string;              // client: items sold per month
  logo?: string;               // client: asset id (see /api/assets)
  banner?: string;             // client: asset id
  workflowSettings?: import('./workflow-settings').WorkflowSettings | null; // client: custom policy, null inherits workspace defaults
  effectiveWorkflow?: import('./workflow-settings').WorkflowSettings; // server-derived policy for display and transitions
  approvalSettings?: import('./workflow-settings').WorkflowSettings; // task: policy captured when first sent
  approvalDueAt?: string;      // task: stored approval deadline, never recomputed
  revisionRound?: number;      // task: client "request changes" rounds used
  signOff?: SignOff;           // task: validation receipt
  internalReview?: { note: string; by: string; at: string }; // task: the studio's last internal refusal; never sent to the client
  sentDeliverable?: string;    // task: the link last sent to the client, the only one their portal shows (lib/flow.ts clientTaskCopy)
  publishedAt?: string;        // task: when the item actually went out · editorial_post: set once every platform succeeded
  autoArchivedAt?: string;     // task: when the sweep archived it, 15 days after its approval (lib/flow.ts); it still counts in the numbers
  evergreen?: boolean;         // task: undated reserve item
  publishable?: boolean;       // task: false for internal work (copywriting, prémontage…) that is never published
  lockOverride?: boolean;      // task: created/re-dated inside J−7 by an admin
  reminders?: string[];        // task: reminder keys already emitted
  request?: { by: string; email?: string; at: string }; // task: came from the portal request form
  planId?: string;             // task: an item of a monthly Plan Éditorial (lib/content-plan.ts)
  planMonth?: string;          // monthly quota follows the plan even before a date is assigned
  planShared?: boolean;        // task: its plan is shared with the client (the portal hides plan items until then)
  timeEntries?: { userId: string; name: string; start: string; end?: string }[]; // task: per-person time log; no `end` = currently running
  // event fields
  type?: 'reminder' | 'auto-approved' | 'sweep' | 'lock' | 'request' | 'decision' | 'client-added' | 'task-assigned' | 'comment' | 'whatsapp' | 'post' | 'meeting';
  meetingId?: string;     // event: the meeting it is about
  requestId?: string;     // event: the client request it is about
  platforms?: string[];   // request (and the task made from it): where the content should go out
  requestStatus?: 'new' | 'accepted' | 'declined'; // request: waiting in the studio's inbox, made a task, or declined
  decision?: { by: string; at: string; reason?: string }; // request: who accepted/declined it, when, why (declined)
  duration?: number;      // meeting: planned length in minutes (starts at `due` + `time`, Casablanca time)
  callMode?: 'video' | 'audio'; // meeting: a video call, or audio only (cameras off when joining)
  attendees?: string[];   // meeting: the studio members invited (user ids); the client's contacts come with its clientId
  attendeeNames?: string[]; // meeting: their names when it was planned, for the client's side
  cancelledAt?: string;   // meeting: when it was called off
  endedAt?: string;       // meeting: explicitly finished, distinct from cancellation and planned duration
  endedBy?: string;       // meeting: name of the host who finished it
  postId?: string;        // event: the social post it is about
  audience?: 'studio' | 'client' | 'both';
  read?: boolean;         // shared read state — only for events with no `recipients` (unchanged broadcast events)
  recipients?: string[];  // event: specific user ids this notification is for; absence = broadcast (use `read` above)
  readBy?: string[];      // event: which of `recipients` has read it, per person
  // library fields — internal resources, every studio role (owner/admin/creative/viewer), never the client
  category?: LibraryCategory;
  content?: string;   // prompt text (category === 'prompt')
  link?: string;       // external URL for asset/plugin/preset (category !== 'prompt')
  tags?: string[];     // library: free tags (« Reel », « Ramadan »…)
  tool?: string;       // library prompt: the AI tool it is written for
  example?: string;    // library prompt: a link to a result made with it
  icon?: string;       // library link: the site's icon, found when the link was added
  favoriteBy?: string[]; // library: user ids who starred it
  copies?: number;     // library: how many times it was copied or opened
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

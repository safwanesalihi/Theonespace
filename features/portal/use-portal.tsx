"use client";
// The client portal's state and data: the client's sub-projects, tasks, posts, requests and documents,
// what waits for their approval, the dialogs in progress, and the actions they take (approve, request
// changes, file a request, answer a post, accept or refuse a document).
import { appNow, deviceTimeZone, formatAppDate, setDisplayTimeZone } from "@/lib/time";
import { uploadVoice } from '@/components/voice-recorder';
import { useConnectedAccounts } from '@/features/social/social-accounts';
import TaskChat from '@/features/tasks/task-chat';
import { brandLogoUrl, brandPdfLogo, studioLabel, useBrand } from '@/features/workspace/brand-store';
import { buildDocumentPdf, downloadPdf } from '@/lib/document-pdf';
import { readStoredLocale } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/locale-provider';
import { type RecordItem, type Priority, safeLink } from '@/lib/model';
import { portalCopy, portalLocaleFor } from '@/lib/portal-i18n';
import { type Network } from '@/lib/social';
import { compareTasks } from '@/lib/task-sort';
import { useEffect, useRef, useState } from 'react';
import type { PortalProps } from "./portal";

export function usePortal(props: PortalProps) {
  const { mode, records, client, user, workspaceId, route, today, busy, error, notice, navigate, mutate, onNotice, onError, onLeave, onBack, onProfile } = props;
  // The portal follows the app language (toggle in the sidebar). A client who never chose one starts in the
  // language recorded on their client file.
  const { locale, setLocale, t } = useI18n();
  // A client reads every time on their own clock, with the zone named; the studio previewing the portal keeps Casablanca's.
  // Set while rendering, before any child formats a time (browser only; business days and deadlines stay on Casablanca).
  setDisplayTimeZone(mode === 'client' ? deviceTimeZone() : undefined);
  // The studio this portal belongs to: its own name and logo when it is a company that signed up.
  const brand = useBrand();
  const studio = studioLabel(brand);
  const brandLogo = brandLogoUrl(brand);
  useEffect(() => { if (mode === 'client' && !readStoredLocale()) setLocale(portalLocaleFor(client.language)); }, [mode, client.language, setLocale]);
  const copy = portalCopy[locale];
  const rtl = copy.dir === 'rtl';
  const [now, setNow] = useState(() => appNow());
  useEffect(() => { const t = setInterval(() => setNow(appNow()), 60000); return () => clearInterval(t); }, []);
  const [dialog, setDialog] = useState<'approve' | 'changes' | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showBrief, setShowBrief] = useState(false);
  const [homeFocus, setHomeFocus] = useState<'production' | 'review' | 'done'>('production');
  const [confirm, setConfirm] = useState(false);
  const [text, setText] = useState('');
  const [clip, setClip] = useState<Blob | null>(null);
  const [request, setRequest] = useState<{ name: string; projectId: string; due: string; platforms: string[]; description: string; priority?: Priority }>({ name: '', projectId: '', due: '', platforms: [], description: '', priority: 'Moyenne' });
  const requestSubmission = useRef<{ text: string; id: string } | null>(null);
  const requestSending = useRef(false);
  const [editingRequest, setEditingRequest] = useState<RecordItem | null>(null);
  const [formError, setFormError] = useState('');
  const [month, setMonth] = useState(() => { const d = new Date(`${today}T12:00:00`); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selectedDay, setSelectedDay] = useState(today);
  const dayDetailsRef = useRef<HTMLDivElement>(null);
  const [projectFilter, setProjectFilter] = useState('');
  const [pdfBusy, setPdfBusy] = useState('');
  const [decidingDocument, setDecidingDocument] = useState<RecordItem | null>(null);
  const [documentRead, setDocumentRead] = useState(false);
  const [documentSaving, setDocumentSaving] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [postNetwork, setPostNetwork] = useState<Network | null>(null);
  const [postNote, setPostNote] = useState('');
  const [askingChanges, setAskingChanges] = useState<string | null>(null);
  // Back from a platform's login, the client lands on their accounts, where the answer is shown.
  const social = useConnectedAccounts(workspaceId, { onNotice, onError, onReturn: () => navigate({ page: 'portal', id: client.id, tab: 'accounts' }) });

  const projects = records.filter((r) => r.kind === 'project' && r.clientId === client.id && !r.archived);
  const tasks = records.filter((r) => r.kind === 'task' && r.clientId === client.id && !r.archived && (!r.projectId || projects.some((p) => p.id === r.projectId))).sort((a, b) => compareTasks(a, b, 'status', copy.locale));
  const waiting = tasks.filter((t) => t.status === 'À valider');
  // Social posts the studio scheduled (portalView sends no drafts); some wait for this client's approval.
  const posts = records.filter((r) => r.kind === 'editorial_post' && r.clientId === client.id).sort((a, b) => `${a.due} ${a.time}`.localeCompare(`${b.due} ${b.time}`));
  const pendingPosts = posts.filter((p) => p.approval?.state === 'pending' && !p.publishedAt);
  const toReview = waiting.length + pendingPosts.length;
  const production = tasks.filter((task) => task.status !== 'Validé' && task.status !== 'À valider');
  const files = tasks.filter((t) => !!link(t) && (t.status === 'À valider' || t.status === 'Validé'));
  // The inbox's requests, plus older ones that went straight to a task; a task made from a request isn't listed twice.
  const requestRecords = records.filter((r) => r.kind === 'request' && r.clientId === client.id);
  const myRequests = [...requestRecords, ...tasks.filter((t) => t.request && !requestRecords.some((r) => r.taskId === t.id))].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // Already scoped to this client by portalView() server-side; re-filtered here defensively, same as tasks/projects above.
  const documents = records.filter((r) => r.kind === 'document' && r.clientId === client.id && !r.archived && r.docStatus !== 'draft').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const task = route.page === 'review' ? tasks.find((t) => t.id === route.id) ?? null : null;
  const tab = route.page === 'review' ? 'review' : route.tab || 'home';
  const meetingsToday = records.filter((r) => r.kind === 'meeting' && !r.cancelledAt && !r.endedAt && r.due === today).length;
  const pname = (id?: string) => projects.find((p) => p.id === id)?.name || '';
  const fmt = (iso?: string, withTime = false) => iso ? formatAppDate(iso, copy.locale, withTime ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : { day: 'numeric', month: 'short' }) : copy.noDate;
  function link(t: RecordItem) { return safeLink(t.deliverable || ''); }
  const go = (tab: string) => navigate({ page: 'portal', id: client.id, tab });

  async function decide(kind: 'approve' | 'changes') {
    if (!task) return;
    try {
      if (kind === 'approve') { await mutate({ action: 'approve', taskId: task.id }); onNotice(copy.approved); }
      else {
        if (!text.trim() && !clip) { setFormError(copy.changesPlaceholder); return; }
        const audio = clip && workspaceId ? await uploadVoice(clip, workspaceId) : undefined;
        const reply = await mutate({ action: 'request-changes', taskId: task.id, text, ...(audio ? { audio } : {}) }) as { extraRequestId?: string };
        onNotice(reply?.extraRequestId ? t('Demande hors forfait enregistrée. Le livrable est en pause jusqu’à l’accord sur le devis extra.') : copy.changesButton);
      }
      setDialog(null); setText(''); setClip(null); setConfirm(false); setFormError('');
    } catch (e) { setFormError(t((e as Error).message)); }
  }
  async function sendRequest(e: React.FormEvent) {
    e.preventDefault();
    if (busy || requestSending.current) return;
    const text = JSON.stringify({ clientId: client.id, ...request });
    if (requestSubmission.current?.text !== text) requestSubmission.current = { text, id: crypto.randomUUID() };
    requestSending.current = true; setFormError('');
    try {
      await mutate({ action: 'request', clientId: client.id, data: { ...request, submissionId: requestSubmission.current.id } });
      requestSubmission.current = null;
      // Keep edits made while the previous submission was being saved.
      setRequest(current => JSON.stringify({ clientId: client.id, ...current }) === text ? { name: '', projectId: '', due: '', platforms: [], description: '', priority: 'Moyenne' } : current);
      onNotice(copy.requestSent);
    } catch (e) { setFormError(t((e as Error).message)); }
    finally { requestSending.current = false; }
  }

  async function answerPost(post: RecordItem, approve: boolean) {
    try {
      if (approve) await mutate({ action: 'post-approve', postId: post.id });
      else {
        if (!postNote.trim()) { onError(copy.postChangesPlaceholder); return; }
        await mutate({ action: 'post-changes', postId: post.id, text: postNote });
      }
      onNotice(approve ? copy.postApproved : copy.postChangesSent);
      setPostNote(''); setAskingChanges(null); setViewing(null);
    } catch (e) { onError(t((e as Error).message)); }
  }
  const planned = (p: RecordItem) => copy.postPlanned(fmt(p.due), p.time || '09:00');
  async function downloadDocument(doc: RecordItem) {
    setPdfBusy(doc.id);
    try {
      const bytes = await buildDocumentPdf({
        docType: doc.docType!, number: doc.number!, docStatus: doc.docStatus || 'draft', studioName: studio, logoUrl: brandPdfLogo(brand),
        clientName: client.name, issuedAt: doc.issuedAt, dueAt: doc.dueAt, validUntil: doc.validUntil,
        lineItems: doc.lineItems || [], taxRate: doc.taxRate, notes: doc.notes,
        serviceScope: doc.serviceScope, workflowTerms: doc.workflowTerms, documentDecision: doc.documentDecision,
      });
      downloadPdf(bytes, `${doc.number}.pdf`);
    } catch { onError(copy.noDocuments); } finally { setPdfBusy(''); }
  }
  async function decideDocument(status: 'accepted' | 'refused') {
    if (!decidingDocument || status === 'accepted' && !documentRead) return;
    setDocumentSaving(true);
    try { await mutate({ action: 'document-decision', id: decidingDocument.id, revision: decidingDocument.revision, status }); setDecidingDocument(null); onNotice(t(status === 'accepted' ? 'Acceptation enregistrée' : 'Refus enregistré')); }
    catch (e) { onError(t((e as Error).message)); }
    finally { setDocumentSaving(false); }
  }
  // One item's thread, the same one the review page shows.
  function thread(taskId: string) {
    const messages = records.filter((r) => r.kind === 'comment' && r.taskId === taskId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return <TaskChat
      key={taskId}
      taskId={taskId}
      messages={messages}
      workspaceId={workspaceId ?? undefined}
      sender={{ id: user.id, name: user.name, client: mode === 'client' }}
      isMine={(c) => (c.authorId ? c.authorId === user.id : mode === 'client' && c.audience === 'client' && c.author === user.name)}
      senderLabel={(c) => (c.audience === 'client' ? client.name : studio)}
      canWrite
      busy={busy}
      onSend={(message) => mutate({ action: 'comment', taskId, ...message })}
      onError={onError}
    />;
  }
  const title = route.page === 'review' ? (records.find(r => r.kind === 'task' && r.id === route.id)?.name || copy.review) : tab === 'home' ? copy.home : tab === 'calendar' ? copy.calendar : tab === 'files' ? copy.files : tab === 'tasks' ? copy.tasks : tab === 'documents' ? copy.documents : tab === 'request' ? copy.request : tab === 'accounts' ? copy.accounts : tab === 'stats' ? copy.stats : tab === 'meetings' ? copy.meetings : tab === 'plan' ? copy.plan : copy.review;
  return { answerPost, askingChanges, brand, brandLogo, busy, client, clip, confirm, copy, dayDetailsRef, decide, decideDocument, decidingDocument, dialog, documentRead, documentSaving, documents, downloadDocument, editingRequest, error, files, fmt, formError, go, homeFocus, link, locale, meetingsToday, mode, month, mutate, myRequests, navigate, notice, now, onBack, onError, onLeave, onNotice, onProfile, pdfBusy, pendingPosts, planned, pname, postNetwork, postNote, posts, production, projectFilter, projects, records, request, requestRecords, requestSending, requestSubmission, route, rtl, selectedDay, sendRequest, setAskingChanges, setClip, setConfirm, setDecidingDocument, setDialog, setDocumentRead, setDocumentSaving, setEditingRequest, setFormError, setHomeFocus, setLocale, setMonth, setNow, setPdfBusy, setPostNetwork, setPostNote, setProjectFilter, setRequest, setSelectedDay, setSettingsOpen, setShowBrief, setText, setViewing, settingsOpen, showBrief, social, studio, t, tab, task, tasks, text, thread, title, toReview, today, user, viewing, waiting, workspaceId };
}
export type PortalContext = ReturnType<typeof usePortal>;

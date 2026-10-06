"use client";
// A task's conversation, drawn like a WhatsApp chat: the owner, the studio, the client and the person
// on the task talk in one thread — text, voice messages, original media and documents.
// Used by the studio's task page (app/tracker.tsx) and the client portal (app/portal.tsx); what each
// side may see and send is decided by /api/records and /api/assets, not here.
import { Fragment, useEffect, useId, useRef, useState } from "react";
import { ArrowDown, AtSign, Ban, Check, CheckCheck, Clock3, Download, FileText, Film, ImageIcon, Loader2, MessageCircle, Mic, Music, Paperclip, Reply, Send, Trash2, X } from "lucide-react";
import AudioPlayer, { formatClock } from "@/app/audio-player";
import { maxVoiceSeconds, pickMimeType, uploadVoice } from "@/app/voice-recorder";
import { useI18n } from "@/app/locale-provider";
import type { Attachment, RecordItem } from "@/lib/model";
import { appDayKey, appNow, formatTimestamp, timestampDate } from "@/lib/time";
import { mergeChatMessages, TaskChatReader } from '@/lib/task-chat-client';
import { editMentions, mentionQuery, type MentionCandidate, type MentionSelection } from "@/lib/task-mentions";
import { maxTaskFileBytes, previewImage, taskFileLabel, taskFileType } from '@/lib/task-files';
import { uploadTaskFile } from '@/lib/task-file-client';

export type ChatSend = { text: string; audio?: string; attachments?: Attachment[]; mentions?: MentionSelection[]; replyTo?: string; submissionId: string; chatOnly: true };
type Outgoing = { message: RecordItem; input: ChatSend; delivery: 'sending' | 'failed' };
type Pending = { key: string; name: string; type: string; size: number; progress: number; preview?: string; file?: Attachment; error?: string };
const sizeLabel = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} Mo` : `${Math.max(1, Math.round(bytes / 1000))} Ko`);
// A stable colour per person, as WhatsApp does for names in a group.
const nameColors = ['var(--t-info)', 'var(--t-review-ink)', 'var(--t-purple)', 'var(--t-success)', 'var(--t-danger)', 'var(--t-brand-text)'];
const colorOf = (name = "") => nameColors[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % nameColors.length];
// The swipe that answers a message: how far it must travel, and the most it follows the finger.
const replyDistance = 56, replyMaxShift = 80;
const searchName = (name: string) => name.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim();
const mentionRoles = { owner: 'Propriétaire', admin: 'Administrateur', client: 'Client', assignee: 'Assigné' };
function messageText(message: RecordItem) {
  let end = 0;
  const parts: React.ReactNode[] = [];
  for (const m of [...(message.mentions ?? [])].sort((a, b) => a.start - b.start)) {
    if (m.start < end || m.end > message.name.length || message.name.slice(m.start, m.end) !== `@${m.name}`) continue;
    parts.push(message.name.slice(end, m.start), <mark className="task-chat-mention" key={m.start}>{message.name.slice(m.start, m.end)}</mark>);
    end = m.end;
  }
  parts.push(message.name.slice(end));
  return parts;
}

function FileIcon({ type, size = 22 }: { type: string; size?: number }) {
  const Icon = type.startsWith('video/') ? Film : type.startsWith('audio/') ? Music : type.startsWith('image/') ? ImageIcon : FileText;
  return <Icon size={size} />;
}

function ChatAttachment({ file }: { file: Attachment }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const src = `/api/assets/${file.id}`, download = `${src}?download=${encodeURIComponent(file.name)}`;
  const photo = previewImage(file.type), video = file.type.startsWith('video/'), audio = file.type.startsWith('audio/');
  const label = taskFileLabel(file.name, file.type);
  return <div className={`task-chat-attachment${photo || video ? ' visual' : audio ? ' sound' : ' document'}${file.type === 'application/pdf' ? ' pdf' : ''}`}>
    {!failed && photo && <div className="task-chat-visual">
      <a className="task-chat-photo" href={src} target="_blank" rel="noopener noreferrer" aria-label={t('Ouvrir {name}', { name: file.name })}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a private uploaded original */}
        <img src={src} alt={file.name} loading="lazy" onError={() => setFailed(true)} />
      </a>
      <a className="task-chat-media-download" href={download} aria-label={t('Télécharger {name}', { name: file.name })}><Download size={18} /></a>
    </div>}
    {!failed && video && <video className="task-chat-video" src={src} controls playsInline preload="none" aria-label={file.name} onError={() => setFailed(true)} />}
    {!failed && audio && <AudioPlayer src={src} label={file.name} speaker={file.name} variant="voice" preload="none" labels={{ play: t('Lire'), pause: t('Pause'), speed: t('Vitesse de lecture'), unavailable: t('Audio indisponible. Réessayez ou téléchargez le fichier.') }} />}
    {failed && <small className="task-chat-preview-error">{t('Aperçu indisponible. Téléchargez le fichier pour l’ouvrir.')}</small>}
    {(!photo || failed) && <div className="task-chat-file">
      {!video && !audio && <span className="task-chat-file-icon"><FileIcon type={file.type} /><b>{label.slice(0, 5)}</b></span>}
      <a href={video || audio || file.type === 'application/pdf' ? src : download} target="_blank" rel="noopener noreferrer"><strong title={file.name}>{file.name}</strong><small>{sizeLabel(file.size)} · {label}</small></a>
      <a className="task-chat-download" href={download} aria-label={t('Télécharger {name}', { name: file.name })} title={t('Télécharger')}><Download size={18} /></a>
    </div>}
  </div>;
}

export default function TaskChat({
  messages, taskId, workspaceId, sender, isMine, senderLabel, canWrite, busy, onSend, onError, title, onDelete,
}: {
  messages: RecordItem[];
  taskId: string;
  workspaceId?: string;
  sender: { id: string; name: string; client?: boolean };
  isMine: (message: RecordItem) => boolean;
  /** Who the sender is for the reader (« Client », « Studio », a role), under their name. */
  senderLabel?: (message: RecordItem) => string | undefined;
  canWrite: boolean;
  busy?: boolean;
  onSend: (message: ChatSend) => Promise<unknown>;
  onError: (message: string) => void;
  title?: string;
  /** The owner and admins remove a message (its text, voice note and files); absent for everyone else. */
  onDelete?: (message: RecordItem) => Promise<void>;
}) {
  const { t, tag, locale } = useI18n();
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<MentionSelection[]>([]);
  const [query, setQuery] = useState<ReturnType<typeof mentionQuery>>(null);
  const [people, setPeople] = useState<MentionCandidate[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState('');
  const [choice, setChoice] = useState(0);
  const peopleId = useId();
  const pickingPerson = query !== null;
  const matches = people.filter(p => searchName(p.name).includes(searchName(query?.query ?? '')));
  const activeChoice = Math.min(choice, Math.max(0, matches.length - 1));
  const [files, setFiles] = useState<Pending[]>([]);
  const [sending, setSending] = useState(false);
  const [liveMessages, setLiveMessages] = useState(messages);
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const [atBottom, setAtBottom] = useState(true);
  const nearBottom = useRef(true);
  const [syncError, setSyncError] = useState('');
  const [accessError, setAccessError] = useState('');
  const inFlight = useRef(new Set<string>());
  const refreshChat = useRef<(fresh?: boolean) => void>(() => {});
  const [replying, setReplying] = useState<RecordItem | null>(null);
  const swipe = useRef<{ id: string; x: number; y: number; dx: number; active: boolean; pointer: number } | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const peopleList = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const uploads = useRef(new Map<string, AbortController>());
  const uploadQueue = useRef<{ file: File; key: string; workspaceId: string; controller: AbortController }[]>([]);
  const activeUploads = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const sendOnStop = useRef(false);
  const seen = useRef(0);
  const editRange = useRef<{ start: number; end: number } | undefined>(undefined);

  // Workspace snapshots can arrive late. Keep newer message revisions and locally confirmed sends.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reconcile late snapshots with locally confirmed sends, rather than replacing them.
    setLiveMessages(current => mergeChatMessages(current, messages));
  }, [messages]);

  useEffect(() => {
    if (!workspaceId) return;
    const reader = new TaskChatReader();
    let disposed = false, generation = 0;
    let next: ReturnType<typeof setTimeout>;
    const refresh = async (fresh = false) => {
      clearTimeout(next);
      const version = ++generation;
      let delay = 1000;
      try {
        if (document.visibilityState !== 'visible') return;
        const result = await reader.read(workspaceId, taskId, fresh);
        if (!result || disposed || version !== generation) return;
        if ([401, 403, 404].includes(result.status)) {
          setAccessError(result.error || 'Cette discussion n’est plus accessible.');
          setLiveMessages([]); return;
        }
        if (result.status !== 304 && !result.messages) throw Error('Actualisation de la discussion impossible.');
        setAccessError(''); setSyncError('');
        if (result.messages) setLiveMessages(current => mergeChatMessages(current, result.messages!));
      } catch {
        if (!disposed && version === generation) { setSyncError('Reconnexion de la discussion…'); delay = 5000; }
      } finally {
        if (!disposed && version === generation) next = setTimeout(() => void refresh(), delay);
      }
    };
    const wake = () => { if (document.visibilityState === 'visible') void refresh(true); };
    refreshChat.current = fresh => { void refresh(fresh); };
    void refresh();
    window.addEventListener('focus', wake); window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      disposed = true; clearTimeout(next); reader.cancel(); refreshChat.current = () => {};
      window.removeEventListener('focus', wake); window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [taskId, workspaceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- A live read can confirm a send whose response was lost.
    setOutgoing(current => current.some(item => liveMessages.some(m => m.id === item.message.id)) ? current.filter(item => !liveMessages.some(m => m.id === item.message.id)) : current);
  }, [liveMessages]);

  // Recheck participants each time the picker opens; assignments and memberships can change.
  useEffect(() => {
    if (!pickingPerson || !workspaceId || !canWrite) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset the participant picker when opening a fresh server lookup.
    setPeopleLoading(true); setPeopleError(''); setPeople([]);
    void fetch(`/api/records?chatTaskId=${encodeURIComponent(taskId)}`, { headers: { 'X-Workspace-Id': workspaceId }, signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Impossible de charger les participants.');
        if (!controller.signal.aborted) setPeople(data.people);
      })
      .catch(e => { if (!controller.signal.aborted) setPeopleError((e as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setPeopleLoading(false); });
    return () => controller.abort();
  }, [pickingPerson, taskId, workspaceId, canWrite]);

  useEffect(() => {
    if (pickingPerson && !peopleLoading) peopleList.current?.children[activeChoice]?.scrollIntoView({ block: 'nearest' });
  }, [pickingPerson, peopleLoading, activeChoice]);

  function updateQuery(value: string, caret: number, selected = mentions) {
    const found = mentionQuery(value, caret);
    const next = found && !selected.some(m => found.start < m.end && caret >= m.start) ? found : null;
    setQuery(next);
    if (next?.start !== query?.start || next?.query !== query?.query) setChoice(0);
  }
  function choosePerson(person: MentionCandidate) {
    if (!query || mentions.length >= 20) return;
    const token = `@${person.name}`;
    const next = text.slice(0, query.start) + token + ' ' + text.slice(query.end);
    if (next.length > 5000) return;
    setMentions([...editMentions(text, next, mentions), { userId: person.userId, start: query.start, end: query.start + token.length }]);
    setText(next); setQuery(null);
    const caret = query.start + token.length + 1;
    requestAnimationFrame(() => { field.current?.focus(); field.current?.setSelectionRange(caret, caret); });
  }
  function openPeople() {
    if (query) { setQuery(null); return; }
    const start = field.current?.selectionStart ?? text.length, end = field.current?.selectionEnd ?? start;
    const token = (start > 0 && !/[\s(]/.test(text[start - 1]) ? ' ' : '') + '@';
    const next = text.slice(0, start) + token + text.slice(end);
    if (next.length > 5000) return;
    const selected = editMentions(text, next, mentions, { start, end });
    setMentions(selected); setText(next); updateQuery(next, start + token.length, selected);
    requestAnimationFrame(() => { field.current?.focus(); field.current?.setSelectionRange(start + token.length, start + token.length); });
  }

  const sorted = [...(accessError ? [] : liveMessages), ...(!accessError ? outgoing.filter(item => !liveMessages.some(m => m.id === item.message.id)).map(item => item.message) : [])].sort((a, b) => timestampDate(a.createdAt).getTime() - timestampDate(b.createdAt).getTime() || a.id.localeCompare(b.id));
  const receiptTargets = JSON.stringify(accessError ? [] : liveMessages.filter(m => !isMine(m) && !m.deletedAt && !m.seenAt).map(m => ({ id: m.id, delivered: !!m.deliveredAt })));
  useEffect(() => {
    if (!workspaceId || !list.current) return;
    const targets = JSON.parse(receiptTargets) as { id: string; delivered: boolean }[];
    if (!targets.length) return;
    const delivered = new Set(targets.filter(m => !m.delivered).map(m => m.id)), viewed = new Set<string>(), acknowledged = new Set<string>();
    let disposed = false, active = false;
    let next: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const schedule = (delay = 250) => { if (!disposed && !active && !next) next = setTimeout(() => { next = undefined; void flush(); }, delay); };
    async function flush() {
      if (disposed || active || (!delivered.size && !viewed.size)) return;
      active = true; controller = new AbortController();
      const batchSeen = [...viewed].slice(0, 100), batchDelivered = [...new Set([...batchSeen, ...delivered])].slice(0, 200);
      const timeout = setTimeout(() => controller?.abort(), 8000);
      let failed = false;
      try {
        const response = await fetch('/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': workspaceId! },
          body: JSON.stringify({ action: 'chat-receipt', taskId, delivered: batchDelivered, seen: batchSeen }), signal: controller.signal });
        if (!response.ok) throw Error('receipt');
        batchDelivered.forEach(id => delivered.delete(id)); batchSeen.forEach(id => { viewed.delete(id); acknowledged.add(id); });
        refreshChat.current(true);
      } catch { failed = true; }
      finally { clearTimeout(timeout); active = false; if (!disposed && (delivered.size || viewed.size)) schedule(failed ? 3000 : 250); }
    }
    const visible = new Set<string>();
    const markVisible = () => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
      visible.forEach(id => { if (!acknowledged.has(id)) viewed.add(id); }); schedule();
    };
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const id = (entry.target as HTMLElement).dataset.messageId!;
        if (entry.isIntersecting && entry.intersectionRect.height >= Math.min(entry.boundingClientRect.height * .55, 120)) visible.add(id); else visible.delete(id);
      }); markVisible();
    }, { threshold: [0, .1, .55] });
    const ids = new Set(targets.map(m => m.id));
    list.current.querySelectorAll<HTMLElement>('[data-message-id]').forEach(el => { if (ids.has(el.dataset.messageId!)) observer.observe(el); });
    schedule(); window.addEventListener('focus', markVisible); document.addEventListener('visibilitychange', markVisible);
    return () => { disposed = true; if (next) clearTimeout(next); controller?.abort(); observer.disconnect(); window.removeEventListener('focus', markVisible); document.removeEventListener('visibilitychange', markVisible); };
  }, [receiptTargets, taskId, workspaceId]);
  const uploading = files.some((f) => !f.file && !f.error);
  const ready = files.filter((f) => f.file).map((f) => f.file!);
  const canSend = canWrite && !accessError && !busy && !sending && !uploading && (!!text.trim() || ready.length > 0);

  // New messages scroll into view, as in a chat; the first render lands on the latest one.
  useEffect(() => {
    if (sorted.length !== seen.current && nearBottom.current) list.current?.scrollTo({ top: list.current.scrollHeight, behavior: seen.current ? "smooth" : "auto" });
    seen.current = sorted.length;
  }, [sorted.length]);
  useEffect(() => {
    const thread = list.current?.querySelector('.task-chat-thread');
    if (!thread) return;
    // Lazy images and audio metadata can increase a bubble after the initial scroll.
    const observer = new ResizeObserver(() => { if (nearBottom.current) list.current?.scrollTo({ top: list.current.scrollHeight }); });
    observer.observe(thread);
    return () => observer.disconnect();
  }, [taskId]);
  // The field grows with the text, up to a few lines.
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);
  // Leaving mid-recording releases the microphone; previews release their memory.
  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
    const r = recorder.current;
    if (r && r.state !== "inactive") { sendOnStop.current = false; r.stop(); }
    r?.stream.getTracks().forEach((track) => track.stop());
  }, []);
  const previews = useRef<string[]>([]);
  useEffect(() => () => previews.current.forEach((url) => URL.revokeObjectURL(url)), []);
  useEffect(() => () => { uploads.current.forEach(controller => controller.abort()); uploadQueue.current = []; }, []);

  function removeFile(file: Pending) {
    uploads.current.get(file.key)?.abort(); uploads.current.delete(file.key);
    if (file.preview) { URL.revokeObjectURL(file.preview); previews.current = previews.current.filter(url => url !== file.preview); }
    setFiles(current => current.filter(f => f.key !== file.key));
  }
  function drainUploads() {
    while (activeUploads.current < 2 && uploadQueue.current.length) {
      const entry = uploadQueue.current.shift()!;
      if (entry.controller.signal.aborted) continue;
      activeUploads.current++;
      void uploadTaskFile(entry.file, entry.workspaceId, entry.controller.signal, progress => {
        if (!entry.controller.signal.aborted) setFiles(current => current.map(f => f.key === entry.key ? { ...f, progress } : f));
      }).then(file => {
        if (!entry.controller.signal.aborted) setFiles(current => current.map(f => f.key === entry.key ? { ...f, file, type: file.type, progress: 100 } : f));
      }).catch(error => {
        if (!entry.controller.signal.aborted) setFiles(current => current.map(f => f.key === entry.key ? { ...f, error: t((error as Error).message) } : f));
      }).finally(() => { uploads.current.delete(entry.key); activeUploads.current--; drainUploads(); });
    }
  }
  function pick(list: FileList | null) {
    if (!list?.length || !workspaceId) return;
    const picked = [...list].slice(0, 10 - files.length);
    const entries: Pending[] = picked.map((file) => ({
      key: crypto.randomUUID(), name: file.name, type: taskFileType(file.type, file.name), size: file.size, progress: 0,
      preview: file.size <= maxTaskFileBytes && previewImage(taskFileType(file.type, file.name)) ? URL.createObjectURL(file) : undefined,
    }));
    previews.current.push(...entries.flatMap((e) => (e.preview ? [e.preview] : [])));
    setFiles((current) => [...current, ...entries]);
    picked.forEach((file, i) => {
      const key = entries[i].key, controller = new AbortController();
      uploads.current.set(key, controller); uploadQueue.current.push({ file, key, workspaceId, controller });
    });
    drainUploads();
  }

  async function transmit(item: Outgoing) {
    if (inFlight.current.has(item.message.id)) return;
    inFlight.current.add(item.message.id);
    setOutgoing(current => current.map(value => value.message.id === item.message.id ? { ...value, delivery: 'sending' } : value));
    try {
      const result = await onSend(item.input) as { message?: RecordItem } | undefined;
      if (!result?.message || result.message.id !== item.message.id) throw Error('Le serveur n’a pas confirmé l’enregistrement. Vos saisies sont conservées ; réessayez dans un instant.');
      setLiveMessages(current => mergeChatMessages(current, [result.message!]));
      setOutgoing(current => current.filter(value => value.message.id !== item.message.id));
      refreshChat.current(true);
    } catch (e) {
      setOutgoing(current => current.map(value => value.message.id === item.message.id ? { ...value, delivery: 'failed' } : value));
      onError(t((e as Error).message));
    } finally { inFlight.current.delete(item.message.id); }
  }

  function send(extra?: { audio?: string }) {
    if (accessError || !canWrite || (!extra?.audio && !canSend)) return;
    const trimmed = text.trim(), offset = text.length - text.trimStart().length;
    const selected = mentions.map(m => ({ ...m, start: m.start - offset, end: m.end - offset })).filter(m => m.start >= 0 && m.end <= trimmed.length);
    const submissionId = crypto.randomUUID();
    const input: ChatSend = { text: trimmed, ...(selected.length ? { mentions: selected } : {}), ...(replying ? { replyTo: replying.id } : {}), ...(extra?.audio ? { audio: extra.audio } : {}), ...(ready.length ? { attachments: ready } : {}), submissionId, chatOnly: true };
    const item: Outgoing = { input, delivery: 'sending', message: {
      id: `chat:${workspaceId}:${sender.id}:${submissionId}`, kind: 'comment', revision: 1, name: trimmed, taskId,
      author: sender.name, authorId: sender.id, createdAt: appNow().toISOString(),
      ...(sender.client ? { audience: 'client' } : {}), ...(extra?.audio ? { audio: extra.audio } : {}), ...(ready.length ? { attachments: ready } : {}),
      mentions: selected.map(m => ({ ...m, name: trimmed.slice(m.start + 1, m.end) })),
      ...(replying ? { replyTo: replying.id } : {}),
    } };
    // Release the composer immediately. Each failed bubble retains its original payload and retry key;
    // a late acknowledgement must never clear the next message the user is typing.
    setOutgoing(current => [...current, item]);
    setText(''); setFiles([]); setMentions([]); setQuery(null); setReplying(null);
    previews.current.forEach(url => URL.revokeObjectURL(url)); previews.current = [];
    nearBottom.current = true; setAtBottom(true);
    requestAnimationFrame(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); field.current?.focus(); });
    return transmit(item);
  }

  async function startRecording() {
    const mimeType = pickMimeType();
    if (!mimeType || !navigator.mediaDevices?.getUserMedia) { onError(t("L’enregistrement vocal n’est pas pris en charge par ce navigateur.")); return; }
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { onError(t("Autorisez le micro pour enregistrer un message vocal.")); return; }
    const r = new MediaRecorder(stream, { mimeType });
    chunks.current = [];
    r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
    r.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      const clip = new Blob(chunks.current, { type: mimeType });
      chunks.current = [];
      setRecording(false);
      if (!sendOnStop.current || !clip.size || !workspaceId) return;
      setSending(true);
      try { await send({ audio: await uploadVoice(clip, workspaceId) }); } catch (e) { onError(t((e as Error).message)); } finally { setSending(false); }
    };
    recorder.current = r;
    sendOnStop.current = false;
    r.start(250);
    setRecording(true); setSeconds(0);
    timer.current = setInterval(() => setSeconds((s) => { if (s + 1 >= maxVoiceSeconds) stopRecording(true); return s + 1; }), 1000);
  }
  function stopRecording(andSend: boolean) {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    const r = recorder.current;
    recorder.current = null;
    sendOnStop.current = andSend;
    if (r && r.state !== "inactive") r.stop();
    else setRecording(false);
  }

  const rtl = locale === "ar";
  const snippet = (m: RecordItem) => m.deletedAt ? t("Message supprimé") : m.name ? m.name.replace(/\s+/g, " ").slice(0, 90)
    : m.audio ? t("Message vocal") : m.attachments?.length ? m.attachments[0].name : "";
  function startReply(m: RecordItem) {
    if (!canWrite || accessError || m.deletedAt) return;
    setReplying(m);
    if (typeof navigator !== "undefined") navigator.vibrate?.(8);
    requestAnimationFrame(() => field.current?.focus());
  }
  function jumpTo(id: string) {
    const el = list.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1400);
  }
  // Drag a message sideways to answer it, as on WhatsApp (to the right; to the left in right-to-left languages).
  function swipeStart(e: React.PointerEvent<HTMLElement>, m: RecordItem, locked: boolean) {
    if (!canWrite || accessError || m.deletedAt || locked) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('a, button, input, textarea, video, audio, [role="slider"], .task-chat-voice, .task-chat-quote')) return;
    swipe.current = { id: m.id, x: e.clientX, y: e.clientY, dx: 0, active: false, pointer: e.pointerId };
  }
  function swipeMove(e: React.PointerEvent<HTMLElement>) {
    const s = swipe.current;
    if (!s || s.pointer !== e.pointerId) return;
    const dx = (e.clientX - s.x) * (rtl ? -1 : 1), dy = e.clientY - s.y;
    if (!s.active) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { swipe.current = null; return; }
      if (dx > 10 && dx > Math.abs(dy)) { s.active = true; e.currentTarget.setPointerCapture?.(e.pointerId); window.getSelection()?.removeAllRanges(); e.currentTarget.classList.add("swiping"); }
      else return;
    }
    s.dx = dx;
    const shift = Math.min(Math.max(dx, 0), replyMaxShift);
    e.currentTarget.style.setProperty("--swipe", `${shift * (rtl ? -1 : 1)}px`);
    e.currentTarget.style.setProperty("--swipe-progress", String(Math.min(shift / replyDistance, 1)));
  }
  function swipeEnd(e: React.PointerEvent<HTMLElement>, m: RecordItem) {
    const s = swipe.current;
    if (!s || s.pointer !== e.pointerId) return;
    swipe.current = null;
    e.currentTarget.classList.remove("swiping");
    e.currentTarget.style.removeProperty("--swipe"); e.currentTarget.style.removeProperty("--swipe-progress");
    if (s.active && e.type === "pointerup" && s.dx >= replyDistance) startReply(m);
  }

  const dayOf = appDayKey;
  const dayLabel = (iso: string) => {
    const day = dayOf(iso);
    const today = appNow();
    const yesterday = new Date(`${dayOf(today)}T12:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    if (day === dayOf(today.toISOString())) return t("Aujourd’hui");
    if (day === yesterday.toISOString().slice(0, 10)) return t("Hier");
    return formatTimestamp(iso, tag, { weekday: "long", day: "numeric", month: "long", ...(day.slice(0, 4) !== dayOf(today).slice(0, 4) ? { year: "numeric" } : {}) });
  };
  const clock = (iso: string) => formatTimestamp(iso, tag, { hour: "2-digit", minute: "2-digit" });

  return (
    <section className="task-chat" aria-label={title || t("Discussion")} dir={locale === "ar" ? "rtl" : "ltr"}>
      <header className="task-chat-head">
        <span className="task-chat-avatar"><MessageCircle size={22} /></span><div>
        <strong>{title || t("Discussion")}</strong>
        <small>{t("Le propriétaire, le client et la personne sur la tâche échangent ici.")}</small>
        {(accessError || syncError) && <small role="status">{t(accessError || syncError)}</small>}
        </div>
      </header>
      <div className="task-chat-body" ref={list} role="log" aria-live="polite" onScroll={() => { const el = list.current; if (el) { nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 72; setAtBottom(nearBottom.current); } }}>
        {!sorted.length && <p className="task-chat-empty">{t("La conversation commence ici. Écrivez un message ou partagez un fichier.")}</p>}
        <div className="task-chat-thread">{sorted.map((m, i) => {
          const pending = outgoing.find(item => item.message.id === m.id);
          const delivery = pending?.delivery;
          const mine = !!delivery || isMine(m);
          const previous = sorted[i - 1];
          const newDay = !previous || dayOf(previous.createdAt) !== dayOf(m.createdAt);
          const sameSender = !newDay && previous && previous.author === m.author && isMine(previous) === mine && timestampDate(m.createdAt).getTime() - timestampDate(previous.createdAt).getTime() < 300_000;
          const label = senderLabel?.(m);
          return (
            <Fragment key={m.id}>
              {newDay && <div className="task-chat-day"><span>{dayLabel(m.createdAt)}</span></div>}
              <div data-message-id={m.id} className={`task-chat-row ${mine ? "mine" : "theirs"}${sameSender ? " follow" : ""}${m.deletedAt ? " deleted" : ""}`}
                onPointerDown={(e) => swipeStart(e, m, !!delivery)} onPointerMove={swipeMove} onPointerUp={(e) => swipeEnd(e, m)} onPointerCancel={(e) => swipeEnd(e, m)}>
                <span className="task-chat-swipe-icon" aria-hidden="true"><Reply size={18} /></span>
                <div className="task-chat-bubble">
                  {(!sameSender && !mine) && <span className="task-chat-author" style={{ color: mine ? undefined : colorOf(m.author) }}>{mine ? t("Vous") : m.author || t("Membre de l’équipe")}{!mine && label && <em>{label}</em>}</span>}
                  {canWrite && !accessError && !m.deletedAt && !delivery && (
                    <button type="button" className="task-chat-reply" aria-label={t("Répondre à {name}", { name: mine ? t("Vous") : m.author || "" })} title={t("Répondre")} onClick={() => startReply(m)}>
                      <Reply size={13} />
                    </button>
                  )}
                  {onDelete && !m.deletedAt && !delivery && (
                    <button type="button" className="task-chat-delete" aria-label={t("Supprimer le message de {name}", { name: m.author || "" })} title={t("Supprimer")}
                      onClick={() => { if (window.confirm(t("Supprimer ce message pour tout le monde ? Son texte, son vocal et ses fichiers seront effacés."))) void onDelete(m).catch((e) => onError(t((e as Error).message))); }}>
                      <Trash2 size={13} />
                    </button>
                  )}
                  {m.replyTo && !m.deletedAt && (() => {
                    const quoted = sorted.find(x => x.id === m.replyTo);
                    return <button type="button" className="task-chat-quote" onClick={() => quoted && jumpTo(quoted.id)} disabled={!quoted}
                      style={{ borderInlineStartColor: quoted && !isMine(quoted) ? colorOf(quoted.author) : undefined }}>
                      <strong style={{ color: quoted && !isMine(quoted) ? colorOf(quoted.author) : undefined }}>{quoted ? (isMine(quoted) ? t("Vous") : quoted.author || t("Membre de l’équipe")) : t("Message")}</strong>
                      <span>{quoted ? snippet(quoted) || "…" : t("Message d’origine indisponible")}</span>
                    </button>;
                  })()}
                  {m.deletedAt && <p className="task-chat-text task-chat-removed"><Ban size={14} />{t("Message supprimé par {name}", { name: m.deletedBy ?? "" })}</p>}
                  {m.attachments?.map(file => <ChatAttachment key={file.id} file={file} />)}
                  {m.audio && <div className="task-chat-voice"><AudioPlayer src={`/api/assets/${m.audio}`} label={t("Message vocal")} variant="voice" speaker={m.author} preload="none" labels={{ play: t("Lire"), pause: t("Pause"), speed: t("Vitesse de lecture"), unavailable: t("Audio indisponible. Réessayez ou téléchargez le fichier.") }} /></div>}
                  {m.name && <p className="task-chat-text">{messageText(m)}</p>}
                  <span className={`task-chat-meta${delivery === 'failed' ? ' failed' : ''}`}>
                    <time dateTime={m.createdAt} title={`${formatTimestamp(m.createdAt, tag, { dateStyle: 'medium', timeStyle: 'short' })} · Casablanca`}>{clock(m.createdAt)}</time>
                    {delivery === 'sending' ? <Clock3 size={14} aria-label={t('Envoi…')} /> : delivery === 'failed' ? <><span role="alert">{t('Envoi impossible.')}</span><button type="button" className="text-link" disabled={busy || !canWrite || !!accessError} onClick={() => pending && void transmit(pending)}>{t('Réessayer')}</button></> : mine && !m.deletedAt && (
                      <span className={`task-chat-receipt${m.seenAt ? ' seen' : ''}`} role="img" aria-label={t(m.seenAt ? 'Vu par un participant' : m.deliveredAt ? 'Distribué à un participant' : 'Envoyé')} title={t(m.seenAt ? 'Vu par un participant' : m.deliveredAt ? 'Distribué à un participant' : 'Envoyé')}>
                        {m.seenAt ? <CheckCheck size={17} /> : m.deliveredAt ? <Check size={17} /> : <span>{t('Envoyé')}</span>}
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </Fragment>
          );
        })}</div>
      </div>
      {!atBottom && <button type="button" className="task-chat-latest" aria-label={t('Derniers messages')} onClick={() => { nearBottom.current = true; setAtBottom(true); list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); }}><ArrowDown size={20} /></button>}
      {canWrite ? (
        <div className="task-chat-compose">
          {pickingPerson && !recording && <div className="task-chat-people">
            <div className="task-chat-people-head"><strong>{t('Mentionner une personne')}</strong><button type="button" className="task-chat-icon" aria-label={t('Fermer')} onClick={() => setQuery(null)}><X size={16} /></button></div>
            {peopleLoading ? <p role="status"><Loader2 size={16} className="spin" />{t('Chargement…')}</p> : peopleError ? <p role="alert">{t(peopleError)}</p> : <>
              {!matches.length && <p role="status">{t('Aucun participant correspondant.')}</p>}
              <div ref={peopleList} id={peopleId} role="listbox" aria-label={t('Participants de cette tâche')}>
                {matches.map((person, i) => <button key={person.userId} id={`${peopleId}-${i}`} type="button" role="option" aria-selected={i === activeChoice} onMouseDown={e => e.preventDefault()} onClick={() => choosePerson(person)}>
                  <AtSign size={16} /><span>{person.name}</span><small>{t(mentionRoles[person.role])}</small>
                </button>)}
              </div>
            </>}
          </div>}
          {replying && !recording && <div className="task-chat-replying">
            <div><strong>{t("Répondre à {name}", { name: isMine(replying) ? t("Vous") : replying.author || t("Membre de l’équipe") })}</strong><span>{snippet(replying) || "…"}</span></div>
            <button type="button" className="task-chat-icon" aria-label={t("Annuler la réponse")} title={t("Annuler la réponse")} onClick={() => setReplying(null)}><X size={16} /></button>
          </div>}
          {!!files.length && (
            <ul className="task-chat-pending">
              {files.map((f) => (
                <li key={f.key} className={f.error ? "failed" : ""}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the picked photo */}
                  {f.preview ? <img src={f.preview} alt="" /> : <span className="task-chat-file-icon small"><FileIcon type={f.type} size={16} /></span>}
                  <span><strong>{f.name}</strong><small>{f.error || (f.file ? `${sizeLabel(f.size)} · ${taskFileLabel(f.name, f.type)}` : t('Envoi… {progress} %', { progress: f.progress }))}</small>
                    {!f.file && !f.error && <progress value={f.progress} max={100} aria-label={t('Envoi de {name}', { name: f.name })} />}
                  </span>
                  <button type="button" className="task-chat-icon" aria-label={t("Retirer {name}", { name: f.name })} onClick={() => removeFile(f)}><X size={15} /></button>
                </li>
              ))}
            </ul>
          )}
          {recording ? (
            <div className="task-chat-bar recording">
              <button type="button" className="task-chat-icon danger" aria-label={t("Annuler l’enregistrement")} title={t("Annuler")} onClick={() => stopRecording(false)}><Trash2 size={19} /></button>
              <span className="task-chat-rec" role="status" aria-live="polite"><i />{formatClock(seconds)}<small>{t("Enregistrement…")}</small></span>
              <button type="button" className="task-chat-send" aria-label={t("Envoyer le message vocal")} onClick={() => stopRecording(true)}><Send size={18} /></button>
            </div>
          ) : (
            <form className="task-chat-bar" onSubmit={(e) => { e.preventDefault(); void send(); }}>
              <div className="task-chat-field">
                <button type="button" className="task-chat-icon" aria-label={t("Joindre un fichier")} title={t("Tous les fichiers · 100 Mo maximum par fichier")} disabled={!workspaceId || sending || files.length >= 10} onClick={() => picker.current?.click()}><Paperclip size={19} /></button>
                <input ref={picker} type="file" multiple hidden onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
                <button type="button" className="task-chat-icon" aria-label={t('Mentionner une personne')} title={t('Mentionner une personne')} disabled={!workspaceId || sending || mentions.length >= 20} onClick={openPeople}><AtSign size={19} /></button>
                <textarea
                  ref={field} rows={1} maxLength={5000} disabled={sending} value={text} placeholder={t("Écrire un message")} aria-label={t("Écrire un message")}
                  role="combobox" aria-autocomplete="list" aria-expanded={pickingPerson} aria-controls={pickingPerson && !peopleLoading && !peopleError ? peopleId : undefined} aria-activedescendant={pickingPerson && !peopleLoading && matches.length ? `${peopleId}-${activeChoice}` : undefined}
                  onBeforeInput={(e) => { editRange.current = { start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd }; }}
                  onChange={(e) => { const next = e.target.value, selected = editMentions(text, next, mentions, editRange.current); editRange.current = undefined; setText(next); setMentions(selected); updateQuery(next, e.target.selectionStart, selected); }}
                  onSelect={(e) => { if (e.currentTarget.selectionStart === e.currentTarget.selectionEnd) updateQuery(text, e.currentTarget.selectionStart); }}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    if (query && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && ['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key)) {
                      e.preventDefault();
                      if (e.key === 'Escape') setQuery(null);
                      else if (e.key === 'Enter') { if (!peopleLoading && matches.length) choosePerson(matches[activeChoice]); }
                      else setChoice((activeChoice + (e.key === 'ArrowDown' ? 1 : -1) + Math.max(1, matches.length)) % Math.max(1, matches.length));
                      return;
                    }
                    if (e.key === 'Escape' && replying) { setReplying(null); return; }
                    if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); void send(); }
                  }}
                />
              </div>
              {text.trim() || ready.length || uploading ? (
                <button className="task-chat-send" disabled={!canSend} aria-label={t("Envoyer")}>{sending ? <Loader2 size={18} className="spin" /> : <Send size={18} />}</button>
              ) : (
                <button type="button" className="task-chat-send" disabled={!workspaceId || sending || busy} aria-label={t("Enregistrer un message vocal")} title={t("Enregistrer un message vocal")} onClick={() => void startRecording()}>{sending ? <Loader2 size={18} className="spin" /> : <Mic size={19} />}</button>
              )}
            </form>
          )}
        </div>
      ) : (
        <p className="task-chat-readonly">{t("Lecture seule : vous ne pouvez pas écrire dans cette discussion.")}</p>
      )}
    </section>
  );
}

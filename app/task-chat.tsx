"use client";
// A task's conversation, drawn like a WhatsApp chat: the owner, the studio, the client and the person
// on the task talk in one thread — text, voice messages (tap the mic, tap send) and files (PDFs,
// photos). Mine on the right, theirs on the left with who wrote it, a day marker between days.
// Used by the studio's task page (app/tracker.tsx) and the client portal (app/portal.tsx); what each
// side may see and send is decided by /api/records and /api/assets, not here.
import { Fragment, useEffect, useId, useRef, useState } from "react";
import { AtSign, Ban, Check, Download, FileText, Loader2, Mic, Paperclip, Send, Trash2, X } from "lucide-react";
import AudioPlayer, { formatClock } from "@/app/audio-player";
import { maxVoiceSeconds, pickMimeType, uploadVoice } from "@/app/voice-recorder";
import { useI18n } from "@/app/locale-provider";
import type { Attachment, RecordItem } from "@/lib/model";
import { appDayKey, appNow, formatTimestamp, timestampDate } from "@/lib/time";
import { mergeChatMessages, TaskChatReader } from '@/lib/task-chat-client';
import { editMentions, mentionQuery, type MentionCandidate, type MentionSelection } from "@/lib/task-mentions";

export type ChatSend = { text: string; audio?: string; attachments?: Attachment[]; mentions?: MentionSelection[]; submissionId: string; chatOnly: true };
type Pending = { key: string; name: string; type: string; size: number; preview?: string; file?: Attachment; error?: string };

const maxFileBytes = 4_000_000;
const accepted = "application/pdf,image/jpeg,image/png,image/webp,image/gif,image/heic";
const isImage = (type: string) => type.startsWith("image/");
const sizeLabel = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} Mo` : `${Math.max(1, Math.round(bytes / 1000))} Ko`);
// A stable colour per person, as WhatsApp does for names in a group.
const nameColors = ['var(--t-info)', 'var(--t-review-ink)', 'var(--t-purple)', 'var(--t-success)', 'var(--t-danger)', 'var(--t-brand-text)'];
const colorOf = (name = "") => nameColors[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % nameColors.length];
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

/** Phone photos are often larger than an upload allows (or HEIC): they go as a JPEG of at most 2400 px. */
async function fitPhoto(file: File): Promise<File> {
  if (!isImage(file.type) || file.type === "image/gif" || (file.size <= maxFileBytes && file.type !== "image/heic")) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  return blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
}

async function uploadFile(file: File, workspaceId: string): Promise<Attachment> {
  const body = new FormData();
  body.append("kind", "file");
  body.append("file", file);
  const response = await fetch("/api/assets", { method: "POST", body, headers: { "X-Workspace-Id": workspaceId } })
    .catch(() => { throw new Error("Connexion au serveur impossible. Vérifiez votre connexion internet, puis réessayez : votre texte est conservé."); });
  const data = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!response.ok || !data.id) throw new Error(data.error || "Envoi impossible.");
  return { id: data.id, name: file.name, type: file.type, size: file.size };
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
  const [pendingMessage, setPendingMessage] = useState<(RecordItem & { delivery: 'sending' | 'failed' }) | null>(null);
  const [syncError, setSyncError] = useState('');
  const [accessError, setAccessError] = useState('');
  const sendActive = useRef(false);
  const submission = useRef<{ content: string; id: string; audio?: string } | null>(null);
  const refreshChat = useRef<(fresh?: boolean) => void>(() => {});
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const peopleList = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const sendOnStop = useRef(false);
  const seen = useRef(0);
  const editRange = useRef<{ start: number; end: number } | undefined>(undefined);

  // Workspace snapshots can arrive late. Keep newer message revisions and locally confirmed sends.
  useEffect(() => {
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
      let delay = 2000;
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

  // Recheck participants each time the picker opens; assignments and memberships can change.
  useEffect(() => {
    if (!pickingPerson || !workspaceId || !canWrite) return;
    const controller = new AbortController();
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

  const sorted = [...(accessError ? [] : liveMessages), ...(pendingMessage && !accessError && !liveMessages.some(m => m.id === pendingMessage.id) ? [pendingMessage] : [])].sort((a, b) => timestampDate(a.createdAt).getTime() - timestampDate(b.createdAt).getTime() || a.id.localeCompare(b.id));
  const uploading = files.some((f) => !f.file && !f.error);
  const ready = files.filter((f) => f.file).map((f) => f.file!);
  const canSend = canWrite && !accessError && !busy && !sending && !uploading && (!!text.trim() || ready.length > 0);

  // New messages scroll into view, as in a chat; the first render lands on the latest one.
  useEffect(() => {
    if (sorted.length !== seen.current) list.current?.scrollTo({ top: list.current.scrollHeight, behavior: seen.current ? "smooth" : "auto" });
    seen.current = sorted.length;
  }, [sorted.length]);
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

  async function pick(list: FileList | null) {
    if (!list?.length || !workspaceId) return;
    const picked = [...list].slice(0, 10 - files.length);
    const entries: Pending[] = picked.map((file) => ({
      key: crypto.randomUUID(), name: file.name, type: file.type, size: file.size,
      preview: isImage(file.type) ? URL.createObjectURL(file) : undefined,
    }));
    previews.current.push(...entries.flatMap((e) => (e.preview ? [e.preview] : [])));
    setFiles((current) => [...current, ...entries]);
    await Promise.all(picked.map(async (raw, i) => {
      const key = entries[i].key;
      try {
        if (!accepted.split(",").includes(raw.type)) throw new Error(t("Formats acceptés : PDF, JPEG, PNG, WebP."));
        const file = await fitPhoto(raw);
        if (file.size > maxFileBytes) throw new Error(t("Fichier trop lourd (4 Mo maximum)."));
        const uploaded = await uploadFile(file, workspaceId);
        setFiles((current) => current.map((f) => (f.key === key ? { ...f, file: uploaded, size: uploaded.size } : f)));
      } catch (e) {
        setFiles((current) => current.map((f) => (f.key === key ? { ...f, error: t((e as Error).message) } : f)));
      }
    }));
  }

  async function send(extra?: { audio?: string }) {
    if (sendActive.current || accessError || !canWrite || (!extra?.audio && !canSend)) return;
    sendActive.current = true;
    setSending(true);
    try {
      const trimmed = text.trim(), offset = text.length - text.trimStart().length;
      const selected = mentions.map(m => ({ ...m, start: m.start - offset, end: m.end - offset })).filter(m => m.start >= 0 && m.end <= trimmed.length);
      const content = { text: trimmed, ...(selected.length ? { mentions: selected } : {}), ...(extra?.audio ? { audio: extra.audio } : {}), ...(ready.length ? { attachments: ready } : {}) };
      const serialized = JSON.stringify(content);
      if (submission.current?.content !== serialized) submission.current = { content: serialized, id: crypto.randomUUID(), audio: extra?.audio };
      const submissionId = submission.current.id;
      const id = `chat:${workspaceId}:${sender.id}:${submissionId}`;
      setPendingMessage({ id, kind: 'comment', revision: 1, name: trimmed, taskId, author: sender.name, authorId: sender.id, createdAt: appNow().toISOString(), ...(sender.client ? { audience: 'client' } : {}), ...(extra?.audio ? { audio: extra.audio } : {}), ...(ready.length ? { attachments: ready } : {}), delivery: 'sending' });
      const result = await onSend({ ...content, submissionId, chatOnly: true }) as { message?: RecordItem } | undefined;
      if (!result?.message || result.message.id !== id) throw Error('Le serveur n’a pas confirmé l’enregistrement. Vos saisies sont conservées ; réessayez dans un instant.');
      setLiveMessages(current => mergeChatMessages(current, [result.message!]));
      setPendingMessage(null); submission.current = null;
      setText(""); setFiles([]); setMentions([]); setQuery(null);
      refreshChat.current(true);
    } catch (e) {
      setPendingMessage(current => current ? { ...current, delivery: 'failed' } : null);
      onError(t((e as Error).message));
    } finally {
      sendActive.current = false;
      setSending(false);
      field.current?.focus();
    }
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
      try { await send({ audio: await uploadVoice(clip, workspaceId) }); } catch (e) { onError(t((e as Error).message)); setSending(false); }
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
        <strong>{title || t("Discussion")}</strong>
        <small>{t("Le propriétaire, le client et la personne sur la tâche échangent ici.")}</small>
        {(accessError || syncError) && <small role="status">{t(accessError || syncError)}</small>}
      </header>
      <div className="task-chat-body" ref={list} role="log" aria-live="polite">
        {!sorted.length && <p className="task-chat-empty">{t("La conversation commence ici. Écrivez un message, envoyez un vocal ou un PDF.")}</p>}
        {sorted.map((m, i) => {
          const delivery = 'delivery' in m ? m.delivery : undefined;
          const mine = !!delivery || isMine(m);
          const previous = sorted[i - 1];
          const newDay = !previous || dayOf(previous.createdAt) !== dayOf(m.createdAt);
          const sameSender = !newDay && previous && previous.author === m.author && isMine(previous) === mine;
          const label = senderLabel?.(m);
          const onlyPhotos = !m.deletedAt && !m.name && !m.audio && !!m.attachments?.length && m.attachments.every((a) => isImage(a.type));
          return (
            <Fragment key={m.id}>
              {newDay && <div className="task-chat-day"><span>{dayLabel(m.createdAt)}</span></div>}
              <div className={`task-chat-row ${mine ? "mine" : "theirs"}${sameSender ? " follow" : ""}${m.deletedAt ? " deleted" : ""}`}>
                <div className={`task-chat-bubble${onlyPhotos ? " photos" : ""}`}>
                  {/* Every message says who sent it — mine included — so a voice note or a file is never anonymous. */}
                  <span className="task-chat-author" style={{ color: mine ? undefined : colorOf(m.author) }}>{mine ? t("Vous") : m.author || t("Membre de l’équipe")}{!mine && label && <em>{label}</em>}</span>
                  {onDelete && !m.deletedAt && !delivery && (
                    <button type="button" className="task-chat-delete" aria-label={t("Supprimer le message de {name}", { name: m.author || "" })} title={t("Supprimer")}
                      onClick={() => { if (window.confirm(t("Supprimer ce message pour tout le monde ? Son texte, son vocal et ses fichiers seront effacés."))) void onDelete(m).catch((e) => onError(t((e as Error).message))); }}>
                      <Trash2 size={13} />
                    </button>
                  )}
                  {m.deletedAt && <p className="task-chat-text task-chat-removed"><Ban size={14} />{t("Message supprimé par {name}", { name: m.deletedBy ?? "" })}</p>}
                  {m.attachments?.map((a) => isImage(a.type) ? (
                    <a key={a.id} className="task-chat-photo" href={`/api/assets/${a.id}`} target="_blank" rel="noopener noreferrer" aria-label={a.name}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- a private upload, served by /api/assets */}
                      <img src={`/api/assets/${a.id}`} alt={a.name} loading="lazy" />
                    </a>
                  ) : (
                    <div key={a.id} className="task-chat-file">
                      <span className="task-chat-file-icon"><FileText size={22} /><b>PDF</b></span>
                      <a href={`/api/assets/${a.id}`} target="_blank" rel="noopener noreferrer"><strong>{a.name}</strong><small>{sizeLabel(a.size)} · PDF</small></a>
                      <a className="task-chat-download" href={`/api/assets/${a.id}?download=${encodeURIComponent(a.name)}`} aria-label={t("Télécharger {name}", { name: a.name })} title={t("Télécharger")}><Download size={16} /></a>
                    </div>
                  ))}
                  {m.audio && <div className="task-chat-voice"><AudioPlayer src={`/api/assets/${m.audio}`} label={t("Message vocal")} labels={{ play: t("Lire"), pause: t("Pause") }} /></div>}
                  {m.name && <p className="task-chat-text">{messageText(m)}</p>}
                  <span className="task-chat-meta"><time dateTime={m.createdAt} title={`${formatTimestamp(m.createdAt, tag, { dateStyle: 'medium', timeStyle: 'short' })} · Casablanca`}>{clock(m.createdAt)}</time>{delivery === 'sending' ? <><Loader2 size={13} className="spin" aria-hidden="true" />{t('Envoi…')}</> : delivery === 'failed' ? <><span role="alert">{t('Envoi impossible.')}</span><button type="button" className="text-link" disabled={busy || sending || !canWrite || !!accessError} onClick={() => void send(submission.current?.audio ? { audio: submission.current.audio } : undefined)}>{t('Réessayer')}</button></> : mine && <Check size={13} aria-label={t("Envoyé")} />}</span>
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>
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
          {!!files.length && (
            <ul className="task-chat-pending">
              {files.map((f) => (
                <li key={f.key} className={f.error ? "failed" : ""}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the picked photo */}
                  {f.preview ? <img src={f.preview} alt="" /> : <span className="task-chat-file-icon small"><FileText size={16} /></span>}
                  <span><strong>{f.name}</strong><small>{f.error || (f.file ? sizeLabel(f.size) : t("Envoi…"))}</small></span>
                  {!f.file && !f.error ? <Loader2 size={15} className="spin" /> : (
                    <button type="button" className="task-chat-icon" aria-label={t("Retirer {name}", { name: f.name })} onClick={() => setFiles((current) => current.filter((x) => x.key !== f.key))}><X size={15} /></button>
                  )}
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
                <button type="button" className="task-chat-icon" aria-label={t("Joindre un fichier")} title={t("Joindre un PDF ou une photo")} disabled={!workspaceId || sending || files.length >= 10} onClick={() => picker.current?.click()}><Paperclip size={19} /></button>
                <input ref={picker} type="file" accept={accepted} multiple hidden onChange={(e) => { void pick(e.target.files); e.target.value = ""; }} />
                <button type="button" className="task-chat-icon" aria-label={t('Mentionner une personne')} title={t('Mentionner une personne')} disabled={!workspaceId || sending || mentions.length >= 20} onClick={openPeople}><AtSign size={19} /></button>
                <textarea
                  ref={field} rows={1} maxLength={5000} value={text} placeholder={t("Écrire un message")} aria-label={t("Écrire un message")}
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

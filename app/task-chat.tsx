"use client";
// A task's conversation, drawn like a WhatsApp chat: the owner, the studio, the client and the person
// on the task talk in one thread — text, voice messages (tap the mic, tap send) and files (PDFs,
// photos). Mine on the right, theirs on the left with who wrote it, a day marker between days.
// Used by the studio's task page (app/tracker.tsx) and the client portal (app/portal.tsx); what each
// side may see and send is decided by /api/records and /api/assets, not here.
import { Fragment, useEffect, useRef, useState } from "react";
import { Check, Download, FileText, Loader2, Mic, Paperclip, Send, Trash2, X } from "lucide-react";
import AudioPlayer, { formatClock } from "@/app/audio-player";
import { maxVoiceSeconds, pickMimeType, uploadVoice } from "@/app/voice-recorder";
import { useI18n } from "@/app/locale-provider";
import type { Attachment, RecordItem } from "@/lib/model";

export type ChatSend = { text: string; audio?: string; attachments?: Attachment[] };
type Pending = { key: string; name: string; type: string; size: number; preview?: string; file?: Attachment; error?: string };

const maxFileBytes = 4_000_000;
const accepted = "application/pdf,image/jpeg,image/png,image/webp,image/gif,image/heic";
const isImage = (type: string) => type.startsWith("image/");
const sizeLabel = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} Mo` : `${Math.max(1, Math.round(bytes / 1000))} Ko`);
// A stable colour per person, as WhatsApp does for names in a group.
const nameColors = ["#1f7aec", "#c2410c", "#7c3aed", "#0f766e", "#be185d", "#a16207", "#0369a1", "#15803d"];
const colorOf = (name = "") => nameColors[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % nameColors.length];

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
  const response = await fetch("/api/assets", { method: "POST", body, headers: { "X-Workspace-Id": workspaceId } });
  const data = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!response.ok || !data.id) throw new Error(data.error || "Envoi impossible.");
  return { id: data.id, name: file.name, type: file.type, size: file.size };
}

export default function TaskChat({
  messages, workspaceId, isMine, senderLabel, canWrite, busy, onSend, onError, title,
}: {
  messages: RecordItem[];
  workspaceId?: string;
  isMine: (message: RecordItem) => boolean;
  /** Who the sender is for the reader (« Client », « Studio », a role), under their name. */
  senderLabel?: (message: RecordItem) => string | undefined;
  canWrite: boolean;
  busy?: boolean;
  onSend: (message: ChatSend) => Promise<void>;
  onError: (message: string) => void;
  title?: string;
}) {
  const { t, tag, locale } = useI18n();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Pending[]>([]);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const sendOnStop = useRef(false);
  const seen = useRef(0);

  const sorted = [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const uploading = files.some((f) => !f.file && !f.error);
  const ready = files.filter((f) => f.file).map((f) => f.file!);
  const canSend = canWrite && !busy && !sending && !uploading && (!!text.trim() || ready.length > 0);

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
    if (!extra?.audio && !canSend) return;
    setSending(true);
    try {
      await onSend({ text: text.trim(), ...(extra?.audio ? { audio: extra.audio } : {}), ...(ready.length ? { attachments: ready } : {}) });
      setText(""); setFiles([]);
    } catch (e) {
      onError(t((e as Error).message));
    } finally {
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

  const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA");
  const dayLabel = (iso: string) => {
    const day = dayOf(iso);
    const today = new Date();
    const yesterday = new Date(Date.now() - 86_400_000);
    if (day === dayOf(today.toISOString())) return t("Aujourd’hui");
    if (day === dayOf(yesterday.toISOString())) return t("Hier");
    return new Date(iso).toLocaleDateString(tag, { weekday: "long", day: "numeric", month: "long", ...(new Date(iso).getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
  };
  const clock = (iso: string) => new Date(iso).toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" });

  return (
    <section className="task-chat" aria-label={title || t("Discussion")} dir={locale === "ar" ? "rtl" : "ltr"}>
      <header className="task-chat-head">
        <strong>{title || t("Discussion")}</strong>
        <small>{t("Le propriétaire, le client et la personne sur la tâche échangent ici.")}</small>
      </header>
      <div className="task-chat-body" ref={list} role="log" aria-live="polite">
        {!sorted.length && <p className="task-chat-empty">{t("La conversation commence ici. Écrivez un message, envoyez un vocal ou un PDF.")}</p>}
        {sorted.map((m, i) => {
          const mine = isMine(m);
          const previous = sorted[i - 1];
          const newDay = !previous || dayOf(previous.createdAt) !== dayOf(m.createdAt);
          const sameSender = !newDay && previous && previous.author === m.author && isMine(previous) === mine;
          const label = senderLabel?.(m);
          const onlyPhotos = !m.name && !m.audio && !!m.attachments?.length && m.attachments.every((a) => isImage(a.type));
          return (
            <Fragment key={m.id}>
              {newDay && <div className="task-chat-day"><span>{dayLabel(m.createdAt)}</span></div>}
              <div className={`task-chat-row ${mine ? "mine" : "theirs"}${sameSender ? " follow" : ""}`}>
                <div className={`task-chat-bubble${onlyPhotos ? " photos" : ""}`}>
                  {!mine && !sameSender && (
                    <span className="task-chat-author" style={{ color: colorOf(m.author) }}>{m.author || t("Membre de l’équipe")}{label && <em>{label}</em>}</span>
                  )}
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
                  {m.name && <p className="task-chat-text">{m.name}</p>}
                  <span className="task-chat-meta">{clock(m.createdAt)}{mine && <Check size={13} aria-label={t("Envoyé")} />}</span>
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>
      {canWrite ? (
        <div className="task-chat-compose">
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
                <textarea
                  ref={field} rows={1} maxLength={5000} value={text} placeholder={t("Écrire un message")} aria-label={t("Écrire un message")}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) { e.preventDefault(); void send(); } }}
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

"use client";
// The floating assistant (app/api/assistant): a round button in the corner of every screen — studio,
// client portal, print — that opens a chat about The One Core, the app and the work. Answers stream in
// as they are written; in the studio it also acts (creates and updates tasks, comments) and shows each
// action as a card, and it remembers what the studio teaches it (« Mémoire »). The conversation stays
// in this browser tab only; the memory is the workspace's.
import { Surface } from "@/components/ui/surface";
import { studioLabel, useBrand } from "@/features/workspace/brand-store";
import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, Check, CircleAlert, MessageCircle, RotateCcw, Send, Sparkles, Square, Trash2, X } from "lucide-react";
import { useAiAvailable } from "@/features/assistant/ai-assist";
import { useI18n } from "@/lib/i18n/locale-provider";
import { canTeachAssistant } from "@/lib/workspace";

type Action = { kind: "created" | "updated" | "commented" | "remembered" | "forgot" | "saved" | "failed"; name: string; taskId?: string; detail?: string };
/** `fresh`: written in this visit, so it is typed out; `status`: what the assistant is doing right now. */
type Message = { role: "user" | "model"; text: string; actions?: Action[]; fresh?: boolean; status?: string };
type Fact = { id: string; text: string; by: string; at: string };
/** What the assistant is doing while a tool runs. */
const toolLabels: Record<string, string> = {
  search_tasks: "Recherche dans les tâches…", list_clients: "Lecture des clients…", list_team: "Lecture de l’équipe…",
  create_task: "Création de la tâche…", update_task: "Mise à jour de la tâche…", add_comment: "Ajout du commentaire…",
  remember: "Mémorisation…", forget: "Suppression de la note…",
  search_library: "Recherche dans la bibliothèque…", save_to_library: "Ajout à la bibliothèque…",
};
const actionLabels: Record<Action["kind"], string> = {
  created: "Tâche créée", updated: "Tâche modifiée", saved: "Ajouté à la bibliothèque", commented: "Commentaire ajouté", remembered: "Retenu", forgot: "Oublié", failed: "Non fait",
};
/** What the model reads back of its own earlier actions, since the tab keeps only text. */
const withActions = (m: Message) => (m.actions?.length ? `${m.text}\n\n[${m.actions.map((a) => `${actionLabels[a.kind]} : ${a.name}${a.taskId ? ` (id ${a.taskId})` : ""}${a.detail && a.kind === "failed" ? ` — ${a.detail}` : ""}`).join(" ; ")}]` : m.text);

const storageKey = (workspaceId: string) => `the-one.assistant.${workspaceId}`;
const read = (key: string): Message[] => {
  try { const v = JSON.parse(sessionStorage.getItem(key) || "[]"); return Array.isArray(v) ? v.slice(-40) : []; } catch { return []; }
};

/** Bold (**…**) and line breaks, the only formatting the answers use; everything else stays text. */
function Rich({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>))}</>;
}

/**
 * The answer typed out as it arrives: the words received are revealed a few letters per frame — faster
 * when far behind — so a sentence Gemini sends in one piece still reads as being written.
 */
function Typing({ text, live, onType }: { text: string; live: boolean; onType: () => void }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (shown >= text.length) return;
    const frame = requestAnimationFrame(() => {
      setShown((n) => Math.min(text.length, n + Math.max(1, Math.ceil((text.length - n) / 24))));
      onType();
    });
    return () => cancelAnimationFrame(frame);
  }, [shown, text, onType]);
  const part = text.slice(0, shown);
  // A bold part being typed is shown bold already.
  const open = (part.match(/\*\*/g)?.length ?? 0) % 2 === 1;
  return <><Rich text={open ? `${part}**` : part} />{(live || shown < text.length) && <span className="assistant-caret" aria-hidden="true" />}</>;
}

export default function Assistant({ workspaceId, role, page, name, onChanged }: { workspaceId: string; role: string; page?: string; name?: string; onChanged?: () => void }) {
  const { t, locale } = useI18n();
  const studio = studioLabel(useBrand());
  const available = useAiAvailable("assistant");
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [facts, setFacts] = useState<Fact[] | null>(null);
  const [teach, setTeach] = useState(false);
  const [fact, setFact] = useState("");
  const studioRole = role !== "client";
  const mayTeach = canTeachAssistant(role);
  // While the answer is typed, the list follows it — unless the person scrolled up to read.
  const follow = useCallback(() => {
    const el = list.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- the tab's saved conversation, read once per workspace
  useEffect(() => { setMessages(read(storageKey(workspaceId))); }, [workspaceId]);
  useEffect(() => { try { sessionStorage.setItem(storageKey(workspaceId), JSON.stringify(messages.slice(-40).map(({ role, text, actions }) => ({ role, text, actions })))); } catch { /* private mode */ } }, [messages, workspaceId]);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [messages, busy, open]);
  useEffect(() => () => abort.current?.abort(), []);
  // A phone keeps the keyboard down until the person taps the field: the suggestions stay in view.
  useEffect(() => { if (open && !window.matchMedia("(max-width: 767px)").matches) field.current?.focus(); }, [open]);
  // On a phone the chat takes the screen: follow the part the keyboard leaves visible, and keep the
  // page behind it still.
  useEffect(() => {
    if (!open || !window.matchMedia("(max-width: 767px)").matches) return;
    const root = box.current;
    const view = window.visualViewport;
    const fit = () => {
      if (!root || !view) return;
      root.style.setProperty("--assistant-h", `${view.height}px`);
      root.style.setProperty("--assistant-top", `${view.offsetTop}px`);
      list.current?.scrollTo({ top: list.current.scrollHeight });
    };
    fit();
    view?.addEventListener("resize", fit);
    view?.addEventListener("scroll", fit);
    document.documentElement.classList.add("assistant-open");
    return () => {
      view?.removeEventListener("resize", fit);
      view?.removeEventListener("scroll", fit);
      document.documentElement.classList.remove("assistant-open");
      root?.style.removeProperty("--assistant-h");
      root?.style.removeProperty("--assistant-top");
    };
  }, [open]);

  if (!available) return null;
  const first = (name || "").split(/[\s@]/)[0];
  const suggestions = role === "client"
    ? [t("Qu’est-ce qui attend ma validation ?"), t("Comment demander une modification ?"), t("Comment connecter mon Instagram ?")]
    : role === "owner" || role === "admin" || role === "social"
        ? [t("Qu’est-ce qui coince aujourd’hui ?"), t("Quels clients n’ont pas répondu ?"), t(role === "social" ? "Comment programmer une publication ?" : "Crée une tâche pour un client")]
        : [t("Qu’est-ce que je fais ensuite ?"), t("Comment fonctionne la validation automatique ?")];

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    const next = [...messages, { role: "user" as const, text: question }];
    setMessages(next); setDraft(""); setBusy(true); setError("");
    const controller = new AbortController();
    abort.current = controller;
    // The answer's bubble is there at once and fills as the words arrive.
    let reply: Message = { role: "model", text: "", actions: [], fresh: true, status: "Réflexion…" };
    const show = () => setMessages([...next, reply]);
    // « Réflexion… » shows the moment the question is sent, not once the server starts answering.
    show();
    let changed = false;
    try {
      const response = await fetch("/api/assistant", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Workspace-Id": workspaceId },
        body: JSON.stringify({ messages: next.slice(-30).map((m) => ({ role: m.role, text: withActions(m) })), page, locale }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body || response.headers.get("content-type")?.includes("application/json")) {
        const data = (await response.json().catch(() => ({}))) as { reply?: string; error?: string };
        if (!response.ok || !data.reply) throw new Error(data.error || "L’assistant ne répond pas pour le moment. Réessayez.");
        reply = { ...reply, text: data.reply, status: undefined }; show();
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "", failure = "";
      const take = (line: string) => {
        if (!line.trim()) return;
        let event: { type?: string; text?: string; error?: string; changed?: boolean; name?: string } & Partial<Action>;
        try { event = JSON.parse(line); } catch { return; }
        if (event.type === "text" && event.text) reply = { ...reply, text: reply.text + event.text, status: undefined };
        else if (event.type === "tool") reply = { ...reply, status: toolLabels[event.name ?? ""] ?? "Réflexion…" };
        else if (event.type === "action" && event.kind) reply = { ...reply, status: "Réflexion…", actions: [...(reply.actions ?? []), { kind: event.kind, name: event.name ?? "", taskId: event.taskId, detail: event.detail }] };
        else if (event.type === "error") failure = event.error || "L’assistant ne répond pas pour le moment. Réessayez.";
        else if (event.type === "done") changed = !!event.changed;
        show();
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        lines.forEach(take);
      }
      take(buffer);
      if (failure) throw new Error(failure);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(t((e as Error).message));
    } finally {
      // An answer that never came leaves no empty bubble behind.
      if (!reply.text.trim() && !reply.actions?.length) setMessages(next);
      else {
        reply = { ...reply, status: undefined }; show();
        if (reply.actions?.some((a) => a.kind !== "failed")) changed = true;
      }
      abort.current = null;
      setBusy(false);
      if (changed) onChanged?.();
    }
  }

  async function memory(body?: Record<string, unknown>) {
    if (!mayTeach) return false;
    try {
      const response = await fetch("/api/assistant", body
        ? { method: "POST", headers: { "Content-Type": "application/json", "X-Workspace-Id": workspaceId }, body: JSON.stringify(body) }
        : { headers: { "X-Workspace-Id": workspaceId }, cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as { facts?: Fact[]; canTeach?: boolean; error?: string };
      if (!response.ok) throw new Error(data.error || "Chargement impossible.");
      setFacts(data.facts ?? []);
      if (data.canTeach !== undefined) setTeach(data.canTeach);
      return true;
    } catch (e) { setError(t((e as Error).message)); return false; }
  }
  const openMemory = () => { setMemoryOpen((o) => !o); if (!memoryOpen) void memory(); };

  return (
    <div ref={box} className={`assistant ${open ? "open" : ""}${busy ? " busy" : ""}`} dir={locale === "ar" ? "rtl" : "ltr"}>
      {open && (
        <Surface asChild tone="default"><section className="assistant-panel" role="dialog" aria-label={t("Assistant {studio}", { studio })}>
          <header className="assistant-head">
            <span className="assistant-avatar"><Sparkles size={15} /></span>
            <div><strong>{t("Assistant {studio}", { studio })}</strong><small>{t(mayTeach ? "Demandez, il agit : tâches, commentaires, mémoire" : studioRole ? "Questions sur le studio et vos tâches" : "Questions sur l’agence et l’application")}</small></div>
            {mayTeach && <button type="button" className={`assistant-icon${memoryOpen ? " on" : ""}`} onClick={openMemory} aria-pressed={memoryOpen} aria-label={t("Mémoire de l’assistant")} title={t("Mémoire de l’assistant")}><Brain size={15} /></button>}
            {!!messages.length && <button type="button" className="assistant-icon" onClick={() => { setMessages([]); setError(""); }} aria-label={t("Nouvelle conversation")} title={t("Nouvelle conversation")}><RotateCcw size={15} /></button>}
            <button type="button" className="assistant-icon" onClick={() => setOpen(false)} aria-label={t("Fermer")}><X size={16} /></button>
          </header>
          {mayTeach && memoryOpen && (
            <div className="assistant-memory">
              <p>{t("Ce que l’assistant a appris du studio. Il s’en sert à chaque question de l’équipe ; les clients ne le voient jamais.")}</p>
              {facts === null ? <small>{t("Chargement…")}</small> : !facts.length ? <small>{t("Rien pour l’instant. Écrivez par exemple : « Retiens que Kojo veut toujours ses posts en darija. »")}</small> : (
                <ul>
                  {facts.map((f) => (
                    <li key={f.id}>
                      <span dir="auto">{f.text}</span>
                      {teach && <button type="button" className="assistant-icon" aria-label={t("Oublier")} title={t("Oublier")} onClick={() => void memory({ action: "forget", id: f.id })}><Trash2 size={13} /></button>}
                    </li>
                  ))}
                </ul>
              )}
              {teach && (
                <form onSubmit={(e) => { e.preventDefault(); if (fact.trim()) void memory({ action: "remember", text: fact }).then((ok) => { if (ok) setFact(""); }); }}>
                  <input value={fact} maxLength={400} onChange={(e) => setFact(e.target.value)} placeholder={t("Une règle, une préférence, qui fait quoi…")} aria-label={t("Nouvelle note")} />
                  <button type="submit" className="btn" disabled={!fact.trim()}>{t("Retenir")}</button>
                </form>
              )}
            </div>
          )}
          <div className="assistant-messages" ref={list} aria-live="polite">
            <div className="assistant-message model">
              {first ? t("Bonjour {name} ! Je suis l’assistant de {studio}. Posez-moi vos questions sur l’agence, nos délais ou l’utilisation de l’espace.", { name: first, studio }) : t("Bonjour ! Je suis l’assistant de {studio}. Posez-moi vos questions sur l’agence, nos délais ou l’utilisation de l’espace.", { studio })}
            </div>
            {!messages.length && (
              <div className="assistant-suggestions">
                {suggestions.map((s) => <button key={s} type="button" onClick={() => void send(s)}>{s}</button>)}
              </div>
            )}
            {messages.map((m, i) => {
              const live = busy && i === messages.length - 1 && m.role === "model";
              return (
                <div key={i} className={`assistant-turn ${m.role}`}>
                  {!!m.actions?.length && (
                    <ul className="assistant-actions">
                      {m.actions.map((a, j) => (
                        <li key={j} className={a.kind === "failed" ? "failed" : ""}>
                          {a.kind === "failed" ? <CircleAlert size={13} /> : <Check size={13} />}
                          <span><b>{t(actionLabels[a.kind])}</b> · {a.taskId ? <a href={`#task/${encodeURIComponent(a.taskId)}`} dir="auto">{a.name}</a> : <span dir="auto">{a.name}</span>}{a.kind === "failed" && a.detail ? <small>{t(a.detail)}</small> : null}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {m.text && (
                    <div className={`assistant-message ${m.role}`}>
                      {m.role === "model" && m.fresh ? <Typing text={m.text} live={live && !m.status} onType={follow} /> : <Rich text={m.text} />}
                    </div>
                  )}
                  {live && m.status && (
                    <div className="assistant-status" role="status">
                      <span className="assistant-dots" aria-hidden="true"><i /><i /><i /></span>
                      <span className="assistant-shimmer">{t(m.status)}</span>
                    </div>
                  )}
                </div>
              );
            })}
            {error && <p className="assistant-error" role="alert">{error}</p>}
          </div>
          <form className="assistant-form" onSubmit={(e) => { e.preventDefault(); void send(draft); }}>
            <textarea
              ref={field} rows={1} maxLength={4000} value={draft} placeholder={t("Écrivez votre question…")} aria-label={t("Votre question")}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(draft); } }}
            />
            {busy
              ? <button type="button" className="assistant-send" onClick={() => abort.current?.abort()} aria-label={t("Arrêter")} title={t("Arrêter")}><Square size={13} /></button>
              : <button type="submit" className="assistant-send" disabled={!draft.trim()} aria-label={t("Envoyer")}><Send size={15} /></button>}
          </form>
          <small className="assistant-foot">{t("L’assistant peut se tromper. Pour votre projet, écrivez au studio.")}</small>
        </section></Surface>
      )}
      <button type="button" className="assistant-fab" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={t(open ? "Fermer l’assistant" : "Ouvrir l’assistant")}>
        {open ? <X size={22} /> : <MessageCircle size={22} />}
      </button>
    </div>
  );
}

"use client";
// The floating assistant (app/api/assistant): a round button in the corner of every screen — studio,
// client portal, print — that opens a small chat about The One Core and the app. The conversation
// stays in this browser tab only.
import { useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { useAiAvailable } from "@/app/ai-assist";
import { useI18n } from "@/app/locale-provider";

type Message = { role: "user" | "model"; text: string };

const storageKey = (workspaceId: string) => `the-one.assistant.${workspaceId}`;
const read = (key: string): Message[] => {
  try { const v = JSON.parse(sessionStorage.getItem(key) || "[]"); return Array.isArray(v) ? v.slice(-40) : []; } catch { return []; }
};

/** Bold (**…**) and line breaks, the only formatting the answers use; everything else stays text. */
function Rich({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>))}</>;
}

export default function Assistant({ workspaceId, role, page, name }: { workspaceId: string; role: string; page?: string; name?: string }) {
  const { t, locale } = useI18n();
  const available = useAiAvailable();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- the tab's saved conversation, read once per workspace
  useEffect(() => { setMessages(read(storageKey(workspaceId))); }, [workspaceId]);
  useEffect(() => { try { sessionStorage.setItem(storageKey(workspaceId), JSON.stringify(messages.slice(-40))); } catch { /* private mode */ } }, [messages, workspaceId]);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [messages, busy, open]);
  useEffect(() => { if (open) field.current?.focus(); }, [open]);

  if (!available) return null;
  const first = (name || "").split(/[\s@]/)[0];
  const suggestions = role === "client"
    ? [t("Qu’est-ce qui attend ma validation ?"), t("Comment demander une modification ?"), t("Comment connecter mon Instagram ?")]
    : role === "print_operator"
      ? [t("Qu’est-ce que je fais ensuite ?"), t("Comment suivre une commande ?"), t("Comment lancer mon chrono ?")]
      : role === "owner" || role === "admin" || role === "social"
        ? [t("Qu’est-ce qui coince aujourd’hui ?"), t("Quels clients n’ont pas répondu ?"), t("Comment programmer une publication ?")]
        : [t("Qu’est-ce que je fais ensuite ?"), t("Comment fonctionne la validation 48 h ?")];

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    const next = [...messages, { role: "user" as const, text: question }];
    setMessages(next); setDraft(""); setBusy(true); setError("");
    try {
      const response = await fetch("/api/assistant", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Workspace-Id": workspaceId },
        body: JSON.stringify({ messages: next.slice(-20), page, locale }),
      });
      const data = (await response.json().catch(() => ({}))) as { reply?: string; error?: string };
      if (!response.ok || !data.reply) throw new Error(data.error || "L’assistant ne répond pas pour le moment. Réessayez.");
      setMessages([...next, { role: "model", text: data.reply }]);
    } catch (e) {
      setError(t((e as Error).message));
    } finally { setBusy(false); }
  }

  return (
    <div className={`assistant ${open ? "open" : ""}`} dir={locale === "ar" ? "rtl" : "ltr"}>
      {open && (
        <section className="assistant-panel" role="dialog" aria-label={t("Assistant The One Core")}>
          <header className="assistant-head">
            <span className="assistant-avatar"><Sparkles size={15} /></span>
            <div><strong>{t("Assistant The One Core")}</strong><small>{t("Questions sur l’agence et l’application")}</small></div>
            {!!messages.length && <button type="button" className="assistant-icon" onClick={() => { setMessages([]); setError(""); }} aria-label={t("Nouvelle conversation")} title={t("Nouvelle conversation")}><RotateCcw size={15} /></button>}
            <button type="button" className="assistant-icon" onClick={() => setOpen(false)} aria-label={t("Fermer")}><X size={16} /></button>
          </header>
          <div className="assistant-messages" ref={list} aria-live="polite">
            <div className="assistant-message model">
              {first ? t("Bonjour {name} ! Je suis l’assistant de The One Core. Posez-moi vos questions sur l’agence, nos délais ou l’utilisation de l’espace.", { name: first }) : t("Bonjour ! Je suis l’assistant de The One Core. Posez-moi vos questions sur l’agence, nos délais ou l’utilisation de l’espace.")}
            </div>
            {!messages.length && (
              <div className="assistant-suggestions">
                {suggestions.map((s) => <button key={s} type="button" onClick={() => void send(s)}>{s}</button>)}
              </div>
            )}
            {messages.map((m, i) => <div key={i} className={`assistant-message ${m.role}`}><Rich text={m.text} /></div>)}
            {busy && <div className="assistant-message model typing"><Loader2 size={14} className="spin" />{t("L’assistant écrit…")}</div>}
            {error && <p className="assistant-error" role="alert">{error}</p>}
          </div>
          <form className="assistant-form" onSubmit={(e) => { e.preventDefault(); void send(draft); }}>
            <textarea
              ref={field} rows={1} maxLength={4000} value={draft} placeholder={t("Écrivez votre question…")} aria-label={t("Votre question")}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(draft); } }}
            />
            <button type="submit" className="assistant-send" disabled={busy || !draft.trim()} aria-label={t("Envoyer")}><Send size={15} /></button>
          </form>
          <small className="assistant-foot">{t("L’assistant peut se tromper. Pour votre projet, écrivez au studio.")}</small>
        </section>
      )}
      <button type="button" className="assistant-fab" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={t(open ? "Fermer l’assistant" : "Ouvrir l’assistant")}>
        {open ? <X size={22} /> : <MessageCircle size={22} />}
      </button>
    </div>
  );
}

"use client";
// Writing help buttons (app/api/ai): « Corriger » on any text field, and the suggestions list the
// composer shows for captions and titles. Hidden when the studio has not set up the AI.
import { useEffect, useState } from "react";
import { Loader2, Sparkles, Undo2, X } from "lucide-react";
import { useI18n } from "@/app/locale-provider";

let configured: Promise<boolean> | null = null;

/** Whether the AI is set up for the studio: asked once per page load. */
export function useAiAvailable() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    configured ??= fetch("/api/ai", { cache: "no-store" }).then((r) => (r.ok ? r.json() : {})).then((d: { configured?: boolean }) => !!d.configured).catch(() => false);
    let live = true;
    configured.then((on) => { if (live) setAvailable(on); });
    return () => { live = false; };
  }, []);
  return available;
}

export async function askAi<T>(workspaceId: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json", "X-Workspace-Id": workspaceId }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "L’IA ne répond pas pour le moment. Réessayez.");
  return data;
}

export type CorrectionKind = "task" | "brief" | "feedback" | "caption" | "title";

/** « Corriger »: spelling, grammar and clarity fixed in place, with a way back to what was written. */
export function AiFix({ value, kind, workspaceId, onChange, disabled }: { value: string; kind: CorrectionKind; workspaceId: string | null | undefined; onChange: (text: string) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const available = useAiAvailable();
  const [busy, setBusy] = useState(false);
  const [before, setBefore] = useState<string | null>(null);
  const [note, setNote] = useState("");
  if (!available || !workspaceId) return null;
  const run = async () => {
    setBusy(true); setNote("");
    try {
      const data = await askAi<{ text: string; changed: boolean }>(workspaceId, { action: "correct", kind, text: value });
      if (data.changed) { setBefore(value); onChange(data.text); } else setNote(t("Rien à corriger."));
    } catch (error) { setNote(t((error as Error).message)); }
    finally { setBusy(false); }
  };
  return (
    <span className="ai-fix">
      {before !== null && before !== value ? (
        <button type="button" className="ai-button" onClick={() => { onChange(before); setBefore(null); }}><Undo2 size={12} />{t("Annuler la correction")}</button>
      ) : (
        <button type="button" className="ai-button" disabled={disabled || busy || !value.trim()} onClick={run} title={t("Corriger l’orthographe et la formulation")}>
          {busy ? <Loader2 size={12} className="spin" /> : <Sparkles size={12} />}{t("Corriger")}
        </button>
      )}
      {note && <small className="ai-note" role="status">{note}</small>}
    </span>
  );
}

/** Proposals from the AI: one click puts it in the field. */
export function AiSuggestions({ items, onPick, onClose }: { items: string[]; onPick: (text: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  if (!items.length) return null;
  return (
    <div className="ai-suggestions" role="list" aria-label={t("Propositions de l’IA")}>
      <div className="ai-suggestions-head"><Sparkles size={12} />{t("Propositions de l’IA : cliquez pour utiliser")}<button type="button" className="ai-close" onClick={onClose} aria-label={t("Fermer")}><X size={13} /></button></div>
      {items.map((item) => (
        <button key={item} type="button" role="listitem" className="ai-suggestion" onClick={() => onPick(item)}>{item}</button>
      ))}
    </div>
  );
}

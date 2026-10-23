"use client";
// The workspace's default validation rules (delay, included rounds, reminders), on the agency settings
// page next to the plan and the brand. They used to sit in each person's settings dialog, where an owner
// would not look for them. Each client can still have its own rules on its page.
import { useState } from "react";
import { Check, Loader2, ShieldCheck } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { useI18n } from "@/lib/i18n/locale-provider";
import { defaultWorkflowSettings, workflowSettingsSchema, type WorkflowSettings } from "@/lib/workflow-settings";
import WorkflowFields from "./workflow-fields";

export default function WorkflowSettingsPanel({ settings, revision, onSave }: {
  settings?: WorkflowSettings;
  revision: number;
  /** Saves the rules at `revision`; answers with the new revision. */
  onSave: (data: WorkflowSettings, revision: number) => Promise<number>;
}) {
  const { t } = useI18n();
  const [workflow, setWorkflow] = useState(settings ?? defaultWorkflowSettings);
  const [version, setVersion] = useState(revision);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  return (
    <Surface asChild tone="default"><form className="work-panel workflow-settings" aria-labelledby="workflow-settings-title" onSubmit={async (e) => {
      e.preventDefault(); if (busy) return;
      const parsed = workflowSettingsSchema.safeParse(workflow);
      if (!parsed.success) { setError(t("Indiquez un délai entre 1 minute et 365 jours et un nombre entier de tours entre 0 et 10 000.")); return; }
      setBusy(true); setError(""); setSaved(false);
      try { setVersion(await onSave(parsed.data, version)); setSaved(true); }
      catch (err) { setError(t((err as Error).message)); }
      finally { setBusy(false); }
    }}>
      <header className="brand-settings-head">
        <h2 id="workflow-settings-title"><ShieldCheck size={16} />{t("Validation et modifications")}</h2>
        <p>{t("Valeurs par défaut de cet espace. Chaque client peut avoir ses propres règles. Les validations en cours et les documents envoyés conservent leurs conditions.")}</p>
      </header>
      <WorkflowFields value={workflow} disabled={busy} onChange={(value) => { setWorkflow(value); setSaved(false); }} />
      <div className="inline settings-actions">
        <button className="btn solid" disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : <Check size={14} />}{t("Enregistrer les règles")}</button>
        {saved && <span className="small-note" role="status">{t("Règles de validation mises à jour")}</span>}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form></Surface>
  );
}

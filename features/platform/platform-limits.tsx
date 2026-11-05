"use client";
// Plateforme → Agences → Équipe et aide → « Limites de cette agence »: what The One Core changes for one agency on top
// of its plan (lib/plans.ts limitsOf). An empty box keeps the plan's number; 0 turns a metered function off for it.
import { Surface } from "@/components/ui/surface";
import { useState } from "react";
import { Check, Gauge, Loader2, RotateCcw } from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-provider";
import { limitKeys, maxLimitValue, plans, type Limit } from "@/lib/plans";
import type { Company } from "./platform-types";

const labels: Record<Limit, string> = {
  members: "Membres de l’équipe", clients: "Clients", storageMb: "Fichiers (Mo)", aiPerMonth: "Demandes à l’IA par mois",
  igPerMonth: "Analyses Instagram par mois", meetingMinutesPerMonth: "Minutes de réunion par mois", whatsappPerMonth: "Messages WhatsApp par mois",
};
const draftOf = (company: Company) => Object.fromEntries(limitKeys.map((key) => [key, company.subscription.limitOverrides?.[key] === undefined ? "" : String(company.subscription.limitOverrides[key])])) as Record<Limit, string>;

export default function PlatformLimits({ company, onCompanies, onNotice, onError }: {
  company: Company; onCompanies: (companies: Company[]) => void; onNotice: (text: string) => void; onError: (text: string) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Record<Limit, string>>(() => draftOf(company));
  const [busy, setBusy] = useState(false);
  const saved = draftOf(company);
  const dirty = limitKeys.some((key) => draft[key].trim() !== saved[key]);
  const invalid = limitKeys.some((key) => { const v = draft[key].trim(); return v !== "" && !(/^\d+$/.test(v) && Number(v) <= maxLimitValue); });
  const planLimits = plans[company.subscription.plan].limits;

  async function save(limits: Partial<Record<Limit, number>> | null) {
    setBusy(true);
    try {
      const r = await fetch("/api/platform", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set-limits", workspaceId: company.id, limits }) });
      const data = (await r.json().catch(() => ({}))) as { companies?: Company[]; error?: string };
      if (!r.ok) throw new Error(data.error || "Enregistrement impossible.");
      if (data.companies) {
        onCompanies(data.companies);
        const fresh = data.companies.find((c) => c.id === company.id);
        if (fresh) setDraft(draftOf(fresh));
      }
      onNotice(t(limits ? "Limites enregistrées." : "Limites du plan rétablies."));
    } catch (e) { onError(t((e as Error).message)); }
    setBusy(false);
  }
  const send = () => save(Object.fromEntries(limitKeys.filter((key) => draft[key].trim() !== "").map((key) => [key, Number(draft[key].trim())])));

  return (
    <Surface className="pf-card pf-limits">
      <h4><Gauge size={15} aria-hidden />{t("Limites de cette agence")}</h4>
      <p className="pf-quiet">{t("Elles s’ajoutent au plan {plan}. Une case vide garde le chiffre du plan ; 0 coupe la fonction pour cette agence (IA, Instagram, réunions, WhatsApp).", { plan: t(plans[company.subscription.plan].name) })}</p>
      <div className="pf-limits-grid">
        {limitKeys.map((key) => (
          <div key={key} className="pf-field">
            <label htmlFor={`pf-limit-${company.id}-${key}`}>{t(labels[key])}</label>
            <input id={`pf-limit-${company.id}-${key}`} inputMode="numeric" value={draft[key]} placeholder={String(planLimits[key])}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} aria-invalid={draft[key].trim() !== "" && !/^\d+$/.test(draft[key].trim())} />
          </div>
        ))}
      </div>
      <div className="pf-payment-actions">
        <button type="button" className="btn primary" disabled={busy || !dirty || invalid} onClick={() => void send()}>
          {busy ? <Loader2 size={14} className="spin" /> : <Check size={14} aria-hidden />}{t("Enregistrer")}
        </button>
        <button type="button" className="btn ghost" disabled={busy || !Object.values(saved).some(Boolean)} onClick={() => void save(null)}><RotateCcw size={14} aria-hidden />{t("Revenir au plan")}</button>
      </div>
    </Surface>
  );
}

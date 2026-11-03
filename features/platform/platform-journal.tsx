"use client";
// Plateforme → Journal: every change made on this page (lib/platform-audit.ts), newest first, and the
// latest production failures (lib/error-report.ts).
import { Surface } from "@/components/ui/surface";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BadgeDollarSign, Ban, CircleCheck, Globe, Hourglass, Inbox, KeyRound, LifeBuoy, Loader2, LogOut, Search, Trash2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-provider";
import { plans, isPaidPlanId } from "@/lib/plans";
import type { AuditEntry } from "@/lib/platform-audit";
import type { ErrorEntry } from "./platform-types";

const actions: Record<string, { label: string; icon: typeof Globe; tone?: "good" | "bad" }> = {
  "mark-paid": { label: "Paiement enregistré : {plan}, {months} mois", icon: BadgeDollarSign, tone: "good" },
  "extend-trial": { label: "Essai prolongé de {days} jours", icon: Hourglass },
  suspend: { label: "Espace suspendu", icon: Ban, tone: "bad" },
  reactivate: { label: "Espace réactivé", icon: CircleCheck, tone: "good" },
  "dismiss-request": { label: "Demande de plan écartée", icon: X },
  "support-on": { label: "Accès support ouvert", icon: LifeBuoy },
  "support-off": { label: "Accès support retiré", icon: LogOut },
  "reset-owner": { label: "Lien de mot de passe envoyé à {email}", icon: KeyRound },
  delete: { label: "Entreprise supprimée", icon: Trash2, tone: "bad" },
  "site-save": { label: "Site public mis à jour", icon: Globe },
  "payment-save": { label: "Coordonnées de paiement mises à jour", icon: Globe },
  "request-approve": { label: "Accès ouvert à {email}", icon: Inbox, tone: "good" },
  "request-decline": { label: "Demande d’accès écartée ({email})", icon: X },
};

export default function PlatformJournal({ errors, onError }: { errors: ErrorEntry[] | null; onError: (text: string) => void }) {
  const { t, date } = useI18n();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    void fetch("/api/platform?audit", { cache: "no-store" }).then((r) => r.json()).then((data: { actions?: AuditEntry[] }) => {
      if (alive) setEntries(data.actions ?? []);
    }).catch(() => onError(t("Chargement impossible.")));
    return () => { alive = false; };
  }, [onError, t]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (entries ?? []).filter((e) => !q || [e.workspaceName, String(e.detail.name ?? ""), e.actor].some((v) => v?.toLowerCase().includes(q)));
  }, [entries, query]);
  const label = (e: AuditEntry) => {
    const plan = isPaidPlanId(e.detail.plan) ? t(plans[e.detail.plan].name) : "";
    return t(actions[e.action]?.label ?? e.action, { plan, months: Number(e.detail.months ?? 0), days: Number(e.detail.days ?? 0), email: String(e.detail.email ?? "") });
  };

  return (
    <div className="pf-journal">
      <Surface className="pf-card">
        <header className="pf-journal-head">
          <h3>{t("Actions sur la plateforme")} <small>{entries?.length ?? ""}</small></h3>
          <label className="platform-search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Filtrer par agence ou par personne…")} aria-label={t("Filtrer")} /></label>
        </header>
        {!entries ? <div className="loading"><Loader2 className="spin" /></div>
          : !shown.length ? <p className="pf-quiet">{entries.length ? t("Aucune action ne correspond.") : t("Aucune action pour l’instant. Chaque paiement, suspension ou mise à jour du site s’inscrira ici.")}</p>
          : (
            <ol className="pf-timeline">
              {shown.map((e) => {
                const meta = actions[e.action];
                const Icon = meta?.icon ?? Globe;
                const name = e.workspaceName || String(e.detail.name ?? ""); // a deleted company keeps its name in the detail
                return (
                  <li key={e.id} className={meta?.tone ?? ""}>
                    <span className="pf-dot"><Icon size={14} aria-hidden /></span>
                    <div>
                      <p>{name && <><b>{name}</b> — </>}{label(e)}</p>
                      <small>{date(e.at, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} · {e.actor}</small>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
      </Surface>

      <Surface className="pf-card">
        <h3><AlertTriangle size={15} />{t("Erreurs récentes")} <small>{errors?.length ?? ""}</small></h3>
        {!errors ? <div className="loading"><Loader2 className="spin" /></div>
          : !errors.length ? <p className="pf-quiet">{t("Aucune erreur enregistrée.")}</p>
          : (
            <ul className="pf-errors">
              {errors.map((e) => (
                <li key={e.id} className={e.recent ? "recent" : ""}>
                  <strong>{e.area}</strong>
                  <span>{e.message}</span>
                  <small>{t("{n} fois", { n: e.count })} · {date(e.lastAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{e.workspaceId ? ` · ${e.workspaceId}` : ""}</small>
                </li>
              ))}
            </ul>
          )}
      </Surface>
    </div>
  );
}

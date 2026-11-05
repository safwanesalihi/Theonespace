"use client";
// Plateforme → Demandes: the agencies that asked for access (lib/access-requests.ts). The One Core calls
// them back, agrees on the plan and the payment, then opens the space here — a trial of a few days or a
// paid plan — and the agency receives its link by e-mail. Declined and opened requests stay listed below.
import { Surface } from "@/components/ui/surface";
import { useState } from "react";
import { Check, Loader2, Mail, MapPin, Phone, Users, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-provider";
import { paidPlanIds, plans, trialDays, type PaidPlanId } from "@/lib/plans";
import { presets } from "@/lib/process-presets";
import type { AccessRequest, Company } from "./platform-types";

type Grant = { plan: "trial" | PaidPlanId; days: number; months: number };
const teamLabels: Record<string, string> = { "1": "Juste moi", "2-5": "2 à 5 personnes", "6-15": "6 à 15 personnes", "16+": "Plus de 15 personnes" };
const studioLabel = (id: string) => presets.find((p) => p.id === id)?.label ?? "";
const statusLabels: Record<AccessRequest["status"], string> = { pending: "En attente", approved: "Espace ouvert", declined: "Écartée" };

export default function PlatformRequests({ requests, onRequests, onCompanies, onNotice, onError }: {
  requests: AccessRequest[] | null; onRequests: (list: AccessRequest[]) => void; onCompanies: (list: Company[]) => void;
  onNotice: (text: string) => void; onError: (text: string) => void;
}) {
  const { t, date } = useI18n();
  const [busy, setBusy] = useState(0);
  const [grants, setGrants] = useState<Record<number, Grant>>({});
  const [declining, setDeclining] = useState(0);
  const [devLink, setDevLink] = useState<{ id: number; link: string } | null>(null);

  const grant = (id: number) => grants[id] ?? { plan: "trial", days: trialDays, months: 1 };
  const setGrant = (id: number, change: Partial<Grant>) => setGrants({ ...grants, [id]: { ...grant(id), ...change } });

  async function act(r: AccessRequest, body: Record<string, unknown>) {
    setBusy(r.id);
    try {
      const res = await fetch("/api/platform", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: r.id, ...body }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Action impossible.");
      if (data.requests) onRequests(data.requests);
      if (data.companies) onCompanies(data.companies);
      if (data.opened) {
        if (data.opened.devLink) setDevLink({ id: r.id, link: data.opened.devLink });
        onNotice(data.opened.mailed ? t("Espace ouvert : le lien est parti à {email}.", { email: data.opened.email }) : t("Espace ouvert, mais l’e-mail n’est pas parti : copiez le lien affiché et envoyez-le vous-même."));
      } else onNotice(t("Demande écartée."));
    } catch (e) { onError(t((e as Error).message)); }
    setBusy(0); setDeclining(0);
  }

  if (!requests) return <div className="loading"><Loader2 className="spin" /></div>;
  const waiting = requests.filter((r) => r.status === "pending");
  const done = requests.filter((r) => r.status !== "pending");
  const day = (iso: string) => date(iso, { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="pf-requests">
      <p className="pf-requests-intro">{t("Les agences qui demandent un accès depuis le site. Appelez-les, convenez de la formule et du paiement, puis ouvrez leur espace : elles reçoivent un lien pour choisir leur mot de passe, valable 7 jours.")}</p>
      {!waiting.length && <p className="platform-empty">{t("Aucune demande en attente.")}</p>}
      <div className="platform-list">
        {waiting.map((r) => {
          const g = grant(r.id);
          return (
            <Surface asChild tone="default" key={r.id}><article className="platform-row requested pf-request">
              <header>
                <div className="pf-agency-id">
                  <span className="pf-avatar" aria-hidden>{r.company.slice(0, 2).toUpperCase()}</span>
                  <div>
                    <strong>{r.company}</strong>
                    <small>{r.name} · {t("demandé le {day}", { day: day(r.createdAt) })}</small>
                  </div>
                </div>
                <span className="pf-phase grace">{t(statusLabels[r.status])}</span>
              </header>
              <ul className="pf-request-facts">
                <li><Mail size={14} aria-hidden /><a href={`mailto:${r.email}`}>{r.email}</a></li>
                {r.phone && <li><Phone size={14} aria-hidden /><a href={`tel:${r.phone.replace(/[^+\d]/g, "")}`}>{r.phone}</a>
                  <a className="pf-wa" href={`https://wa.me/${r.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">WhatsApp</a></li>}
                {r.city && <li><MapPin size={14} aria-hidden />{r.city}</li>}
                {r.teamSize && <li><Users size={14} aria-hidden />{t(teamLabels[r.teamSize])}</li>}
                {studioLabel(r.studioType) && <li className="pf-chip-li"><span className="platform-chip">{t(studioLabel(r.studioType))}</span></li>}
              </ul>
              {r.message && <blockquote className="pf-request-note">{r.message}</blockquote>}
              <footer>
                <label className="platform-pay">
                  <select value={g.plan} onChange={(e) => setGrant(r.id, { plan: e.target.value as Grant["plan"] })} aria-label={t("Formule")}>
                    <option value="trial">{t("Essai gratuit")}</option>
                    {paidPlanIds.map((id) => <option key={id} value={id}>{t(plans[id].name)} · {plans[id].priceMad} MAD</option>)}
                  </select>
                  {g.plan === "trial"
                    ? <select value={g.days} onChange={(e) => setGrant(r.id, { days: Number(e.target.value) })} aria-label={t("Durée")}>
                        {[7, 14, 30, 60].map((d) => <option key={d} value={d}>{t("{n} jours", { n: d })}</option>)}
                      </select>
                    : <select value={g.months} onChange={(e) => setGrant(r.id, { months: Number(e.target.value) })} aria-label={t("Durée")}>
                        {[1, 2, 3, 6, 12].map((m) => <option key={m} value={m}>{m === 1 ? t("1 mois") : t("{n} mois", { n: m })}</option>)}
                      </select>}
                  <button type="button" className="btn primary" disabled={busy === r.id}
                    onClick={() => void act(r, { action: "request-approve", plan: g.plan, days: g.days, months: g.months })}>
                    {busy === r.id ? <Loader2 size={14} className="spin" /> : <Check size={14} />}{t("Ouvrir l’espace")}
                  </button>
                </label>
                {declining === r.id
                  ? <span className="pf-confirm-inline">{t("Écarter cette demande ?")}
                      <button type="button" className="btn danger" disabled={busy === r.id} onClick={() => void act(r, { action: "request-decline" })}>{t("Écarter")}</button>
                      <button type="button" className="btn ghost" onClick={() => setDeclining(0)}>{t("Annuler")}</button>
                    </span>
                  : <button type="button" className="btn ghost danger-text" disabled={busy === r.id} onClick={() => setDeclining(r.id)}><X size={14} />{t("Écarter")}</button>}
              </footer>
            </article></Surface>
          );
        })}
      </div>

      {devLink && <small className="platform-devlink">{t("L’e-mail n’est pas parti : copiez ce lien et envoyez-le vous-même (WhatsApp).")} <a href={devLink.link}>{devLink.link}</a> <button type="button" className="btn" onClick={() => void navigator.clipboard?.writeText(devLink.link).then(() => onNotice(t("Lien copié.")), () => onError(t("Copie impossible : sélectionnez le lien.")))}>{t("Copier le lien")}</button></small>}

      {!!done.length && (
        <section className="pf-requests-done" aria-label={t("Déjà traitées")}>
          <h3>{t("Déjà traitées")}</h3>
          <ul>
            {done.map((r) => (
              <li key={r.id}>
                <b>{r.company}</b><small>{r.name} · {r.email}</small>
                <span className={`pf-phase ${r.status === "approved" ? "paid" : "canceled"}`}>{t(statusLabels[r.status])}{r.decidedAt ? ` · ${date(r.decidedAt, { day: "numeric", month: "short" })}` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

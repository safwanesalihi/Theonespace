"use client";
// Plateforme → Site: the public site's key information (lib/site-content.ts) — the news banner, the pilot
// offer, the prices shown and how to reach The One Core — edited in a form beside a preview of what
// visitors see. Saved with POST /api/platform « site-save »; the landing reads it from GET /api/site.
import { Surface } from "@/components/ui/surface";
import { useEffect, useState } from "react";
import { Check, Globe, Loader2, Megaphone, Phone, RotateCcw, Sparkles, Tag } from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-provider";
import { defaultSiteContent, type SiteContent, type SiteContentState } from "@/lib/site-content";

type Group = keyof SiteContent;
const same = (a: SiteContent, b: SiteContent) => JSON.stringify(a) === JSON.stringify(b);

export default function PlatformSite({ onNotice, onError }: { onNotice: (text: string) => void; onError: (text: string) => void }) {
  const { t, date } = useI18n();
  const [saved, setSaved] = useState<SiteContentState | null>(null);
  const [draft, setDraft] = useState<SiteContent>(defaultSiteContent);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ field: string; message: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch("/api/platform?site", { cache: "no-store" }).then((r) => r.json()).then((data: { site?: SiteContentState }) => {
      if (alive && data.site) { setSaved(data.site); setDraft(data.site.content); }
    }).catch(() => onError(t("Chargement impossible.")));
    return () => { alive = false; };
  }, [onError, t]);

  const set = <G extends Group>(group: G, change: Partial<SiteContent[G]>) => { setDraft((d) => ({ ...d, [group]: { ...d[group], ...change } })); setProblem(null); };
  const dirty = !!saved && !same(saved.content, draft);
  const invalid = (field: string) => (problem?.field === field ? { "aria-invalid": true as const, "aria-describedby": "pf-site-problem" } : {});

  async function save() {
    setBusy(true); setProblem(null);
    try {
      const r = await fetch("/api/platform", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "site-save", content: draft }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { setProblem({ field: data.field ?? "", message: t(data.error || "Enregistrement impossible.") }); return; }
      setSaved(data.site); setDraft(data.site.content);
      onNotice(t("Site mis à jour. Les visiteurs voient la nouvelle version d’ici une minute."));
    } catch { onError(t("Enregistrement impossible.")); } finally { setBusy(false); }
  }

  if (!saved) return <div className="loading"><Loader2 className="spin" /></div>;
  const a = draft.announcement, p = draft.pilot, pr = draft.prices, c = draft.contact;

  return (
    <div className="pf-site">
      <div className="pf-site-bar">
        <p>{saved.updatedAt ? t("Dernière mise à jour le {day} par {who}", { day: date(saved.updatedAt, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }), who: saved.updatedBy ?? "—" }) : t("Valeurs de départ : rien n’a encore été enregistré.")}</p>
        <div className="inline">
          <button type="button" className="btn ghost" disabled={!dirty || busy} onClick={() => { setDraft(saved.content); setProblem(null); }}><RotateCcw size={14} />{t("Annuler les changements")}</button>
          <button type="button" className="btn primary" disabled={!dirty || busy} onClick={() => void save()}>{busy ? <Loader2 size={14} className="spin" /> : <Check size={14} />}{t("Publier sur le site")}</button>
        </div>
      </div>
      {problem && <p id="pf-site-problem" className="pf-site-problem" role="alert">{problem.message}</p>}

      <div className="pf-site-grid">
        <div className="pf-site-form">
          <Surface className="pf-card">
            <header className="pf-site-head"><h3><Megaphone size={15} />{t("Bandeau d’annonce")}</h3><Toggle id="site-ann-on" on={a.on} label={t("Afficher")} onChange={(on) => set("announcement", { on })} /></header>
            <Field id="site-ann-text" label={t("Texte")} hint={t("140 caractères au plus.")} count={[a.text.length, 140]}>
              <input id="site-ann-text" value={a.text} maxLength={140} onChange={(e) => set("announcement", { text: e.target.value })} placeholder={t("Ex. Les inscriptions des agences pilotes ferment le 30 novembre.")} {...invalid("announcement.text")} />
            </Field>
            <div className="pf-row2">
              <Field id="site-ann-label" label={t("Libellé du lien")}><input id="site-ann-label" value={a.linkLabel} maxLength={40} onChange={(e) => set("announcement", { linkLabel: e.target.value })} placeholder={t("Ex. Postuler")} {...invalid("announcement.linkLabel")} /></Field>
              <Field id="site-ann-link" label={t("Lien")}><input id="site-ann-link" value={a.link} onChange={(e) => set("announcement", { link: e.target.value })} placeholder="#pilote" {...invalid("announcement.link")} /></Field>
            </div>
          </Surface>

          <Surface className="pf-card">
            <header className="pf-site-head"><h3><Sparkles size={15} />{t("Offre pilote")}</h3><Toggle id="site-pilot-on" on={p.on} label={t("Afficher")} onChange={(on) => set("pilot", { on })} /></header>
            <Field id="site-pilot-title" label={t("Titre")}><input id="site-pilot-title" value={p.title} maxLength={80} onChange={(e) => set("pilot", { title: e.target.value })} {...invalid("pilot.title")} /></Field>
            <Field id="site-pilot-text" label={t("Texte")} count={[p.text.length, 280]}><textarea id="site-pilot-text" rows={3} value={p.text} maxLength={280} onChange={(e) => set("pilot", { text: e.target.value })} /></Field>
            <div className="pf-row2">
              <Field id="site-pilot-seats" label={t("Places restantes")}><input id="site-pilot-seats" type="number" min={0} max={100} value={p.seatsLeft} onChange={(e) => set("pilot", { seatsLeft: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })} /></Field>
              <Field id="site-pilot-deadline" label={t("Date limite (facultatif)")}><input id="site-pilot-deadline" type="date" value={p.deadline} onChange={(e) => set("pilot", { deadline: e.target.value })} {...invalid("pilot.deadline")} /></Field>
            </div>
          </Surface>

          <Surface className="pf-card">
            <header className="pf-site-head"><h3><Tag size={15} />{t("Prix affichés")}</h3><Toggle id="site-prices-on" on={pr.show} label={t("Afficher")} onChange={(show) => set("prices", { show })} /></header>
            <p className="pf-quiet">{t("Ce que le site annonce. Les prix facturés restent ceux des plans de l’app.")}</p>
            <div className="pf-row3">
              {(["starter", "pro", "agency"] as const).map((id) => (
                <Field key={id} id={`site-price-${id}`} label={id === "agency" ? "Agence" : id === "pro" ? "Pro" : "Starter"}>
                  <span className="pf-money"><input id={`site-price-${id}`} type="number" min={0} step={1} value={pr[id]} onChange={(e) => set("prices", { [id]: Math.max(0, Math.round(Number(e.target.value) || 0)) })} /><small>MAD</small></span>
                </Field>
              ))}
            </div>
            <Field id="site-prices-note" label={t("Note sous les prix")} count={[pr.note.length, 160]}><input id="site-prices-note" value={pr.note} maxLength={160} onChange={(e) => set("prices", { note: e.target.value })} /></Field>
          </Surface>

          <Surface className="pf-card">
            <header className="pf-site-head"><h3><Phone size={15} />{t("Contact et réseaux")}</h3></header>
            <div className="pf-row2">
              <Field id="site-email" label={t("E-mail")}><input id="site-email" type="email" value={c.email} onChange={(e) => set("contact", { email: e.target.value })} placeholder="contact@…" {...invalid("contact.email")} /></Field>
              <Field id="site-wa" label="WhatsApp"><input id="site-wa" value={c.whatsapp} onChange={(e) => set("contact", { whatsapp: e.target.value })} placeholder="+212 6 …" {...invalid("contact.whatsapp")} /></Field>
              <Field id="site-city" label={t("Ville")}><input id="site-city" value={c.city} maxLength={60} onChange={(e) => set("contact", { city: e.target.value })} /></Field>
              <Field id="site-hours" label={t("Horaires")}><input id="site-hours" value={c.hours} maxLength={80} onChange={(e) => set("contact", { hours: e.target.value })} placeholder={t("Ex. Lun.–ven., 9 h – 18 h")} /></Field>
              <Field id="site-ig" label="Instagram"><input id="site-ig" value={draft.social.instagram} onChange={(e) => set("social", { instagram: e.target.value })} placeholder="https://instagram.com/…" {...invalid("social.instagram")} /></Field>
              <Field id="site-li" label="LinkedIn"><input id="site-li" value={draft.social.linkedin} onChange={(e) => set("social", { linkedin: e.target.value })} placeholder="https://linkedin.com/company/…" {...invalid("social.linkedin")} /></Field>
            </div>
          </Surface>
        </div>

        <aside className="pf-site-preview" aria-label={t("Aperçu")}>
          <div className="pf-preview-label"><Globe size={14} />{t("Aperçu du site")}{dirty && <span className="pf-dirty">{t("non publié")}</span>}</div>
          <div className="pf-browser">
            <div className="pf-browser-top"><i /><i /><i /><span>space.the1core.com</span></div>
            {a.on && a.text && <div className="pf-pv-banner">{a.text}{a.linkLabel && <u>{a.linkLabel} →</u>}</div>}
            <div className="pf-pv-hero"><b>The One Space</b><span>{t("Vos clients valident en 48 h.")}</span></div>
            {p.on && (
              <div className="pf-pv-pilot">
                <small>{t("Offre pilote")}</small>
                <strong>{p.title || "—"}</strong>
                <p>{p.text}</p>
                <span>{t("{n} places restantes", { n: p.seatsLeft })}{p.deadline ? ` · ${t("jusqu’au {day}", { day: date(p.deadline, { day: "numeric", month: "long" }) })}` : ""}</span>
              </div>
            )}
            {pr.show && (
              <div className="pf-pv-prices">
                {(["starter", "pro", "agency"] as const).map((id) => (
                  <div key={id} className={id === "pro" ? "featured" : ""}><small>{id === "agency" ? "Agence" : id === "pro" ? "Pro" : "Starter"}</small><b>{pr[id].toLocaleString("fr-FR")}</b><span>MAD / {t("mois")}</span></div>
                ))}
                {pr.note && <p>{pr.note}</p>}
              </div>
            )}
            <div className="pf-pv-foot">
              <span>{[c.email, c.whatsapp, c.city].filter(Boolean).join(" · ") || t("Coordonnées non renseignées")}</span>
              {c.hours && <small>{c.hours}</small>}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Field({ id, label, hint, count, children }: { id: string; label: string; hint?: string; count?: [number, number]; children: React.ReactNode }) {
  return (
    <div className="pf-field">
      <label htmlFor={id}>{label}{count && <small className={count[0] > count[1] * 0.9 ? "near" : ""}>{count[0]}/{count[1]}</small>}</label>
      {children}
      {hint && <small className="pf-hint">{hint}</small>}
    </div>
  );
}

function Toggle({ id, on, label, onChange }: { id: string; on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <label className="pf-toggle" htmlFor={id}>
      <input id={id} type="checkbox" role="switch" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden />{label}
    </label>
  );
}

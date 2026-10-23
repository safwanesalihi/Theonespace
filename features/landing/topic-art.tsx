"use client";
// A small picture of each of the six topics (planets.ts), drawn from what the product does: the 48-hour
// track, the client's phone, the publishing queue, a Darija exchange with One, the on-time target and the
// six roles. Shown on the landing's bento (sections.tsx) and in each topic's window (windows.tsx). Its
// styles live in sections.css. Names are sample data.
import { useI18n } from "@/lib/i18n/locale-provider";
import type { PlanetSlug } from "./planets";

/** Whether a topic's picture sits on a dark surface (graphite or deep) or on silver glass. */
export const topicTone: Record<PlanetSlug, "deep" | "graphite" | "glass"> = { methode: "deep", portail: "glass", publication: "glass", one: "graphite", pilotage: "glass", equipe: "glass" };

/** A small picture of each topic, drawn from what the product does (sample names). */
export function TopicArt({ slug }: { slug: PlanetSlug }) {
  const { t } = useI18n();
  if (slug === "methode") return (
    <div className="ts-ba-flow" aria-hidden="true">
      <div className="ts-ba-track"><i className="done" style={{ left: "0%" }} /><i className="done" style={{ left: "33.33%" }} /><i style={{ left: "66.67%" }} /><i className="end" style={{ left: "100%" }} /><span className="fill" /></div>
      <div className="ts-ba-ticks"><span>0 h · {t("envoi")}</span><span>24 h · {t("rappel")}</span><span>42 h · {t("rappel")}</span><span>48 h · {t("validé")}</span></div>
      <div className="ts-ba-chips"><span>{t("2 tours inclus")}</span><span>J−14 · J−7 · J−5 · J−1</span><span>🔒 {t("Gelé · J−7")}</span></div>
    </div>
  );
  if (slug === "portail") return (
    <div className="ts-ba-phone" aria-hidden="true"><div>
      <span className="ts-ba-notif"><i>✓</i>{t("Votre carrousel est prêt à valider.")}</span>
      <span className="ts-ba-post"><b>5 secrets</b><em>{t("du barista")}</em></span>
      <span className="ts-ba-btns"><i>{t("Retouche")}</i><i className="go">{t("Valider")}</i></span>
    </div></div>
  );
  if (slug === "publication") return (
    <div className="ts-ba-pub" aria-hidden="true">
      <div className="ts-ba-row"><i className="ig" />Instagram · Reel<b>{t("ven. 18:00")}</b></div>
      <div className="ts-ba-row"><i className="fb" />Facebook · Post<b>{t("lun. 09:00")}</b></div>
      <div className="ts-ba-row soon"><i className="tt" />TikTok · YouTube<b>{t("bientôt")}</b></div>
    </div>
  );
  if (slug === "one") return (
    // The Darija exchange is the example in the assistant's own instructions (lib/assistant.ts).
    <div className="ts-ba-chat" aria-hidden="true" dir="ltr">
      <span className="me">bghit nbedel lwan f l post dyal ghda</span>
      <span className="one"><b>One</b>Wakha. Had l post ba9i lik round 1/2.</span>
    </div>
  );
  if (slug === "pilotage") return (
    <div className="ts-ba-gauge" aria-hidden="true">
      <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="48" /><circle className="on" cx="60" cy="60" r="48" pathLength="100" strokeDasharray="95 100" /></svg>
      <b>95 %</b><span>{t("à l’heure · objectif")}</span>
    </div>
  );
  return (
    <div className="ts-ba-roles" aria-hidden="true">
      {[t("Propriétaire"), t("Administrateur"), t("Membre"), t("Social media manager"), t("Observateur"), t("Client")].map((role, i) => <span key={role}><i className={`r${i}`} />{role}</span>)}
    </div>
  );
}

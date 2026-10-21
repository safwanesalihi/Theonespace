"use client";
// A new agency's first steps, on the home page of its owner and administrators: each step is read from
// the workspace itself (a brand, a client, a teammate, a client invited to the portal, a first
// deliverable sent), so it ticks itself off whoever does it and wherever. The list shows until every
// step is done, or until the person hides it (per browser and workspace).
import { useState } from "react";
import { ArrowUpRight, Check, Eye, Lock } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { brandLogoClass, brandLogoUrl, useBrand, type CurrentBrand } from "@/features/workspace/brand-store";
import type { ScreenProps } from "@/features/workspace/screen-props";
import { defaultBrandColor } from "@/lib/branding";
import { useI18n } from "@/lib/i18n/locale-provider";

type StepId = "space" | "brand" | "client" | "team" | "portal" | "send";
type Step = { id: StepId; title: string; text: string; done: boolean; action?: { label: string; run: () => void }; blocked?: string };

const hiddenKey = (workspaceId: string) => `the-one.setup-hidden:${workspaceId}`;

export function brandChosen(brand: CurrentBrand | null) {
  return !!brand?.logo || (!!brand?.color && brand.color.toLowerCase() !== defaultBrandColor);
}

/** The steps and whether the list is shown; HomePage adapts its greeting while it is. */
export function useSetupChecklist({ data, roles, actions }: Pick<ScreenProps, "data" | "roles" | "actions">) {
  const { clients, members, allTasks, workspace } = data;
  const { owner, manager } = roles;
  const { navigate, open } = actions;
  const brand = useBrand();
  const workspaceId = workspace?.id ?? "";
  const [hidden, setHidden] = useState(() => {
    try { return !!workspaceId && localStorage.getItem(hiddenKey(workspaceId)) === "1"; } catch { return false; }
  });
  const hasClient = clients.length > 0;
  const team = (tab: "brand" | "invite") => () => navigate({ page: "team", tab });
  const steps: Step[] = [
    { id: "space", title: "Créer votre espace", text: "Fait à la création du compte.", done: true },
    { id: "brand", title: "Votre logo et votre couleur", text: "Ils remplacent les nôtres partout, portail client compris.", done: brandChosen(brand), action: { label: "Personnaliser", run: team("brand") } },
    {
      id: "client", title: "Ajouter votre premier client", text: "Son nom, son contact et le nombre de contenus par mois.", done: hasClient,
      ...(owner ? { action: { label: "Ajouter un client", run: () => open("client") } } : { blocked: "Le propriétaire de l’espace ajoute les clients." }),
    },
    { id: "team", title: "Inviter votre équipe", text: "Créatifs, social media manager, administrateur.", done: members.some((m) => m.role !== "client" && m.role !== "owner"), action: { label: "Inviter", run: team("invite") } },
    {
      id: "portal", title: "Inviter votre client sur son portail", text: "Il y valide les contenus, suit son calendrier et vous écrit.", done: members.some((m) => m.role === "client"),
      ...(hasClient ? { action: { label: "Inviter le client", run: team("invite") } } : { blocked: "Après votre premier client." }),
    },
    {
      id: "send", title: "Envoyer un premier contenu à valider", text: "Le client reçoit un lien et valide en un clic.",
      done: allTasks.some((t) => !!t.sentAt || t.status === "À valider" || t.status === "Validé"), action: { label: "Créer une tâche", run: () => open("task") },
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const visible = manager && !hidden && doneCount < steps.length;
  const hide = () => {
    setHidden(true);
    try { localStorage.setItem(hiddenKey(workspaceId), "1"); } catch { /* private mode */ }
  };
  return { steps, doneCount, visible, hide, brand, firstClientId: clients[0]?.id };
}

export function SetupChecklist({ setup, workspaceName, onPreview }: {
  setup: ReturnType<typeof useSetupChecklist>;
  workspaceName: string;
  onPreview: (clientId: string) => void;
}) {
  const { t } = useI18n();
  const { steps, doneCount, hide, brand, firstClientId } = setup;
  const next = steps.find((s) => !s.done && !s.blocked);
  const logo = brandLogoUrl(brand);
  return (
    <div className="onb-grid">
      <Surface asChild tone="default"><section className="onb-card" aria-labelledby="onb-title">
        <header className="onb-head">
          <h2 id="onb-title">{t("Démarrage")}</h2>
          <div className="onb-progress" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount} aria-label={t("Étapes terminées")}>
            <span style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </div>
          <span className="onb-count">{t("{n} sur {total}", { n: doneCount, total: steps.length })}</span>
          <button type="button" className="text-link onb-hide" onClick={hide}>{t("Masquer")}</button>
        </header>
        <ol className="onb-steps">
          {steps.map((step, index) => (
            <li key={step.id} className={step.done ? "done" : step === next ? "next" : undefined}>
              <span className="onb-mark" aria-hidden="true">{step.done ? <Check size={14} strokeWidth={2.5} /> : index + 1}</span>
              <div className="onb-text">
                <strong>{t(step.title)}</strong>
                <small>{step.done ? t("Fait") : step.blocked ? t(step.blocked) : t(step.text)}</small>
              </div>
              {!step.done && step.action && !step.blocked && (
                <button type="button" className={`btn${step === next ? " primary" : ""}`} onClick={step.action.run}>{t(step.action.label)}</button>
              )}
              {!step.done && step.blocked && <Lock size={15} className="onb-lock" aria-hidden="true" />}
            </li>
          ))}
        </ol>
      </section></Surface>
      <Surface asChild tone="default"><aside className="onb-side">
        <h3>{t("Ce que vos clients verront")}</h3>
        <p>{t("Un portail à vos couleurs, en français, anglais ou arabe, pour valider sans e-mails ni WhatsApp.")}</p>
        <div className="onb-portal" aria-hidden="true">
          <div className="onb-portal-bar">
            {/* eslint-disable-next-line @next/next/no-img-element -- the workspace's own uploaded logo */}
            {logo ? <img src={logo} alt="" className={brandLogoClass(brand)} /> : <strong>{workspaceName}<span className="wordmark-dot">.</span></strong>}
            <span>{t("Portail client")}</span>
          </div>
          {[["Reel — lancement", true], ["Carrousel — 5 conseils", true], ["Story — coulisses", false]].map(([name, waiting]) => (
            <div className="onb-portal-row" key={String(name)}>
              <span>{t(String(name))}</span>
              <span className={`onb-portal-chip${waiting ? " waiting" : ""}`}>{t(waiting ? "À valider" : "Validé")}</span>
            </div>
          ))}
        </div>
        {firstClientId
          ? <button type="button" className="btn" onClick={() => onPreview(firstClientId)}><Eye size={15} />{t("Voir le portail de votre client")}<ArrowUpRight size={14} /></button>
          : <small className="onb-note">{t("L’aperçu s’ouvre dès votre premier client.")}</small>}
      </aside></Surface>
    </div>
  );
}

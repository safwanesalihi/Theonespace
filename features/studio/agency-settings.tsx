"use client";
// « Paramètres de l'agence »: the agency's whole set-up in one place, in tabs (docs/MENU-AUDIT.md §4–6).
// Abonnement, Équipe (members, invitations, roles), Clients (the list, adding, the archive), Logo et
// couleur, Règles and Google Drive (once in « Mon compte ») for the owner and administrators; « Processus », once its own page « Personnaliser »,
// for the owner alone. The tab is in the route (#settings//team…), so the trial pill, the plan banner, the
// setup checklist and the old #customize, #team and #clients links land on the right one.
import dynamic from "next/dynamic";
import { useEffect, useState, type ReactNode } from "react";
import { Building2, Cloud, CreditCard, Palette, ShieldCheck, Users, Workflow, type LucideIcon } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SubscriptionPanel, { type PlanPayload } from "@/features/plans/subscription-panel";
import BrandSettings from "@/features/workspace/brand-settings";
import WorkflowSettingsPanel from "@/features/workspace/workflow-settings-panel";
import type { ScreenProps } from "@/features/workspace/screen-props";
import { useI18n } from "@/lib/i18n/locale-provider";
import type { WorkspaceRoute } from "@/lib/navigation";
import type { WorkflowSettings } from "@/lib/workflow-settings";
const CustomizePage = dynamic(() => import("@/features/customize/customize-page"));
const DriveSettings = dynamic(() => import("@/features/drive/drive-settings"));

type Tab = "plan" | "team" | "clients" | "brand" | "rules" | "drive" | "process";

export default function AgencySettings({ route, plan, owner, data, actions, workflowRevision, onWorkflowSave, team, clients }: Pick<ScreenProps, "data" | "actions"> & {
  route: WorkspaceRoute;
  plan: PlanPayload | null;
  owner: boolean;
  workflowRevision: number;
  onWorkflowSave: (data: WorkflowSettings, revision: number) => Promise<number>;
  /** The team's tab (features/team/team.tsx) and the clients' tab (features/clients/clients-page.tsx). */
  team: ReactNode;
  clients: ReactNode;
}) {
  const { t } = useI18n();
  const { workspace } = data;
  const { navigate, mutate, setNotice, setError } = actions;
  const tabs: [Tab, string, LucideIcon][] = [
    ...(plan?.subscription ? [["plan", "Abonnement", CreditCard] as [Tab, string, LucideIcon]] : []),
    ["team", "Équipe", Users],
    ["clients", "Clients", Building2],
    ["brand", "Logo et couleur", Palette],
    ["rules", "Règles", ShieldCheck],
    ["drive", "Google Drive", Cloud],
    ...(owner ? [["process", "Processus", Workflow] as [Tab, string, LucideIcon]] : []),
  ];
  // A tab this person doesn't have (an administrator on an old #customize link) opens the first one.
  const tab = tabs.find(([id]) => id === route.tab)?.[0] ?? tabs[0][0];
  return (
    <>
      <div className="page-heading">
        <h1>{t("Paramètres de l’agence")}</h1>
        <p>{t(owner ? "Votre abonnement, votre équipe, vos clients, votre logo et votre couleur, vos règles de validation et votre processus." : "Votre abonnement, votre équipe, vos clients, votre logo et votre couleur, et vos règles de validation.")}</p>
      </div>
      <Tabs value={tab} onValueChange={(next) => navigate({ page: "settings", tab: next })}>
        <TabsList className="settings-tabs">
          {tabs.map(([id, label, Icon]) => <TabsTrigger key={id} value={id}><Icon size={15} />{t(label)}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      {tab === "plan" && plan?.subscription ? (
        <SubscriptionPanel
          plan={plan}
          owner={owner}
          workspaceId={workspace?.id ?? ""}
          onRequest={(id) => mutate({ action: "request-plan", plan: id })}
          onNotice={setNotice}
          onError={setError}
        />
      ) : tab === "team" ? (
        team
      ) : tab === "clients" ? (
        clients
      ) : tab === "brand" ? (
        workspace && <BrandSettings workspaceId={workspace.id} onSave={(changes) => mutate({ action: "set-brand", ...changes })} onNotice={setNotice} onError={setError} />
      ) : tab === "rules" ? (
        <WorkflowSettingsPanel settings={data.workflowSettings} revision={workflowRevision} onSave={onWorkflowSave} />
      ) : tab === "drive" ? (
        workspace && <DriveTab workspaceId={workspace.id} owner={owner} />
      ) : owner ? (
        <CustomizePage data={data} actions={actions} />
      ) : null}
    </>
  );
}

/** The agency's Google Drive. A Google sign-in comes back here (lib/drive-oauth.ts) with its result in the address. */
function DriveTab({ workspaceId, owner }: { workspaceId: string; owner: boolean }) {
  const [result, setResult] = useState<{ error?: string; connected?: boolean }>();
  useEffect(() => {
    const url = new URL(window.location.href);
    const error = url.searchParams.get("driveError"); const connected = url.searchParams.has("driveConnected");
    if (!error && !connected) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- consume a completed external OAuth navigation
    setResult({ ...(error ? { error } : {}), connected });
    url.searchParams.delete("driveError"); url.searchParams.delete("driveConnected");
    window.history.replaceState(window.history.state, "", url);
  }, []);
  return <Surface asChild tone="default"><section className="brand-settings"><DriveSettings key={result ? "returned" : "plain"} workspaceId={workspaceId} owner={owner} oauthResult={result} /></section></Surface>;
}
"use client";
// « Paramètres », behind the profile button: everything a person can change, by category, each person
// seeing those of their role. « #settings//team » opens a category; the agency's parts (« #settings//plan »)
// open its category at that part.
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Briefcase, Building2, Palette, SlidersHorizontal, UserRound, Users } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { ClientsPage } from "@/features/clients/clients-page";
import SubscriptionPanel, { type PlanPayload } from "@/features/plans/subscription-panel";
import type { TaskListView } from "@/features/tasks/use-task-list-view";
import BrandSettings from "@/features/workspace/brand-settings";
import { useProcess } from "@/features/workspace/process-context";
import type { ScreenProps } from "@/features/workspace/screen-props";
import { AccountSections, PreferenceSections, ProfileSections, type ProfileUser, type ProfileWhatsapp } from "@/features/workspace/settings-dialog";
import WorkflowSettingsPanel from "@/features/workspace/workflow-settings-panel";
import { useI18n } from "@/lib/i18n/locale-provider";
import type { WorkspaceRoute } from "@/lib/navigation";
import type { WorkflowSettings } from "@/lib/workflow-settings";
import type { Invitation, MemberChange } from "@/lib/workspace";
const CustomizePage = dynamic(() => import("@/features/customize/customize-page"));
const DriveSettings = dynamic(() => import("@/features/drive/drive-settings"));
// Opened by few, on some visits (features/studio/studio-pages.tsx keeps the same rule for its pages).
const TeamPage = dynamic(() => import("@/features/team/team"));

export type DriveResult = { error?: string; connected?: boolean };

const anchor = (parts: Record<string, string>, part?: string) => (part && Object.hasOwn(parts, part) ? parts[part] : undefined);
const agencyParts = { brand: "brand-settings-title", plan: "plan-title", rules: "workflow-settings-title", drive: "drive-settings-title" };
const teamParts = { invite: "team-invite-title" };

function ScrollToSection({ id }: { id?: string }) {
  useEffect(() => {
    if (!id) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // The section may render a moment later (the plan and the brand load first): look again for up to 2 s.
    let tries = 0;
    const timer = window.setInterval(() => {
      const target = document.getElementById(id);
      if (target) target.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
      if (target || ++tries >= 20) window.clearInterval(timer);
    }, 100);
    return () => window.clearInterval(timer);
  }, [id]);
  return null;
}

export function StudioSettings({ route, plan, mailConfigured, data, roles, lookups, actions, list, changeMember, workflowRevision, onWorkflowSave, onProfile, onLogout, driveResult, whatsapp }: ScreenProps & {
  route: WorkspaceRoute;
  plan: PlanPayload | null;
  mailConfigured: boolean;
  list: TaskListView;
  changeMember: (change: MemberChange) => Promise<Invitation | undefined>;
  workflowRevision: number;
  onWorkflowSave: (data: WorkflowSettings, revision: number) => Promise<number>;
  onProfile: (changes: { name?: string; avatar?: string | null }) => Promise<ProfileUser | undefined>;
  onLogout: () => void;
  driveResult?: DriveResult;
  whatsapp?: ProfileWhatsapp;
}) {
  const { t: tr } = useI18n();
  const process = useProcess();
  const [saving, setSaving] = useState(false);
  const { members, clients, user, workspace, busy } = data;
  const { owner, manager } = roles;
  const { navigate, mutate, setNotice, setError, load } = actions;
  const categories = [
    { id: "profile", label: tr("Profil"), icon: UserRound },
    { id: "preferences", label: tr("Préférences"), icon: Palette },
    ...(process.pages.team.on ? [{ id: "team", label: process.pages.team.label?.trim() || tr("Équipe"), icon: Users }] : []),
    { id: "clients", label: tr("Clients"), icon: Building2 },
    ...(manager ? [{ id: "agency", label: tr("Agence"), icon: Briefcase }] : []),
    ...(owner ? [{ id: "customize", label: tr("Personnaliser"), icon: SlidersHorizontal }] : []),
  ];
  const agencyPart = anchor(agencyParts, route.tab);
  const wanted = agencyPart ? "agency" : route.tab;
  const active = categories.some((c) => c.id === wanted) ? wanted : "profile";
  const driveRole = workspace?.role === "owner" || workspace?.role === "admin";
  // Once Settings is open, fetch the team chunk while idle: a click on « Équipe » then switches at once
  // instead of leaving the previous category on screen while it arrives.
  const teamOn = process.pages.team.on;
  useEffect(() => {
    if (!teamOn) return;
    const id = window.setTimeout(() => void import("@/features/team/team"), 300);
    return () => window.clearTimeout(id);
  }, [teamOn]);
  return (
    <>
      <div className="live-switch settings-nav" role="group" aria-label={tr("Paramètres")}>
        {categories.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" aria-pressed={active === id} onClick={() => navigate({ page: "settings", tab: id })}>
            <Icon size={15} aria-hidden="true" />{label}
          </button>
        ))}
      </div>
      {active === "profile" && (
        <>
          <div className="page-heading">
            <h1>{tr("Profil")}</h1>
            <p>{tr("Votre photo, votre nom et votre mot de passe.")}</p>
          </div>
          <Surface className="settings-dialog settings-panel">
            <ProfileSections user={user} workspaceId={workspace?.id ?? null} workspaceName={workspace?.name} whatsapp={whatsapp} onSave={onProfile} onBusyChange={setSaving} />
            <AccountSections disabled={saving} onLogout={onLogout} />
          </Surface>
        </>
      )}
      {active === "preferences" && (
        <>
          <div className="page-heading">
            <h1>{tr("Apparence et langue")}</h1>
            <p>{tr("Le thème et la langue de l’application, sur cet appareil.")}</p>
          </div>
          <Surface className="settings-dialog settings-panel"><PreferenceSections /></Surface>
        </>
      )}
      {active === "team" && (
        <>
          <ScrollToSection id={anchor(teamParts, route.detail)} />
          <TeamPage
            workspace={workspace}
            members={members}
            clients={clients}
            currentUserId={user.id}
            busy={busy}
            mailConfigured={mailConfigured}
            onChange={changeMember}
            onRefresh={() => void load()}
          />
        </>
      )}
      {active === "clients" && <ClientsPage data={data} roles={roles} lookups={lookups} actions={actions} listView={list} />}
      {active === "agency" && (
        <>
          <ScrollToSection id={agencyPart} />
          <div className="page-heading">
            <h1>{tr("Paramètres de l’agence")}</h1>
            <p>{tr("Votre abonnement, votre logo et votre couleur, et vos règles de validation.")}</p>
          </div>
          {plan?.subscription && (
            <SubscriptionPanel
              plan={plan}
              owner={owner}
              workspaceId={workspace?.id ?? ""}
              onRequest={(id) => mutate({ action: "request-plan", plan: id })}
              onNotice={setNotice}
              onError={setError}
            />
          )}
          {workspace && (
            <BrandSettings
              workspaceId={workspace.id}
              onSave={(changes) => mutate({ action: "set-brand", ...changes })}
              onNotice={setNotice}
              onError={setError}
            />
          )}
          <WorkflowSettingsPanel settings={data.workflowSettings} revision={workflowRevision} onSave={onWorkflowSave} />
          {workspace && driveRole && (
            <div id="drive-settings-title" className="settings-drive">
              <DriveSettings workspaceId={workspace.id} owner={owner} oauthResult={route.tab === "drive" ? driveResult : undefined} />
            </div>
          )}
        </>
      )}
      {active === "customize" && (
        <>
          <div className="page-heading"><h1>{tr("Personnaliser")}</h1></div>
          <CustomizePage data={data} actions={actions} layer={route.detail} />
        </>
      )}
    </>
  );
}

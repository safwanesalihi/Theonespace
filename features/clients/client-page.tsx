"use client";
// One client: its brief and images, sub-projects, tasks, social calendar and content plan, files,
// commercial pipeline and documents, with the actions managers and the owner have on it.
import { Blank } from "@/components/empty-state";
import { Heading } from "@/components/page-heading";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ClientImages from "@/features/clients/client-images";
import ClientMark from "@/features/clients/client-mark";
import ContentPlanPage from "@/features/content-plan/content-plan";
import ClientDocuments from "@/features/documents/client-documents";
import { useI18n } from "@/lib/i18n/locale-provider";
import { RecordItem } from "@/lib/model";
import { memberName } from "@/lib/workspace";
import { CheckSquare, Plus, ChevronRight, ArrowUpRight, ArrowLeft, CalendarDays, FileText, Folder, Archive, Eye, Sparkles, Bell, Megaphone, FileSignature, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { WorkspaceRoute } from "@/lib/navigation";
import type { ScreenProps } from "@/features/workspace/screen-props";
import type { TaskListView } from "@/features/tasks/use-task-list-view";
import dynamic from "next/dynamic";
const ClientBriefBoard = dynamic(() => import("@/features/clients/client-brief"));
const ClientDrive = dynamic(() => import("@/features/drive/client-drive"));
const SocialHub = dynamic(() => import("@/features/social/social-hub"));

export function ClientPage({ client, route, data, roles, lookups, actions, list, onNotifyClient, onDeleteClient, renderTasks }: ScreenProps & {
  client: RecordItem | null;
  route: WorkspaceRoute;
  list: Pick<TaskListView, "setQuery">;
  /** Opens the « Notifier le client » dialog. */
  onNotifyClient: (client: RecordItem) => void;
  /** Asks to confirm the permanent deletion of an archived client. */
  onDeleteClient: (client: RecordItem) => void;
  /** The client's task database (the « Tâches » tab). */
  renderTasks: () => ReactNode;
}) {
  const { t: tr } = useI18n();
  const { records, projects, tasks, members, workspace, today, busy, mediaStorage, workflowSettings } = data;
  const { owner, manager, writable, social } = roles;
  const { dateLabel } = lookups;
  const { navigate, goBack, open, update, mutate, setError, setNotice, load, reloadSilently } = actions;
  const { setQuery } = list;
  if (!client) return <Blank title={tr("Client introuvable")} />;
  const tab = route.tab || "overview",
    ps = projects.filter((p) => p.clientId === client.id && !p.archived);
  return (
    <>
      <button className="text-link back" onClick={() => goBack({ page: "clients" })}><ArrowLeft size={15} />{tr("Retour")}</button>
      {tab === "overview" && (
        <ClientImages
          client={client}
          workspaceId={workspace?.id || ""}
          canEdit={manager && !client.archived}
          onChange={(changes, message) => update(client, changes, message)}
          onError={setError}
        />
      )}
      <Heading
        emoji="📁"
        title={client.name}
        subtitle={`${client.sector || tr("Client")} · ${client.city || ""}${client.archived ? tr(" · Archivé") : ""}`}
        mark={
          tab === "overview" ? (
            <span
              className="page-symbol page-symbol-hidden"
              aria-hidden="true"
            />
          ) : (
            <ClientMark
              name={client.name}
              logo={client.logo}
              size="lg"
              className="page-symbol-mark"
            />
          )
        }
        action={
          <div className="inline">
            {manager && !client.archived && (
              <button
                className="btn"
                onClick={() => onNotifyClient(client)}
              >
                <Bell size={15} />
                {tr("Notifier le client")}
              </button>
            )}
            <button
              className="btn"
              disabled={!manager}
              onClick={() => open("client", client)}
            >
              {tr("Modifier la fiche")}
            </button>
          </div>
        }
      />
      <Tabs
        value={tab}
        onValueChange={(tab) =>
          navigate({ page: "client", id: client.id, tab })
        }
      >
        <TabsList variant="line" className="client-tabs">
          <TabsTrigger value="overview"><Sparkles size={15} />{tr("Aperçu")}</TabsTrigger>
          <TabsTrigger value="projects">
            <Folder size={15} />{tr("Sous-projets")} <small>{ps.length}</small>
          </TabsTrigger>
          <TabsTrigger value="tasks"><CheckSquare size={15} />{tr("Tâches")}</TabsTrigger>
          {social && <TabsTrigger value="editorial"><Megaphone size={15} />{tr("Social")}</TabsTrigger>}
          {social && <TabsTrigger value="plan"><CalendarDays size={15} />{tr("Plan Éditorial")}</TabsTrigger>}
          {manager && <TabsTrigger value="files"><Folder size={15} />{tr("Fichiers")}</TabsTrigger>}
          {owner && (
            <TabsTrigger value="documents">
              <FileText size={15} />{tr("Pipeline & documents")}
            </TabsTrigger>
          )}
        </TabsList>
      </Tabs>
      {tab === "overview" ? (
        <><ClientBriefBoard key={client.id} client={client} canEdit={manager && !client.archived} onSave={(brief, revision) => update({ ...client, revision: revision ?? client.revision }, { brief }, tr("Brief enregistré"))} />{manager && <div className="section-head"><p className="small-note">{tr("Organisez les sources et livrables à partir de ce brief.")}</p><button type="button" className="btn" onClick={() => navigate({ page: "client", id: client.id, tab: "files" })}><Folder size={16} />{tr("Organiser les fichiers")}</button></div>}<div className="detail-split">
          <article>
            <div className="section-head">
              <h2>{tr("Sous-projets en cours")}</h2>
              <button
                className="text-link"
                onClick={() =>
                  navigate({ page: "client", id: client.id, tab: "projects" })
                }
              >
                {tr("Voir tout")}
                <ArrowUpRight size={14} />
              </button>
            </div>
            {ps.map((p) => (
              <button
                className="project-brief-row"
                key={p.id}
                onClick={() => {
                  navigate({ page: "client", id: client.id, tab: "tasks" });
                  setQuery("");
                }}
              >
                <Folder size={17} />
                {p.name}
                <small>
                  {tr("{n} tâches", {
                    n: tasks.filter((t) => t.projectId === p.id).length,
                  })}
                </small>
                <ChevronRight size={14} />
              </button>
            ))}
            {!ps.length && (
              <button
                className="btn"
                disabled={!writable}
                onClick={() => open("project")}
              >
                <Plus size={15} />
                {tr("Nouveau sous-projet")}
              </button>
            )}
          </article>
          <aside>
            <h3>{tr("INFORMATIONS CLIENT")}</h3>
            <dl className="properties">
              {(
                [
                  ["Contact", client.contact],
                  ["E-mail", client.email],
                  ["WhatsApp", client.whatsapp],
                  ["Secteur", client.sector],
                  ["Ville", client.city],
                  ["Langue", client.language ? tr(client.language) : ""],
                  ["Contenus vendus / mois", client.quota || "—"],
                  ["Publications", client.postApproval ? tr("Validées par le client") : tr("Publiées par le studio")],
                  [
                    "Accès portail",
                    members
                      .filter(
                        (m) =>
                          m.role === "client" && m.clientId === client.id,
                      )
                      .map(memberName)
                      .join(", ") ||
                      tr(manager ? "Aucun · inviter depuis Équipe" : "Aucun"),
                  ],
                  ["Créé le", dateLabel(client.createdAt.slice(0, 10))],
                ] as [string, string | undefined][]
              ).map(([l, v]) => (
                <div key={l}>
                  <dt>{tr(l)}</dt>
                  <dd>{v || "—"}</dd>
                </div>
              ))}
            </dl>
            {manager && (
              <div className="aside-actions">
                <button
                  className="btn"
                  onClick={() =>
                    navigate({ page: "portal", id: client.id, tab: "home" })
                  }
                >
                  <Eye size={16} />
                  {tr("Aperçu du portail client")}
                  <ArrowUpRight size={15} />
                </button>
                <button
                  className="btn"
                  onClick={() => navigate({ page: "annex", id: client.id })}
                >
                  <FileSignature size={16} />
                  {tr("Annexe contractuelle")}
                </button>
                <button
                  className="btn ghost"
                  onClick={() => open("archive", client)}
                >
                  <Archive size={16} />
                  {tr(
                    client.archived
                      ? "Restaurer le client"
                      : "Archiver le client",
                  )}
                </button>
                {client.archived && owner && (
                  <button
                    className="btn danger"
                    onClick={() => onDeleteClient(client)}
                  >
                    <Trash2 size={16} />
                    {tr("Supprimer définitivement")}
                  </button>
                )}
              </div>
            )}
          </aside>
        </div></>
      ) : tab === "projects" ? (
        <>
          <div className="section-head">
            <h2>
              {ps.length === 1
                ? tr("1 sous-projet")
                : tr("{n} sous-projets", { n: ps.length })}
            </h2>
            <button className="btn primary" onClick={() => open("project")}>
              <Plus size={16} />
              {tr("Nouveau sous-projet")}
            </button>
          </div>
          {ps.map((p) => {
            const ts = tasks.filter((t) => t.projectId === p.id),
              done = ts.filter((t) => t.status === "Validé").length;
            return (
              <div className="project-row" key={p.id}>
                <span className="client-mark">
                  <Folder size={20} />
                </span>
                <button
                  disabled={!writable}
                  onClick={() => open("project", p)}
                >
                  <strong>{p.name}</strong>
                  <small>
                    {p.description || tr("Ajouter une description")}
                  </small>
                </button>
                <span>{tr("{n} tâches", { n: ts.length })}</span>
                <div className="project-progress">
                  <Progress
                    value={ts.length ? (done / ts.length) * 100 : 0}
                  />
                  <small>
                    {tr("{done}/{total} validées", {
                      done,
                      total: ts.length,
                    })}
                  </small>
                </div>
                {manager && (
                  <button
                    className="icon-button"
                    aria-label={tr("Archiver {name}", { name: p.name })}
                    onClick={() => open("archive", p)}
                  >
                    <Archive size={16} />
                  </button>
                )}
              </div>
            );
          })}
          {!ps.length && (
            <Blank
              title={tr("Le premier sous-projet vous attend")}
              text={tr(
                "Un sous-projet regroupe les tâches d’une même mission.",
              )}
            />
          )}
          <details className="archived-projects">
            <summary>
              {tr("Sous-projets archivés ({n})", {
                n: projects.filter(
                  (p) => p.clientId === client.id && p.archived,
                ).length,
              })}
            </summary>
            {projects
              .filter((p) => p.clientId === client.id && p.archived)
              .map((p) => (
                <div className="link-row" key={p.id}>
                  {p.name}
                  <button className="btn" onClick={() => open("archive", p)}>
                    {tr("Restaurer")}
                  </button>
                </div>
              ))}
          </details>
        </>
      ) : tab === "tasks" ? (
        renderTasks()
      ) : tab === "plan" && social && workspace ? (
        <ContentPlanPage
          workspaceId={workspace.id}
          clientId={client.id}
          clientName={client.name}
          onNotice={setNotice}
          onError={setError}
          planId={route.detail ?? null}
          canDiscuss={(id) => records.some(r => r.id === id && r.kind === "plan_item")}
          onPlanChange={(detail) => detail ? navigate({ ...route, detail }) : goBack({ ...route, detail: undefined })}
          onOpenTask={(id) => navigate({ page: "task", id })}
          onRecordsChanged={reloadSilently}
        />
      ) : tab === "files" && manager && workspace ? (
        <ClientDrive key={`${workspace.id}:${client.id}`} workspaceId={workspace.id} clientId={client.id} clientName={client.name} owner={owner} archived={!!client.archived} />
      ) : tab === "documents" && owner ? (
        <ClientDocuments
          workspaceWorkflowSettings={workflowSettings}
          client={client}
          records={records}
          busy={busy}
          onChange={mutate}
          onError={setError}
          today={today}
          onNavigate={(tab) => navigate({ page: "client", id: client.id, tab })}
        />
      ) : tab === "editorial" && social && workspace ? (
        <SocialHub
          records={records}
          workspaceId={workspace.id}
          today={today}
          fixedClientId={client.id}
          mediaStorage={mediaStorage}
          mutate={mutate}
          reload={() => load(true)}
          onNotice={setNotice}
          onError={setError}
        />
      ) : null}
    </>
  );
}

"use client";
// One task: its state and milestones, brief and deliverable, conversation, properties, validation
// receipt, time and history, with the validation, publication and reminder actions.
import { Blank } from "@/components/empty-state";
import { Heading } from "@/components/page-heading";
import { Surface } from "@/components/ui/surface";
import { Chip, CourtChip, Pick, TimeTracker } from "@/features/tasks/task-controls";
import TaskPriority from "@/features/tasks/task-priority";
import { flow, gatesFor, hoursLeft, revisionState, insideLock, isPublishable } from "@/lib/flow";
import { useI18n } from "@/lib/i18n/locale-provider";
import { RecordItem, Status, safeLink } from "@/lib/model";
import { behaviourOf, startStatus, statusLabel, stepIds, workStatus } from "@/lib/process";
import { useProcess } from "@/features/workspace/process-context";
import { taskReturnRoute } from "@/lib/navigation";
import { appNow } from "@/lib/time";
import { ArrowUpRight, ArrowLeft, FileText, Archive, Check, Clock, RefreshCw, Eye, X, Inbox, Sparkles, Bell, ShieldCheck, Megaphone, Unlock, Trash2, PenLine, MessageCircle, Send, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ScreenProps } from "@/features/workspace/screen-props";
import { TaskConversation } from "./task-conversation";

export function TaskPage({ task, data, roles, lookups, actions }: ScreenProps & { task: RecordItem | null }) {
  const { t: tr } = useI18n();
  const [moreOpen, setMoreOpen] = useState(false);
  const { today, busy } = data;
  const { owner, manager, member, writable, social } = roles;
  const { archived, cname, pname, dateLabel, timeLabel, link } = lookups;
  const { navigate, goBack, open, update, act } = actions;
  // What the task's status does in this studio (lib/process.ts): the banners and actions follow it.
  const process = useProcess();
  const b = behaviourOf(task?.status, process);
  if (!task) return <Blank title={tr("Tâche introuvable")} />;
  if (task.kind === "plan_item") return <>
    <button className="text-link back" onClick={() => goBack(social ? { page: "client", id: task.clientId, tab: "plan", detail: task.planId } : taskReturnRoute(task.clientId))}><ArrowLeft size={15} />{tr("Retour")}</button>
    <Heading emoji="💬" title={task.name} subtitle={`${cname(task.clientId)} · ${tr("Plan Éditorial")}`} />
    <Surface asChild tone="default"><section className="work-panel">
      {task.description && <p className="document-copy" dir="auto">{task.description}</p>}
      <TaskConversation task={task} data={data} roles={roles} lookups={lookups} actions={actions} />
    </section></Surface>
  </>;
  return (
    <>
      <button
        className="text-link back"
        onClick={() => goBack(taskReturnRoute(task.clientId))}
      >
        <ArrowLeft size={15} />
        {tr("Retour")}
      </button>
      <Heading
        emoji="📝"
        title={task.name}
        subtitle={`${cname(task.clientId)} / ${pname(task.projectId)}${task.priority ? ` · ${tr("Priorité")} ${tr(task.priority)}` : ""}`}
        action={
          <div className="inline task-actions">
            <button
              className="btn"
              disabled={!writable || archived(task)}
              onClick={() => open("task", task)}
            >
              <PenLine size={15} />
              {tr("Modifier")}
            </button>
            {b === "internal" && manager && !archived(task) && (
              <>
                <button className="btn" disabled={busy} onClick={() => open("internal-reject", task)}>
                  <X size={15} />{tr("Refuser")}
                </button>
                <button
                  className="btn primary"
                  disabled={busy || !task.deliverable}
                  onClick={() => act({ action: "internal-review", taskId: task.id, revision: task.revision, decision: "send" }, tr("Validé en interne · envoyé au client"))}
                >
                  <Send size={15} />{tr("Envoyer au client")}
                </button>
              </>
            )}
            {b === "client" && manager && !archived(task) && (
              <>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => open("feedback", task)}
                >
                  <RefreshCw size={15} />
                  {tr("Retours client")}
                </button>
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() => open("approve", task)}
                >
                  <Check size={15} />
                  {tr("Valider (accord reçu)")}
                </button>
              </>
            )}
            {b === "done" &&
              !task.publishedAt &&
              !task.evergreen &&
              isPublishable(task) && (
                <button
                  disabled={busy || archived(task)}
                  className="btn primary"
                  onClick={() =>
                    act(
                      { action: "publish", taskId: task.id },
                      tr("Contenu marqué publié"),
                    )
                  }
                >
                  <Megaphone size={15} />
                  {tr("Marquer publié")}
                </button>
              )}
            {/* Occasional actions wait in one menu, so the step's own decision stays the obvious one. */}
            {manager && (
              <Popover open={moreOpen} onOpenChange={setMoreOpen}>
                <PopoverTrigger asChild>
                  <button className="icon-button" aria-label={tr("Plus d’actions")} title={tr("Plus d’actions")}>
                    <MoreHorizontal size={17} />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="action-menu">
                  {!archived(task) && b !== "done" && !task.publishedAt && (
                    <button
                      disabled={busy || !task.assigneeId}
                      title={!task.assigneeId ? tr("Assignez cette tâche avant d’envoyer un rappel.") : undefined}
                      onClick={() => { setMoreOpen(false); act({ action: "remind-assignee-whatsapp", taskId: task.id, revision: task.revision }, tr("Rappel WhatsApp demandé")); }}
                    >
                      <Bell size={15} />{tr("Rappeler l’assigné")}
                    </button>
                  )}
                  {b === "client" && !archived(task) && (
                    <button
                      disabled={busy || task.clientId === "internal"}
                      onClick={() => { setMoreOpen(false); act({ action: "retry-approval-whatsapp", taskId: task.id, revision: task.revision }, tr("Demande WhatsApp effectuée")); }}
                    >
                      <MessageCircle size={15} />{tr("Renvoyer WhatsApp")}
                    </button>
                  )}
                  <button onClick={() => { setMoreOpen(false); open("archive", task); }}>
                    <Archive size={15} />
                    {tr(task.archived ? "Restaurer" : "Archiver")}
                  </button>
                  <button className="danger" onClick={() => { setMoreOpen(false); open("delete", task); }}>
                    <Trash2 size={15} />{tr("Supprimer la tâche")}
                  </button>
                </PopoverContent>
              </Popover>
            )}
          </div>
        }
      />
      <div className="task-state">
        <Chip status={task.status} />
        <CourtChip task={task} />
        {task.publishedAt && (
          <span className="flag-pill ok">
            <Megaphone size={11} />
            {tr("Publié le {date}", { date: timeLabel(task.publishedAt) })}
          </span>
        )}
        {task.evergreen && (
          <span className="flag-pill">
            <Sparkles size={11} />
            {tr("Réserve evergreen")}
          </span>
        )}
        {task.publishable === false && (
          <span className="flag-pill">
            <PenLine size={11} />
            {tr("Travail interne · non publié")}
          </span>
        )}
        {task.request && (
          <span className="flag-pill">
            <Inbox size={11} />
            {tr("Demande portail · {by}", { by: task.request.by })}
          </span>
        )}
        {revisionState(task).overBudget && (
          <span className="flag-pill warn">
            {tr("Hors forfait · tour {n}", { n: revisionState(task).used })}
          </span>
        )}
        {task.pendingExtraRequestId && <span className="flag-pill warn">{tr('Tour supplémentaire : devis extra en attente')}</span>}
        {task.lockOverride && (
          <span className="flag-pill">
            <Unlock size={11} />
            {tr("Verrou J−{n} levé", { n: flow.lockDays })}
          </span>
        )}
        {archived(task) && (
          <span className="small-note">
            {tr(
              "Archivée · restaurez les éléments parents avant de reprendre le travail.",
            )}
          </span>
        )}
        {b === "internal" && (
          <span className="small-note">
            <ShieldCheck size={12} />{" "}
            {tr(manager
              ? "En validation interne · le client ne voit rien tant que vous ne l’envoyez pas"
              : "En validation interne · le propriétaire ou un administrateur l’enverra au client")}
          </span>
        )}
        {task.internalReview && b !== "internal" && b !== "client" && b !== "done" && (
          <span className="small-note internal-note" dir="auto">
            <PenLine size={12} />{" "}
            {tr("Retour interne de {by} ({date}) : {note}", { by: task.internalReview.by, date: timeLabel(task.internalReview.at), note: task.internalReview.note })}
          </span>
        )}
        {b === "client" && (
          <span className="small-note">
            <Clock size={12} />{" "}
            {tr(
              "Chez le client depuis le {since} · validation tacite dans {hours} h ({due})",
              {
                since: timeLabel(task.sentAt),
                hours: Math.max(
                  0,
                  Math.ceil((hoursLeft(task, appNow()) ?? 0) * 100) / 100,
                ),
                due: timeLabel(task.approvalDueAt),
              },
            )}
          </span>
        )}
      </div>
      {(() => {
        if (!isPublishable(task)) return null;
        const gates = gatesFor(task, today);
        return gates.length ? (
          <div className="gates">
            {gates.map((g) => (
              <div
                key={g.key}
                className={g.reached ? "reached" : g.late ? "late" : ""}
              >
                <span>
                  {g.reached ? (
                    <Check size={12} />
                  ) : g.late ? (
                    <X size={12} />
                  ) : (
                    <Clock size={12} />
                  )}
                </span>
                <strong>{tr(g.label)}</strong>
                <small>
                  J−{flow.gates.find((x) => x.key === g.key)!.offset} ·{" "}
                  {dateLabel(g.day)}
                </small>
              </div>
            ))}
            <div className="gate-publish">
              <span>
                <Megaphone size={12} />
              </span>
              <strong>{tr("Publication")}</strong>
              <small>
                J · {dateLabel(task.due)}
                {insideLock(task.due, today) && !task.sentAt
                  ? tr(" · dans la fenêtre gelée")
                  : ""}
              </small>
            </div>
          </div>
        ) : (
          <div className="gates none">
            <Sparkles size={13} />
            <span>
              {tr(
                task.evergreen
                  ? "Contenu de réserve : sans date, prêt à combler un trou du calendrier."
                  : "Sans date de publication — les jalons apparaîtront une fois la date fixée.",
              )}
            </span>
            {!task.due && b === "done" && !task.publishedAt && (
              <button
                className="btn"
                disabled={busy || archived(task)}
                onClick={() =>
                  update(
                    task,
                    { evergreen: !task.evergreen },
                    tr(
                      task.evergreen
                        ? "Retiré de la réserve"
                        : "Placé dans la réserve evergreen",
                    ),
                  )
                }
              >
                <Sparkles size={14} />
                {tr(
                  task.evergreen
                    ? "Retirer de la réserve"
                    : "Mettre en réserve evergreen",
                )}
              </button>
            )}
          </div>
        );
      })()}
      <div className="workflow">
        {stepIds(process).map((s, i, steps) => {
          // A paused task stays where work stands as far as the delivery milestones go.
          const reached = steps.indexOf(b === "paused" ? workStatus(process) : task.status ?? startStatus(process));
          return (
            <div key={s} className={i <= reached ? "reached" : ""}>
              <span className={i === reached ? "current" : ""}>
                {i < reached ? <Check size={14} /> : i + 1}
              </span>
              <strong>{tr(statusLabel(s, process))}</strong>
            </div>
          );
        })}
      </div>
      <div className="detail-split">
        <article>
          <div className="section-head">
            <h2>{tr("Brief")}</h2>
          </div>
          <p className="document-copy">
            {task.description || tr("Aucun brief renseigné.")}
          </p>
          <div className="section-head second">
            <h2>{tr("Livrable")}</h2>
          </div>
          <div className="deliverable">
            <div className="doc-thumb">
              <FileText size={30} />
            </div>
            <div>
              <strong>
                {tr(link(task) ? "Fichier de livraison" : "Aucun livrable")}
              </strong>
              <small>
                {task.deliverable ||
                  tr("Collez le lien de votre fichier pour le faire valider.")}
              </small>
              <div className="inline">
                {link(task) && (
                  <a
                    className="btn"
                    href={link(task)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ArrowUpRight size={15} />
                    {tr("Ouvrir")}
                  </a>
                )}
                <button
                  className="btn"
                  disabled={archived(task)}
                  onClick={() => open("task", task)}
                >
                  {tr(link(task) ? "Remplacer" : "Ajouter un lien")}
                </button>
                {b === "client" && manager && (
                  <button
                    className="btn"
                    onClick={() => navigate({ page: "review", id: task.id })}
                  >
                    <Eye size={15} />
                    {tr("Aperçu de la revue")}
                  </button>
                )}
              </div>
            </div>
          </div>
          <TaskConversation task={task} data={data} roles={roles} lookups={lookups} actions={actions} />
        </article>
        <aside>
          <h3>{tr("Propriétés")}</h3>
          <dl className="properties">
            <div><dt>{tr("Priorité")}</dt><dd><TaskPriority priority={task.priority} /></dd></div>
            {[
              ["Client", cname(task.clientId)],
              ["Sous-projet", pname(task.projectId)],
              ["Assigné", task.assignee || tr("Non assigné")],
              ["Publication", dateLabel(task.due)],
              ["Canal", task.channel || "—"],
              [
                "Tours de retours",
                `${revisionState(task).used} / ${revisionState(task).included}${revisionState(task).overBudget ? tr(" · hors forfait") : ""}`,
              ],
              ["Créée le", dateLabel(task.createdAt.slice(0, 10))],
            ].map(([l, v]) => (
              <div key={l}>
                <dt>{tr(l)}</dt>
                <dd>{v}</dd>
              </div>
            ))}
            <div>
              <dt>{tr("Lien de brief")}</dt>
              <dd>
                {task.source && safeLink(task.source) ? (
                  <a
                    href={safeLink(task.source)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-link"
                  >
                    {tr("Ouvrir le brief")}
                    <ArrowUpRight size={14} />
                  </a>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt>{tr("Statut")}</dt>
              <dd>
                <Pick
                  label={tr("Statut de la tâche")}
                  value={task.status ?? startStatus(process)}
                  onChange={(s) => {
                    if (s) void update(task, { status: s as Status });
                  }}
                  items={process.statuses
                    .filter((st) => manager
                      || (member ? ["todo", "work", "paused", "internal"].includes(st.behaviour) || st.id === task.status
                        : st.behaviour !== "done" && (st.behaviour !== "client" || st.id === task.status)))
                    .map((st) => ({ value: st.id, label: tr(st.label) }))}
                />
              </dd>
            </div>
          </dl>
          {task.signOff && (
            <div className="receipt">
              <ShieldCheck size={16} />
              <div>
                <strong>{tr("Reçu de validation")}</strong>
                <small>
                  {tr(
                    task.signOff.mode === "silence"
                      ? "Validation tacite — délai écoulé"
                      : task.signOff.mode === "studio"
                        ? "Validation depuis le studio"
                        : "Validation explicite du client",
                  )}
                </small>
                <small>
                  {task.signOff.by}
                  {task.signOff.email ? ` · ${task.signOff.email}` : ""}
                </small>
                <small>
                  {timeLabel(task.signOff.at)} {tr("(heure de Casablanca)")} ·{" "}
                  {task.signOff.round === 1
                    ? tr("1 tour utilisé")
                    : tr("{n} tours utilisés", { n: task.signOff.round })}
                </small>
              </div>
            </div>
          )}
          {(owner || manager) && writable && (
            <>
              <h3>{tr("Temps")}</h3>
              <TimeTracker task={task} />
            </>
          )}
          <h3 className="history-heading">{tr("Historique")}</h3>
          <div className="history">
            {task.history
              ?.slice()
              .reverse()
              .map((e, i) => (
                <div key={i}>
                  <span />
                  <p>
                    {e.text}
                    <small>{timeLabel(e.date)}</small>
                  </p>
                </div>
              ))}
          </div>
        </aside>
      </div>
    </>
  );
}

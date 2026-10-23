"use client";
// One task: its state and milestones, brief and deliverable, conversation, properties, validation
// receipt, time and history, with the validation, publication and reminder actions.
import { Blank } from "@/components/empty-state";
import { Heading } from "@/components/page-heading";
import { Surface } from "@/components/ui/surface";
import { BorderBeam } from "@/components/ui/border-beam";
import { Chip, CourtChip, Pick, TimeTracker } from "@/features/tasks/task-controls";
import TaskPriority from "@/features/tasks/task-priority";
import { flow, gatesFor, hoursLeft, revisionState, insideLock, isPublishable } from "@/lib/flow";
import { useI18n } from "@/lib/i18n/locale-provider";
import { RecordItem, Status, statuses, deliverySteps, safeLink } from "@/lib/model";
import { taskReturnRoute } from "@/lib/navigation";
import { appNow, formatDuration } from "@/lib/time";
import { ArrowUpRight, ArrowLeft, FileText, Archive, Check, Clock, RefreshCw, Eye, X, Inbox, Sparkles, Bell, ShieldCheck, Megaphone, Unlock, Trash2, PenLine, MessageCircle, Send, MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
        subtitle={[cname(task.clientId), task.projectId ? pname(task.projectId) : "", task.assignee || tr("Non assigné")].filter(Boolean).join(" · ")}
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
            {task.status === "Validation interne" && manager && !archived(task) && (
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
            {task.status === "À valider" && manager && !archived(task) && (
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
            {task.status === "Validé" &&
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
                  {!archived(task) && task.status !== "Validé" && !task.publishedAt && (
                    <button
                      disabled={busy || !task.assigneeId}
                      title={!task.assigneeId ? tr("Assignez cette tâche avant d’envoyer un rappel.") : undefined}
                      onClick={() => { setMoreOpen(false); act({ action: "remind-assignee-whatsapp", taskId: task.id, revision: task.revision }, tr("Rappel WhatsApp demandé")); }}
                    >
                      <Bell size={15} />{tr("Rappeler l’assigné")}
                    </button>
                  )}
                  {task.status === "À valider" && !archived(task) && (
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
        {task.internalReview && task.status !== "Validation interne" && task.status !== "À valider" && task.status !== "Validé" && (
          <span className="small-note internal-note" dir="auto">
            <PenLine size={12} />{" "}
            {tr("Retour interne de {by} ({date}) : {note}", { by: task.internalReview.by, date: timeLabel(task.internalReview.at), note: task.internalReview.note })}
          </span>
        )}
      </div>
      <StatusCard task={task} manager={manager} timeLabel={timeLabel} />
      <TaskTimeline task={task} today={today} dateLabel={dateLabel} />
      {isPublishable(task) && !task.due && (
        <div className="gates none">
          <Sparkles size={13} />
          <span>
            {tr(
              task.evergreen
                ? "Contenu de réserve : sans date, prêt à combler un trou du calendrier."
                : "Sans date de publication — les jalons apparaîtront une fois la date fixée.",
            )}
          </span>
          {task.status === "Validé" && !task.publishedAt && (
            <button
              className="btn"
              disabled={busy || archived(task)}
              onClick={() =>
                update(
                  task,
                  { evergreen: !task.evergreen },
                  tr(task.evergreen ? "Retiré de la réserve" : "Placé dans la réserve evergreen"),
                )
              }
            >
              <Sparkles size={14} />
              {tr(task.evergreen ? "Retirer de la réserve" : "Mettre en réserve evergreen")}
            </button>
          )}
        </div>
      )}
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
                  disabled={!writable || archived(task)}
                  onClick={() => open("task", task)}
                >
                  {tr(link(task) ? "Remplacer" : "Ajouter un lien")}
                </button>
                {task.status === "À valider" && manager && (
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
                  value={task.status!}
                  onChange={(s) => {
                    if (s) void update(task, { status: s as Status });
                  }}
                  items={
                    manager
                      ? [...statuses]
                      : member
                        ? statuses.filter(
                            (s) =>
                              s === "À faire" ||
                              s === "En cours" ||
                              s === "En pause" ||
                              s === "Validation interne" ||
                              s === task.status,
                          )
                        : statuses.filter(
                            (s) =>
                              s !== "Validé" &&
                              (s !== "À valider" ||
                                task.status === "À valider"),
                          )
                  }
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

/**
 * What the task is waiting for, said once and plainly: the client's clock while it is with them (time
 * left before tacit approval, as a bar), or the studio's decision while it is in internal review.
 */
function StatusCard({ task, manager, timeLabel }: { task: RecordItem; manager: boolean; timeLabel: (timestamp?: string) => string }) {
  const { t: tr } = useI18n();
  if (task.status === "Validation interne") {
    return (
      <div className={`task-status-card internal${manager ? " has-beam" : ""}`} role="status">
        {manager && <BorderBeam />}
        <ShieldCheck size={18} aria-hidden="true" />
        <div className="task-status-body">
          <strong>{tr(manager ? "Votre décision" : "En validation interne")}</strong>
          <small>{tr(manager ? "Le client ne voit rien tant que vous ne l’envoyez pas." : "Le propriétaire ou un administrateur l’enverra au client.")}</small>
        </div>
      </div>
    );
  }
  if (task.status !== "À valider" || !task.approvalDueAt) return null;
  const left = Math.max(0, hoursLeft(task, appNow()) ?? 0);
  const start = Date.parse(task.sentAt ?? task.approvalDueAt), end = Date.parse(task.approvalDueAt);
  const elapsed = end > start ? Math.min(1, Math.max(0, (appNow().getTime() - start) / (end - start))) : 1;
  const rounds = revisionState(task);
  return (
    <div className={`task-status-card client${left <= 6 ? " urgent" : ""}`} role="status">
      <Clock size={18} aria-hidden="true" />
      <div className="task-status-body">
        <strong>{tr("Chez le client")}</strong>
        <small>{tr("Envoyé le {since} · tour {used} sur {included}", { since: timeLabel(task.sentAt), used: rounds.used, included: rounds.included })}</small>
        <span className="task-status-meter" aria-hidden="true"><span style={{ width: `${elapsed * 100}%` }} /></span>
      </div>
      <div className="task-status-left">
        <b>{formatDuration(left * 3_600_000)}</b>
        <small>{tr("avant validation tacite · {due}", { due: timeLabel(task.approvalDueAt) })}</small>
      </div>
    </div>
  );
}

/**
 * The task's road in one line: the delivery steps it moves through, each with the deadline The One
 * Flow sets for it (brief J−14, sent J−7, validated J−5, published J) once it has a publication date.
 */
function TaskTimeline({ task, today, dateLabel }: { task: RecordItem; today: string; dateLabel: (day?: string) => string }) {
  const { t: tr } = useI18n();
  const gates = Object.fromEntries(gatesFor(task, today).map((g) => [g.key, g]));
  const publishable = isPublishable(task);
  const steps: { key: string; label: string; gate?: string; deadline?: string }[] = [
    ...deliverySteps.map((s) => ({ key: s, label: s, gate: s === "À faire" ? "brief" : s === "À valider" ? "send" : s === "Validé" ? "validation" : undefined })),
    ...(publishable ? [{ key: "published", label: "Publié", deadline: task.due }] : []),
  ];
  const current = task.publishedAt ? steps.length - 1 : deliverySteps.indexOf(task.status === "En pause" ? "En cours" : (task.status as (typeof deliverySteps)[number]));
  const done = (i: number) => i < current || (i === current && (!!task.publishedAt || (task.status === "Validé" && !publishable)));
  // On a phone the line scrolls sideways: open it on the current step, not on « À faire ».
  const line = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = line.current;
    if (list && list.scrollWidth > list.clientWidth) list.querySelector("li.current")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [current]);
  return (
    <ol ref={line} className="task-timeline" aria-label={tr("Étapes de la tâche")}>
      {steps.map((step, i) => {
        const gate = step.gate ? gates[step.gate] : undefined;
        const offset = gate ? flow.gates.find((g) => g.key === gate.key)!.offset : 0;
        const state = done(i) ? "done" : i === current ? "current" : "todo";
        return (
          <li key={step.key} className={state} aria-current={state === "current" ? "step" : undefined}>
            <span className="task-timeline-dot" aria-hidden="true">{state === "done" ? <Check size={13} strokeWidth={2.5} /> : null}</span>
            <strong>{tr(step.label)}</strong>
            {gate ? (
              <small className={gate.reached ? "met" : gate.late ? "late" : undefined}>
                J−{offset} · {dateLabel(gate.day)}{gate.late ? ` · ${tr("en retard")}` : ""}
              </small>
            ) : step.deadline ? (
              <small className={insideLock(task.due, today) && !task.sentAt ? "late" : undefined}>J · {dateLabel(step.deadline)}</small>
            ) : task.status === "En pause" && step.key === "En cours" ? (
              <small>{tr("En pause")}</small>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

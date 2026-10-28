"use client";
// One task: its state and milestones, brief and deliverable, conversation, properties, validation
// receipt, time and history, with the validation, publication and reminder actions.
import { Blank } from "@/components/empty-state";
import { Heading } from "@/components/page-heading";
import { Surface } from "@/components/ui/surface";
import { BorderBeam } from "@/components/ui/border-beam";
import { Stamp } from "@/components/moments/stamp";
import { ClockRing } from "@/components/moments/clock-ring";
import { HoldButton } from "@/components/moments/hold-button";
import { MotionConfig, motion } from "motion/react";
import { spring } from "@/lib/motion";
import { Chip, CourtChip, Pick, TimeTracker } from "@/features/tasks/task-controls";
import TaskPriority from "@/features/tasks/task-priority";
import { gatesFor, hoursLeft, revisionState, insideLock, isPublishable } from "@/lib/flow";
import { useI18n } from "@/lib/i18n/locale-provider";
import { RecordItem, Status, safeLink } from "@/lib/model";
import { behaviourOf, fieldsFor, firstOf, fitsTask, flowFor, nextCheck, rulesOf, startStatus, statusDef, statusLabel, stepIds, workStatus, workTypeOf, type Process } from "@/lib/process";
import { useProcess } from "@/features/workspace/process-context";
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
  // What the task's status does in this studio (lib/process.ts): the banners and actions follow it, and
  // the stepper and status menu show only the steps of the task's own path (its work type).
  const studio = useProcess();
  const process = flowFor(studio, task);
  const b = behaviourOf(task?.status, process);
  // Passing an internal check: to the next check of a chain, else to the client, else done.
  const nextStep = nextCheck(process, task?.status);
  // The agency's own work never goes to a client: after its last check it is validated.
  const internalWork = task?.clientId === "internal";
  const toClient = !!firstOf(process, "client") && !internalWork;
  // Who passes this check: those allowed to review and, when the check names its roles, holding one (lib/roles.ts).
  const reviewers = statusDef(task?.status, process)?.reviewers;
  const passes = owner || (roles.can("review") && (!reviewers?.length || (!!roles.studioRoleId && reviewers.includes(roles.studioRoleId))));
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
            {b === "internal" && passes && !archived(task) && (
              <>
                <button className="btn" disabled={busy} onClick={() => open("internal-reject", task)}>
                  <X size={15} />{tr("Refuser")}
                </button>
                {/* Sending to the client can't be taken back: it is held, not clicked. */}
                {!nextStep && toClient ? (
                  <HoldButton
                    disabled={busy || !task.deliverable}
                    icon={<Send size={15} />}
                    hint={tr("Maintenez pour envoyer")}
                    holding={tr("Envoi…")}
                    onConfirm={() => act({ action: "internal-review", taskId: task.id, revision: task.revision, decision: "send" }, tr("Validé en interne · envoyé au client"))}
                  >
                    {tr("Envoyer au client")}
                  </HoldButton>
                ) : (
                  <button
                    className="btn primary"
                    disabled={busy || (!task.deliverable && !internalWork)}
                    onClick={() => act({ action: "internal-review", taskId: task.id, revision: task.revision, decision: "send" },
                      nextStep ? tr("Validé · passe à « {step} »", { step: tr(statusLabel(nextStep, process)) }) : tr("Validé en interne"))}
                  >
                    <Send size={15} />{nextStep ? tr("Valider · passer à « {step} »", { step: tr(statusLabel(nextStep, process)) }) : tr("Valider")}
                  </button>
                )}
              </>
            )}
            {b === "client" && roles.can("send") && !archived(task) && (
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
            {tr("Verrou J−{n} levé", { n: rulesOf(process).lockDays })}
          </span>
        )}
        {archived(task) && (
          <span className="small-note">
            {tr(
              "Archivée · restaurez les éléments parents avant de reprendre le travail.",
            )}
          </span>
        )}
        {task.internalReview && b !== "internal" && b !== "client" && b !== "done" && (
          <span className="small-note internal-note" dir="auto">
            <PenLine size={12} />{" "}
            {tr("Retour interne de {by} ({date}) : {note}", { by: task.internalReview.by, date: timeLabel(task.internalReview.at), note: task.internalReview.note })}
          </span>
        )}
      </div>
      <StatusCard task={task} process={process} decider={passes} timeLabel={timeLabel} />
      <TaskTimeline task={task} process={process} today={today} dateLabel={dateLabel} />
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
          {b === "done" && !task.publishedAt && (
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
                {b === "client" && roles.can("send") && (
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
                    .filter((st) => st.id === task.status || fitsTask(st, task))
                    .filter((st) => manager
                      || (member ? ["todo", "work", "paused", "internal"].includes(st.behaviour) || st.id === task.status
                        : st.behaviour !== "done" && (st.behaviour !== "client" || st.id === task.status)))
                    .map((st) => ({ value: st.id, label: tr(st.label) }))}
                />
              </dd>
            </div>
            {!!studio.workTypes?.length && (
              <div><dt>{tr("Type de travail")}</dt><dd>{workTypeOf(studio, task.workType)?.label ?? "—"}</dd></div>
            )}
            {/* The studio's own fields for this work type (lib/process.ts FieldDef). */}
            {fieldsFor(studio, task).map((def) => {
              const raw = task.fields?.[def.id];
              const unit = def.unit ? ` ${def.unit}` : "";
              const shown = raw === undefined || raw === "" ? "—"
                : def.type === "person" ? data.members.find((m) => m.userId === raw)?.name || String(raw)
                : def.type === "date" ? dateLabel(String(raw))
                : def.type === "money" ? `${Number(raw).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${unit}`
                : def.type === "number" ? `${Number(raw).toLocaleString()}${unit}`
                : def.type === "platform" ? tr(String(raw))
                : String(raw);
              const href = def.type === "link" && typeof raw === "string" ? safeLink(raw) : undefined;
              return (
                <div key={def.id}>
                  <dt>{def.label}</dt>
                  <dd dir="auto">{href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-link">{tr("Ouvrir")}<ArrowUpRight size={14} /></a> : shown}</dd>
                </div>
              );
            })}
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
 * left before tacit approval, as a ring), or the studio's decision while it is in internal review; once
 * validated, the seal and who signed.
 */
function StatusCard({ task, process, decider, timeLabel }: { task: RecordItem; process: Process; decider: boolean; timeLabel: (timestamp?: string) => string }) {
  const { t: tr } = useI18n();
  const b = behaviourOf(task.status, process);
  // Validated while this page is open: the seal strikes once; a task opened already done shows it still.
  const [seen, setSeen] = useState({ id: task.id, b });
  const [struck, setStruck] = useState<string | null>(null);
  if (seen.id !== task.id || seen.b !== b) {
    setSeen({ id: task.id, b });
    setStruck(seen.id === task.id && b === "done" ? task.id : null);
  }
  const fresh = b === "done" && struck === task.id;
  if (b === "done" && task.signOff) {
    const s = task.signOff;
    return (
      <div className={`task-status-card done${fresh ? " is-fresh" : ""}`} role="status">
        <Stamp play={fresh} size={44} />
        <div className="task-status-body">
          <strong>{tr("Validé")}</strong>
          <small>{s.mode === "silence" ? tr("Validation tacite · {when}", { when: timeLabel(s.at) })
            : tr(s.mode === "studio" ? "Accord enregistré par le studio · {by} · {when}" : "Validé par le client · {by} · {when}", { by: s.by, when: timeLabel(s.at) })}</small>
        </div>
      </div>
    );
  }
  if (b === "internal") {
    // A check in a chain shows its own name (« Relecture DA »); the built-in one reads as before.
    const step = statusLabel(task.status, process);
    return (
      <div className={`task-status-card internal${decider ? " has-beam" : ""}`} role="status">
        {decider && <BorderBeam />}
        <ShieldCheck size={18} aria-hidden="true" />
        <div className="task-status-body">
          <strong>{tr(decider ? "Votre décision" : "En validation interne")}{step && step !== "Validation interne" ? ` · ${step}` : ""}</strong>
          <small>{tr(task.clientId === "internal"
            ? decider ? "Tâche interne : aucun client ne la voit, votre validation la termine." : "En validation interne · le propriétaire ou un administrateur la valide"
            : decider ? "Le client ne voit rien tant que vous ne l’envoyez pas." : "Le propriétaire ou un administrateur l’enverra au client.")}</small>
        </div>
      </div>
    );
  }
  if (b !== "client" || !task.approvalDueAt) return null;
  const now = appNow();
  const left = Math.max(0, hoursLeft(task, now) ?? 0);
  const rounds = revisionState(task);
  return (
    <div className={`task-status-card client${left <= 6 ? " urgent" : ""}`} role="status">
      <ClockRing task={task} now={now} size={46}><Clock size={16} /></ClockRing>
      <div className="task-status-body">
        <strong>{tr("Chez le client")}</strong>
        <small>{tr("Envoyé le {since} · tour {used} sur {included}", { since: timeLabel(task.sentAt), used: rounds.used, included: rounds.included })}</small>
      </div>
      <div className="task-status-left">
        <b>{formatDuration(left * 3_600_000)}</b>
        <small>{tr("avant validation tacite · {due}", { due: timeLabel(task.approvalDueAt) })}</small>
      </div>
    </div>
  );
}

/**
 * The task's road in one line: the steps of its own path (its work type, lib/process.ts), each milestone
 * under the step it belongs to (brief at the first step, sent at the client's, validated at the end), with
 * the studio's own offsets once it has a publication date.
 */
function TaskTimeline({ task, process, today, dateLabel }: { task: RecordItem; process: Process; today: string; dateLabel: (day?: string) => string }) {
  const { t: tr } = useI18n();
  const gates = Object.fromEntries(gatesFor(task, today, process).map((g) => [g.key, g]));
  const rules = rulesOf(process);
  const publishable = isPublishable(task);
  const b = behaviourOf(task.status, process);
  const ids = stepIds(process, task);
  const gateAt: Record<string, string | undefined> = { [firstOf(process, "todo") ?? ""]: "brief", [firstOf(process, "client") ?? ""]: "send", [firstOf(process, "done") ?? ""]: "validation" };
  const steps: { key: string; label: string; gate?: string; deadline?: string }[] = [
    ...ids.map((id) => ({ key: id, label: statusLabel(id, process), gate: gateAt[id] })),
    ...(publishable ? [{ key: "published", label: "Publié", deadline: task.due }] : []),
  ];
  const paused = b === "paused";
  const current = task.publishedAt ? steps.length - 1 : ids.indexOf(paused ? workStatus(process) : task.status ?? startStatus(process));
  const done = (i: number) => i < current || (i === current && (!!task.publishedAt || (b === "done" && !publishable)));
  // On a phone the line scrolls sideways: open it on the current step, not on the first one.
  const line = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = line.current;
    if (list && list.scrollWidth > list.clientWidth) list.querySelector("li.current")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [current]);
  // The ring around the current step walks to the next stone when the task moves on, and the stretch of
  // road just covered fills in (styles/moments.css).
  return (
    <MotionConfig reducedMotion="user">
    <ol ref={line} className="task-timeline" aria-label={tr("Étapes de la tâche")}>
      {steps.map((step, i) => {
        const gate = step.gate ? gates[step.gate] : undefined;
        const offset = gate ? rules.gates[gate.key as keyof typeof rules.gates] : 0;
        const state = done(i) ? "done" : i === current ? "current" : "todo";
        return (
          <li key={step.key} className={state} aria-current={state === "current" ? "step" : undefined}>
            <span className="task-timeline-dot" aria-hidden="true">{state === "done" ? <Check size={13} strokeWidth={2.5} /> : null}</span>
            {i === current && <motion.span className="task-timeline-walker" layoutId={`walker-${task.id}`} transition={spring.walk} aria-hidden="true" />}
            <strong>{tr(step.label)}</strong>
            {gate ? (
              <small className={gate.reached ? "met" : gate.late ? "late" : undefined}>
                J−{offset} · {dateLabel(gate.day)}{gate.late ? ` · ${tr("en retard")}` : ""}
              </small>
            ) : step.deadline ? (
              <small className={insideLock(task.due, today, rules.lockDays) && !task.sentAt ? "late" : undefined}>J · {dateLabel(step.deadline)}</small>
            ) : paused && step.key === workStatus(process) ? (
              <small>{tr("En pause")}</small>
            ) : null}
          </li>
        );
      })}
    </ol>
    </MotionConfig>
  );
}

"use client";
// The studio's home: the greeting, the person's priorities, what waits for the client, time logged,
// alerts and requests to handle, and the clients; for members also the studio's numbers and charts
// (managers see those on the Tableau de bord).
import { Blank } from "@/components/empty-state";
import Avatar from "@/components/profile-avatar";
import { Surface } from "@/components/ui/surface";
import ClientMark from "@/features/clients/client-mark";
import type { Slice } from "@/features/dashboard/dashboard-charts";
import { Chip, CourtChip } from "@/features/tasks/task-controls";
import { flow, clientWork, dayIn, isEventRecipient, isEventUnreadFor, shiftDay } from "@/lib/flow";
import { useI18n } from "@/lib/i18n/locale-provider";
import { RecordItem } from "@/lib/model";
import { behaviourOf, chartColorOf, firstOf, isDone, rulesOf, workStatus } from "@/lib/process";
import { useProcess } from "@/features/workspace/process-context";
import { appNow, formatTimestamp } from "@/lib/time";
import { CheckSquare, Plus, ChevronRight, ArrowUpRight, CalendarDays, FileText, Folder, Clock, Lock, UserRound, Send, CheckCircle2, Gauge, Inbox, Bell, Building2, MessageSquare, type LucideIcon } from "lucide-react";
import dynamic from "next/dynamic";
import type { ScreenProps } from "@/features/workspace/screen-props";
import type { TaskListView } from "@/features/tasks/use-task-list-view";
const TimeRecords = dynamic(() => import("@/features/tasks/time-records"));
const DonutStat = dynamic(() => import("@/features/dashboard/dashboard-charts").then((m) => m.DonutStat));
const TrendArea = dynamic(() => import("@/features/dashboard/dashboard-charts").then((m) => m.TrendArea));

/** The list controls the home page uses: a metric opens the task list already filtered. */
type HomeListControls = Pick<TaskListView, "setQuick" | "setStatusFilter">;

function TaskRows({ items, compact = false, data, lookups, actions }: { items: RecordItem[]; compact?: boolean } & Pick<ScreenProps, "data" | "lookups" | "actions">) {
  const { t: tr } = useI18n();
  const process = useProcess();
  const { today } = data;
  const { cname, pname, avatarOf, dateLabel } = lookups;
  const { navigate } = actions;
  return items.length ? (
    <div className="task-rows">
      {items.map((t) => (
        <button
          className="task-line"
          key={t.id}
          onClick={() => navigate({ page: "task", id: t.id })}
        >
          <span className="task-line-icon">
            <FileText size={16} />
          </span>
          <span className="task-line-name">
            <strong>{t.name}</strong>
            <small>
              {cname(t.clientId)}
              {!compact && ` / ${pname(t.projectId)}`}
            </small>
          </span>
          <Chip status={t.status} />
          <CourtChip task={t} />
          <span className="task-line-assignee">
            <Avatar name={t.assignee} avatar={avatarOf(t.assignee)} />
          </span>
          <span
            className={`due ${t.due && t.due < today && !isDone(t.status, process) ? "overdue" : ""}`}
          >
            {dateLabel(t.due)}
          </span>
          <ChevronRight size={15} />
        </button>
      ))}
    </div>
  ) : (
    <Blank
      title={tr("Tout est à jour")}
      text={tr("Aucune tâche dans cette sélection.")}
    />
  );
}

// The studio's numbers: on the Tableau de bord for those who have it, on the home page for the others.
export function StudioMetrics({ data, actions, list }: Pick<ScreenProps, "data" | "actions"> & { list: HomeListControls }) {
  const { t: tr } = useI18n();
  const { today } = data;
  const tasks = clientWork(data.tasks); // the cards open the client tasks; the agency's own have their page
  const { navigate } = actions;
  const { setStatusFilter, setQuick } = list;
  const process = useProcess();
  const reviewTasks = tasks.filter((t) => behaviourOf(t.status, process) === "client"),
    late = tasks.filter((t) => t.due && t.due < today && !isDone(t.status, process));
  const active = tasks.filter((t) => !isDone(t.status, process)),
    completed = tasks.filter((t) => isDone(t.status, process));
  return (
      <div className="metric-grid">
        {(
          [
            [
              "Tâches actives",
              active.length,
              CheckSquare,
              "À faire et en cours de livraison",
            ],
            [
              "À valider",
              reviewTasks.length,
              Send,
              "Dans la file de validation",
            ],
            ["En retard", late.length, Clock, "À traiter en priorité"],
            [
              "Tâches validées",
              completed.length,
              CheckCircle2,
              "Livrables approuvés",
            ],
          ] as [string, number, LucideIcon, string][]
        ).map(([label, value, Icon, detail], index) => (
          <Surface asChild tone={index === 0 ? "gold" : "default"} key={label}><button className={`metric-card${index === 0 ? " gold" : ""}`} onClick={() => { navigate({ page: "tasks" }); if (index === 1) setQuick("review"); else if (index === 2) setQuick("late"); else if (index === 3) setStatusFilter(firstOf(process, "done") ?? ""); else setQuick("active"); }}>
            <div className="metric-label">
              <span>{tr(label)}</span>
              <span className="metric-icon">
                <Icon size={18} />
              </span>
            </div>
            <strong>{String(value).padStart(2, "0")}</strong>
            <small>{tr(detail)}</small>
          </button></Surface>
        ))}
      </div>
  );
}

export function StudioCharts({ data, lookups }: Pick<ScreenProps, "data" | "lookups">) {
  const { t: tr } = useI18n();
  const { records, today } = data;
  const tasks = clientWork(data.tasks);
  const { dateLabel } = lookups;
  const process = useProcess();
  if (!records.length) return null;
  return (() => {
          const statusSlices: Slice[] = process.statuses.map((s) => ({
            key: s.id,
            label: tr(s.label),
            value: tasks.filter((t) => t.status === s.id).length,
            color: chartColorOf(s.color),
          }));
          const weeks = Array.from({ length: 8 }, (_, i) =>
            shiftDay(today, -7 * (7 - i)),
          );
          const weeklyTrend = weeks.map((weekStart) => {
            const weekEnd = shiftDay(weekStart, 6);
            return {
              x: weekStart,
              y: tasks.filter(
                (t) =>
                  t.validatedAt &&
                  dayIn(new Date(t.validatedAt)) >= weekStart &&
                  dayIn(new Date(t.validatedAt)) <= weekEnd,
              ).length,
              label: `${dateLabel(weekStart)} – ${dateLabel(weekEnd)}`,
            };
          });
          return (
            <div className="chart-row">
              <Surface asChild tone="default"><section className="work-panel">
                <div className="section-head">
                  <div>
                    <h2>{tr("Répartition des tâches")}</h2>
                    <p>{tr("Les tâches clients, par statut.")}</p>
                  </div>
                </div>
                <div className="flow-panel-body">
                  <DonutStat data={statusSlices} centerLabel={tr("Tâches")} />
                </div>
              </section></Surface>
              <Surface asChild tone="default"><section className="work-panel">
                <div className="section-head">
                  <div>
                    <h2>{tr("Validations")}</h2>
                    <p>{tr("Tâches validées, semaine par semaine.")}</p>
                  </div>
                </div>
                <div className="flow-panel-body">
                  <TrendArea
                    data={weeklyTrend}
                    color="var(--t-chart-done)"
                    height={182}
                    xTickFormatter={dateLabel}
                  />
                </div>
              </section></Surface>
            </div>
          );
        })();
}

export function HomePage({ data, roles, lookups, actions, list }: ScreenProps & { list: HomeListControls }) {
  const { t: tr, tag } = useI18n();
  const { records, clients, tasks, allTasks, members, user, workspace } = data;
  const { owner, manager, member } = roles;
  const { cname, dateLabel, timeLabel } = lookups;
  const { navigate, open, update, mutate } = actions;
  const { setStatusFilter } = list;
  const process = useProcess();
  const reviewTasks = tasks.filter((t) => behaviourOf(t.status, process) === "client");
  const active = tasks.filter((t) => !isDone(t.status, process)),
    mine = active
      .slice()
      .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  const
    // The whole name, not its first word: an account named after the studio ("The One Core")
    // would otherwise be greeted as "Bonjour, The".
    greetingName =
      user.name.includes("@") || user.name === workspace?.name ? "" : user.name;
  return (
    <div className="dashboard">
      <Surface asChild tone="gold"><div className="dashboard-heading">
        <div>
          <div className="eyebrow">{tr("Votre espace de travail")}</div>
          <h1>
            {greetingName
              ? tr("Bonjour, {name}", { name: greetingName })
              : tr("Bonjour")}
            <span className="greeting-dot">.</span>
          </h1>
          <p>
            {tr(
              member
                ? "Les tâches qui vous sont assignées et celles à prendre."
                : "Ce qui vous attend aujourd’hui : vos tâches, les validations et les alertes.",
            )}
          </p>
        </div>
        <div className="dashboard-actions">
          <span className="date-tag">
            <CalendarDays size={15} />
            {formatTimestamp(appNow(), tag, {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </span>
          {roles.can("tasks.create") && (
            <button className="btn primary" onClick={() => open("task")}>
              <Plus size={17} />
              {tr("Nouvelle tâche")}
            </button>
          )}
        </div>
      </div></Surface>
      {!manager && <StudioMetrics data={data} actions={actions} list={list} />}
      {!records.length ? (
        <div className="onboarding-grid">
          <Surface asChild tone="default"><section className="onboarding-card">
            <span className="onboarding-icon">
              <Folder size={28} />
            </span>
            <div className="eyebrow">{tr("Un nouveau départ")}</div>
            <h2>
              {tr("Faites de la place")}
              <br />
              {tr("à votre prochain projet.")}
            </h2>
            <p>
              {tr(
                "Un client, un brief, une équipe. Tout commence par votre première mission.",
              )}
            </p>
            <div className="inline">
              {owner && (
                <button
                  className="btn primary"
                  onClick={() => open("client")}
                >
                  <Plus size={16} />
                  {tr("Ajouter mon premier client")}
                </button>
              )}
            </div>
          </section></Surface>
          <Surface asChild tone="default"><section className="setup-card">
            <div className="section-head">
              <h2>{tr("Votre studio, organisé.")}</h2>
              <span className="neutral-badge">{tr("3 étapes")}</span>
            </div>
            {[
              [
                "01",
                "Ajoutez vos clients",
                "Le brief et les informations au même endroit.",
              ],
              [
                "02",
                "Structurez vos missions",
                "Un sous-projet pour chaque objectif.",
              ],
              [
                "03",
                "Faites avancer le travail",
                "De la première idée à la validation.",
              ],
            ].map(([n, title, text]) => (
              <div className="setup-step" key={n}>
                <span>{n}</span>
                <div>
                  <strong>{tr(title)}</strong>
                  <p>{tr(text)}</p>
                </div>
              </div>
            ))}
            <div className="setup-footer">
              <Lock size={14} />
              {tr("Votre espace est privé et prêt à accueillir vos projets.")}
            </div>
          </section></Surface>
        </div>
      ) : (
        <div className="dashboard-grid">
          <Surface asChild tone="default"><section className="work-panel">
            <div className="section-head">
              <div>
                <h2>
                  {tr("Vos priorités")}
                  <span className="neutral-badge">{active.length}</span>
                </h2>
                <p>{tr("Les prochaines tâches à faire avancer.")}</p>
              </div>
              <button
                className="btn"
                onClick={() => navigate({ page: "tasks" })}
              >
                {tr("Tout voir")}
                <ArrowUpRight size={14} />
              </button>
            </div>
            <TaskRows items={mine.slice(0, 6)} compact data={data} lookups={lookups} actions={actions} />
          </section></Surface>
          <Surface asChild tone="default"><section className="review-panel">
            <div className="section-head">
              <div>
                <h2>{tr("À valider")}</h2>
                <p>{tr("La prochaine étape est chez le client.")}</p>
              </div>
              <span className="review-count">{reviewTasks.length}</span>
            </div>
            {reviewTasks.length ? (
              <div className="approval-list">
                {reviewTasks.slice(0, 3).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => navigate({ page: "task", id: t.id })}
                  >
                    <span className="approval-icon">
                      <FileText size={19} />
                    </span>
                    <span>
                      <small>{cname(t.clientId)}</small>
                      <strong>{t.name}</strong>
                      <span className="approval-date">
                        <Clock size={12} />
                        {dateLabel(t.due)}
                      </span>
                    </span>
                    <ArrowUpRight size={15} />
                  </button>
                ))}
              </div>
            ) : (
              <Blank
                title={tr("Tout est à jour")}
                text={tr("Aucun livrable en attente de validation.")}
              />
            )}
            <button
              className="review-all"
              onClick={() => {
                navigate({ page: "tasks" });
                setStatusFilter(firstOf(process, "client") ?? "");
              }}
            >
              {tr("Voir la file de validation")}
              <ChevronRight size={16} />
            </button>
          </section></Surface>
        </div>
      )}
      {!!records.length && (
        <TimeRecords
          tasks={allTasks}
          members={members}
          userId={user.id}
          scope={member ? "own" : "team"}
          clientName={cname}
          onOpenTask={(id) => navigate({ page: "task", id })}
          onPause={
            workspace?.role !== "viewer"
              ? (t) => void update(t, { status: firstOf(process, "paused") ?? workStatus(process) })
              : undefined
          }
        />
      )}
      {!manager && <StudioCharts data={data} lookups={lookups} />}
      {(() => {
        const alerts = records
          .filter(
            (r) =>
              r.kind === "event" &&
              r.audience !== "client" &&
              (!r.recipients || isEventRecipient(r, user.id)) &&
              isEventUnreadFor(r, user.id),
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        // Requests waiting in the inbox (managers decide), and older ones that went straight to a task.
        const requests = [
          ...(manager ? records.filter((r) => r.kind === "request" && (r.requestStatus ?? "new") === "new") : []),
          ...tasks.filter((t) => t.request && behaviourOf(t.status, process) === "todo"),
        ];
        return alerts.length || requests.length ? (
          <section className="alerts-panel">
            <div className="section-head">
              <div>
                <h2>
                  {tr("À traiter")}
                  <span className="neutral-badge">
                    {alerts.length + requests.length}
                  </span>
                </h2>
                <p>
                  {tr("Horloges, verrou J−{n}, demandes clients.", {
                    n: rulesOf(process).lockDays,
                  })}
                </p>
              </div>
              {manager && (
                <button
                  className="btn"
                  onClick={() => navigate({ page: "flow" })}
                >
                  <Gauge size={14} />
                  {tr("Tableau de bord")}
                </button>
              )}
            </div>
            <div className="alerts-list">
              {requests.slice(0, 3).map((t) => (
                <button
                  key={t.id}
                  onClick={() => navigate(t.kind === "request" ? { page: "requests" } : { page: "task", id: t.id })}
                >
                  <span className="flow-event-icon">
                    <Inbox size={15} />
                  </span>
                  <span>
                    <small>
                      {tr("Demande · {client}", {
                        client: cname(t.clientId),
                      })}
                    </small>
                    <strong>
                      {t.name}
                      {t.due
                        ? tr(" · pour le {date}", { date: dateLabel(t.due) })
                        : ""}
                    </strong>
                  </span>
                  <ChevronRight size={15} />
                </button>
              ))}
              {alerts.slice(0, 5).map((e) => (
                <button
                  key={e.id}
                  onClick={() => {
                    if (e.taskId) navigate({ page: "task", id: e.taskId });
                    else if (e.requestId) navigate({ page: "requests" });
                    void mutate({ action: "mark-read", ids: [e.id] }).catch(
                      () => {},
                    );
                  }}
                >
                  <span className={`flow-event-icon ${e.type}`}>
                    {e.type === "lock" ? (
                      <Lock size={15} />
                    ) : e.type === "reminder" ? (
                      <Bell size={15} />
                    ) : e.type === "auto-approved" ? (
                      <CheckCircle2 size={15} />
                    ) : e.type === "client-added" ? (
                      <Building2 size={15} />
                    ) : e.type === "task-assigned" ? (
                      <UserRound size={15} />
                    ) : e.type === "comment" ? (
                      <MessageSquare size={15} />
                    ) : (
                      <Clock size={15} />
                    )}
                  </span>
                  <span>
                    <small>
                      {tr(
                        e.type === "auto-approved"
                          ? "Validation tacite"
                          : e.type === "reminder"
                            ? "Rappel"
                            : e.type === "sweep"
                              ? "Balayage J−1"
                              : e.type === "lock"
                                ? "Verrou J−7"
                                : e.type === "request"
                                  ? "Demande"
                                  : e.type === "client-added"
                                    ? "Nouveau client"
                                    : e.type === "task-assigned"
                                      ? "Assignation"
                                      : e.type === "comment"
                                        ? "Commentaire"
                                        : "Décision",
                      )}{" "}
                      · {timeLabel(e.createdAt)}
                    </small>
                    <strong>{e.name}</strong>
                  </span>
                  <ChevronRight size={15} />
                </button>
              ))}
            </div>
          </section>
        ) : null;
      })()}
      {!!records.length && (
        <section className="client-overview">
          <div className="section-head">
            <div>
              <h2>
                {tr("Vos clients")}
                <span className="neutral-badge">
                  {clients.filter((c) => !c.archived).length}
                </span>
              </h2>
              <p>{tr("Des relations qui font avancer le studio.")}</p>
            </div>
            <button
              className="text-link"
              onClick={() => navigate({ page: "clients" })}
            >
              {tr("Tous les clients")}
              <ArrowUpRight size={15} />
            </button>
          </div>
          <div className="client-strip">
            {clients
              .filter((c) => !c.archived)
              .slice(0, 4)
              .map((c) => (
                <button
                  key={c.id}
                  onClick={() => navigate({ page: "client", id: c.id })}
                >
                  <ClientMark name={c.name} logo={c.logo} />
                  <span>
                    <strong>{c.name}</strong>
                    <small>
                      {tr("{n} tâches actives", {
                        n: tasks.filter((t) => t.clientId === c.id).length,
                      })}
                    </small>
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}

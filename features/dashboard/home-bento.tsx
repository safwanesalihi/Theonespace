"use client";
// The top of the home page (Nuage d'or): one priority, marked with the gold seal — what waits for the
// clients' decision — two figures that open the task list already filtered (never the one the sentence
// already says), what to do next and the week compared with the last. Styles in home-bento.css.
import type { ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Clock, FileText } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Seal } from "@/components/ui/seal";
import { clientWork, shiftDay } from "@/lib/flow";
import { behaviourOf, firstOf, isDone } from "@/lib/process";
import { useProcess } from "@/features/workspace/process-context";
import { useI18n } from "@/lib/i18n/locale-provider";
import { formatTimestamp } from "@/lib/time";
import type { ScreenProps } from "@/features/workspace/screen-props";
import type { TaskListView } from "@/features/tasks/use-task-list-view";

type Props = Pick<ScreenProps, "data" | "lookups" | "actions"> & {
  list: Pick<TaskListView, "setQuick" | "setStatusFilter">;
  priorities: ReactNode;
  prioritiesCount: number;
  /** Owner or administrator: their own decisions come first. */
  manager: boolean;
};

/** The sentence with its number marked by a stroke of gold under it (the number is found in the translated text). */
function MarkedNumber({ text, n }: { text: string; n: number }) {
  const at = text.indexOf(String(n));
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<mark className="gold-mark">{n}</mark>{text.slice(at + String(n).length)}</>;
}

export function HomeBento({ data, lookups, actions, list, priorities, prioritiesCount, manager }: Props) {
  const { t: tr, tag } = useI18n();
  // Client work only: the agency's own tasks have their page (lib/flow.ts clientWork).
  const tasks = clientWork(data.tasks);
  const { today } = data;
  const { cname, dateLabel } = lookups;
  const { navigate } = actions;
  const { setQuick, setStatusFilter } = list;

  // The studio's own steps (lib/process.ts): what waits for the client, what is finished.
  const process = useProcess();
  const clientStep = firstOf(process, "client") ?? "", doneStep = firstOf(process, "done") ?? "";
  const review = tasks.filter((t) => behaviourOf(t.status, process) === "client");
  const late = tasks.filter((t) => t.due && t.due < today && !isDone(t.status, process));
  // Only what slipped by more than three days raises its voice; a day or two late is ordinary follow-up.
  const longLate = late.filter((t) => t.due! < shiftDay(today, -3));
  const month = today.slice(0, 7);
  const validatedThisMonth = tasks.filter((t) => t.validatedAt?.slice(0, 7) === month);
  const openTasks = (apply: () => void) => { navigate({ page: "tasks" }); apply(); };

  const days = Array.from({ length: 7 }, (_, i) => shiftDay(today, i - 6));
  const perDay = days.map((day) => tasks.filter((t) => t.validatedAt?.slice(0, 10) === day).length);
  const peak = Math.max(1, ...perDay);
  const weekTotal = perDay.reduce((a, b) => a + b, 0);
  // The week answers one question: are we validating more or less than last week?
  const lastWeek = days.map((day) => shiftDay(day, -7)).reduce((n, day) => n + tasks.filter((t) => t.validatedAt?.slice(0, 10) === day).length, 0);
  const trend = weekTotal === lastWeek ? tr("Autant que la semaine dernière.")
    : weekTotal > lastWeek ? tr("{n} de plus que la semaine dernière.", { n: weekTotal - lastWeek })
    : tr("{n} de moins que la semaine dernière.", { n: lastWeek - weekTotal });

  // The priority is the decision the line under the greeting names (UX study, rule 2): first the work to
  // review in-house, then the new requests, and only then what waits for the clients.
  const toCheck = manager ? data.tasks.filter((t) => behaviourOf(t.status, process) === "internal")
    .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999")) : [];
  const newRequests = manager ? data.records.filter((r) => r.kind === "request" && (r.requestStatus ?? "new") === "new").length : 0;
  const front = toCheck.length ? {
    n: toCheck.length, items: toCheck,
    sentence: toCheck.length === 1 ? tr("1 contenu attend votre relecture.") : tr("{n} contenus attendent votre relecture.", { n: toCheck.length }),
    action: tr("Relire le premier"), go: () => navigate({ page: "task", id: toCheck[0].id }),
  } : newRequests ? {
    n: newRequests, items: [],
    sentence: newRequests === 1 ? tr("1 nouvelle demande attend votre réponse.") : tr("{n} nouvelles demandes attendent votre réponse.", { n: newRequests }),
    action: tr("Voir les demandes"), go: () => navigate({ page: "requests" }),
  } : review.length ? {
    n: review.length, items: review,
    sentence: review.length === 1 ? tr("1 contenu attend la décision d’un client.") : tr("{n} contenus attendent la décision de vos clients.", { n: review.length }),
    action: tr("Ouvrir les validations"), go: () => openTasks(() => setStatusFilter(clientStep)),
  } : null;
  const frontClients = front ? [...new Set(front.items.map((t) => t.clientId))] : [];

  return (
    <div className="home-bento">
      <Surface asChild tone="default"><section className="home-hero" aria-labelledby="home-hero-title">
        <div className="home-hero-text">
          <div className="home-hero-eyebrow"><Seal /><span className="silver-shine">{tr("Votre priorité aujourd’hui")}</span></div>
          <h2 id="home-hero-title">
            {front ? <MarkedNumber text={front.sentence} n={front.n} /> : tr("Rien n’attend vos clients. Tout avance.")}
          </h2>
          {frontClients.length > 0 && (
            <div className="home-hero-clients">
              {frontClients.slice(0, 3).map((id) => (
                <span key={id}>{cname(id)} · {front!.items.filter((t) => t.clientId === id).length}</span>
              ))}
            </div>
          )}
          <div className="home-hero-actions">
            <span className="star-border">
              <button className="btn primary" onClick={front ? front.go : () => navigate({ page: "tasks" })}>
                {front ? front.action : tr("Voir les tâches")}
                <ArrowRight size={16} />
              </button>
            </span>
          </div>
        </div>
        {front && front.items.length > 0 && (
          <div className="home-fan" aria-hidden="true">
            {front.items.slice(0, 3).map((t, i) => (
              <span key={t.id} className={`home-fan-card home-fan-${i}`}>
                <FileText size={18} />
                <strong>{t.name}</strong>
                <small>{cname(t.clientId)}</small>
              </span>
            ))}
          </div>
        )}
      </section></Surface>

      <div className="home-figures">
        {([
          // « À valider » is the sentence on the left: not repeated here.
          ["À relancer", late.length, longLate.length ? tr("dont {n} depuis plus de 3 jours", { n: longLate.length }) : tr("échéance passée"), longLate.length > 0, () => setQuick("late")],
          ["Validés ce mois", validatedThisMonth.length, formatTimestamp(new Date(`${today}T12:00:00`), tag, { month: "long" }), false, () => setStatusFilter(doneStep)],
        ] as [string, number, string, boolean, () => void][]).map(([label, value, note, strong, apply]) => (
          <Surface asChild tone="default" key={label}><button className="home-figure" onClick={() => openTasks(apply)}>
            <span>
              <small>{tr(label)}</small>
              <strong><NumberTicker value={value} /></strong>
            </span>
            <em className={strong && value ? "strong" : undefined}>{note}</em>
          </button></Surface>
        ))}
      </div>

      <Surface asChild tone="default"><section className="home-priorities" aria-labelledby="home-priorities-title">
        <header>
          <h2 id="home-priorities-title">{tr("À faire ensuite")}</h2>
          <button className="text-link" onClick={() => navigate({ page: "tasks" })}>{tr("Toutes vos tâches ({n})", { n: prioritiesCount })}<ArrowUpRight size={14} /></button>
        </header>
        {priorities}
      </section></Surface>

      <Surface asChild tone="default"><section className="home-week" aria-labelledby="home-week-title">
        <header>
          <h2 id="home-week-title">{tr("Validés cette semaine")}</h2>
          <span>{tr(weekTotal === 1 ? "1 validé" : "{n} validés", { n: weekTotal })}</span>
        </header>
        <div className="home-week-bars">
          {days.map((day, i) => (
            <div key={day} className={`home-week-day${day === today ? " today" : ""}`} title={`${dateLabel(day)} · ${perDay[i]}`}>
              <b>{perDay[i]}</b>
              <span style={{ height: `${Math.max(8, Math.round((perDay[i] / peak) * 100))}%`, animationDelay: `${200 + i * 60}ms` }} />
              <small>{formatTimestamp(new Date(`${day}T12:00:00`), tag, { weekday: "narrow" })}</small>
            </div>
          ))}
        </div>
        <p className="home-week-note"><Clock size={13} />{trend}</p>
      </section></Surface>
    </div>
  );
}

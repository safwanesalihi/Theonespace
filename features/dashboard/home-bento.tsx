"use client";
// The top of the home page (Nuage d'or): one priority, marked with the gold seal — what waits for the
// clients' decision — three figures that open the task list already filtered, the person's next tasks and
// the week's validations. Styles in features/dashboard/home-bento.css.
import type { ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Clock, FileText } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Seal } from "@/components/ui/seal";
import { shiftDay } from "@/lib/flow";
import { useI18n } from "@/lib/i18n/locale-provider";
import { formatTimestamp } from "@/lib/time";
import type { ScreenProps } from "@/features/workspace/screen-props";
import type { TaskListView } from "@/features/tasks/use-task-list-view";

type Props = Pick<ScreenProps, "data" | "lookups" | "actions"> & {
  list: Pick<TaskListView, "setQuick" | "setStatusFilter">;
  priorities: ReactNode;
  prioritiesCount: number;
};

/** The sentence with its number marked by a stroke of gold under it (the number is found in the translated text). */
function MarkedNumber({ text, n }: { text: string; n: number }) {
  const at = text.indexOf(String(n));
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<mark className="gold-mark">{n}</mark>{text.slice(at + String(n).length)}</>;
}

export function HomeBento({ data, lookups, actions, list, priorities, prioritiesCount }: Props) {
  const { t: tr, tag } = useI18n();
  const { tasks, today } = data;
  const { cname, dateLabel } = lookups;
  const { navigate } = actions;
  const { setQuick, setStatusFilter } = list;

  const review = tasks.filter((t) => t.status === "À valider");
  const late = tasks.filter((t) => t.due && t.due < today && t.status !== "Validé");
  const month = today.slice(0, 7);
  const validatedThisMonth = tasks.filter((t) => t.validatedAt?.slice(0, 7) === month);
  const waitingClients = [...new Set(review.map((t) => t.clientId))];
  const openTasks = (apply: () => void) => { navigate({ page: "tasks" }); apply(); };

  const days = Array.from({ length: 7 }, (_, i) => shiftDay(today, i - 6));
  const perDay = days.map((day) => tasks.filter((t) => t.validatedAt?.slice(0, 10) === day).length);
  const peak = Math.max(1, ...perDay);
  const weekTotal = perDay.reduce((a, b) => a + b, 0);

  const sentence = review.length === 1
    ? tr("1 contenu attend la décision d’un client.")
    : tr("{n} contenus attendent la décision de vos clients.", { n: review.length });

  return (
    <div className="home-bento">
      <Surface asChild tone="default"><section className="home-hero" aria-labelledby="home-hero-title">
        <div className="home-hero-text">
          <div className="home-hero-eyebrow"><Seal /><span className="silver-shine">{tr("Votre priorité aujourd’hui")}</span></div>
          <h2 id="home-hero-title">
            {review.length ? <MarkedNumber text={sentence} n={review.length} /> : tr("Rien n’attend vos clients. Tout avance.")}
          </h2>
          {waitingClients.length > 0 && (
            <div className="home-hero-clients">
              {waitingClients.slice(0, 3).map((id) => (
                <span key={id}>{cname(id)} · {review.filter((t) => t.clientId === id).length}</span>
              ))}
            </div>
          )}
          <div className="home-hero-actions">
            <span className="star-border">
              <button className="btn primary" onClick={() => openTasks(() => setStatusFilter("À valider"))}>
                {tr(review.length ? "Ouvrir les validations" : "Voir les tâches")}
                <ArrowRight size={16} />
              </button>
            </span>
            {late.length > 0 && (
              <button className="text-link" onClick={() => openTasks(() => setQuick("late"))}>
                {tr("{n} en retard à relancer", { n: late.length })}
              </button>
            )}
          </div>
        </div>
        {review.length > 0 && (
          <div className="home-fan" aria-hidden="true">
            {review.slice(0, 3).map((t, i) => (
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
          ["À valider", review.length, waitingClients.length ? tr(waitingClients.length === 1 ? "chez 1 client" : "chez {n} clients", { n: waitingClients.length }) : tr("rien en attente"), false, () => setStatusFilter("À valider")],
          ["En retard", late.length, tr("à relancer"), true, () => setQuick("late")],
          ["Validés ce mois", validatedThisMonth.length, formatTimestamp(new Date(`${today}T12:00:00`), tag, { month: "long" }), false, () => setStatusFilter("Validé")],
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
          <h2 id="home-priorities-title">{tr("Vos priorités")}<span className="neutral-badge">{prioritiesCount}</span></h2>
          <button className="text-link" onClick={() => navigate({ page: "tasks" })}>{tr("Tout voir")}<ArrowUpRight size={14} /></button>
        </header>
        {priorities}
      </section></Surface>

      <Surface asChild tone="default"><section className="home-week" aria-labelledby="home-week-title">
        <header>
          <h2 id="home-week-title">{tr("La semaine")}</h2>
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
        <p className="home-week-note"><Clock size={13} />{tr("Contenus validés, jour par jour.")}</p>
      </section></Surface>
    </div>
  );
}

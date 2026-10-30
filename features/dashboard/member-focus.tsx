"use client";
// A member's home answers one question, « sur quoi je travaille maintenant ? » (UX study): the task in hand,
// the few next ones by date, and what they finished today, so a day can end on « c'est fait ». Styles in
// features/dashboard/home-bento.css.
import { ArrowRight, Check, Play } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Chip } from "@/features/tasks/task-controls";
import { useProcess } from "@/features/workspace/process-context";
import { useI18n } from "@/lib/i18n/locale-provider";
import { behaviourOf } from "@/lib/process";
import type { RecordItem } from "@/lib/model";
import type { ScreenProps } from "@/features/workspace/screen-props";

export function MemberFocus({ data, lookups, actions }: Pick<ScreenProps, "data" | "lookups" | "actions">) {
  const { t: tr } = useI18n();
  const process = useProcess();
  const { tasks, user, today } = data;
  const { cname, dueInfo } = lookups;
  const { navigate } = actions;
  const mine = tasks.filter((t) => t.assigneeId === user.id && !t.archived);
  const byDue = (a: RecordItem, b: RecordItem) => (a.due || "9999").localeCompare(b.due || "9999");
  const now = mine.filter((t) => behaviourOf(t.status, process) === "work").sort(byDue)[0];
  const next = mine.filter((t) => t.id !== now?.id && ["todo", "work"].includes(behaviourOf(t.status, process))).sort(byDue).slice(0, 3);
  // Finished today: handed on (to the check, the client) or done, with a step written today.
  const doneToday = mine.filter((t) => ["internal", "client", "done"].includes(behaviourOf(t.status, process))
    && (t.history ?? []).some((h) => h.date?.slice(0, 10) === today));
  const open = (t: RecordItem) => navigate({ page: "task", id: t.id });

  return (
    <div className="member-focus">
      <Surface asChild tone="default"><section className="focus-now" aria-labelledby="focus-now-title">
        <span className="focus-label" id="focus-now-title"><Play size={14} aria-hidden="true" />{tr("Maintenant")}</span>
        {now ? (
          <button type="button" className="focus-now-task" onClick={() => open(now)}>
            <strong>{now.name}</strong>
            <small>{cname(now.clientId)} · {dueInfo(now).label}</small>
            <span className="focus-go">{tr("Continuer")}<ArrowRight size={16} aria-hidden="true" /></span>
          </button>
        ) : (
          <p className="focus-empty">{next.length ? tr("Rien en cours. Commencez par la première tâche ci-dessous.") : tr("Tout est fait pour l’instant.")}</p>
        )}
      </section></Surface>

      <Surface asChild tone="default"><section className="focus-next" aria-labelledby="focus-next-title">
        <h2 className="focus-label" id="focus-next-title">{tr("Ensuite")}</h2>
        {next.length ? (
          <ul>
            {next.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => open(t)}>
                  <span><strong>{t.name}</strong><small>{cname(t.clientId)}</small></span>
                  <em>{dueInfo(t).label}</em>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="focus-empty">{tr("Rien d’autre de prévu.")}</p>}
      </section></Surface>

      <Surface asChild tone="default"><section className="focus-done" aria-labelledby="focus-done-title">
        <h2 className="focus-label" id="focus-done-title"><Check size={14} aria-hidden="true" />{tr("Fait aujourd’hui")}</h2>
        {doneToday.length ? (
          <ul>
            {doneToday.map((t) => (
              <li key={t.id}><button type="button" onClick={() => open(t)}><strong>{t.name}</strong><Chip status={t.status} /></button></li>
            ))}
          </ul>
        ) : <p className="focus-empty">{tr("Ce que vous terminez aujourd’hui s’affichera ici.")}</p>}
      </section></Surface>
    </div>
  );
}

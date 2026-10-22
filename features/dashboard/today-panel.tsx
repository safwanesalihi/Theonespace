"use client";
// « Aujourd'hui » on the home page: the day's meetings and shooting sessions, in time order. Managers see
// every one; the rest of the team sees those they are invited to or on the crew of. Nothing today, no panel.
import { Camera, ChevronRight, Video, Phone } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import type { ScreenProps } from "@/features/workspace/screen-props";
import { useI18n } from "@/lib/i18n/locale-provider";

export function TodayPanel({ data, roles, lookups, actions }: Pick<ScreenProps, "data" | "roles" | "lookups" | "actions">) {
  const { t } = useI18n();
  const { records, today, user } = data;
  const { cname } = lookups;
  const items = records
    .filter((r) => (r.kind === "meeting" || r.kind === "shoot") && r.due === today && !r.cancelledAt)
    .filter((r) => roles.manager || r.authorId === user.id || !!r.attendees?.includes(user.id))
    .sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
  if (!items.length) return null;
  return (
    <Surface asChild tone="default"><section className="today-panel" aria-labelledby="today-title">
      <header>
        <h2 id="today-title">{t("Aujourd’hui")}</h2>
        <span className="neutral-badge">{items.length}</span>
      </header>
      <ul>
        {items.map((item) => {
          const Icon = item.kind === "shoot" ? Camera : item.callMode === "audio" ? Phone : Video;
          const done = !!item.endedAt;
          return (
            <li key={item.id}>
              <button type="button" className={done ? "done" : undefined} onClick={() => actions.navigate({ page: item.kind === "shoot" ? "shoots" : "meetings" })}>
                <time>{item.time}</time>
                <span className="today-icon" aria-hidden="true"><Icon size={15} /></span>
                <span className="today-name">
                  <strong>{item.name}</strong>
                  <small>
                    {[item.kind === "shoot" ? t("Shooting") : t("Réunion"), item.clientId ? cname(item.clientId) : "", item.location ?? "", item.duration ? t("{n} min", { n: item.duration }) : ""].filter(Boolean).join(" · ")}
                  </small>
                </span>
                {done && <span className="today-state">{t("Terminé")}</span>}
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </section></Surface>
  );
}

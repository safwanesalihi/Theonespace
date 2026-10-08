"use client";
import { appNowMs } from "@/lib/time";
// « Activité » — owner only. For each person: online now or last seen, time in and time out, time with
// the app on screen and time actively using it, for a day or the last 7 / 30 days, with every session
// on a 24-hour line. The figures come from the browser beat described in lib/activity.ts.
import { Surface } from "@/components/ui/surface";
import { Fragment, useCallback, useEffect, useState } from "react";
import { Activity, ChevronDown, ChevronLeft, ChevronRight, Clock, Monitor, MousePointerClick, RefreshCw, Users } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Avatar from "@/components/profile-avatar";
import { useI18n } from "@/lib/i18n/locale-provider";
import { activity, activeSeconds, onScreenSeconds, type ActivityDay } from "@/lib/activity-rules";
import { shiftDay } from "@/lib/flow";
import { formatDuration, formatTimestamp } from "@/lib/time";
import { memberName, roleLabels, type WorkspaceMember } from "@/lib/workspace";

type Period = "day" | "7" | "30";
type Report = { days: ActivityDay[]; lastSeen: Record<string, string> };

/** Minutes since midnight, in the studio's time zone (the same clock the days are cut on). */
function minuteOfDay(iso: string) {
  const [hour, minute] = formatTimestamp(iso, 'en-GB', { hour: '2-digit', minute: '2-digit' }).split(':').map(Number);
  return hour * 60 + minute;
}

export default function ActivityPage({ workspaceId, members, today }: { workspaceId: string; members: WorkspaceMember[]; today: string }) {
  const { t, tag, rtl } = useI18n();
  const [period, setPeriod] = useState<Period>("day");
  const [day, setDay] = useState(today);
  const [audience, setAudience] = useState<"team" | "clients">("team");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [now, setNow] = useState(() => appNowMs());

  const from = period === "day" ? day : shiftDay(today, -(Number(period) - 1));
  const to = period === "day" ? day : today;

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/activity?from=${from}&to=${to}`, { headers: { "X-Workspace-Id": workspaceId }, cache: "no-store" });
      const data = (await response.json()) as Report & { error?: string };
      if (!response.ok) throw new Error(data.error || "Chargement impossible.");
      setReport(data);
      setError("");
      setNow(appNowMs());
    } catch (e) {
      setError(t((e as Error).message));
    }
  }, [from, to, workspaceId, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount and whenever the period changes
    void load();
    const timer = window.setInterval(() => void load(), activity.beatSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [load]);

  const people = members.filter((m) => (audience === "clients" ? m.role === "client" : m.role !== "client"));
  const daysOf = (userId: string) => (report?.days ?? []).filter((d) => d.userId === userId && d.sessions.length).sort((a, b) => a.day.localeCompare(b.day));
  const online = (userId: string) => {
    const seen = report?.lastSeen[userId];
    return !!seen && now - Date.parse(seen) < activity.onlineMinutes * 60_000;
  };
  const clock = (iso: string) => formatTimestamp(iso, tag, { hour: "2-digit", minute: "2-digit" });
  const dayLabel = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString(tag, { weekday: "short", day: "numeric", month: "short" });
  const seenLabel = (userId: string) => {
    const seen = report?.lastSeen[userId];
    if (!seen) return t("Jamais");
    const date = new Date(seen);
    return formatTimestamp(date, tag, { day: "numeric", month: "short" }) + " · " + clock(seen);
  };
  const duration = (seconds: number) => (seconds > 0 ? formatDuration(seconds * 1000) : "—");

  const rows = people.map((m) => {
    const days = daysOf(m.userId);
    const screen = days.reduce((sum, d) => sum + onScreenSeconds(d), 0);
    const active = days.reduce((sum, d) => sum + activeSeconds(d), 0);
    const sessions = days.flatMap((d) => d.sessions);
    return { m, days, screen, active, first: sessions[0]?.start, last: sessions.at(-1)?.end };
  }).sort((a, b) => Number(online(b.m.userId)) - Number(online(a.m.userId)) || b.screen - a.screen || memberName(a.m).localeCompare(memberName(b.m)));

  const totals = {
    online: people.filter((m) => online(m.userId)).length,
    screen: rows.reduce((sum, r) => sum + r.screen, 0),
    active: rows.reduce((sum, r) => sum + r.active, 0),
    present: rows.filter((r) => r.days.length).length,
  };

  function Timeline({ d }: { d: ActivityDay }) {
    return (
      <div className="activity-line" aria-hidden="true">
        {[6, 12, 18].map((h) => <span key={h} className="activity-tick" style={{ left: `${(h / 24) * 100}%` }} />)}
        {d.sessions.map((s) => {
          // A session still open at midnight runs to the end of its line.
          const start = minuteOfDay(s.start), clockEnd = minuteOfDay(s.end);
          const end = Math.max(start + 2, clockEnd < start ? 1440 : clockEnd);
          const length = (Date.parse(s.end) - Date.parse(s.start)) / 1000;
          const ratio = length > 0 ? Math.min(1, s.active / length) : 0;
          return <span key={s.start} className="activity-block" style={{ left: `${(start / 1440) * 100}%`, width: `${((end - start) / 1440) * 100}%`, opacity: 0.45 + ratio * 0.55 }} />;
        })}
      </div>
    );
  }

  return (
    <div className="activity-page">
      <div className="page-heading">
        <span className="page-symbol" aria-hidden="true"><Activity size={22} /></span>
        <div className="heading-line">
          <h1>{t("Activité")}</h1>
          <button className="btn" onClick={() => void load()}><RefreshCw size={15} />{t("Actualiser")}</button>
        </div>
        <p>{t("Arrivée, départ et temps passé sur l’application, par personne. Visible par vous seul.")}</p>
      </div>

      <div className="activity-toolbar">
        <Tabs value={period} onValueChange={(v) => { setPeriod(v as Period); setOpen(null); }}>
          <TabsList>
            <TabsTrigger value="day">{t("Jour")}</TabsTrigger>
            <TabsTrigger value="7">{t("7 jours")}</TabsTrigger>
            <TabsTrigger value="30">{t("30 jours")}</TabsTrigger>
          </TabsList>
        </Tabs>
        {period === "day" && (
          <div className="activity-day-nav">
            <button className="icon-button" aria-label={t("Jour précédent")} onClick={() => setDay(shiftDay(day, -1))}>{rtl ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}</button>
            <strong>{day === today ? t("Aujourd’hui") : new Date(`${day}T12:00:00`).toLocaleDateString(tag, { weekday: "long", day: "numeric", month: "long" })}</strong>
            <button className="icon-button" aria-label={t("Jour suivant")} disabled={day >= today} onClick={() => setDay(shiftDay(day, 1))}>{rtl ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}</button>
          </div>
        )}
        <div className="grow" />
        <Tabs value={audience} onValueChange={(v) => { setAudience(v as "team" | "clients"); setOpen(null); }}>
          <TabsList>
            <TabsTrigger value="team">{t("Équipe")}</TabsTrigger>
            <TabsTrigger value="clients">{t("Clients")}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="activity-tiles">
        {([
          [Users, "En ligne maintenant", String(totals.online)],
          [Clock, period === "day" ? "Présents ce jour" : "Présents sur la période", String(totals.present)],
          [Monitor, "Temps à l’écran", duration(totals.screen)],
          [MousePointerClick, "Temps actif", duration(totals.active)],
        ] as const).map(([Icon, label, value]) => (
          <Surface asChild tone="default" key={label}><div className="activity-tile"><span><Icon size={15} />{t(label)}</span><strong>{value}</strong></div></Surface>
        ))}
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      <Surface asChild tone="default"><section className="activity-card">
        <div className="activity-table" role="table">
          <div className="activity-row activity-head" role="row">
            <span role="columnheader">{t("Membre")}</span>
            <span role="columnheader">{t("Statut")}</span>
            {period === "day"
              ? <><span role="columnheader">{t("Arrivée")}</span><span role="columnheader">{t("Départ")}</span></>
              : <><span role="columnheader">{t("Jours présents")}</span><span role="columnheader">{t("Moyenne / jour")}</span></>}
            <span role="columnheader">{t("À l’écran")}</span>
            <span role="columnheader">{t("Actif")}</span>
            <span />
          </div>
          {rows.map(({ m, days, screen, active, first, last }) => {
            const name = memberName(m), isOnline = online(m.userId), expanded = open === m.userId;
            return (
              <Fragment key={m.userId}>
                <button type="button" className={`activity-row ${expanded ? "open" : ""} ${days.length ? "" : "idle"}`} role="row" aria-expanded={days.length ? expanded : undefined} onClick={() => days.length && setOpen(expanded ? null : m.userId)}>
                  <span className="activity-person" role="cell">
                    <Avatar name={name} avatar={m.avatar} />
                    <span><strong>{name}</strong><small>{m.titles?.length ? m.titles.map((x) => t(x)).join(" · ") : t(roleLabels[m.role])}</small></span>
                  </span>
                  <span role="cell">{isOnline ? <span className="activity-online"><i />{t("En ligne")}</span> : <small className="activity-seen">{seenLabel(m.userId)}</small>}</span>
                  {period === "day" ? (
                    <>
                      <span role="cell" data-label={t("Arrivée")}>{first ? clock(first) : "—"}</span>
                      <span role="cell" data-label={t("Départ")}>{last ? (isOnline && day === today ? t("en cours") : clock(last)) : "—"}</span>
                    </>
                  ) : (
                    <>
                      <span role="cell" data-label={t("Jours présents")}>{days.length || "—"}</span>
                      <span role="cell" data-label={t("Moyenne / jour")}>{days.length ? duration(Math.round(screen / days.length)) : "—"}</span>
                    </>
                  )}
                  <span role="cell" data-label={t("À l’écran")}><strong>{duration(screen)}</strong></span>
                  <span role="cell" data-label={t("Actif")}>{duration(active)}</span>
                  <span className="activity-chevron" role="cell">{!!days.length && <ChevronDown size={15} />}</span>
                </button>
                {expanded && (
                  <div className="activity-detail">
                    {[...days].reverse().map((d) => (
                      <div key={d.day} className="activity-day">
                        <div className="activity-day-head">
                          <strong>{dayLabel(d.day)}</strong>
                          <span>{clock(d.sessions[0].start)} → {clock(d.sessions.at(-1)!.end)}</span>
                          <span>{t("À l’écran")} {duration(onScreenSeconds(d))}</span>
                          <span>{t("Actif")} {duration(activeSeconds(d))}</span>
                        </div>
                        <Timeline d={d} />
                        <div className="activity-hours" aria-hidden="true"><span>0 h</span><span>6 h</span><span>12 h</span><span>18 h</span><span>24 h</span></div>
                        <ul className="activity-sessions">
                          {d.sessions.map((s) => (
                            <li key={s.start}>
                              {clock(s.start)} → {clock(s.end)}
                              <small> · {duration((Date.parse(s.end) - Date.parse(s.start)) / 1000)} · {t("actif")} {duration(s.active)}</small>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </Fragment>
            );
          })}
          {!rows.length && <p className="activity-empty">{t(audience === "clients" ? "Aucun accès client." : "Aucun membre.")}</p>}
        </div>
      </section></Surface>
      <p className="activity-note">
        {t("Mesuré quand l’application est ouverte et visible à l’écran. « Actif » : clavier, souris ou écran touché dans les {n} dernières minutes. Une absence de plus de {gap} minutes ferme la session. Historique conservé {days} jours.", { n: activity.idleMinutes, gap: activity.gapMinutes, days: activity.keepDays })}
      </p>
    </div>
  );
}

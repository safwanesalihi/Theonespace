"use client";
// Réunions: the studio plans calls with a client (video, or audio only) and adds the team members it
// wants; « Appel instantané » starts one now. Everyone invited joins from here — the call opens inside
// the app (CallRoom), or in a new tab when the studio pasted a Google Meet / Zoom link. The client sees
// the same meetings in their portal (MeetingsList). Rules: lib/meetings.ts; the call: /api/meetings/join.
import { Surface } from "@/components/ui/surface";
import TimeField from "@/app/time-field";
import { brandLogoClass, brandLogoUrl, useBrand } from "@/app/brand-store";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { DailyCall } from "@daily-co/daily-js";
import { CalendarClock, Clock, ExternalLink, GripVertical, Loader2, Maximize2, Mic, Minimize2, PhoneCall, PhoneOff, Plus, Users, Video, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import DatePicker from "@/app/date-picker";
import { useI18n } from "@/app/locale-provider";
import { dayIn } from "@/lib/flow";
import { canPlanMeetings, meetingDurations, meetingLists, meetingPhase, type CallMode, type MeetingPhase } from "@/lib/meetings";
import type { RecordItem } from "@/lib/model";
import { memberName, type WorkspaceMember, type WorkspaceRole } from "@/lib/workspace";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the records API's reply (lib's payload), read for the new id only
type Mutate = (body: Record<string, unknown>) => Promise<any>;

/** Now, on the studio's clock (Casablanca): the date and the time of an instant call. */
function casablancaNow() {
  const now = new Date();
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Casablanca", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  return { day: dayIn(now), time: time.replace(/^24/, "00") };
}

/** Joining: a personal link into the meeting's room, opened here — or the studio's own link, in a new tab. */
export function useJoin(workspaceId: string | undefined, onError: (message: string) => void) {
  const { t, locale } = useI18n();
  const [joining, setJoining] = useState("");
  async function join(meeting: Pick<RecordItem, "id" | "name" | "link">) {
    if (!workspaceId || joining) return;
    setJoining(meeting.id);
    // A tab opened now, while the click still counts, so a pasted link isn't caught by a pop-up blocker.
    const pending = meeting.link ? window.open("", "_blank") : null;
    try {
      const response = await fetch("/api/meetings/join", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Workspace-Id": workspaceId },
        body: JSON.stringify({ meetingId: meeting.id, locale }),
      });
      const data = (await response.json().catch(() => ({}))) as { provider?: string; url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error || "La réunion n’a pas pu être ouverte. Réessayez.");
      if (data.provider === "link") {
        if (pending) pending.location.href = data.url; else window.open(data.url, "_blank", "noopener");
      } else {
        pending?.close();
        startCall({ url: data.url, title: meeting.name });
      }
    } catch (e) {
      pending?.close();
      onError(t((e as Error).message));
    } finally { setJoining(""); }
  }
  return { join, joining };
}

// ---------- the call in progress, for the whole app ----------
// One call at a time, kept outside any page: it goes on while the person moves around the app,
// full screen or as a small window (CallHost, mounted next to the assistant).
type ActiveCall = { url: string; title: string };
let activeCall: ActiveCall | null = null;
const callListeners = new Set<() => void>();
const setActiveCall = (call: ActiveCall | null) => { activeCall = call; callListeners.forEach((f) => f()); };
export const startCall = (call: ActiveCall) => setActiveCall(call);
const subscribeCall = (f: () => void) => { callListeners.add(f); return () => { callListeners.delete(f); }; };

/** Where the call lives: mounted once per screen, it outlasts page changes. */
export function CallHost() {
  const call = useSyncExternalStore(subscribeCall, () => activeCall, () => null);
  return call ? <CallRoom key={call.url} url={call.url} title={call.title} onLeave={() => setActiveCall(null)} /> : null;
}

// The call in the app's own colours (app/tokens.css): the amber for actions, white panels, the sidebar's
// charcoal behind the videos. Daily draws the call; these are the colours it is asked to use.
const callTheme = {
  colors: {
    accent: "#efb849", accentText: "#251f12",
    background: "#ffffff", backgroundAccent: "#f4f6fa",
    baseText: "#111111", supportiveText: "#58637a", border: "#e2e8f0",
    mainAreaBg: "#1c1e23", mainAreaBgAccent: "#2a2d35", mainAreaText: "#f1f3f6",
  },
};

/** The call: full screen, or a small window to drag anywhere while working in the app. Leaving from
 * Daily's own button closes it too. The call itself (the iframe) stays the same in both, never reloaded. */
function CallRoom({ url, title, onLeave }: { url: string; title: string; onLeave: () => void }) {
  const { t, locale } = useI18n();
  const brand = useBrand();
  const brandLogo = brandLogoUrl(brand);
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<DailyCall | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [mini, setMini] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const leave = useRef(onLeave);
  useEffect(() => { leave.current = onLeave; }, [onLeave]);

  // Full screen holds the page still; the small window lets it scroll and be used.
  useEffect(() => {
    if (mini) return;
    document.documentElement.classList.add("call-open");
    return () => document.documentElement.classList.remove("call-open");
  }, [mini]);

  useEffect(() => {
    let live = true;
    // The personal link carries its token as ?t=…; Daily's library takes the room and the token apart.
    const link = new URL(url);
    const token = link.searchParams.get("t") ?? undefined;
    link.search = "";
    void import("@daily-co/daily-js").then(({ default: Daily }) => {
      if (!live || !box.current) return;
      const call = Daily.createFrame(box.current, {
        iframeStyle: { width: "100%", height: "100%", border: "0", background: "#1c1e23" },
        showLeaveButton: true,
        showFullscreenButton: true,
        theme: callTheme,
        lang: locale === "fr" ? "fr" : locale === "en" ? "en" : "user",
      });
      frame.current = call;
      call.on("left-meeting", () => leave.current());
      call.on("error", () => setStatus("error"));
      call.on("loaded", () => setStatus("ready"));
      void call.join({ url: link.toString(), token }).catch(() => setStatus("error"));
    }).catch(() => setStatus("error"));
    return () => {
      live = false;
      const call = frame.current;
      frame.current = null;
      if (call) void call.leave().catch(() => {}).finally(() => call.destroy());
    };
  }, [url, locale]);

  // The small window stays inside the screen, also when the window is resized.
  const clamp = (x: number, y: number) => {
    const el = windowRef.current;
    const w = el?.offsetWidth ?? 340, h = el?.offsetHeight ?? 240;
    return { x: Math.min(Math.max(8, x), window.innerWidth - w - 8), y: Math.min(Math.max(8, y), window.innerHeight - h - 8) };
  };
  useEffect(() => {
    if (!mini) return;
    const fit = () => setPos((p) => (p ? clamp(p.x, p.y) : p));
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [mini]);
  function minimize() {
    setMini(true);
    // First time: bottom right, above the assistant's button; afterwards where it was left.
    requestAnimationFrame(() => setPos((p) => p ?? clamp(window.innerWidth, window.innerHeight - (windowRef.current?.offsetHeight ?? 240) - (window.innerWidth < 768 ? 164 : 96))));
  }
  function startDrag(e: React.PointerEvent) {
    if (!mini || (e.target as HTMLElement).closest("button")) return;
    const el = windowRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function moveDrag(e: React.PointerEvent) {
    if (!drag.current) return;
    setPos(clamp(e.clientX - drag.current.dx, e.clientY - drag.current.dy));
  }
  function endDrag() { drag.current = null; setDragging(false); }
  const hangUp = () => { const call = frame.current; if (call) void call.leave(); else onLeave(); };

  return (
    <div ref={windowRef} className={`call-room${mini ? " mini" : ""}${dragging ? " dragging" : ""}`} role="dialog" aria-label={title}
      style={mini && pos ? { left: pos.x, top: pos.y } : undefined}>
      <header className="call-room-bar" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
        {!mini && <>
          {brandLogo ? (
            // eslint-disable-next-line @next/next/no-img-element -- the workspace's own uploaded logo
            <span className="brand-logo-box call-room-brand"><img className={brandLogoClass(brand)} src={brandLogo} alt={brand?.name ?? ""} /></span>
          ) : brand?.company ? <strong className="call-room-wordmark">{brand.name}</strong> : (
            // eslint-disable-next-line @next/next/no-img-element -- the brand mark, a static SVG
            <img className="call-room-logo" src="/the-one-core-logo-white.svg" alt="The One Core" />
          )}
          <span className="call-room-divider" aria-hidden="true" />
        </>}
        {mini && <GripVertical size={15} className="call-room-grip" aria-hidden="true" />}
        <div className="call-room-title">
          <strong>{title}</strong>
          <span className="call-room-live"><i />{t("En direct")}</span>
        </div>
        {mini ? (
          <button type="button" className="call-room-icon" onClick={() => setMini(false)} aria-label={t("Agrandir la réunion")} title={t("Agrandir")}><Maximize2 size={15} /></button>
        ) : (
          <button type="button" className="btn call-room-minimize" onClick={minimize} title={t("Continuer à travailler pendant l’appel")}><Minimize2 size={15} />{t("Réduire")}</button>
        )}
        {mini
          ? <button type="button" className="call-room-icon danger" onClick={hangUp} aria-label={t("Quitter la réunion")} title={t("Quitter")}><PhoneOff size={15} /></button>
          : <button type="button" className="btn call-room-leave" onClick={hangUp}><X size={16} />{t("Quitter")}</button>}
      </header>
      <div className="call-room-stage">
        <div ref={box} className="call-room-frame" />
        {status !== "ready" && (
          <div className="call-room-status" role="status">
            {status === "error"
              ? <><strong>{t("La réunion n’a pas pu être ouverte. Réessayez.")}</strong><button type="button" className="btn" onClick={onLeave}>{t("Fermer")}</button></>
              : <><Loader2 size={22} className="spin" />{t("Connexion à la réunion…")}</>}
          </div>
        )}
      </div>
    </div>
  );
}

function PhaseBadge({ phase, meeting }: { phase: MeetingPhase; meeting: RecordItem }) {
  const { t } = useI18n();
  const label = phase === "live" ? t("En cours") : phase === "open" ? t("Ouverte") : phase === "cancelled" ? t("Annulée") : phase === "over" ? t("Terminée") : meeting.due === casablancaNow().day ? t("Aujourd’hui") : t("À venir");
  return <span className={`meeting-phase ${phase}`}>{phase === "live" && <i />}{label}</span>;
}

function MeetingCard({ meeting, clientName, canPlan, joining, onJoin, onEdit, onCancel }: {
  meeting: RecordItem; clientName?: string; canPlan: boolean; joining: boolean;
  onJoin: () => void; onEdit?: () => void; onCancel?: () => void;
}) {
  const { t, tag } = useI18n();
  const phase = meetingPhase(meeting);
  const date = meeting.due ? new Date(`${meeting.due}T12:00:00`) : null;
  const joinable = phase === "open" || phase === "live" || (canPlan && phase === "upcoming");
  const people = meeting.attendeeNames ?? [];
  return (
    <Surface asChild tone="default"><article className={`meeting-card ${phase}`}>
      <div className="meeting-date" aria-hidden="true">
        <small>{date?.toLocaleDateString(tag, { month: "short" })}</small>
        <strong>{date?.getDate()}</strong>
        <small>{date?.toLocaleDateString(tag, { weekday: "short" })}</small>
      </div>
      <div className="meeting-main">
        <div className="meeting-title-line">
          <span className="meeting-mode" title={t(meeting.callMode === "audio" ? "Appel audio" : "Réunion vidéo")}>{meeting.callMode === "audio" ? <Mic size={14} /> : <Video size={14} />}</span>
          <strong>{meeting.name}</strong>
          <PhaseBadge phase={phase} meeting={meeting} />
        </div>
        <p className="meeting-when"><Clock size={13} />{meeting.time} · {meeting.duration ?? 60} min{clientName ? <> · <b>{clientName}</b></> : null}{meeting.link ? <> · <ExternalLink size={12} />{t("Lien externe")}</> : null}</p>
        {!!people.length && <p className="meeting-people"><Users size={13} />{people.join(", ")}</p>}
        {meeting.description && <p className="meeting-agenda">{meeting.description}</p>}
      </div>
      <div className="meeting-actions">
        {phase !== "cancelled" && phase !== "over" && (
          <button type="button" className={`btn ${phase === "open" || phase === "live" ? "primary" : ""}`} disabled={!joinable || joining} onClick={onJoin} title={joinable ? undefined : t("La réunion ouvre 30 minutes avant l’heure prévue.")}>
            {joining ? <Loader2 size={15} className="spin" /> : meeting.callMode === "audio" ? <PhoneCall size={15} /> : <Video size={15} />}{t("Rejoindre")}
          </button>
        )}
        {onEdit && phase !== "cancelled" && phase !== "over" && <button type="button" className="btn ghost" onClick={onEdit}>{t("Modifier")}</button>}
        {onCancel && phase !== "cancelled" && phase !== "over" && <button type="button" className="btn ghost danger" onClick={onCancel}>{t("Annuler")}</button>}
      </div>
    </article></Surface>
  );
}

/** Refreshes the phases (« Ouverte », « En cours »…) as time passes. */
function useTick(ms = 30_000) {
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((n) => n + 1), ms); return () => clearInterval(id); }, [ms]);
}

/** The client's side (portal): their meetings with the studio, and « Rejoindre ». */
export function MeetingsList({ records, workspaceId, onError }: { records: RecordItem[]; workspaceId?: string; onError: (message: string) => void }) {
  const { t } = useI18n();
  useTick();
  const { join, joining } = useJoin(workspaceId, onError);
  const { coming, past } = meetingLists(records.filter((r) => r.kind === "meeting"), casablancaNow().day);
  return (
    <div className="meetings">
      {!coming.length && <div className="meetings-empty"><CalendarClock size={26} /><strong>{t("Aucune réunion prévue")}</strong><p>{t("Quand le studio planifie un appel avec vous, il apparaît ici avec le bouton « Rejoindre ».")}</p></div>}
      {coming.map((m) => <MeetingCard key={m.id} meeting={m} canPlan={false} joining={joining === m.id} onJoin={() => void join(m)} />)}
      {!!past.length && <><h3 className="meetings-past-title">{t("Récemment")}</h3>{past.map((m) => <MeetingCard key={m.id} meeting={m} canPlan={false} joining={false} onJoin={() => {}} />)}</>}
    </div>
  );
}

type Form = { id?: string; revision?: number; name: string; clientId: string; due: string; time: string; duration: number; callMode: CallMode; attendees: string[]; description: string; link: string; emailClient: boolean; instant?: boolean };

/** The studio's Réunions page. */
export default function MeetingsPage({ records, clients, members, workspaceId, userId, role, busy, mutate, onNotice, onError }: {
  records: RecordItem[]; clients: RecordItem[]; members: WorkspaceMember[]; workspaceId?: string; userId: string; role: WorkspaceRole;
  busy: boolean; mutate: Mutate; onNotice: (text: string) => void; onError: (text: string) => void;
}) {
  const { t } = useI18n();
  useTick();
  const canPlan = canPlanMeetings(role);
  const { join, joining } = useJoin(workspaceId, onError);
  const [form, setForm] = useState<Form | null>(null);
  const [cancelling, setCancelling] = useState<RecordItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [callsOn, setCallsOn] = useState<boolean | null>(null);
  const [filter, setFilter] = useState("");
  useEffect(() => { fetch("/api/meetings/join").then((r) => r.json()).then((d: { calls?: boolean }) => setCallsOn(!!d.calls)).catch(() => setCallsOn(false)); }, []);

  const activeClients = clients.filter((c) => !c.archived);
  const team = members.filter((m) => m.role !== "client" && m.userId !== userId);
  const clientName = (id?: string) => (id ? clients.find((c) => c.id === id)?.name : undefined);
  const me = members.find(m => m.userId === userId);
  const myId = userId;
  const myEmail = me?.email || '';
  const meetings = records.filter((r) => {
    if (r.kind !== "meeting") return false;
    if (filter && (filter === "internal" ? r.clientId : r.clientId !== filter)) return false;
    if (role === 'owner') return true; // Admins/managers see all meetings
    if (!r.attendees || r.attendees.length === 0) return true;
    return r.attendees.includes(myId) || r.attendees.includes(myEmail);
  });
  const { coming, past } = useMemo(() => meetingLists(meetings, casablancaNow().day), [meetings]);

  function plan(instant = false) {
    const now = casablancaNow();
    setFormError("");
    setForm({ name: "", clientId: filter && filter !== "internal" ? filter : "", due: now.day, time: instant ? now.time : "10:00", duration: instant ? 60 : 30, callMode: "video", attendees: [], description: "", link: "", emailClient: true, instant });
  }
  function edit(m: RecordItem) {
    setFormError("");
    setForm({ id: m.id, revision: m.revision, name: m.name, clientId: m.clientId ?? "", due: m.due ?? "", time: m.time ?? "10:00", duration: m.duration ?? 30, callMode: m.callMode === "audio" ? "audio" : "video", attendees: m.attendees ?? [], description: m.description ?? "", link: m.link ?? "", emailClient: true });
  }
  async function save() {
    if (!form) return;
    setSaving(true); setFormError("");
    try {
      const now = casablancaNow();
      const name = form.name.trim() || (form.instant ? `${t(form.callMode === "audio" ? "Appel" : "Visio")} — ${clientName(form.clientId) || t("Équipe")}` : "");
      const data = { ...form, name, ...(form.instant ? { due: now.day, time: now.time } : {}) };
      const result = await mutate({ action: "meeting-save", ...(form.id ? { id: form.id, revision: form.revision } : {}), emailClient: form.emailClient, data });
      setForm(null);
      onNotice(t(form.id ? "Réunion mise à jour." : form.instant ? "Appel lancé." : "Réunion planifiée. Les invités sont prévenus."));
      if (form.instant && result?.id) void join({ id: result.id, name, link: form.link || undefined });
    } catch (e) { setFormError(t((e as Error).message)); }
    finally { setSaving(false); }
  }
  async function cancel() {
    if (!cancelling) return;
    setSaving(true);
    try { await mutate({ action: "meeting-cancel", id: cancelling.id }); setCancelling(null); onNotice(t("Réunion annulée. Les invités sont prévenus.")); }
    catch (e) { onError(t((e as Error).message)); }
    finally { setSaving(false); }
  }
  const toggle = (id: string) => form && setForm({ ...form, attendees: form.attendees.includes(id) ? form.attendees.filter((a) => a !== id) : [...form.attendees, id] });

  return (
    <div className="meetings-page">
      <div className="page-heading">
        <span className="page-symbol" aria-hidden="true"><CalendarClock size={22} /></span>
        <div className="heading-line">
          <h1>{t("Réunions")}</h1>
          {canPlan && <div className="inline">
            <button type="button" className="btn" disabled={busy} onClick={() => plan(true)}><PhoneCall size={15} />{t("Appel instantané")}</button>
            <button type="button" className="btn primary" disabled={busy} onClick={() => plan(false)}><Plus size={15} />{t("Planifier une réunion")}</button>
          </div>}
        </div>
        <p>{t("Vos appels vidéo et audio avec les clients et l’équipe. Chacun rejoint depuis l’application, sans rien installer.")}</p>
      </div>
      {callsOn === false && canPlan && <p className="meetings-setup">{t("Les appels intégrés ne sont pas encore activés : ajoutez DAILY_API_KEY dans Vercel (daily.co, gratuit jusqu’à 10 000 minutes par mois). En attendant, collez un lien Google Meet ou Zoom dans la réunion.")}</p>}
      <div className="meetings-toolbar">
        <Select value={filter || "__all"} onValueChange={(v) => setFilter(v === "__all" ? "" : v)}>
          <SelectTrigger className="pick" aria-label={t("Client")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">{t("Toutes les réunions")}</SelectItem>
            <SelectItem value="internal">{t("Équipe seulement")}</SelectItem>
            {activeClients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <section className="meetings" aria-label={t("À venir")}>
        {!coming.length && <div className="meetings-empty"><CalendarClock size={26} /><strong>{t("Aucune réunion prévue")}</strong><p>{canPlan ? t("Planifiez un appel avec un client, ajoutez l’équipe si besoin : chacun reçoit l’invitation et rejoint d’un clic.") : t("Les réunions auxquelles vous êtes invité apparaissent ici.")}</p></div>}
        {coming.map((m) => (
          <MeetingCard key={m.id} meeting={m} clientName={clientName(m.clientId)} canPlan={canPlan} joining={joining === m.id}
            onJoin={() => void join(m)} onEdit={canPlan ? () => edit(m) : undefined} onCancel={canPlan ? () => setCancelling(m) : undefined} />
        ))}
        {!!past.length && <><h3 className="meetings-past-title">{t("Récemment")}</h3>{past.map((m) => <MeetingCard key={m.id} meeting={m} clientName={clientName(m.clientId)} canPlan={false} joining={false} onJoin={() => {}} />)}</>}
      </section>

      <Dialog open={!!form} onOpenChange={(open) => { if (!open && !saving) setForm(null); }}>
        <DialogContent className="tracker-modal meeting-modal">
          <DialogHeader>
            <DialogTitle>{t(form?.instant ? "Appel instantané" : form?.id ? "Modifier la réunion" : "Planifier une réunion")}</DialogTitle>
            <DialogDescription>{t(form?.instant ? "L’appel démarre tout de suite ; les personnes choisies sont prévenues et le rejoignent depuis l’application." : "Le client et les membres invités sont prévenus et rejoignent d’un clic, depuis l’application.")}</DialogDescription>
          </DialogHeader>
          {form && <form className="form-fields" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <div className="meeting-mode-switch" role="radiogroup" aria-label={t("Type d’appel")}>
              {(["video", "audio"] as const).map((mode) => (
                <button key={mode} type="button" role="radio" aria-checked={form.callMode === mode} className={form.callMode === mode ? "selected" : ""} onClick={() => setForm({ ...form, callMode: mode })}>
                  {mode === "video" ? <Video size={16} /> : <Mic size={16} />}{t(mode === "video" ? "Vidéo" : "Audio seulement")}
                </button>
              ))}
            </div>
            <label className="form-field"><span>{t("Titre")}</span><input value={form.name} maxLength={140} required={!form.instant} placeholder={t(form.instant ? "Facultatif" : "Point mensuel, présentation du plan…")} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="form-field"><span>{t("Client")}</span>
              <Select value={form.clientId || "__none"} onValueChange={(v) => setForm({ ...form, clientId: v === "__none" ? "" : v })}>
                <SelectTrigger className="pick" aria-label={t("Client")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">{t("Aucun — réunion d’équipe")}</SelectItem>
                  {activeClients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {form.clientId && <small>{t("Tous les contacts du client ayant accès au portail sont invités.")}</small>}
            </label>
            {!form.instant && <div className="form-pair">
              <div className="form-field"><span>{t("Date")}</span><DatePicker label={t("Date")} value={form.due} onChange={(v) => setForm({ ...form, due: v })} /></div>
              <label className="form-field"><span>{t("Heure (Maroc)")}</span><TimeField required value={form.time} label={t("Heure (Maroc)")} onChange={(time) => setForm({ ...form, time })} /></label>
            </div>}
            <label className="form-field"><span>{t("Durée")}</span>
              <Select value={String(form.duration)} onValueChange={(v) => setForm({ ...form, duration: Number(v) })}>
                <SelectTrigger className="pick" aria-label={t("Durée")}><SelectValue /></SelectTrigger>
                <SelectContent>{meetingDurations.map((d) => <SelectItem key={d} value={String(d)}>{d < 60 ? `${d} min` : `${d / 60} h${d % 60 ? ` ${d % 60}` : ""}`}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <fieldset className="form-field meeting-team">
              <span>{t("Membres de l’équipe")}</span>
              {team.length ? <div className="meeting-team-list">{team.map((m) => (
                <label key={m.userId} className={form.attendees.includes(m.userId) ? "selected" : ""}>
                  <input type="checkbox" checked={form.attendees.includes(m.userId)} onChange={() => toggle(m.userId)} />
                  <span>{memberName(m)}</span>
                </label>
              ))}</div> : <small>{t("Invitez d’abord des membres dans Équipe.")}</small>}
            </fieldset>
            {!form.instant && <label className="form-field"><span>{t("Ordre du jour")}</span><textarea rows={3} maxLength={4000} value={form.description} placeholder={t("Les points à voir ensemble (facultatif)")} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>}
            <details className="meeting-more" open={!!form.link || callsOn === false}>
              <summary>{t("Utiliser un autre outil (Google Meet, Zoom…)")}</summary>
              <label className="form-field"><span>{t("Lien de la réunion")}</span><input type="url" value={form.link} placeholder="https://meet.google.com/…" onChange={(e) => setForm({ ...form, link: e.target.value })} /><small>{t("Laissez vide pour l’appel intégré à l’application.")}</small></label>
            </details>
            {form.clientId && !form.instant && <label className="meeting-check"><input type="checkbox" checked={form.emailClient} onChange={(e) => setForm({ ...form, emailClient: e.target.checked })} />{t("Prévenir aussi le client par e-mail")}</label>}
            {formError && <p className="form-error" role="alert">{formError}</p>}
            <DialogFooter className="modal-footer">
              <button type="button" className="btn" disabled={saving} onClick={() => setForm(null)}>{t("Annuler")}</button>
              <button className="btn primary" disabled={saving || (!form.instant && !form.name.trim())}>
                {saving ? <Loader2 size={15} className="spin" /> : form.instant ? <PhoneCall size={15} /> : null}
                {t(saving ? "Enregistrement…" : form.instant ? "Démarrer l’appel" : form.id ? "Enregistrer" : "Planifier")}
              </button>
            </DialogFooter>
          </form>}
        </DialogContent>
      </Dialog>

      <Dialog open={!!cancelling} onOpenChange={(open) => { if (!open && !saving) setCancelling(null); }}>
        <DialogContent className="tracker-modal">
          <DialogHeader><DialogTitle>{t("Annuler la réunion ?")}</DialogTitle><DialogDescription>{t("« {name} » est annulée pour tout le monde ; le client et les invités sont prévenus.", { name: cancelling?.name ?? "" })}</DialogDescription></DialogHeader>
          <DialogFooter className="modal-footer"><button type="button" className="btn" disabled={saving} onClick={() => setCancelling(null)}>{t("Garder")}</button><button type="button" className="btn primary danger" disabled={saving} onClick={() => void cancel()}>{t("Annuler la réunion")}</button></DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

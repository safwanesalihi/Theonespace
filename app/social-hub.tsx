"use client";
// The Social hub: every client's posts on one calendar (or one client's, on their page), a list by
// status, and the composer. Drag a post to another day to move it. Owner, admins and social media
// managers only — the parent decides who gets here.
import { useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarDays, ChevronLeft, ChevronRight, FileText, Link2, List, Loader2, Megaphone, PencilLine, Play, Plus, Repeat, SkipForward, Undo2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from "@/components/ui/empty";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import NetworkIcon from "@/app/network-icon";
import PostComposer from "@/app/post-composer";
import { AccountsPanel, PagePicker, useConnectedAccounts } from "@/app/social-accounts";
import SocialReportView from "@/app/social-report";
import { useI18n } from "@/app/locale-provider";
import { dayIn, shiftDay } from "@/lib/flow";
import { timeIn } from "@/lib/editorial-queue";
import { dayKey, type RecordItem } from "@/lib/model";
import { mediaOf, networkLabels, networks, postStatus, statusLabels, targetsOf, type Network, type PostStatus } from "@/lib/social";
import { repeatLabel, repeatsOn, seriesDay } from "@/lib/social-repeat";

type Mutate = (body: Record<string, unknown>) => Promise<{ id?: string } | undefined>;
const statusOrder: PostStatus[] = ["changes", "awaiting", "failed", "manual", "publishing", "scheduled", "draft", "published"];

export default function SocialHub({
  records, workspaceId, today, fixedClientId, mediaStorage, mutate, reload, onNotice, onError,
}: {
  records: RecordItem[];
  workspaceId: string;
  today: string;
  fixedClientId?: string;
  mediaStorage: boolean;
  mutate: Mutate;
  reload: () => Promise<void> | void;
  onNotice: (text: string) => void;
  onError: (text: string) => void;
}) {
  const { t, tag, rtl } = useI18n();
  const [view, setView] = useState<"calendar" | "list" | "stats" | "accounts">("calendar");
  const [month, setMonth] = useState(() => { const d = new Date(`${today}T12:00:00`); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [clientFilter, setClientFilter] = useState("");
  const [networkFilter, setNetworkFilter] = useState<Network[]>([]);
  const [statusFilter, setStatusFilter] = useState<PostStatus | "">("");
  const [composer, setComposer] = useState<{ open: boolean; postId: string | null; due?: string }>({ open: false, postId: null });
  const [dragging, setDragging] = useState<string | null>(null);
  const [seriesDate, setSeriesDate] = useState<{ postId: string; day: string } | null>(null);
  const [nowKey, setNowKey] = useState(() => `${dayIn(new Date())} ${timeIn(new Date())}`);
  useEffect(() => {
    const id = window.setInterval(() => setNowKey(`${dayIn(new Date())} ${timeIn(new Date())}`), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Connected accounts; back from a platform's login, the accounts view shows what happened.
  const { accounts, available, pending, cancelPick, pick, disconnect } = useConnectedAccounts(workspaceId, { onNotice, onError, onReturn: () => setView("accounts") });

  const clients = records.filter((r) => r.kind === "client" && !r.archived).sort((a, b) => a.name.localeCompare(b.name));
  const platforms = records.filter((r) => r.kind === "platform");
  const clientOf = (id?: string) => clients.find((c) => c.id === id);
  const scope = fixedClientId || clientFilter;
  const posts = useMemo(() => records
    .filter((r) => r.kind === "editorial_post" && !r.archived && (!scope || r.clientId === scope) && (r.clientId === "internal" || !!clients.find((c) => c.id === r.clientId)))
    .map((post) => ({ post, status: postStatus(post, clientOf(post.clientId), platforms, nowKey), targets: targetsOf(post, platforms), media: mediaOf(post) }))
    .filter((p) => !networkFilter.length || p.targets.some((x) => networkFilter.includes(x.network)))
    .sort((a, b) => `${a.post.due} ${a.post.time || "09:00"}`.localeCompare(`${b.post.due} ${b.post.time || "09:00"}`)),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- clientOf/platforms derive from records
  [records, scope, networkFilter, nowKey]);

  const counts = statusOrder.map((s) => [s, posts.filter((p) => p.status === s).length] as const).filter(([, n]) => n > 0);
  const editing = composer.postId ? records.find((r) => r.id === composer.postId && r.kind === "editorial_post") ?? null : null;

  async function reschedule(postId: string, day: string) {
    const post = records.find((r) => r.id === postId);
    if (!post || post.due === day || post.publishedAt) return;
    try {
      await mutate({
        action: "update", kind: "editorial_post", id: post.id, revision: post.revision,
        data: {
          name: post.name, clientId: post.clientId, due: day, time: post.time || "", description: post.description || "",
          socialState: post.socialState || "draft", targets: targetsOf(post, platforms), media: mediaOf(post),
        },
      });
      onNotice(t("Déplacé au {date}.", { date: new Date(`${day}T12:00:00`).toLocaleDateString(tag, { day: "numeric", month: "long" }) }));
    } catch (e) {
      onError(t((e as Error).message));
    }
  }

  const start = new Date(month);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return dayKey(d); });
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * 86_400_000).toLocaleDateString(tag, { weekday: "short" }));

  function Thumb({ post }: { post: RecordItem }) {
    const first = mediaOf(post)[0];
    return (
      <span className="social-thumb">
        {!first ? <FileText size={13} /> : first.source === "drive" && first.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element -- Drive's own preview of the file
          <img src={first.thumb} alt="" loading="lazy" />
        ) : first.type === "video" ? <Play size={12} /> : (
          // eslint-disable-next-line @next/next/no-img-element -- a user upload on the storage origin, shown as is
          <img src={first.url} alt="" loading="lazy" />
        )}
      </span>
    );
  }

  return (
    <div className="social-hub">
      {!fixedClientId && (
        <div className="page-heading">
          <span className="page-symbol" aria-hidden="true"><Megaphone size={22} /></span>
          <div className="heading-line">
            <h1>{t("Social")}</h1>
            <button className="btn primary" onClick={() => setComposer({ open: true, postId: null, due: today })}><Plus size={16} />{t("Nouvelle publication")}</button>
          </div>
          <p>{t("Planifiez, faites valider et publiez les contenus de tous vos clients, au même endroit.")}</p>
        </div>
      )}

      <div className="social-toolbar">
        <Tabs value={view} onValueChange={(v) => setView(v as "calendar" | "list" | "stats" | "accounts")}>
          <TabsList>
            <TabsTrigger value="calendar"><CalendarDays size={14} />{t("Calendrier")}</TabsTrigger>
            <TabsTrigger value="list"><List size={14} />{t("Liste")}</TabsTrigger>
            <TabsTrigger value="stats"><BarChart3 size={14} />{t("Statistiques")}</TabsTrigger>
            <TabsTrigger value="accounts"><Link2 size={14} />{t("Comptes")}</TabsTrigger>
          </TabsList>
        </Tabs>
        {view === "calendar" && (
          <div className="social-month">
            <button className="icon-button" aria-label={t("Mois précédent")} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>{rtl ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}</button>
            <strong>{month.toLocaleDateString(tag, { month: "long", year: "numeric" })}</strong>
            <button className="icon-button" aria-label={t("Mois suivant")} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>{rtl ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}</button>
            <button className="btn" onClick={() => { const d = new Date(`${today}T12:00:00`); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>{t("Aujourd’hui")}</button>
          </div>
        )}
        <div className="grow" />
        {!fixedClientId && view !== "stats" && (
          <Select value={clientFilter || "__all"} onValueChange={(v) => setClientFilter(v === "__all" ? "" : v)}>
            <SelectTrigger className="pick" aria-label={t("Client")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">{t("Tous les clients")}</SelectItem>
              <SelectItem value="internal">{t("Agence")}</SelectItem>
              {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {view !== "stats" && <div className="social-network-filter" role="group" aria-label={t("Réseaux")}>
          {networks.map((n) => (
            <button key={n} type="button" aria-label={networkLabels[n]} aria-pressed={networkFilter.includes(n)} title={networkLabels[n]}
              onClick={() => setNetworkFilter((f) => (f.includes(n) ? f.filter((x) => x !== n) : [...f, n]))}>
              <NetworkIcon network={n} size={18} />
            </button>
          ))}
        </div>}
        {fixedClientId && <button className="btn primary" onClick={() => setComposer({ open: true, postId: null, due: today })}><Plus size={16} />{t("Nouvelle publication")}</button>}
      </div>

      {view !== "accounts" && view !== "stats" && !!counts.length && (
        <div className="social-counts">
          {counts.map(([s, n]) => (
            <button key={s} type="button" className={`social-count ${s} ${statusFilter === s ? "selected" : ""}`} onClick={() => { setStatusFilter(statusFilter === s ? "" : s); setView("list"); }}>
              <i />{t(statusLabels[s])}<strong>{n}</strong>
            </button>
          ))}
        </div>
      )}

      {view === "stats" ? (
        <SocialReportView records={records} clients={clients} workspaceId={workspaceId} today={today} fixedClientId={fixedClientId} canRefresh onNotice={onNotice} onError={onError} />
      ) : view === "accounts" ? (
        <AccountsPanel
          clients={clients}
          accounts={accounts}
          available={available}
          workspaceId={workspaceId}
          fixedClientId={fixedClientId}
          onDisconnect={disconnect}
        />
      ) : view === "calendar" ? (
        <div className="social-calendar">
          <div className="social-weekdays">{weekdays.map((d) => <span key={d}>{d}</span>)}</div>
          <div className="social-days">
            {days.map((day) => {
              // A repeating series shows on its own date, and again on each later day it goes out.
              const items = posts.filter((p) => p.post.due === day || (!!p.post.repeat && !p.post.publishedAt && p.post.socialState === "scheduled" && day > p.post.due! && day >= today && repeatsOn(p.post.repeat, day)));
              const outside = new Date(`${day}T12:00:00`).getMonth() !== month.getMonth();
              return (
                <div
                  key={day}
                  className={`social-day ${outside ? "outside" : ""} ${day === today ? "today" : ""} ${day < today ? "past" : ""} ${dragging ? "droppable" : ""}`}
                  onDragOver={(e) => { if (dragging) e.preventDefault(); }}
                  onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); setDragging(null); if (id) void reschedule(id, day); }}
                >
                  <header>
                    <span>{Number(day.slice(8))}</span>
                    <small className="social-day-name">{new Date(`${day}T12:00:00`).toLocaleDateString(tag, { weekday: "long", month: "long" })}</small>
                    {day >= today && <button type="button" className="social-day-add" aria-label={t("Nouvelle publication le {date}", { date: day })} onClick={() => setComposer({ open: true, postId: null, due: day })}><Plus size={18} /></button>}
                  </header>
                  {items.map(({ post, status, targets }) => {
                    // A repeating series: this date may be skipped, or have its own title.
                    const series = !!post.repeat && !post.publishedAt;
                    const own = series ? seriesDay(post, day) : null;
                    const skipped = series && own === null;
                    const name = own?.name ?? post.name;
                    return (
                    <button
                      key={post.id}
                      type="button"
                      className={`social-chip ${status}${post.repeat && post.due !== day ? " repeat-ahead" : ""}${skipped ? " repeat-skipped" : ""}`}
                      draggable={!post.publishedAt && post.due === day}
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", post.id); e.dataTransfer.effectAllowed = "move"; setDragging(post.id); }}
                      onDragEnd={() => setDragging(null)}
                      onClick={() => (series ? setSeriesDate({ postId: post.id, day }) : setComposer({ open: true, postId: post.id }))}
                      title={`${name} · ${skipped ? t("Date sautée") : t(statusLabels[status])}`}
                    >
                      <Thumb post={post} />
                      <span className="social-chip-body">
                        <small>{post.repeat && <Repeat size={10} aria-label={t("Répétée")} />}{own?.changed && <PencilLine size={10} aria-label={t("Modifiée pour cette date")} />}{skipped ? t("Sautée") : post.time || "09:00"} {targets.map((x) => <NetworkIcon key={x.network} network={x.network} size={10} />)}</small>
                        <strong>{name}</strong>
                        {!scope && <small className="social-chip-client">{post.clientId === "internal" ? t("Agence") : clientOf(post.clientId)?.name}</small>}
                      </span>
                    </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="social-list">
          {statusOrder.filter((s) => !statusFilter || s === statusFilter).map((s) => {
            const group = posts.filter((p) => p.status === s && (s !== "published" || p.post.due! >= shiftDay(today, -30)));
            if (!group.length) return null;
            return (
              <section key={s}>
                <h3 className={`social-list-title ${s}`}><i />{t(statusLabels[s])} <span>{group.length}</span></h3>
                {group.map(({ post, targets, media }) => (
                  <button key={post.id} type="button" className="social-row" onClick={() => setComposer({ open: true, postId: post.id })}>
                    <Thumb post={post} />
                    <span className="social-row-main">
                      <strong>{post.name}</strong>
                      <small>{(post.description || "").slice(0, 110) || t("Sans texte")}</small>
                    </span>
                    {!scope && <span className="social-row-client">{post.clientId === "internal" ? t("Agence") : clientOf(post.clientId)?.name}</span>}
                    <span className="social-row-networks">{targets.map((x) => <NetworkIcon key={x.network} network={x.network} size={13} badge />)}</span>
                    <span className="social-row-date">{new Date(`${post.due}T12:00:00`).toLocaleDateString(tag, { day: "numeric", month: "short" })} · {post.time || "09:00"}{media.length > 1 ? ` · ${media.length} ${t("médias")}` : ""}{post.repeat && !post.publishedAt && <em className="social-row-repeat"><Repeat size={11} />{(() => { const [k, v] = repeatLabel(post.repeat, t); return t(k, v); })()}</em>}</span>
                  </button>
                ))}
              </section>
            );
          })}
          {!posts.length && (
            <Empty className="empty-state">
              <EmptyHeader>
                <EmptyMedia>
                  <CalendarDays size={32} />
                </EmptyMedia>
                <EmptyTitle>{t("Calendrier vide")}</EmptyTitle>
                <EmptyDescription>{t("Aucune publication pour l’instant. Créez la première avec « Nouvelle publication ».")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      )}

      {seriesDate && (() => {
        const series = records.find((r) => r.id === seriesDate.postId && r.kind === "editorial_post");
        return series ? (
          <SeriesDateDialog
            key={`${series.id}:${seriesDate.day}:${series.revision}`}
            series={series} day={seriesDate.day} mutate={mutate}
            onClose={() => setSeriesDate(null)}
            onEditSeries={() => { setSeriesDate(null); setComposer({ open: true, postId: series.id }); }}
            onNotice={onNotice} onError={onError}
          />
        ) : null;
      })()}
      <PostComposer
        open={composer.open}
        post={editing}
        defaults={{ due: composer.due, clientId: fixedClientId || clientFilter || undefined }}
        clients={clients}
        platforms={platforms}
        fixedClientId={fixedClientId}
        workspaceId={workspaceId}
        today={today}
        nowKey={nowKey}
        mediaStorage={mediaStorage}
        accounts={accounts}
        onClose={() => setComposer({ open: false, postId: null })}
        onSaved={(postId) => setComposer((c) => ({ ...c, postId }))}
        mutate={mutate}
        onPublished={async () => { await reload(); }}
        onNotice={onNotice}
      />
      <PagePicker
        pending={pending}
        clientName={pending ? (pending.clientId === "internal" ? t("Agence") : clientOf(pending.clientId)?.name || "") : ""}
        onCancel={cancelPick}
        onPick={pick}
      />
    </div>
  );
}

/**
 * One date of a repeating series: publish it with its own title and text, skip it, or put it back as
 * the series. The photos, networks and time stay the series'; « Modifier toute la série » changes every date.
 */
function SeriesDateDialog({ series, day, mutate, onClose, onEditSeries, onNotice, onError }: {
  series: RecordItem; day: string; mutate: Mutate; onClose: () => void; onEditSeries: () => void;
  onNotice: (text: string) => void; onError: (text: string) => void;
}) {
  const { t, tag } = useI18n();
  const own = seriesDay(series, day);
  const exception = series.repeatExceptions?.[day];
  const [name, setName] = useState(own?.name ?? series.name);
  const [description, setDescription] = useState(own?.description ?? series.description ?? "");
  const [busy, setBusy] = useState(false);
  const label = new Date(`${day}T12:00:00`).toLocaleDateString(tag, { weekday: "long", day: "numeric", month: "long" });
  const rule = series.repeat ? repeatLabel(series.repeat, t) : null;
  const send = async (exceptionBody: Record<string, unknown> | null, notice: string) => {
    setBusy(true);
    try {
      await mutate({ action: "series-date", id: series.id, revision: series.revision, day, exception: exceptionBody });
      onNotice(t(notice, { date: label }));
      onClose();
    } catch (e) { onError(t((e as Error).message)); }
    setBusy(false);
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="tracker-modal series-date-dialog">
        <DialogHeader>
          <DialogTitle>{t("Cette date seulement")}</DialogTitle>
          <DialogDescription>
            {label} · <Repeat size={12} /> {series.name}{rule ? ` · ${t(rule[0], rule[1])}` : ""}
          </DialogDescription>
        </DialogHeader>
        {own === null ? (
          <p className="series-date-skipped"><SkipForward size={15} />{t("Cette date est sautée : rien ne sera publié ce jour-là. Les autres dates de la série ne changent pas.")}</p>
        ) : (
          <div className="form-fields">
            <label className="form-field"><span>{t("Titre")}</span><input dir="auto" value={name} maxLength={160} onChange={(e) => setName(e.target.value)} /></label>
            <label className="form-field"><span>{t("Texte")}</span><textarea dir="auto" rows={6} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
            <small className="small-note">{t("Seule cette date change. Les photos, les réseaux et l’heure restent ceux de la série.")}</small>
          </div>
        )}
        <div className="modal-footer series-date-footer">
          <button type="button" className="btn ghost" disabled={busy} onClick={onEditSeries}><Repeat size={14} />{t("Modifier toute la série")}</button>
          {exception && <button type="button" className="btn" disabled={busy} onClick={() => void send(null, "Le {date} reprend la série.")}><Undo2 size={14} />{t("Reprendre la série")}</button>}
          {own !== null && <button type="button" className="btn" disabled={busy} onClick={() => void send({ skip: true }, "Le {date} est sauté.")}><SkipForward size={14} />{t("Sauter cette date")}</button>}
          {own !== null && (
            <button type="button" className="btn primary" disabled={busy || !name.trim() || (name === (own.name) && description === own.description)}
              onClick={() => void send({ name: name.trim(), description }, "Le {date} a son propre texte.")}>
              {busy ? <Loader2 size={14} className="spin" /> : <PencilLine size={14} />}{t("Enregistrer pour cette date")}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

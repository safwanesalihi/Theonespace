"use client";
import { appDayKey, appNow, appNowMs, formatTimestamp } from "@/lib/time";
// IG Analyzer (owner and admins): paste any public Instagram account, and see what works for it —
// cadence, engagement, reel views, formats, reel and caption length, the best time to post, hashtags,
// the viral posts — and how it compares with the other accounts followed. Readings come from
// /api/ig (Apify); every number here is computed in the browser (lib/ig-analyzer/analyze.ts).
import { Surface } from "@/components/ui/surface";
import { studioLabel, useBrand } from "@/app/brand-store";
import { Fragment, useEffect, useMemo, useState } from "react";
import { ExternalLink, ChartNoAxesCombined, FileDown, Heart, Loader2, MessageCircle, Play, RefreshCw, Star, Timer, X } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "@/lib/i18n/locale-provider";
import { analyzeAccount, BLOCKS, DAYS, hook, recommendations, TYPE_LABEL, TYPE_ONE, type Analysis, type AnalyzedPost, type Scored } from "@/lib/ig-analyzer/analyze";
import type { IgAccount } from "@/lib/ig-analyzer/scraper";
import type { HistoryPoint, Tracked } from "@/lib/ig-analyzer/store";

const AMBER = "var(--t-chart-doing)", CHARCOAL = "var(--t-chart-todo)", GRID = "var(--t-line)", AXIS = "var(--t-text-muted)";
const SERIES = ["var(--t-chart-doing)", "var(--t-chart-todo)", "var(--t-chart-done)", "var(--t-chart-review)", "var(--t-chart-paused)", "var(--t-chart-info)", "var(--t-danger)", "var(--t-success)"];
// Weaker → stronger than a typical post, in the app's amber.
const HEAT = Array.from({ length: 7 }, (_, i) => `var(--t-heat-${i})`);
type Tab = "overview" | "content" | "viral" | "compare";

async function api<T>(workspaceId: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", "X-Workspace-Id": workspaceId, ...(init?.headers ?? {}) } })
    .catch(() => { throw new Error("Connexion au serveur impossible. Vérifiez votre connexion internet, puis réessayez : votre texte est conservé."); });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "L’analyse a échoué. Réessayez.");
  return body;
}

export default function IgAnalyzer({ workspaceId, onError }: { workspaceId: string; onError: (message: string) => void }) {
  const { t, tag } = useI18n();
  const studio = studioLabel(useBrand());
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [accounts, setAccounts] = useState<Tracked[]>([]);
  const [data, setData] = useState<Record<string, Analysis>>({});
  const [history, setHistory] = useState<Record<string, HistoryPoint[]>>({});
  const [pending, setPending] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [input, setInput] = useState("");
  const [started, setStarted] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  // « Exporter en PDF »: the whole audit on one page, then the browser's print dialog (Save as PDF).
  const [printing, setPrinting] = useState(false);
  // After the print dialog: « PDF enregistré ? » — yes deletes the analysis (the browser cannot tell a
  // saved PDF from a cancelled dialog). Unexported analyses go by themselves two days after their reading.
  const [saved, setSaved] = useState<string | null>(null);

  const nf = useMemo(() => new Intl.NumberFormat(tag), [tag]);
  const cf = useMemo(() => new Intl.NumberFormat(tag, { notation: "compact", maximumFractionDigits: 1 }), [tag]);
  const f = {
    num: (n: number | null | undefined) => (n == null ? "–" : nf.format(Math.round(n))),
    short: (n: number | null | undefined) => (n == null ? "–" : cf.format(n)),
    x: (v: number | null | undefined) => (v == null || !isFinite(v) ? "–" : `${v.toFixed(1)}×`),
    pct: (v: number | null | undefined) => (v == null ? "–" : `${v.toFixed(2)} %`),
  };
  const img = (url: string | null | undefined) => (url ? `/api/ig/img?ws=${encodeURIComponent(workspaceId)}&u=${encodeURIComponent(url)}` : null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [status, list, hist] = await Promise.all([
          api<{ configured: boolean }>(workspaceId, "/api/ig?view=status"),
          api<{ accounts: Tracked[] }>(workspaceId, "/api/ig?view=accounts"),
          api<{ history: Record<string, HistoryPoint[]> }>(workspaceId, "/api/ig?view=history"),
        ]);
        if (!live) return;
        setConfigured(status.configured); setAccounts(list.accounts); setHistory(hist.history);
        const cached = await Promise.all(list.accounts.map((a) => api<IgAccount>(workspaceId, `/api/ig?view=account&username=${encodeURIComponent(a.username)}`).catch(() => null)));
        if (!live) return;
        const next: Record<string, Analysis> = {};
        for (const c of cached) if (c) next[c.profile.username] = analyzeAccount(c);
        setData(next);
        setSelected(list.accounts.find((a) => a.isMe && next[a.username])?.username ?? list.accounts.find((a) => next[a.username])?.username ?? null);
      } catch (e) { if (live) setError(t((e as Error).message)); }
    })();
    return () => { live = false; };
  }, [workspaceId, t]);

  useEffect(() => {
    if (!printing) return;
    const title = document.title;
    const done = () => { document.title = title; setPrinting(false); setSaved(selected); };
    window.addEventListener("afterprint", done, { once: true });
    const timer = setTimeout(() => {
      document.title = `${t("Audit Instagram")} @${selected} ${appDayKey(appNow())}`;
      window.print();
    }, 700); // charts and pictures settle at print width first
    return () => { clearTimeout(timer); window.removeEventListener("afterprint", done); document.title = title; };
  }, [printing, selected, t]);

  // The « lecture en cours » clock.
  useEffect(() => {
    if (!pending.length) return;
    const id = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [pending.length, started]);

  const guess = (v: string) => { const m = v.trim().match(/instagram\.com\/([A-Za-z0-9._]+)/i); return (m ? m[1] : v.trim().replace(/^@/, "")).toLowerCase(); };
  async function scan(value: string, refresh = false) {
    const g = guess(value);
    if (!g || pending.includes(g)) return;
    setPending((p) => [...p, g]); setError("");
    if (!pending.length) { setStarted(Date.now()); setElapsed(0); }
    try {
      const reply = await api<{ account: IgAccount; accounts: Tracked[]; history: Record<string, HistoryPoint[]> }>(workspaceId, "/api/ig", { method: "POST", body: JSON.stringify({ action: "scan", username: value, refresh }) });
      setData((d) => ({ ...d, [reply.account.profile.username]: analyzeAccount(reply.account) }));
      setAccounts(reply.accounts); setHistory(reply.history); setSelected(reply.account.profile.username);
    } catch (e) {
      setError(t("Impossible d’analyser {name} : {reason}", { name: `@${g}`, reason: t((e as Error).message) }));
    } finally { setPending((p) => p.filter((x) => x !== g)); }
  }
  async function remove(username: string) {
    try {
      const reply = await api<{ accounts: Tracked[] }>(workspaceId, "/api/ig", { method: "POST", body: JSON.stringify({ action: "remove", username }) });
      setAccounts(reply.accounts);
      setData((d) => { const n = { ...d }; delete n[username]; return n; });
      if (selected === username) setSelected(reply.accounts.find((a) => data[a.username] && a.username !== username)?.username ?? null);
    } catch (e) { onError(t((e as Error).message)); }
  }
  async function makeMine(username: string) {
    try { setAccounts((await api<{ accounts: Tracked[] }>(workspaceId, "/api/ig", { method: "POST", body: JSON.stringify({ action: "set-me", username }) })).accounts); }
    catch (e) { onError(t((e as Error).message)); }
  }

  const a = selected ? data[selected] : undefined;
  const others = Object.values(data).filter((d) => d.profile.username !== selected && accounts.some((x) => x.username === d.profile.username));
  const meName = accounts.find((x) => x.isMe)?.username;
  const chips = [...accounts, ...pending.filter((p) => !accounts.some((x) => x.username === p)).map((username) => ({ username }))];

  return (
    <div className={`ig-page${printing ? " printing" : ""}`}>
      <div className="page-heading">
        <span className="page-symbol" aria-hidden="true"><ChartNoAxesCombined size={22} /></span>
        <div className="heading-line"><h1>{t("Analyse Instagram")}</h1></div>
        <p>{t("Collez n’importe quel compte Instagram public : ce qui fonctionne pour lui — formats, horaires, accroches, publications virales — et comment il se compare aux autres comptes suivis.")}</p>
      </div>
      {configured === false && <p className="meetings-setup">{t("L’analyse Instagram n’est pas encore activée : ajoutez APIFY_TOKEN dans Vercel (apify.com → Settings → API & Integrations).")}</p>}
      <form className="ig-scan" onSubmit={(e) => { e.preventDefault(); const v = input.trim(); if (v) { setInput(""); void scan(v); } }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={t("@nom ou lien du profil Instagram")} aria-label={t("Compte Instagram à analyser")} />
        <button className="btn primary" disabled={!input.trim()}>{t("Analyser")}</button>
      </form>
      {!!chips.length && (
        <div className="ig-chips">
          {chips.map((c) => {
            const d = data[c.username];
            const pic = img(d?.profile.profile_picture_url);
            const busy = pending.includes(c.username);
            return (
              <div key={c.username} className={`ig-chip${selected === c.username ? " selected" : ""}${busy ? " busy" : ""}`} title={"expiresAt" in c && typeof c.expiresAt === "string" ? t("Supprimée {when} si le PDF n’est pas exporté.", { when: remaining(c.expiresAt, t) }) : undefined}>
                <button type="button" onClick={() => (d ? setSelected(c.username) : void scan(c.username))}>
                  <span className="ig-av" style={pic ? { backgroundImage: `url('${pic}')` } : undefined} />
                  @{c.username}{"isMe" in c && !!c.isMe && <em>{t("Mon compte")}</em>}
                  {busy ? <Loader2 size={13} className="spin" /> : !d ? <small>{t("à analyser")}</small> : null}
                </button>
                {!busy && <button type="button" className="ig-chip-x" onClick={() => void remove(c.username)} aria-label={t("Retirer @{name}", { name: c.username })}><X size={13} /></button>}
              </div>
            );
          })}
        </div>
      )}
      {!!pending.length && <p className="ig-banner"><Loader2 size={15} className="spin" />{t("Lecture de {names} sur Instagram… {s} s (souvent 30 à 90 secondes)", { names: pending.map((p) => `@${p}`).join(", "), s: elapsed })}</p>}
      {error && <p className="ig-banner error" role="alert">{error}</p>}

      {!a ? (!pending.length && (
        <div className="meetings-empty"><ChartNoAxesCombined size={26} /><strong>{t("Aucun compte analysé")}</strong><p>{t("Commencez par le compte d’un client ou le vôtre, puis ajoutez des concurrents pour les comparer.")}</p></div>
      )) : (
        <>
          {printing && (
            <header className="ig-report-head">
              <h1>{t("Audit Instagram")} — @{a.profile.username}</h1>
              <p>{t("Audit Instagram préparé par {studio} · {date}", { studio, date: formatTimestamp(appNow(), tag, { day: "numeric", month: "long", year: "numeric" }) })}</p>
            </header>
          )}
          {saved === a.profile.username && !printing && (
            <div className="ig-banner ig-saved" role="status">
              <FileDown size={15} />
              <span>{t("Le PDF de @{name} est-il enregistré ? L’analyse sera alors supprimée pour libérer de la place.", { name: saved })}</span>
              <button type="button" className="btn primary" onClick={() => { setSaved(null); void remove(a.profile.username); }}>{t("Oui, supprimer l’analyse")}</button>
              <button type="button" className="btn ghost" onClick={() => setSaved(null)}>{t("Non, la garder")}</button>
            </div>
          )}
          <Profile a={a} expiresAt={accounts.find((x) => x.username === a.profile.username)?.expiresAt} isMe={meName === a.profile.username} busy={pending.includes(a.profile.username)} img={img} f={f} onRefresh={() => void scan(a.profile.username, true)} onMine={() => void makeMine(a.profile.username)} onExport={() => setPrinting(true)} exporting={printing} />
          {printing ? (
            <>
              <h2 className="ig-report-title">{t("Vue d’ensemble")}</h2>
              <Overview a={a} others={others} isMe={meName === a.profile.username} history={history[a.profile.username] ?? []} f={f} />
              <h2 className="ig-report-title">{t("Ce qui fonctionne")}</h2>
              <Content a={a} f={f} />
              <h2 className="ig-report-title">{t("Publications virales")}</h2>
              <Viral a={a} img={img} f={f} />
              {!!others.length && <><h2 className="ig-report-title">{t("Comparer")}</h2><Compare a={a} others={others} history={history} meName={meName} onOpen={setSelected} img={img} f={f} /></>}
            </>
          ) : (
            <>
          <div className="requests-tabs ig-tabs" role="tablist">
            {([["overview", "Vue d’ensemble"], ["content", "Ce qui fonctionne"], ["viral", "Publications virales"], ["compare", "Comparer"]] as [Tab, string][]).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "selected" : ""} onClick={() => setTab(k)}>{t(l)}</button>
            ))}
          </div>
          {tab === "overview" && <Overview a={a} others={others} isMe={meName === a.profile.username} history={history[a.profile.username] ?? []} f={f} />}
          {tab === "content" && <Content a={a} f={f} />}
          {tab === "viral" && <Viral a={a} img={img} f={f} />}
          {tab === "compare" && <Compare a={a} others={others} history={history} meName={meName} onOpen={setSelected} img={img} f={f} />}
            </>
          )}
        </>
      )}
    </div>
  );
}

type Fmt = { num: (n: number | null | undefined) => string; short: (n: number | null | undefined) => string; x: (v: number | null | undefined) => string; pct: (v: number | null | undefined) => string };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
type Img = (url: string | null | undefined) => string | null;

function timeAgo(iso: string, t: (k: string, p?: Record<string, string | number>) => string) {
  const s = (appNowMs() - Date.parse(iso)) / 1000;
  if (s < 90) return t("à l’instant");
  if (s < 3600) return t("il y a {n} min", { n: Math.round(s / 60) });
  if (s < 86400) return t("il y a {n} h", { n: Math.round(s / 3600) });
  return t("il y a {n} jours", { n: Math.round(s / 86400) });
}

/** « dans 1 j 20 h », « dans 5 h », « dans 12 min ». */
function remaining(iso: string, t: (k: string, p?: Record<string, string | number>) => string) {
  const m = Math.max(0, Math.round((Date.parse(iso) - appNowMs()) / 60_000));
  if (m >= 1440) return t("dans {d} j {h} h", { d: Math.floor(m / 1440), h: Math.floor((m % 1440) / 60) });
  if (m >= 60) return t("dans {h} h", { h: Math.floor(m / 60) });
  return t("dans {n} min", { n: m });
}

function Profile({ a, expiresAt, isMe, busy, img, f, onRefresh, onMine, onExport, exporting }: { a: Analysis; expiresAt?: string; isMe: boolean; busy: boolean; img: Img; f: Fmt; onRefresh: () => void; onMine: () => void; onExport: () => void; exporting: boolean }) {
  const { t } = useI18n();
  const p = a.profile;
  const pic = img(p.profile_picture_url);
  return (
    <Surface asChild tone="default"><section className="work-panel ig-profile">
      <span className="ig-big-av" style={pic ? { backgroundImage: `url('${pic}')` } : undefined} />
      <div className="ig-profile-info">
        <div className="ig-handle">@{p.username}{p.verified && <span className="ig-verified" title={t("Compte vérifié")}>✔</span>}{isMe && <span className="neutral-badge">{t("Mon compte")}</span>}</div>
        <div>{p.name}{p.category && <span className="ig-muted"> · {p.category}</span>}</div>
        <div className="ig-counts"><span><b>{f.num(p.followers_count)}</b> {t("abonnés")}</span><span><b>{f.num(p.follows_count)}</b> {t("abonnements")}</span><span><b>{f.num(p.media_count)}</b> {t("publications")}</span></div>
        {p.biography && <p className="ig-bio">{p.biography}</p>}
        <small className="ig-muted">{t("Analyse des {n} dernières publications · lu {when}", { n: a.posts.length, when: timeAgo(a.fetchedAt, t) })} · <a href={`https://www.instagram.com/${p.username}/`} target="_blank" rel="noopener noreferrer">{t("Ouvrir sur Instagram")} <ExternalLink size={11} /></a></small>
        {expiresAt && <small className="ig-expiry"><Timer size={12} />{t("Supprimée {when} si le PDF n’est pas exporté.", { when: remaining(expiresAt, t) })}</small>}
      </div>
      <div className="ig-profile-actions">
        <button type="button" className="btn" disabled={busy} onClick={onRefresh} title={t("Relire les données (utilise des crédits Apify)")}>{busy ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}{t("Relire")}</button>
        <button type="button" className="btn" disabled={exporting} onClick={onExport}>{exporting ? <Loader2 size={15} className="spin" /> : <FileDown size={15} />}{t("Exporter en PDF")}</button>
        {!isMe && <button type="button" className="btn ghost" onClick={onMine}><Star size={15} />{t("C’est mon compte")}</button>}
      </div>
    </section></Surface>
  );
}

function growth(h: HistoryPoint[]) {
  if (h.length < 2) return null;
  const first = h[0], last = h[h.length - 1];
  return { pct: ((last.followers - first.followers) / (first.followers || 1)) * 100, days: Math.round((Date.parse(last.date) - Date.parse(first.date)) / 86400e3) };
}

function Overview({ a, others, isMe, history, f }: { a: Analysis; others: Analysis[]; isMe: boolean; history: HistoryPoint[]; f: Fmt }) {
  const { t, tag } = useI18n();
  const g = growth(history);
  const kpis: [string, string, string][] = [
    [t("Abonnés"), f.short(a.followers), g ? t("{sign}{pct} % en {days} jours", { sign: g.pct >= 0 ? "+" : "", pct: g.pct.toFixed(1), days: g.days }) : t("la croissance apparaît après 2 lectures")],
    [t("Taux d’engagement"), f.pct(a.avgER), t("moyenne (j’aime + commentaires) ÷ abonnés")],
    [t("Publications par semaine"), a.postsPerWeek.toFixed(1), t("sur les {n} dernières publications", { n: a.posts.length })],
    [t("Vues habituelles d’un reel"), f.short(a.medViews), a.reelCount ? t("médiane de {n} reels", { n: a.reelCount }) : t("aucun reel trouvé")],
    [t("Vues des reels ÷ abonnés"), a.viewsPerFollower ? (a.viewsPerFollower < 0.1 ? `${a.viewsPerFollower.toFixed(3)}×` : f.x(a.viewsPerFollower)) : "–", t("au-dessus de 1× = touche des non-abonnés")],
    [t("Publications virales"), String(a.viralCount), t("2× ou plus qu’une publication habituelle")],
  ];
  const recs = recommendations(a, others);
  // Recommendation values carry French labels (formats, days, lengths): translate them too.
  const tp = (v?: Record<string, string | number>) => v && Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "string" ? t(x) : x]));
  const reels = a.posts.filter((p) => p.type === "REEL" && p.views != null).sort((p, q) => p.date.getTime() - q.date.getTime());
  return (
    <div className="ig-stack">
      <div className="ig-kpis">{kpis.map(([label, value, sub]) => <Surface asChild tone="default" key={label}><div className="metric-card ig-kpi"><span>{label}</span><strong>{value}</strong><small>{sub}</small></div></Surface>)}</div>
      <Surface asChild tone="default"><section className="work-panel">
        <h3>{isMe ? t("Que faire ensuite") : t("Ce qui marche pour @{name}", { name: a.profile.username })}</h3>
        {recs.length ? <ol className="ig-recs">{recs.map((r, i) => <li key={i}><strong>{t(r.title[0], tp(r.title[1]))}</strong><span>{cap(t(r.body[0], tp(r.body[1])))}</span></li>)}</ol>
          : <p className="ig-muted">{t("Pas encore assez de publications pour dégager des tendances : il en faut une dizaine.")}</p>}
      </section></Surface>
      <div className="ig-grid-2">
        <Surface asChild tone="default"><section className="work-panel">
          <h3>{t("Vues par reel")}</h3>
          {reels.length ? (
            <div className="ig-chart"><ResponsiveContainer width="100%" height="100%">
              <BarChart data={reels.map((p) => ({ x: formatTimestamp(p.date, tag, { day: "numeric", month: "short" }), y: p.views, viral: p.viral, hook: hook(p.caption).slice(0, 60), perf: p.perf, url: p.permalink }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="x" tickLine={false} axisLine={false} fontSize={11} stroke={AXIS} minTickGap={16} />
                <YAxis tickLine={false} axisLine={false} fontSize={11} stroke={AXIS} tickFormatter={(v) => f.short(v)} width={44} />
                <Tooltip cursor={{ fill: "var(--t-surface-sunken)" }} content={({ active, payload }) => active && payload?.[0] ? <div className="ig-tip"><b>{String(payload[0].payload.hook || t("(sans légende)"))}</b><span>{t("{views} vues · {x} l’habitude", { views: f.num(payload[0].payload.y), x: f.x(payload[0].payload.perf) })}</span></div> : null} />
                <Bar dataKey="y" radius={[4, 4, 0, 0]} maxBarSize={22} onClick={(d: { payload?: { url?: string } }) => d.payload?.url && window.open(d.payload.url, "_blank", "noopener")}>
                  {reels.map((p) => <Cell key={p.id} fill={p.viral ? AMBER : CHARCOAL} cursor="pointer" />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer></div>
          ) : <p className="ig-empty">{t("Aucun reel dans les publications lues.")}</p>}
          <p className="ig-legend"><i style={{ background: CHARCOAL }} />{t("Reel")}<i style={{ background: AMBER }} />{t("Reel viral (2× et +)")}</p>
        </section></Surface>
        <Surface asChild tone="default"><section className="work-panel">
          <h3>{t("Abonnés")}</h3>
          {history.length >= 2 ? (
            <div className="ig-chart"><ResponsiveContainer width="100%" height="100%">
              <LineChart data={history.map((h) => ({ x: h.date.slice(5), y: h.followers }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="x" tickLine={false} axisLine={false} fontSize={11} stroke={AXIS} />
                <YAxis tickLine={false} axisLine={false} fontSize={11} stroke={AXIS} tickFormatter={(v) => f.short(v)} width={44} domain={["auto", "auto"]} />
                <Tooltip formatter={(v) => [f.num(Number(v)), t("abonnés")]} />
                <Line type="monotone" dataKey="y" stroke={AMBER} strokeWidth={2} dot={history.length < 15} />
              </LineChart>
            </ResponsiveContainer></div>
          ) : <p className="ig-empty">{t("Une seule lecture pour l’instant ({n} abonnés).", { n: f.num(a.followers) })}</p>}
          <p className="ig-muted small">{t("Un relevé est gardé à chaque lecture (au plus un par jour) : relisez ce compte un autre jour pour voir sa croissance.")}</p>
        </section></Surface>
      </div>
    </div>
  );
}

function ScoreBars({ rows, empty, f }: { rows: Scored[]; empty: string; f: Fmt }) {
  const { t } = useI18n();
  if (!rows.some((r) => r.n)) return <p className="ig-empty">{empty}</p>;
  const data = rows.map((r) => ({ label: t(r.label), score: r.n ? r.score : 0, n: r.n }));
  return (
    <div className="ig-chart short"><ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 70, left: 0, bottom: 0 }}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} stroke={AXIS} tickFormatter={(v) => `${Number(v).toFixed(1)}×`} domain={[0, (max: number) => Math.max(1.5, max) * 1.25]} />
        <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} fontSize={12} stroke={AXIS} width={112} />
        <Tooltip cursor={{ fill: "var(--t-surface-sunken)" }} formatter={(v, _n, item) => [t("{x} l’habitude · {n} publications", { x: f.x(Number(v)), n: (item.payload as { n: number }).n }), ""]} />
        <Bar dataKey="score" fill={AMBER} radius={[0, 4, 4, 0]} maxBarSize={22} label={{ position: "right", fontSize: 12, fill: "var(--t-text-muted)", formatter: (v: unknown) => (Number(v) ? f.x(Number(v)) : "") }} />
      </BarChart>
    </ResponsiveContainer></div>
  );
}

function Content({ a, f }: { a: Analysis; f: Fmt }) {
  const { t, tag } = useI18n();
  const [sort, setSort] = useState<{ k: keyof AnalyzedPost; dir: number }>({ k: "date", dir: -1 });
  const bucket = (s: number) => Math.max(0, Math.min(6, Math.floor((s - 0.4) / 0.3)));
  const tags = a.tags.filter((x) => x.count >= 2).slice(0, 25);
  const rows = [...a.posts].sort((p, q) => {
    const va = (p[sort.k] ?? -Infinity) as number | string | Date, vb = (q[sort.k] ?? -Infinity) as number | string | Date;
    return (va > vb ? 1 : va < vb ? -1 : 0) * sort.dir;
  });
  const cols: [keyof AnalyzedPost, string, boolean][] = [["date", "Date", false], ["type", "Type", false], ["caption", "Accroche", false], ["views", "Vues", true], ["likes", "J’aime", true], ["comments", "Commentaires", true], ["er", "Engagement", true], ["perf", "Performance", true]];
  return (
    <div className="ig-stack">
      <div className="ig-grid-3">
        <Surface asChild tone="default"><section className="work-panel"><h3>{t("Par format")}</h3><ScoreBars rows={a.formats.map((x) => ({ label: x.label, score: x.medScore, n: x.count }))} empty={t("Aucune publication.")} f={f} /></section></Surface>
        <Surface asChild tone="default"><section className="work-panel"><h3>{t("Durée des reels")}</h3><ScoreBars rows={a.durations} empty={t("Durées des reels indisponibles.")} f={f} /></section></Surface>
        <Surface asChild tone="default"><section className="work-panel"><h3>{t("Longueur des légendes")}</h3><ScoreBars rows={a.buckets} empty={t("Aucune légende.")} f={f} /></section></Surface>
      </div>
      <p className="ig-muted small">{t("1,0× = une publication habituelle de ce compte ; 2× et plus = virale.")}</p>
      <Surface asChild tone="default"><section className="work-panel">
        <h3>{t("Meilleur moment pour publier")}</h3>
        <p className="ig-muted small">{t("Performance médiane par jour et par créneau de 3 heures, à votre heure.")}</p>
        <div className="ig-heat">
          <span />{BLOCKS.map((b) => <span key={b} className="ig-heat-head">{b}</span>)}
          {a.timing.map((row, d) => (
            <Fragment key={d}>
              <span className="ig-heat-head">{t(DAYS[d])}</span>
              {row.map((c, b) => c.n
                ? <span key={b} className="ig-heat-cell" style={{ background: HEAT[bucket(c.score!)], color: bucket(c.score!) >= 5 ? "var(--t-heat-light-ink)" : "var(--t-heat-dark-ink)" }} title={t("{day} {block} : {x} l’habitude · {n} publication(s)", { day: t(DAYS[d]), block: BLOCKS[b], x: f.x(c.score), n: c.n })}>{f.x(c.score)}</span>
                : <span key={b} className="ig-heat-cell empty" title={t("{day} {block} : aucune publication", { day: t(DAYS[d]), block: BLOCKS[b] })} />)}
            </Fragment>
          ))}
        </div>
        <p className="ig-legend">{t("Plus faible")}{HEAT.map((c) => <i key={c} style={{ background: c }} />)}{t("Plus fort")}</p>
      </section></Surface>
      <Surface asChild tone="default"><section className="work-panel">
        <h3>{t("Hashtags")}</h3>
        {tags.length ? <table className="ig-table"><thead><tr><th>{t("Hashtag")}</th><th className="num">{t("Publications")}</th><th className="num">{t("Performance médiane")}</th></tr></thead>
          <tbody>{tags.map((x) => <tr key={x.tag}><td>{x.tag}</td><td className="num">{x.count}</td><td className={`num ${x.score >= 1.15 ? "up" : x.score <= 0.85 ? "down" : ""}`}>{f.x(x.score)}</td></tr>)}</tbody></table>
          : <p className="ig-empty">{t("Aucun hashtag n’est utilisé sur plus d’une publication.")}</p>}
      </section></Surface>
      <Surface asChild tone="default"><section className="work-panel">
        <h3>{t("Toutes les publications")}</h3>
        <div className="ig-table-wrap"><table className="ig-table sortable">
          <thead><tr>{cols.map(([k, l, n]) => <th key={k} className={n ? "num" : ""} onClick={() => setSort((s) => ({ k, dir: s.k === k ? -s.dir : -1 }))}>{t(l)}{sort.k === k ? (sort.dir > 0 ? " ↑" : " ↓") : ""}</th>)}</tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id}>
              <td>{formatTimestamp(p.date, tag, { day: "numeric", month: "short", year: "2-digit" })}</td>
              <td>{t(TYPE_ONE[p.type])}{p.isPinned ? " 📌" : ""}</td>
              <td className="ig-cap">{p.permalink ? <a href={p.permalink} target="_blank" rel="noopener noreferrer">{hook(p.caption) || t("(sans légende)")}</a> : hook(p.caption)}</td>
              <td className="num">{f.short(p.views)}</td>
              <td className="num">{p.likes == null ? t("masqués") : f.num(p.likes)}</td>
              <td className="num">{f.num(p.comments)}</td>
              <td className="num">{f.pct(p.er)}</td>
              <td className="num">{f.x(p.perf)}{p.viral && <span className="ig-viral">{t("Virale")}</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </section></Surface>
    </div>
  );
}

function PostCard({ p, who, img, f }: { p: AnalyzedPost; who?: string; img: Img; f: Fmt }) {
  const { t, tag } = useI18n();
  const pic = img(p.thumb);
  return (
    <a className="ig-post" href={p.permalink ?? undefined} target="_blank" rel="noopener noreferrer">
      <span className="ig-thumb" style={pic ? { backgroundImage: `url('${pic}')` } : undefined}>
        {!pic && t(TYPE_LABEL[p.type])}
        <span className="ig-badges"><span>{t(TYPE_ONE[p.type])}</span>{p.viral && <span className="ig-viral">{t("Virale")}</span>}</span>
      </span>
      <span className="ig-post-body">
        {who && <small>@{who}</small>}
        <strong>{hook(p.caption).slice(0, 110) || t("(sans légende)")}</strong>
        <span className="ig-stats"><b>{t("{x} l’habitude", { x: f.x(p.perf) })}</b>
          {p.views != null && <span><Play size={12} />{f.short(p.views)}</span>}
          <span><Heart size={12} />{p.likes == null ? t("masqués") : f.short(p.likes)}</span>
          <span><MessageCircle size={12} />{f.short(p.comments)}</span>
          {p.duration ? <span><Timer size={12} />{Math.round(p.duration)} s</span> : null}
        </span>
        <small>{formatTimestamp(p.date, tag, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</small>
      </span>
    </a>
  );
}

function Viral({ a, img, f }: { a: Analysis; img: Img; f: Fmt }) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<"all" | AnalyzedPost["type"]>("all");
  const top = a.posts.filter((p) => filter === "all" || p.type === filter).sort((p, q) => q.perf - p.perf).slice(0, 12);
  return (
    <Surface asChild tone="default"><section className="work-panel">
      <div className="ig-row">
        <div><h3>{t("Les publications qui ont le mieux marché")}</h3><p className="ig-muted small">{t("Classées par rapport à une publication habituelle de ce compte.")}</p></div>
        <div className="requests-tabs">{(["all", "REEL", "CAROUSEL", "IMAGE"] as const).map((k) => <button key={k} type="button" className={filter === k ? "selected" : ""} onClick={() => setFilter(k)}>{k === "all" ? t("Toutes") : t(TYPE_LABEL[k])}</button>)}</div>
      </div>
      {top.length ? <div className="ig-posts">{top.map((p) => <PostCard key={p.id} p={p} img={img} f={f} />)}</div> : <p className="ig-empty">{t("Aucune publication de ce type.")}</p>}
    </section></Surface>
  );
}

function HBars({ data, fmt }: { data: { label: string; v: number; me: boolean }[]; fmt: (v: number) => string }) {
  return (
    <div className="ig-chart short"><ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 70, left: 0, bottom: 0 }}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} fontSize={12} stroke={AXIS} width={120} />
        <Tooltip cursor={{ fill: "var(--t-surface-sunken)" }} formatter={(v) => [fmt(Number(v)), ""]} />
        <Bar dataKey="v" radius={[0, 4, 4, 0]} maxBarSize={20} label={{ position: "right", fontSize: 12, fill: "var(--t-text-muted)", formatter: (v: unknown) => fmt(Number(v)) }}>
          {data.map((d) => <Cell key={d.label} fill={d.me ? AMBER : "var(--t-line-strong)"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer></div>
  );
}

function Compare({ a, others, history, meName, onOpen, img, f }: { a: Analysis; others: Analysis[]; history: Record<string, HistoryPoint[]>; meName?: string; onOpen: (u: string) => void; img: Img; f: Fmt }) {
  const { t } = useI18n();
  const rows = [a, ...others];
  const best = (r: Analysis) => [...r.formats].filter((x) => x.count >= 2).sort((p, q) => q.medScore - p.medScore)[0];
  const bars = (value: (r: Analysis) => number | null) => rows.filter((r) => value(r) != null).sort((p, q) => (value(q) ?? 0) - (value(p) ?? 0)).map((r) => ({ label: `@${r.profile.username}`, v: value(r) as number, me: r.profile.username === a.profile.username }));
  const names = rows.map((r) => r.profile.username).filter((u) => (history[u]?.length ?? 0) >= 2).slice(0, 8);
  const dates = [...new Set(names.flatMap((u) => history[u].map((h) => h.date)))].sort();
  const indexed = dates.map((d) => {
    const row: Record<string, number | string | null> = { x: d.slice(5) };
    for (const u of names) { const h = history[u]; const pt = h.find((p) => p.date === d); row[u] = pt ? (pt.followers / (h[0].followers || 1)) * 100 : null; }
    return row;
  });
  const niche = others.flatMap((c) => c.posts.map((p) => ({ p, who: c.profile.username }))).sort((p, q) => q.p.perf - p.p.perf).slice(0, 12);
  return (
    <div className="ig-stack">
      <Surface asChild tone="default"><section className="work-panel">
        <h3>{t("Tous les comptes suivis")}</h3>
        <div className="ig-table-wrap"><table className="ig-table">
          <thead><tr><th>{t("Compte")}</th><th className="num">{t("Abonnés")}</th><th className="num">{t("Croissance")}</th><th className="num">{t("Publications/sem.")}</th><th className="num">{t("Engagement moyen")}</th><th className="num">{t("Vues habituelles d’un reel")}</th><th className="num">{t("Part de reels")}</th><th>{t("Meilleur format")}</th><th className="num">{t("Virales")}</th></tr></thead>
          <tbody>{rows.map((r) => {
            const u = r.profile.username; const g = growth(history[u] ?? []); const reel = r.formats.find((x) => x.type === "REEL"); const b = best(r);
            return (
              <tr key={u} className={`clickable${u === a.profile.username ? " current" : ""}`} onClick={() => onOpen(u)}>
                <td>@{u}{u === meName && <span className="neutral-badge">{t("Moi")}</span>}</td>
                <td className="num">{f.num(r.followers)}</td>
                <td className="num">{g ? t("{sign}{pct} % / {days} j", { sign: g.pct >= 0 ? "+" : "", pct: g.pct.toFixed(1), days: g.days }) : "–"}</td>
                <td className="num">{r.postsPerWeek.toFixed(1)}</td>
                <td className="num">{f.pct(r.avgER)}</td>
                <td className="num">{f.short(r.medViews)}</td>
                <td className="num">{reel ? Math.round(reel.share * 100) : 0} %</td>
                <td>{b ? t(b.label) : "–"}</td>
                <td className="num">{r.viralCount}/{r.posts.length}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
        {!others.length && <p className="ig-muted small">{t("Analysez d’autres comptes (collez un nom plus haut) pour les comparer ici.")}</p>}
      </section></Surface>
      {!!others.length && (
        <div className="ig-grid-2">
          <Surface asChild tone="default"><section className="work-panel"><h3>{t("Taux d’engagement")}</h3><HBars data={bars((r) => r.avgER)} fmt={(v) => f.pct(v)} /></section></Surface>
          <Surface asChild tone="default"><section className="work-panel"><h3>{t("Vues des reels ÷ abonnés")}</h3><HBars data={bars((r) => r.viewsPerFollower)} fmt={(v) => f.x(v)} /></section></Surface>
        </div>
      )}
      <Surface asChild tone="default"><section className="work-panel">
        <h3>{t("Croissance des abonnés")}</h3>
        <p className="ig-muted small">{names.length ? t("Base 100 au premier relevé de chaque compte, pour comparer des comptes de tailles différentes.") : t("Les relevés s’accumulent à chaque lecture (au plus un par jour) : la croissance apparaît quand un compte a été lu deux jours différents.")}</p>
        {!!names.length && (
          <div className="ig-chart"><ResponsiveContainer width="100%" height="100%">
            <LineChart data={indexed} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="x" tickLine={false} axisLine={false} fontSize={11} stroke={AXIS} />
              <YAxis tickLine={false} axisLine={false} fontSize={11} stroke={AXIS} width={40} domain={["auto", "auto"]} />
              <Tooltip formatter={(v, name) => [Number(v).toFixed(1), `@${name}`]} />
              <Legend formatter={(v) => <span style={{ color: "var(--t-text-body)" }}>@{v}</span>} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              {names.map((u, i) => <Line key={u} type="monotone" dataKey={u} stroke={SERIES[i % SERIES.length]} strokeWidth={2} dot={dates.length < 15} connectNulls />)}
            </LineChart>
          </ResponsiveContainer></div>
        )}
      </section></Surface>
      {!!niche.length && (
        <Surface asChild tone="default"><section className="work-panel">
          <h3>{t("Les meilleures publications des autres comptes")}</h3>
          <div className="ig-posts">{niche.map(({ p, who }) => <PostCard key={`${who}-${p.id}`} p={p} who={who} img={img} f={f} />)}</div>
        </section></Surface>
      )}
    </div>
  );
}

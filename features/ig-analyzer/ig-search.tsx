"use client";
// Instagram search (owner and admins), beside the IG Analyzer: find public profiles by city and theme,
// or read a list of accounts, then sort them by followers or engagement, filter by tier, open one in the
// analyzer, and download the list (CSV, JSON). Server: /api/ig/search (Apify, lib/ig-analyzer/search.ts).
import { useEffect, useMemo, useRef, useState } from "react";
import { BadgeCheck, ChartNoAxesCombined, Download, ExternalLink, Loader2, MapPin, UserSearch, X } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/lib/i18n/locale-provider";
import { runInBackground, useBackgroundJob, useElapsed } from "@/features/workspace/background-work";
import { igSearchBanner } from "@/lib/integration-notices";
import { defaultTerms, searchLimits, toCsv, usdPerProfile, type Search, type SkipReason, type Tier } from "@/lib/ig-analyzer/search-model";

type Kept = Search & { expiresAt: string };
type State = { configured?: boolean; searches: Kept[]; left: number; perDay: number };
type Mode = "discover" | "profiles";

const tiers: Tier[] = ["nano", "micro", "mid", "macro", "mega"];
const tierLabels: Record<Tier, string> = { nano: "Nano", micro: "Micro", mid: "Moyen", macro: "Macro", mega: "Méga" };
const reasonLabels: Record<SkipReason, string> = { not_found: "introuvables", private: "privés", low_followers: "sous le seuil d’abonnés", no_posts: "sans publication" };
const thresholds = [0, 1000, 5000, 10000, 50000];

async function call<T>(workspaceId: string, init?: RequestInit): Promise<T> {
  const response = await fetch("/api/ig/search", { ...init, headers: { "Content-Type": "application/json", "X-Workspace-Id": workspaceId } })
    .catch(() => { throw new Error("Connexion au serveur impossible. Vérifiez votre connexion internet, puis réessayez."); });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "La recherche a échoué. Réessayez.");
  return body;
}

function download(name: string, type: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function IgSearch({ workspaceId, onError, onAnalyze }: {
  workspaceId: string; onError: (message: string) => void; onAnalyze: (username: string) => void;
}) {
  const { t, tag } = useI18n();
  const [state, setState] = useState<State | null>(null);
  const [mode, setMode] = useState<Mode>("discover");
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState("");
  const [terms, setTerms] = useState<string[] | null>(null); // null: built from the city and the theme
  const [usernames, setUsernames] = useState("");
  const [minFollowers, setMinFollowers] = useState(searchLimits.minFollowers);
  const [error, setError] = useState("");
  // A search runs in the background (features/workspace/background-work.tsx): leave the page and come back.
  const jobKey = `ig-search:${workspaceId}`;
  const job = useBackgroundJob(jobKey);
  const running = !!job;
  const elapsed = useElapsed(job?.startedAt);
  const here = useRef(true);
  useEffect(() => { here.current = true; return () => { here.current = false; }; }, []);
  const [selected, setSelected] = useState<string | null>(null);
  const [sort, setSort] = useState<"followers" | "engagement">("followers");
  const [tier, setTier] = useState<Tier | "">("");

  // Read on arrival, and again when a search ends (even one launched before leaving the page).
  useEffect(() => {
    let alive = true;
    call<State>(workspaceId).then((s) => { if (alive) setState(s); }).catch((e) => onError(t((e as Error).message)));
    return () => { alive = false; };
  }, [workspaceId, onError, t, running]);

  const shownTerms = terms ?? defaultTerms(location, category);
  const pasted = usernames.split(/[\s,;]+/).filter(Boolean).length;
  const expected = mode === "discover" ? shownTerms.filter((x) => x.trim()).length * searchLimits.perTerm : pasted;
  const ready = mode === "discover" ? shownTerms.some((x) => x.trim()) : pasted > 0 && pasted <= searchLimits.usernames;
  const current = state?.searches.find((s) => s.id === selected) ?? state?.searches[0] ?? null;
  const shown = useMemo(() => (current?.profiles ?? [])
    .filter((p) => !tier || p.influencer_tier === tier)
    .sort((a, b) => (sort === "engagement" ? (b.engagement_rate ?? -1) - (a.engagement_rate ?? -1) : b.followers - a.followers)), [current, sort, tier]);
  const img = (url: string | null) => (url ? `/api/ig/img?ws=${encodeURIComponent(workspaceId)}&u=${encodeURIComponent(url)}` : undefined);
  const number = (n: number | null) => (n === null ? "—" : n.toLocaleString(tag));
  const label = (s: Search) => s.mode === "discover" ? [s.category, s.location].filter(Boolean).join(" · ") || s.terms[0] : t("{n} comptes", { n: s.profiles.length + Object.values(s.skipped).flat().length });
  const fileName = (s: Search, ext: string) => `instagram-${(label(s) || "recherche").toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${s.at.slice(0, 10)}.${ext}`;

  function run() {
    setError("");
    const body = mode === "discover"
      ? { action: "discover", location, category, terms: shownTerms.filter((x) => x.trim()), minFollowers }
      : { action: "profiles", usernames, minFollowers };
    runInBackground({
      key: jobKey,
      label: mode === "discover"
        ? t("Recherche Instagram « {what} »", { what: [category, location].map((x) => x.trim()).filter(Boolean).join(" · ") || shownTerms[0] })
        : t("Recherche Instagram : {n} comptes", { n: pasted }),
      work: () => call<State & { search: Search }>(workspaceId, { method: "POST", body: JSON.stringify(body) }),
      // On the page, the results simply appear; elsewhere, a notice says they're ready.
      done: (next) => {
        setState((s) => ({ ...s, ...next })); setSelected(next.search.id); setTier("");
        return here.current ? null : t("Recherche Instagram terminée : {n} profils gardés.", { n: next.search.profiles.length });
      },
      failed: (e) => { if (here.current) { setError(t(e.message)); return null; } return t(e.message); },
    });
  }
  async function remove(id: string) {
    try {
      const next = await call<State>(workspaceId, { method: "POST", body: JSON.stringify({ action: "remove", id }) });
      setState((s) => ({ ...s, ...next }));
      if (selected === id) setSelected(null);
    } catch (e) { onError(t((e as Error).message)); }
  }

  const skippedLine = current ? (Object.entries(current.skipped) as [SkipReason, string[]][]).filter(([, list]) => list.length).map(([reason, list]) => `${list.length} ${t(reasonLabels[reason])}`).join(" · ") : "";

  return (
    <div className="ig-page igs-page">
      <div className="page-heading">
        <span className="page-symbol" aria-hidden="true"><UserSearch size={22} /></span>
        <div className="heading-line"><h1>{t("Recherche Instagram")}</h1></div>
        <p>{t("Trouvez des créateurs et des comptes publics par ville et par thème, ou lisez une liste de comptes : abonnés, palier d’influence et taux d’engagement sur leurs dernières publications.")}</p>
      </div>
      {state?.configured === false && <p className="meetings-setup">{t(igSearchBanner(workspaceId))}</p>}

      <Surface asChild tone="default"><form className="work-panel igs-form" onSubmit={(e) => { e.preventDefault(); if (ready && !running) run(); }}>
        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList>
            <TabsTrigger value="discover"><MapPin size={14} />{t("Par ville et thème")}</TabsTrigger>
            <TabsTrigger value="profiles"><UserSearch size={14} />{t("Comptes précis")}</TabsTrigger>
          </TabsList>
        </Tabs>
        {mode === "discover" ? (
          <>
            <div className="form-pair">
              <label className="form-field"><span>{t("Ville")}</span><input value={location} maxLength={60} placeholder={t("Casablanca")} onChange={(e) => setLocation(e.target.value)} /></label>
              <label className="form-field"><span>{t("Thème")}</span><input value={category} maxLength={60} placeholder={t("coach sportif, food, mode…")} onChange={(e) => setCategory(e.target.value)} /></label>
            </div>
            <div className="form-field">
              <span>{t("Recherches envoyées à Instagram")}</span>
              <div className="igs-terms">
                {shownTerms.map((term, i) => (
                  <input key={i} value={term} maxLength={60} aria-label={t("Recherche {n}", { n: i + 1 })} onChange={(e) => setTerms(shownTerms.map((x, j) => (j === i ? e.target.value : x)))} />
                ))}
                {shownTerms.length < searchLimits.terms && <button type="button" className="btn ghost" onClick={() => setTerms([...shownTerms, ""])}>{t("+ une recherche")}</button>}
                {terms && <button type="button" className="btn ghost" onClick={() => setTerms(null)}>{t("Rétablir")}</button>}
              </div>
              <small className="composer-hint">{t("Instagram cherche ces mots dans les noms, les pseudos et les bios : ce n’est pas une recherche par lieu. Écrivez-les comme les comptes les écrivent (« coach sportif casablanca »).")}</small>
            </div>
          </>
        ) : (
          <label className="form-field"><span>{t("Comptes (un @nom ou un lien par ligne, {n} au plus)", { n: searchLimits.usernames })}</span>
            <textarea rows={5} value={usernames} placeholder={"@natgeo\nhttps://www.instagram.com/nasa/"} onChange={(e) => setUsernames(e.target.value)} />
          </label>
        )}
        <div className="igs-run">
          <label className="form-field igs-min"><span>{t("Abonnés au moins")}</span>
            <select value={minFollowers} onChange={(e) => setMinFollowers(Number(e.target.value))}>
              {thresholds.map((n) => <option key={n} value={n}>{n.toLocaleString(tag)}</option>)}
            </select>
          </label>
          <p className="igs-cost">
            {t("≈ {n} profils · ≈ {usd} $ Apify", { n: expected, usd: (expected * usdPerProfile).toFixed(2) })}
            {state && <> · {t("{left} recherches restantes aujourd’hui sur {total}", { left: state.left, total: state.perDay })}</>}
          </p>
          <button className="btn primary" disabled={!ready || running || state?.left === 0}>
            {running ? <Loader2 size={15} className="spin" /> : <UserSearch size={15} />}{t("Rechercher")}
          </button>
        </div>
      </form></Surface>

      {running && <p className="ig-banner"><Loader2 size={15} className="spin" />{t("Recherche sur Instagram… {s} s (souvent 30 à 90 secondes) · vous pouvez quitter cette page, elle continue.", { s: elapsed })}</p>}
      {error && <p className="ig-banner error" role="alert">{error}</p>}

      {!!state?.searches.length && (
        <div className="ig-chips">
          {state.searches.map((s) => (
            <div key={s.id} className={`ig-chip${current?.id === s.id ? " selected" : ""}`} title={t("Supprimée {when}.", { when: new Date(s.expiresAt).toLocaleString(tag, { weekday: "short", hour: "2-digit", minute: "2-digit" }) })}>
              <button type="button" onClick={() => { setSelected(s.id); setTier(""); }}>{s.mode === "discover" ? <MapPin size={13} /> : <UserSearch size={13} />}{label(s)}<small>{s.profiles.length}</small></button>
              <button type="button" className="ig-chip-x" onClick={() => void remove(s.id)} aria-label={t("Retirer cette recherche")}><X size={13} /></button>
            </div>
          ))}
        </div>
      )}

      {!current ? (!running && (
        <div className="meetings-empty"><UserSearch size={26} /><strong>{t("Aucune recherche")}</strong><p>{t("Cherchez par ville et thème pour trouver des créateurs, ou collez les comptes d’un client et de ses concurrents.")}</p></div>
      )) : (
        <Surface asChild tone="default"><section className="work-panel igs-results">
          <div className="section-head igs-head">
            <div>
              <h2>{t("{n} profils gardés", { n: current.profiles.length })}</h2>
              <p className="small-note">{[current.terms.length ? t("Recherches : {list}", { list: current.terms.join(" · ") }) : "", skippedLine && t("Écartés : {list}", { list: skippedLine })].filter(Boolean).join(" — ")}</p>
            </div>
            <div className="inline igs-actions">
              <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label={t("Trier")}>
                <option value="followers">{t("Par abonnés")}</option>
                <option value="engagement">{t("Par engagement")}</option>
              </select>
              <button type="button" className="btn" disabled={!current.profiles.length} onClick={() => download(fileName(current, "csv"), "text/csv;charset=utf-8", "﻿" + toCsv(current.profiles))}><Download size={14} />CSV</button>
              <button type="button" className="btn" disabled={!current.profiles.length} onClick={() => download(fileName(current, "json"), "application/json", JSON.stringify(current.profiles, null, 2))}><Download size={14} />JSON</button>
            </div>
          </div>
          <div className="igs-tiers" role="group" aria-label={t("Palier d’influence")}>
            <button type="button" className={tier ? "" : "on"} onClick={() => setTier("")}>{t("Tous")} <small>{current.profiles.length}</small></button>
            {tiers.map((x) => {
              const n = current.profiles.filter((p) => p.influencer_tier === x).length;
              return n ? <button key={x} type="button" className={tier === x ? "on" : ""} onClick={() => setTier(x)}>{t(tierLabels[x])} <small>{n}</small></button> : null;
            })}
          </div>
          {!shown.length ? <p className="small-note">{t("Aucun profil ne passe les filtres de cette recherche.")}</p> : (
            <ul className="igs-list">
              {shown.map((p) => (
                <li key={p.username} className="igs-row">
                  <span className="ig-big-av igs-av" style={p.profile_pic ? { backgroundImage: `url('${img(p.profile_pic)}')` } : undefined} />
                  <div className="igs-main">
                    <div className="igs-name">
                      <a href={p.profile_url} target="_blank" rel="noopener noreferrer">@{p.username}</a>
                      {p.is_verified && <BadgeCheck size={14} className="igs-verified" aria-label={t("Compte vérifié")} />}
                      {p.full_name && <span>{p.full_name}</span>}
                    </div>
                    {p.bio && <p className="igs-bio" dir="auto">{p.bio}</p>}
                    <div className="igs-tags">
                      <span className={`igs-tier ${p.influencer_tier}`}>{t(tierLabels[p.influencer_tier])}</span>
                      {p.business_category && <span>{p.business_category}</span>}
                      {p.says_location && <span className="igs-here"><MapPin size={11} />{t("Mentionne {city}", { city: p.location ?? "" })}</span>}
                    </div>
                    {!!p.post_engagement.length && (
                      <div className="igs-thumbs">
                        {p.post_engagement.slice(0, searchLimits.thumbnails).map((post, i) => post.thumb && (
                          <a key={i} href={post.url ?? p.profile_url} target="_blank" rel="noopener noreferrer" style={{ backgroundImage: `url('${img(post.thumb)}')` }} aria-label={t("Publication {n}", { n: i + 1 })} />
                        ))}
                      </div>
                    )}
                  </div>
                  <dl className="igs-stats">
                    <div><dt>{t("Abonnés")}</dt><dd>{number(p.followers)}</dd></div>
                    <div><dt>{t("Engagement")}</dt><dd>{p.engagement_rate === null ? "—" : `${p.engagement_rate.toLocaleString(tag)} %`}</dd></div>
                    <div><dt>{t("J’aime moy.")}</dt><dd>{number(p.avg_likes)}</dd></div>
                  </dl>
                  <div className="igs-row-actions">
                    <button type="button" className="btn" onClick={() => onAnalyze(p.username)}><ChartNoAxesCombined size={14} />{t("Analyser")}</button>
                    <a className="btn ghost" href={p.profile_url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />Instagram</a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section></Surface>
      )}
    </div>
  );
}

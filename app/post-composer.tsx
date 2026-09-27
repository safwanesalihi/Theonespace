"use client";
// The Social hub's composer: one post, published to several networks, each in its own format and,
// if wanted, with its own caption. Photos and videos upload straight to storage; the preview shows
// what each network will display. Saving never publishes: « Programmer » queues the post for its
// date and time (after the client's approval when that client approves posts), « Publier maintenant »
// sends it at once.
import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Clock, Copy, Repeat, ExternalLink, ImagePlus, Link2, Loader2, Play, Send, ShieldCheck, Sparkles, Trash2, TriangleAlert, Undo2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import DatePicker from "@/app/date-picker";
import NetworkIcon from "@/app/network-icon";
import PostPreview from "@/app/post-preview";
import { AiFix, AiSuggestions, askAi, useAiAvailable } from "@/app/ai-assist";
import { acceptedMedia, uploadMedia } from "@/app/media-upload";
import { useI18n } from "@/app/locale-provider";
import type { RecordItem } from "@/lib/model";
import {
  autoNetworks, captionLimits, captionFor, formatLabels, formatsFor, limits, mediaOf, networkLabels, networks, postStatus, problemsFor,
  statusLabels, targetsOf, type Network, type SocialMedia, type SocialTarget,
} from "@/lib/social";
import { nextRepeatDay, normalizeRepeat, repeatLabel, type PostRepeat } from "@/lib/social-repeat";
import { shiftDay } from "@/lib/flow";

type Draft = { name: string; clientId: string; due: string; time: string; description: string; targets: SocialTarget[]; media: SocialMedia[]; repeat: PostRepeat | null };
type Upload = { key: string; name: string; progress: number };
type Mutate = (body: Record<string, unknown>) => Promise<{ id?: string } | undefined>;

const defaultFormat: Record<Network, SocialTarget["format"]> = { instagram: "post", facebook: "post", tiktok: "video", youtube: "short" };

function draftFrom(post: RecordItem | null, platforms: RecordItem[], defaults: { due?: string; clientId?: string }, today: string): Draft {
  if (!post) return { name: "", clientId: defaults.clientId || "", due: defaults.due || today, time: "18:00", description: "", targets: [{ network: "instagram", format: "post" }], media: [], repeat: null };
  return {
    name: post.name, clientId: post.clientId || "", due: post.due || today, time: post.time || "18:00", description: post.description || "",
    targets: targetsOf(post, platforms).map((t) => ({ ...t })), media: mediaOf(post).map((m) => ({ ...m })), repeat: post.repeat ?? null,
  };
}

export default function PostComposer({
  open, post, defaults, clients, platforms, fixedClientId, workspaceId, today, nowKey, mediaStorage, accounts, onClose, onSaved, mutate, onPublished, onNotice,
}: {
  open: boolean;
  post: RecordItem | null;
  defaults: { due?: string; clientId?: string };
  clients: RecordItem[];
  platforms: RecordItem[];
  fixedClientId?: string;
  workspaceId: string;
  today: string;
  nowKey: string;
  /** Uploading needs the app's storage; a Google Drive link never does. */
  mediaStorage: boolean;
  /** The clients' connected accounts: shows where each network will post, or that it can't. */
  accounts: { clientId: string; network: Network; name: string; status: "ok" | "expired" }[];
  onClose: () => void;
  /** A new post got its id: the parent keeps it open on that post. */
  onSaved: (postId: string) => void;
  mutate: Mutate;
  onPublished: (postId: string) => Promise<void> | void;
  onNotice: (text: string) => void;
}) {
  const { t, tag } = useI18n();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(post, platforms, defaults, today));
  const [initial, setInitial] = useState(() => JSON.stringify(draftFrom(post, platforms, defaults, today)));
  const [postId, setPostId] = useState<string | null>(post?.id ?? null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState("");
  const [custom, setCustom] = useState<Network[]>([]);
  const [preview, setPreview] = useState<Network>("instagram");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [changeUrl, setChangeUrl] = useState<Partial<Record<Network, string>>>({});
  const [driveLink, setDriveLink] = useState("");
  const [driveBusy, setDriveBusy] = useState(false);
  // Writing help: captions (and a title for the post) or YouTube titles proposed by the AI.
  const aiAvailable = useAiAvailable();
  const [aiBusy, setAiBusy] = useState<"" | "caption" | "title">("");
  const [aiCaptions, setAiCaptions] = useState<{ captions: string[]; title: string; checks: string[] } | null>(null);
  const [aiTitles, setAiTitles] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);

  // A different post (or a new one) opens with its own content.
  const openedFor = `${open}:${post?.id ?? "new"}:${defaults.due ?? ""}:${defaults.clientId ?? ""}`;
  const [openedKey, setOpenedKey] = useState(openedFor);
  if (openedKey !== openedFor) {
    const fresh = draftFrom(post, platforms, defaults, today);
    setOpenedKey(openedFor);
    setDraft(fresh);
    setInitial(JSON.stringify(fresh));
    setPostId(post?.id ?? null);
    setUploads([]);
    setError("");
    setChangeUrl({});
    setAiCaptions(null);
    setAiTitles([]);
    setCustom(fresh.targets.filter((x) => !!x.caption?.trim() || !!x.title).map((x) => x.network));
    setPreview(fresh.targets[0]?.network ?? "instagram");
  }

  const client = clients.find((c) => c.id === draft.clientId);
  const dirty = JSON.stringify(draft) !== initial;
  const shape: RecordItem = { ...(post ?? { id: "new", kind: "editorial_post", revision: 0, name: "", createdAt: "" }), description: draft.description, targets: draft.targets, media: draft.media };
  const problems = draft.targets.map((target) => ({ target, list: problemsFor(shape, target) }));
  const blocking = problems.filter((p) => p.list.length);
  const status = post ? postStatus(post, client, platforms, nowKey) : "draft";
  const results = post?.publishResults ?? {};
  const approvalNeeded = !!client?.postApproval;
  const approved = post?.approval?.state === "approved" && !dirty;
  const selected = new Set(draft.targets.map((x) => x.network));
  const tightest = draft.targets.length ? Math.min(...draft.targets.map((x) => captionLimits[x.network])) : captionLimits.instagram;

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const setTarget = (network: Network, patch: Partial<SocialTarget>) =>
    set({ targets: draft.targets.map((x) => (x.network === network ? { ...x, ...patch } : x)) });
  /**
   * Captions from the AI, which looks at the post's photos and videos. `auto` (a Drive link just pasted
   * into a post with no text yet): the first caption goes straight into the text, the others stay offered.
   */
  async function suggestCaptions(media = draft.media, auto = false) {
    // The shared text is written for the first network; a network's own text can be corrected on its own.
    const target = draft.targets[0] ?? { network: "instagram" as Network, format: "post" as const };
    setAiBusy("caption"); setError("");
    try {
      const data = await askAi<{ captions: string[]; title: string; checks: string[] }>(workspaceId, {
        action: "caption", network: target.network, format: target.format, clientId: fixedClientId || draft.clientId,
        brief: draft.name, current: auto ? "" : draft.description,
        media: { images: media.filter((m) => m.type === "image").length, videos: media.filter((m) => m.type === "video").length },
        files: media.map((m) => ({ url: m.url, type: m.type, ...(m.mime ? { mime: m.mime } : {}) })),
      });
      setAiCaptions(data);
      if (auto) setDraft((d) => (d.description.trim() ? d : { ...d, description: data.captions[0], name: d.name.trim() || data.title }));
    } catch (e) { setError(t((e as Error).message)); }
    finally { setAiBusy(""); }
  }
  async function suggestTitles(format: string) {
    setAiBusy("title"); setError("");
    try {
      const data = await askAi<{ titles: string[] }>(workspaceId, { action: "title", format, clientId: fixedClientId || draft.clientId, brief: draft.name, current: draft.description });
      setAiTitles(data.titles);
    } catch (e) { setError(t((e as Error).message)); }
    finally { setAiBusy(""); }
  }
  function toggleNetwork(network: Network) {
    if (selected.has(network)) set({ targets: draft.targets.filter((x) => x.network !== network) });
    else set({ targets: [...draft.targets, { network, format: defaultFormat[network] }].sort((a, b) => networks.indexOf(a.network) - networks.indexOf(b.network)) });
  }
  function move(index: number, by: number) {
    const next = [...draft.media];
    const [item] = next.splice(index, 1);
    next.splice(Math.max(0, Math.min(next.length, index + by)), 0, item);
    set({ media: next });
  }

  async function pick(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    const list = Array.from(files).slice(0, Math.max(0, 35 - draft.media.length));
    for (const file of list) {
      const key = `${file.name}:${Date.now()}:${Math.random()}`;
      setUploads((u) => [...u, { key, name: file.name, progress: 0 }]);
      try {
        const media = await uploadMedia(file, workspaceId, (progress) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, progress } : x))));
        setDraft((d) => ({ ...d, media: [...d.media, media] }));
      } catch (e) {
        setError(t((e as Error).message));
      } finally {
        setUploads((u) => u.filter((x) => x.key !== key));
      }
    }
    if (input.current) input.current.value = "";
  }

  async function addFromDrive(pasted?: string) {
    const link = (pasted ?? driveLink).trim();
    if (!link) return;
    setDriveBusy(true);
    setError("");
    try {
      const response = await fetch("/api/editorial/media/drive", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Workspace-Id": workspaceId },
        body: JSON.stringify({ link }),
      });
      const data = (await response.json().catch(() => ({}))) as { url?: string; thumb?: string; type?: "image" | "video"; mime?: string; name?: string; error?: string };
      if (!response.ok || !data.url || !data.type) throw new Error(data.error || "Lien Google Drive illisible.");
      const media: SocialMedia = { url: data.url, type: data.type, source: "drive", thumb: data.thumb, mime: data.mime, name: data.name };
      setDraft((d) => (d.media.some((m) => m.url === media.url) ? d : { ...d, media: [...d.media, media] }));
      setDriveLink("");
      // No text yet: the AI writes it from the file and says what to check.
      if (aiAvailable && !draft.description.trim() && !draft.media.some((m) => m.url === media.url)) void suggestCaptions([...draft.media, media], true);
    } catch (e) {
      setError(t((e as Error).message));
    } finally {
      setDriveBusy(false);
    }
  }

  function payload(socialState: "draft" | "scheduled") {
    const name = draft.name.trim() || draft.description.trim().split("\n")[0].slice(0, 80) || t("Publication du {date}", { date: draft.due });
    return {
      name, clientId: fixedClientId || draft.clientId, due: draft.due, time: draft.time, description: draft.description, socialState,
      ...(post?.repeatOf ? {} : { repeat: draft.repeat }),
      targets: draft.targets.map((x) => ({ network: x.network, format: x.format, ...(custom.includes(x.network) && x.caption?.trim() ? { caption: x.caption } : {}), ...(x.network === "youtube" && x.title?.trim() ? { title: x.title.trim() } : {}) })),
      media: draft.media.map((m) => (m.source === "drive"
        ? { url: m.url, type: m.type, source: "drive", ...(m.thumb ? { thumb: m.thumb } : {}), ...(m.mime ? { mime: m.mime } : {}), ...(m.name ? { name: m.name.slice(0, 200) } : {}) }
        : { url: m.url, type: m.type, ...(m.path ? { path: m.path } : {}) })),
    };
  }

  async function save(socialState: "draft" | "scheduled", silent = false): Promise<string | null> {
    if (!(fixedClientId || draft.clientId)) { setError(t("Choisissez un client.")); return null; }
    if (!draft.targets.length) { setError(t("Choisissez au moins un réseau.")); return null; }
    if (socialState === "scheduled" && blocking.length) { setError(`${networkLabels[blocking[0].target.network]} : ${t(blocking[0].list[0])}`); return null; }
    const data = payload(socialState);
    const saved = postId && post
      ? await mutate({ action: "update", kind: "editorial_post", id: postId, revision: post.revision, data })
      : await mutate({ action: "create", kind: "editorial_post", data });
    const id = postId ?? saved?.id ?? null;
    if (id) { setPostId(id); if (!postId) onSaved(id); }
    setInitial(JSON.stringify(draft));
    if (!silent) {
      onNotice(t(socialState === "draft" ? "Brouillon enregistré." : approvalNeeded && !approved ? "Programmé · envoyé au client pour validation." : "Programmé."));
    }
    return id;
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    try { await fn(); } catch (e) { setError(t((e as Error).message)); } finally { setBusy(""); }
  }

  const schedule = () => run("schedule", async () => { if (await save("scheduled")) onClose(); });
  const saveDraft = () => run("draft", async () => { await save("draft"); });
  const unschedule = () => run("unschedule", async () => { await save("draft"); });
  const publishNow = () => run("publish", async () => {
    const id = await save("scheduled", true);
    if (!id) return;
    const response = await fetch("/api/editorial/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Workspace-Id": workspaceId },
      body: JSON.stringify({ postId: id }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string; results?: Record<string, { ok: boolean; pending?: boolean; error?: string; platform: string }> };
    await onPublished(id);
    if (!response.ok) throw new Error(data.error || "Publication impossible. Réessayez.");
    const outcomes = Object.values(data.results ?? {});
    const failed = outcomes.filter((r) => !r.ok && !r.pending);
    if (failed.length) setError(failed.map((r) => `${r.platform} : ${r.error}`).join(" · "));
    else onNotice(t(outcomes.some((r) => r.pending) ? "Publication lancée · Instagram termine le traitement." : "Publié."));
  });
  const approveForClient = () => run("approve", async () => {
    if (!postId) return;
    await mutate({ action: "post-approve", postId });
    onNotice(t("Validation du client enregistrée."));
  });
  const markDone = (network: Network) => run(`mark:${network}`, async () => {
    if (!postId) return;
    await mutate({ action: "post-mark-published", postId, network, url: changeUrl[network] || "" });
    onNotice(t("Marqué comme publié sur {network}.", { network: networkLabels[network] }));
  });
  const remove = () => run("delete", async () => {
    if (!postId || !post) return;
    await mutate({ action: "delete", kind: "editorial_post", id: postId, revision: post.revision });
    setConfirmDelete(false);
    onNotice(t("Publication supprimée."));
    onClose();
  });
  function duplicate() {
    const copy = { ...draft, name: draft.name ? `${draft.name} (copie)` : "" };
    setPostId(null);
    setDraft(copy);
    setInitial("");
    onNotice(t("Copie prête : choisissez sa date, puis enregistrez."));
  }

  const clientName = client?.name || t("Agence");
  const working = !!busy || uploads.length > 0;
  // The network whose preview is shown: the one picked, or the first still selected.
  const previewTarget = draft.targets.find((x) => x.network === preview) ?? draft.targets[0];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !working) onClose(); }}>
      <DialogContent className="tracker-modal composer-modal">
        <DialogHeader>
          <DialogTitle>{postId ? t("Publication") : t("Nouvelle publication")}</DialogTitle>
          <DialogDescription>
            {post ? <span className={`post-status ${status}`}>{t(statusLabels[status])}</span> : t("Un contenu, plusieurs réseaux, chacun dans son format.")}
            {post?.approval?.state === "changes" && post.approval.note && <span className="composer-note"> · {t("Retour du client :")} « {post.approval.note} »</span>}
          </DialogDescription>
        </DialogHeader>

        <div className="composer-grid">
          <div className="composer-form">
            <div className="form-pair">
              {!fixedClientId && (
                <label className="form-field">
                  <span>{t("Client")}</span>
                  <Select value={draft.clientId || "__none"} onValueChange={(v) => set({ clientId: v === "__none" ? "" : v })}>
                    <SelectTrigger className="pick" aria-label={t("Client")}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">{t("Choisir un client")}</SelectItem>
                      <SelectItem value="internal">{t("Agence")}</SelectItem>
                      {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </label>
              )}
              <label className="form-field">
                <span>{t("Titre interne")}<AiFix value={draft.name} kind="title" workspaceId={workspaceId} onChange={(name) => set({ name })} /></span>
                <input value={draft.name} maxLength={160} placeholder={t("Ex. Lancement menu d’automne")} onChange={(e) => set({ name: e.target.value })} />
              </label>
            </div>
            <div className="form-pair">
              <label className="form-field"><span>{t("Date")}</span><DatePicker label={t("Date")} value={draft.due} onChange={(v) => set({ due: v || today })} /></label>
              <label className="form-field"><span>{t("Heure")}</span><input type="time" value={draft.time} onChange={(e) => set({ time: e.target.value || "18:00" })} /></label>
            </div>
            {post?.repeatOf ? (
              <p className="composer-repeat-note"><Repeat size={13} />{t("Publication d’une série répétée : modifiez la série pour changer les prochaines.")}</p>
            ) : (
              <RepeatField repeat={draft.repeat} start={draft.due} time={draft.time} onChange={(repeat) => set({ repeat })} />
            )}

            <div className="form-field">
              <span>{t("Réseaux")}</span>
              <div className="composer-networks">
                {networks.map((n) => (
                  <button key={n} type="button" className={`composer-network ${selected.has(n) ? "selected" : ""}`} aria-pressed={selected.has(n)} onClick={() => toggleNetwork(n)}>
                    <NetworkIcon network={n} size={15} />{networkLabels[n]}
                  </button>
                ))}
              </div>
            </div>

            {draft.targets.map((target) => (
              <div key={target.network} className="composer-target">
                <div className="composer-target-head">
                  <NetworkIcon network={target.network} size={15} badge />
                  <div className="composer-formats" role="group" aria-label={t("Format")}>
                    {formatsFor[target.network].map((f) => (
                      <button key={f} type="button" className={target.format === f ? "selected" : ""} aria-pressed={target.format === f} onClick={() => setTarget(target.network, { format: f })}>{t(formatLabels[f])}</button>
                    ))}
                  </div>
                  <label className="composer-custom">
                    <input type="checkbox" checked={custom.includes(target.network)} onChange={(e) => setCustom((c) => (e.target.checked ? [...c, target.network] : c.filter((x) => x !== target.network)))} />
                    {t("Texte propre")}
                  </label>
                </div>
                {(() => {
                  const account = accounts.find((a) => a.clientId === (fixedClientId || draft.clientId) && a.network === target.network);
                  return account && account.status === "ok"
                    ? <p className="composer-account ok"><Check size={12} />{t("Publié sur {name}", { name: account.name })}</p>
                    : <p className="composer-account"><TriangleAlert size={12} />{t(account ? "Connexion expirée : reconnectez le compte dans « Comptes »." : "Compte non connecté : connectez-le dans « Comptes » pour publier.")}</p>;
                })()}
                {target.network === "youtube" && (
                  <>
                    <div className="composer-title-row">
                      <input className="composer-title" value={target.title || ""} maxLength={limits.titleLength} placeholder={t("Titre de la vidéo YouTube")} onChange={(e) => setTarget("youtube", { title: e.target.value })} />
                      {aiAvailable && (
                        <button type="button" className="ai-button" disabled={!!aiBusy || (!draft.name.trim() && !draft.description.trim())} onClick={() => suggestTitles(target.format)} title={t("Donnez un titre interne ou un texte, l’IA propose des titres.")}>
                          {aiBusy === "title" ? <Loader2 size={12} className="spin" /> : <Sparkles size={12} />}{t("Suggérer")}
                        </button>
                      )}
                    </div>
                    <AiSuggestions items={aiTitles} onPick={(title) => { setTarget("youtube", { title }); setAiTitles([]); }} onClose={() => setAiTitles([])} />
                  </>
                )}
                {custom.includes(target.network) && (
                  <>
                    <textarea rows={3} value={target.caption || ""} placeholder={t("Texte pour {network} seulement…", { network: networkLabels[target.network] })} onChange={(e) => setTarget(target.network, { caption: e.target.value })} />
                    <AiFix value={target.caption || ""} kind="caption" workspaceId={workspaceId} onChange={(caption) => setTarget(target.network, { caption })} />
                  </>
                )}
                {problems.find((p) => p.target.network === target.network)?.list.map((p) => <p key={p} className="composer-problem"><TriangleAlert size={13} />{t(p)}</p>)}
              </div>
            ))}

            <label className="form-field">
              <span>
                {t("Texte")}
                <span className="ai-actions">
                  {aiAvailable && (
                    <button type="button" className="ai-button" disabled={!!aiBusy || (!draft.name.trim() && !draft.description.trim() && !draft.media.length)} onClick={() => void suggestCaptions()} title={t("L’IA regarde les photos et vidéos et propose trois textes, à partir du titre interne ou de vos notes.")}>
                      {aiBusy === "caption" ? <Loader2 size={12} className="spin" /> : <Sparkles size={12} />}{t("Rédiger avec l’IA")}
                    </button>
                  )}
                  <AiFix value={draft.description} kind="caption" workspaceId={workspaceId} onChange={(description) => set({ description })} />
                  <small className="composer-count">{draft.description.length} / {tightest}</small>
                </span>
              </span>
              <textarea rows={6} value={draft.description} maxLength={captionLimits.facebook} placeholder={t("Le texte publié, hashtags compris…")} onChange={(e) => set({ description: e.target.value })} />
            </label>
            {aiBusy === "caption" && <p className="ai-working"><Loader2 size={13} className="spin" />{t("L’IA regarde le média et écrit le texte…")}</p>}
            {!!aiCaptions?.checks.length && (
              <div className="ai-checks" role="status">
                <strong><TriangleAlert size={13} />{t("À vérifier avant de publier")}</strong>
                <ul>{aiCaptions.checks.map((c) => <li key={c}>{c}</li>)}</ul>
              </div>
            )}
            <AiSuggestions
              items={aiCaptions?.captions ?? []}
              onPick={(description) => { set({ description, ...(!draft.name.trim() && aiCaptions?.title ? { name: aiCaptions.title } : {}) }); setAiCaptions((x) => (x?.checks.length ? { ...x, captions: [] } : null)); }}
              onClose={() => setAiCaptions((a) => (a?.checks.length ? { ...a, captions: [] } : null))}
            />

            <div className="form-field">
              <span>{t("Photos et vidéos")}<small className="composer-count">{draft.media.length}</small></span>
              <div className="composer-media">
                {draft.media.map((m, i) => (
                  <figure key={m.url} className="composer-thumb" title={m.name}>
                    {m.source === "drive" ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element -- Drive's own preview of the file */}
                        <img src={m.thumb} alt="" />
                        {m.type === "video" && <Play size={14} className="composer-play" />}
                        <span className="composer-drive">Drive</span>
                      </>
                    ) : m.type === "video" ? <><video src={m.url} muted preload="metadata" /><Play size={14} className="composer-play" /></> : (
                      // eslint-disable-next-line @next/next/no-img-element -- a user upload on the storage origin, shown as is
                      <img src={m.url} alt="" />
                    )}
                    <figcaption>
                      <button type="button" aria-label={t("Avant")} disabled={i === 0} onClick={() => move(i, -1)}><ArrowLeft size={12} /></button>
                      <span>{i + 1}</span>
                      <button type="button" aria-label={t("Après")} disabled={i === draft.media.length - 1} onClick={() => move(i, 1)}><ArrowRight size={12} /></button>
                      <button type="button" aria-label={t("Retirer")} onClick={() => set({ media: draft.media.filter((_, j) => j !== i) })}><X size={12} /></button>
                    </figcaption>
                  </figure>
                ))}
                {uploads.map((u) => (
                  <figure key={u.key} className="composer-thumb uploading"><Loader2 size={16} className="spin" /><small>{Math.round(u.progress * 100)} %</small></figure>
                ))}
                {mediaStorage && (
                  <button type="button" className="composer-add" disabled={draft.media.length >= 35} onClick={() => input.current?.click()}>
                    <ImagePlus size={18} /><span>{t("Importer")}</span>
                  </button>
                )}
                <input ref={input} type="file" hidden multiple accept={acceptedMedia} onChange={(e) => void pick(e.target.files)} />
              </div>
              <div className="composer-drive-link">
                <Link2 size={15} />
                <input
                  value={driveLink}
                  placeholder={t("Lien Google Drive du fichier…")}
                  aria-label={t("Lien Google Drive")}
                  onChange={(e) => setDriveLink(e.target.value)}
                  onPaste={(e) => {
                    // A pasted Drive link is added at once, no click needed.
                    const pasted = e.clipboardData.getData("text").trim();
                    if (!driveBusy && /^https:\/\/(drive|docs)\.google\.com\//.test(pasted)) { e.preventDefault(); setDriveLink(pasted); void addFromDrive(pasted); }
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addFromDrive(); } }}
                />
                <button type="button" className="btn" disabled={driveBusy || !driveLink.trim() || draft.media.length >= 35} onClick={() => void addFromDrive()}>
                  {driveBusy ? <Loader2 size={14} className="spin" /> : null}{t("Ajouter")}
                </button>
              </div>
              <small className="composer-hint">{t("Un fichier par lien, partagé en « Tous les utilisateurs disposant du lien ». Photos en JPEG pour Instagram.")}</small>
            </div>

            {post && Object.keys(results).length > 0 && (
              <div className="composer-results">
                {targetsOf(post, platforms).map((x) => {
                  const r = results[x.network];
                  return (
                    <div key={x.network} className={`composer-result ${r?.ok ? "ok" : r?.pending ? "pending" : r ? "failed" : ""}`}>
                      <NetworkIcon network={x.network} size={14} />
                      {r?.ok ? <>{t("Publié")} {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer">{t("Voir")}<ExternalLink size={11} /></a>}</>
                        : r?.pending ? <><Clock size={13} />{t("En cours de traitement…")}</>
                        : r ? <><TriangleAlert size={13} />{r.error}</>
                        : <span>{t("Pas encore publié")}</span>}
                    </div>
                  );
                })}
              </div>
            )}

            {post && draft.targets.filter((x) => results[x.network] && !results[x.network].ok && !results[x.network].pending).map((x) => (
              <div key={x.network} className="composer-manual">
                <NetworkIcon network={x.network} size={14} badge />
                <span>{t("Publié autrement sur {network} ?", { network: networkLabels[x.network] })}</span>
                <input value={changeUrl[x.network] || ""} placeholder={t("Lien de la publication (facultatif)")} onChange={(e) => setChangeUrl((c) => ({ ...c, [x.network]: e.target.value }))} />
                <button type="button" className="btn" disabled={!!busy} onClick={() => void markDone(x.network)}><Check size={14} />{t("Marquer comme publié")}</button>
              </div>
            ))}

            {approvalNeeded && (
              <p className="composer-approval">
                <ShieldCheck size={14} />
                {post?.approval?.state === "approved" && !dirty
                  ? t("Validé par {name} le {date}.", { name: post.approval.by || t("le client"), date: new Date(post.approval.at).toLocaleDateString(tag, { day: "numeric", month: "short" }) })
                  : post?.approval?.state === "pending" && !dirty
                    ? t("En attente de la validation du client, dans son portail.")
                    : t("Ce client valide ses publications : en programmant, elle lui est envoyée pour validation.")}
                {post?.approval?.state === "pending" && !dirty && (
                  <button type="button" className="text-link" disabled={!!busy} onClick={() => void approveForClient()}>{t("Il a validé autrement (WhatsApp…)")}</button>
                )}
              </p>
            )}
            {error && <p className="form-error" role="alert">{error}</p>}
          </div>

          <aside className="composer-preview" aria-label={t("Aperçu")}>
            <div className="composer-preview-tabs">
              {draft.targets.map((x) => (
                <button key={x.network} type="button" className={previewTarget?.network === x.network ? "selected" : ""} onClick={() => setPreview(x.network)}>
                  <NetworkIcon network={x.network} size={14} />
                </button>
              ))}
            </div>
            {previewTarget ? (
              <PostPreview target={previewTarget} media={draft.media} caption={captionFor({ ...shape, description: draft.description } as RecordItem, custom.includes(previewTarget.network) ? previewTarget : { ...previewTarget, caption: "" })} account={clientName} />
            ) : <p className="small-note">{t("Choisissez un réseau pour voir l’aperçu.")}</p>}
          </aside>
        </div>

        <DialogFooter className="modal-footer composer-footer">
          {postId && post && (
            <>
              <button type="button" className="btn ghost danger" disabled={working} onClick={() => setConfirmDelete(true)}><Trash2 size={14} />{t("Supprimer")}</button>
              <button type="button" className="btn ghost" disabled={working} onClick={duplicate}><Copy size={14} />{t("Dupliquer")}</button>
            </>
          )}
          <div className="grow" />
          {post?.socialState === "scheduled" && !post.publishedAt && (
            <button type="button" className="btn" disabled={working} onClick={() => void unschedule()}><Undo2 size={14} />{t("Repasser en brouillon")}</button>
          )}
          <button type="button" className="btn" disabled={working} onClick={() => void saveDraft()}>
            {busy === "draft" ? <Loader2 size={14} className="spin" /> : null}{t("Enregistrer le brouillon")}
          </button>
          <button type="button" className="btn" disabled={working || !!post?.publishedAt} onClick={() => void schedule()}>
            {busy === "schedule" ? <Loader2 size={14} className="spin" /> : <Clock size={14} />}
            {t(approvalNeeded && !approved ? "Programmer et envoyer au client" : "Programmer")}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={working || !!post?.publishedAt || !!draft.repeat || (approvalNeeded && !approved) || !draft.targets.some((x) => autoNetworks.includes(x.network))}
            title={draft.repeat ? t("Une publication répétée part d’elle-même chaque jour prévu.") : approvalNeeded && !approved ? t("Attend la validation du client") : undefined}
            onClick={() => void publishNow()}
          >
            {busy === "publish" ? <Loader2 size={14} className="spin" /> : <Send size={14} />}{t("Publier maintenant")}
          </button>
        </DialogFooter>
        {dirty && postId && <p className="composer-dirty"><CheckCircle2 size={12} />{t("Modifications non enregistrées")}</p>}

        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("Supprimer cette publication ?")}</AlertDialogTitle>
              <AlertDialogDescription>{t("Elle disparaît du calendrier, ses photos et vidéos aussi. Ce qui est déjà publié sur les réseaux y reste.")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("Annuler")}</AlertDialogCancel>
              <AlertDialogAction onClick={(e) => { e.preventDefault(); void remove(); }}>{t("Supprimer")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

const weekdayShort = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
const weekOrder = [1, 2, 3, 4, 5, 6, 0];

/** « Répéter » : once, every day, some weekdays, or every month — with an optional last day and the next dates. */
function RepeatField({ repeat, start, time, onChange }: { repeat: PostRepeat | null; start: string; time: string; onChange: (repeat: PostRepeat | null) => void }) {
  const { t, tag } = useI18n();
  const rule = normalizeRepeat(repeat, start);
  const choose = (every: PostRepeat["every"] | "none") => onChange(every === "none" ? null : normalizeRepeat({ every, until: repeat?.until }, start)!);
  const toggleDay = (d: number) => {
    const days = rule?.days ?? [];
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
    if (next.length) onChange({ ...rule!, days: next });
  };
  const next: string[] = [];
  for (let day = rule ? nextRepeatDay(rule, start) : null; day && next.length < 4; day = nextRepeatDay(rule!, shiftDay(day, 1))) next.push(day);
  const fmt = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(tag, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const label = rule ? repeatLabel(rule, t) : null;
  return (
    <div className="form-field composer-repeat">
      <span><Repeat size={13} />{t("Répéter")}</span>
      <div className="requests-tabs composer-repeat-tabs" role="radiogroup" aria-label={t("Répéter")}>
        {([["none", "Une seule fois"], ["day", "Tous les jours"], ["week", "Chaque semaine"], ["month", "Chaque mois"]] as const).map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={(rule?.every ?? "none") === k} className={(rule?.every ?? "none") === k ? "selected" : ""} onClick={() => choose(k)}>{t(l)}</button>
        ))}
      </div>
      {rule?.every === "week" && (
        <div className="composer-weekdays" role="group" aria-label={t("Jours de la semaine (un ou plusieurs)")}>
          {weekOrder.map((d) => (
            <button key={d} type="button" aria-pressed={rule.days?.includes(d)} className={rule.days?.includes(d) ? "selected" : ""} onClick={() => toggleDay(d)}>{t(weekdayShort[d])}</button>
          ))}
        </div>
      )}
      {rule && (
        <>
          <label className="composer-repeat-until">
            <span>{t("Jusqu’au (facultatif)")}</span>
            <DatePicker label={t("Jusqu’au")} value={rule.until ?? ""} onChange={(v) => onChange({ ...rule, until: v || undefined })} />
            {rule.until && <button type="button" className="text-link" onClick={() => onChange({ ...rule, until: undefined })}>{t("Sans fin")}</button>}
          </label>
          <small className="composer-repeat-next">
            {label && <strong>{t(label[0], label[1])} · {time}</strong>}
            {next.length ? ` — ${t("prochaines : {dates}", { dates: next.map(fmt).join(", ") })}${rule.until ? "" : "…"}` : ` — ${t("aucune date avant la fin choisie.")}`}
          </small>
        </>
      )}
    </div>
  );
}

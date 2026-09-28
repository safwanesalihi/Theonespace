"use client";
// « Plan Éditorial » inside a client (tracker → client → tab « Plan Éditorial »): the client's months,
// each one a mind map built by hand — branches (series, themes) around the month, and a reel, post or
// story on each branch. Every node is a real task: a click opens it (title, type, branch, date, status,
// assignee, idea, Drive link), a drag moves it to another branch. No AI. Server: app/api/content-plan.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, ArrowLeft, CalendarDays, Copy, Download, ExternalLink, FileDown, FileUp, Loader2, Plus, Share2 } from "lucide-react";
import { useI18n } from "@/app/locale-provider";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { statuses, type Status } from "@/lib/model";
import { itemTypeLabels, itemTypes, nextMonth, type Branch, type ContentPlan, type ItemType } from "@/lib/content-plan";
import MindMap, { TypeIcon, type MapItem } from "@/app/content-plan-map";

type Item = MapItem & { revision: number; assignee?: string; assigneeId?: string; deliverable?: string };
type Member = { userId: string; name: string };
type Detail = { plan: ContentPlan; items: Item[]; comments: { taskId: string }[]; members: Member[]; canEdit: boolean };
type Summary = { id: string; month: string; shared: boolean; archived: boolean; branches: number; items: number };
type Overview = { plans: Summary[]; canEdit: boolean };

const thisMonth = () => new Date().toISOString().slice(0, 7);
/** « octobre 2026 » in the interface language. */
export function useMonthName() {
  const { date } = useI18n();
  return useCallback((month: string) => date(`${month}-15`, { month: "long", year: "numeric" }), [date]);
}

function useApi(workspaceId: string) {
  const headers = useMemo(() => ({ "Content-Type": "application/json", "X-Workspace-Id": workspaceId }), [workspaceId]);
  const get = useCallback(async <T,>(query: Record<string, string>): Promise<T> => {
    const r = await fetch(`/api/content-plan?${new URLSearchParams(query)}`, { headers, cache: "no-store" });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "Chargement impossible.");
    return data as T;
  }, [headers]);
  const post = useCallback(async <T,>(body: Record<string, unknown>): Promise<T> => {
    const r = await fetch("/api/content-plan", { method: "POST", headers, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || "Action impossible."), { problems: data.problems as string[] | undefined });
    return data as T;
  }, [headers]);
  return { get, post };
}

/** The message for a failed call, with the first problems found in an uploaded file. */
const failure = (e: unknown, t: (s: string) => string) => {
  const { message, problems } = e as Error & { problems?: string[] };
  return [t(message), ...(problems ?? []).slice(0, 4)].join(" — ");
};

/** « Importer (JSON) »: picks a file, reads it and hands the parsed JSON over (or says it isn't JSON). */
function ImportButton({ busy, onFile, onError, label }: { busy: boolean; onFile: (json: unknown) => void; onError: (s: string) => void; label: string }) {
  const { t } = useI18n();
  return (
    <label className={`btn${busy ? " disabled" : ""}`} aria-disabled={busy}>
      {busy ? <Loader2 size={14} className="spin" /> : <FileUp size={14} />}{t(label)}
      <input type="file" accept="application/json,.json" hidden disabled={busy} onChange={async (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        if (file.size > 1_000_000) { onError(t("Fichier trop lourd (1 Mo au plus).")); return; }
        try { onFile(JSON.parse(await file.text())); } catch { onError(t("Ce fichier n’est pas du JSON valide.")); }
      }} />
    </label>
  );
}

// ---------------------------------------------------------------- one node

function ItemDialog({ item, branches, members, comments, busy, onClose, onSave, onOpenTask }: {
  item: Item; branches: Branch[]; members: Member[]; comments: number; busy: boolean;
  onClose: () => void; onSave: (patch: Record<string, unknown>) => void; onOpenTask: (id: string) => void;
}) {
  const { t } = useI18n();
  const initial = {
    name: item.name, planType: item.planType, planBranch: item.planBranch, due: item.due ?? "", status: item.status ?? "À faire",
    assigneeId: item.assigneeId ?? "", planContent: item.planContent ?? "", deliverable: item.deliverable ?? "",
  };
  const [f, setF] = useState(initial);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const changes = Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== initial[k as keyof typeof initial]));
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="tracker-modal cp-item-dialog">
        <DialogHeader>
          <DialogTitle>{t("Contenu")}</DialogTitle>
          <DialogDescription>{t("Chaque contenu est une vraie tâche : statut, date et assignation se retrouvent partout dans l’app.")}</DialogDescription>
        </DialogHeader>
        <div className="form-fields">
          <label className="form-field title-field"><span>{t("Titre")}</span><input dir="auto" value={f.name} maxLength={160} onChange={(e) => set("name", e.target.value)} /></label>
          <div className="form-field"><span>{t("Type")}</span>
            <div className="mm-types" role="group">{itemTypes.map((ty) => <button key={ty} type="button" className={f.planType === ty ? "on" : ""} onClick={() => set("planType", ty)}><TypeIcon type={ty} />{t(itemTypeLabels[ty])}</button>)}</div>
          </div>
          <div className="form-pair">
            <label className="form-field"><span>{t("Branche")}</span><select value={f.planBranch} onChange={(e) => set("planBranch", e.target.value)}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            <label className="form-field"><span>{t("Date de publication")}</span><input type="date" value={f.due} onChange={(e) => set("due", e.target.value)} /></label>
          </div>
          <div className="form-pair">
            <label className="form-field"><span>{t("Statut")}</span><select value={f.status} onChange={(e) => set("status", e.target.value as Status)}>{statuses.map((s) => <option key={s} value={s}>{t(s)}</option>)}</select></label>
            <label className="form-field"><span>{t("Assigné")}</span><select value={f.assigneeId} onChange={(e) => set("assigneeId", e.target.value)}><option value="">—</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select></label>
          </div>
          <label className="form-field"><span>{t("Idée / contenu")}</span><textarea dir="auto" rows={5} maxLength={3000} value={f.planContent} onChange={(e) => set("planContent", e.target.value)} placeholder={t("Ce que le contenu dit ou montre, l’accroche, les personnes…")} /></label>
          <label className="form-field"><span>{t("Lien Drive")}</span><input value={f.deliverable} onChange={(e) => set("deliverable", e.target.value)} placeholder="https://…" /></label>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn ghost" disabled={busy} onClick={() => { if (window.confirm(t("Archiver ce contenu ? Rien n’est supprimé."))) onSave({ archived: true }); }}><Archive size={14} />{t("Archiver")}</button>
          <button type="button" className="btn" onClick={() => onOpenTask(item.id)}><ExternalLink size={14} />{t("Ouvrir la tâche")}{comments ? ` · ${comments}` : ""}</button>
          <button type="button" className="btn primary" disabled={busy || !f.name.trim() || !Object.keys(changes).length} onClick={() => onSave(changes)}>{busy ? <Loader2 size={14} className="spin" /> : null}{t("Enregistrer")}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- one month

function PlanDetail({ workspaceId, planId, onBack, onChanged, onNotice, onError, onOpenTask }: {
  workspaceId: string; planId: string; onBack: () => void; onChanged: () => void;
  onNotice: (s: string) => void; onError: (s: string) => void; onOpenTask: (id: string) => void;
}) {
  const { t } = useI18n();
  const monthName = useMonthName();
  const { get, post } = useApi(workspaceId);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);

  const load = useCallback(async () => { setDetail(await get<Detail>({ planId })); }, [get, planId]);
  useEffect(() => {
    let alive = true;
    get<Detail>({ planId }).then((d) => { if (alive) setDetail(d); }).catch((e) => onError(t((e as Error).message)));
    return () => { alive = false; };
  }, [get, planId, onError, t]);

  const run = async (key: string, body: Record<string, unknown>, notice?: string) => {
    setBusy(key);
    let ok = true;
    try {
      const data = await post<{ notice?: string }>(body);
      await load(); onChanged();
      if (notice || data.notice) onNotice(t(data.notice ?? notice!));
    } catch (e) { ok = false; onError(failure(e, t)); await load().catch(() => {}); }
    setBusy("");
    return ok;
  };
  if (!detail) return <div className="loading"><Loader2 className="spin" /></div>;
  const { plan, items, canEdit } = detail;
  const editable = canEdit && !plan.archived;
  const setBranches = (branches: Branch[]) => run("branches", { action: "update-plan", planId: plan.id, revision: plan.revision, patch: { branches } });
  const patchItem = (item: Item, patch: Record<string, unknown>) => run(`item:${item.id}`, { action: "update-item", itemId: item.id, revision: item.revision, patch });
  const comments = (id: string) => detail.comments.filter((c) => c.taskId === id).length;
  const opened = items.find((i) => i.id === open) ?? null;
  const importFile = async (file: unknown) => {
    setBusy("import");
    try {
      const r = await post<{ count: number }>({ action: "import", clientId: plan.clientId, planId: plan.id, file });
      await load(); onChanged(); onNotice(t("Plan importé : {n} contenus.", { n: r.count }));
    } catch (e) { onError(failure(e, t)); }
    setBusy("");
  };

  return (
    <div className="cp-detail">
      <button type="button" className="text-link back" onClick={onBack}><ArrowLeft size={14} />{t("Tous les mois")}</button>
      <div className="section-head cp-detail-head">
        <h2><span className="cp-month">{monthName(plan.month)}</span>{plan.archived && <span className="cp-tag">{t("Archivé")}</span>}{plan.shared && <span className="cp-tag">{t("Partagé avec le client")}</span>}</h2>
        <div className="inline cp-actions">
          {editable && <button type="button" className="btn" disabled={!!busy} onClick={() => void run("share", { action: plan.shared ? "unshare" : "share", planId: plan.id }, plan.shared ? "Le client ne voit plus ce plan." : "Plan partagé avec le client.")}><Share2 size={14} />{t(plan.shared ? "Ne plus partager" : "Partager avec le client")}</button>}
          {editable && <ImportButton busy={busy === "import"} label="Importer (JSON)" onError={onError} onFile={(file) => void importFile(file)} />}
          {canEdit && <button type="button" className="btn" disabled={!!busy} onClick={() => void run("dup", { action: "duplicate", planId: plan.id })}><Copy size={14} />{t("Dupliquer vers le mois suivant")}</button>}
          <a className="btn" href={`/plan-editorial/print?plan=${encodeURIComponent(plan.id)}&ws=${encodeURIComponent(workspaceId)}`} target="_blank" rel="noopener"><FileDown size={14} />{t("Exporter PDF")}</a>
          {canEdit && <button type="button" className="btn ghost" disabled={!!busy} onClick={() => { if (plan.archived || window.confirm(t("Archiver ce mois et ses contenus ? Rien n’est supprimé."))) void run("arch", { action: plan.archived ? "unarchive" : "archive", planId: plan.id }, plan.archived ? "Plan désarchivé." : "Plan archivé."); }}>{plan.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}{t(plan.archived ? "Désarchiver" : "Archiver")}</button>}
        </div>
      </div>
      {editable && <p className="small-note cp-hint">{t("Ajoutez des branches (séries, thèmes), puis des contenus sur chaque branche. Glissez un contenu d’une branche à l’autre ; cliquez dessus pour le modifier.")}</p>}

      <MindMap
        title={monthName(plan.month)} branches={plan.branches} items={items} editable={editable} comments={comments}
        onOpen={(i) => setOpen(i.id)}
        onAddBranch={(name) => void setBranches([...plan.branches, { id: crypto.randomUUID(), name }])}
        onRenameBranch={(id, name) => void setBranches(plan.branches.map((b) => (b.id === id ? { ...b, name } : b)))}
        onRemoveBranch={(b) => {
          const n = items.filter((i) => i.planBranch === b.id && !i.archived).length;
          if (window.confirm(n ? t("Retirer « {name} » ? Ses {n} contenus seront archivés (rien n’est supprimé).", { name: b.name, n }) : t("Retirer la branche « {name} » ?", { name: b.name }))) {
            void run("branch", { action: "remove-branch", planId: plan.id, branchId: b.id });
          }
        }}
        onAddItem={(branchId, type: ItemType, name) => void run("add", { action: "add-item", planId: plan.id, planBranch: branchId, planType: type, name })}
        onMoveItem={(item, branchId) => void patchItem(item as Item, { planBranch: branchId })}
      />

      <section className="work-panel cp-notes">
        <h3>{t("Notes du mois")}</h3>
        <textarea dir="auto" rows={4} disabled={!editable} value={notes ?? plan.notes} placeholder={t("L’angle du mois, les événements, ce qu’il faut valider avec le client…")}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => { if (notes !== null && notes !== plan.notes) void run("notes", { action: "update-plan", planId: plan.id, revision: plan.revision, patch: { notes } }).then(() => setNotes(null)); }} />
      </section>

      {opened && <ItemDialog key={`${opened.id}:${opened.revision}`} item={opened} branches={plan.branches} members={detail.members} comments={comments(opened.id)} busy={!!busy}
        onClose={() => setOpen(null)} onOpenTask={onOpenTask}
        onSave={(patch) => void patchItem(opened, patch).then((ok) => { if (ok) setOpen(null); })} />}
    </div>
  );
}

// ---------------------------------------------------------------- new month

function NewPlanDialog({ plans, busy, onClose, onCreate }: { plans: Summary[]; busy: boolean; onClose: () => void; onCreate: (month: string, copy: boolean) => void }) {
  const { t } = useI18n();
  const monthName = useMonthName();
  const months = useMemo(() => Array.from({ length: 14 }, (_, i) => nextMonth(thisMonth(), i - 1)), []);
  const taken = new Set(plans.filter((p) => !p.archived).map((p) => p.month));
  const [month, setMonth] = useState(() => months.slice(1).find((m) => !taken.has(m)) ?? months[1]);
  const hasPrevious = plans.some((p) => !p.archived && p.month < month);
  const [copy, setCopy] = useState(true);
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="tracker-modal">
        <DialogHeader>
          <DialogTitle>{t("Nouveau plan")}</DialogTitle>
          <DialogDescription>{t("Un mois vide, que vous remplissez à la main.")}</DialogDescription>
        </DialogHeader>
        <div className="form-fields">
          <label className="form-field"><span>{t("Mois")}</span>
            <select value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m) => <option key={m} value={m} disabled={taken.has(m)}>{monthName(m)}{taken.has(m) ? ` · ${t("déjà planifié")}` : ""}</option>)}
            </select>
          </label>
          {hasPrevious && <label className="cp-check"><input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />{t("Reprendre les branches du mois précédent")}</label>}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>{t("Annuler")}</button>
          <button type="button" className="btn primary" disabled={busy || taken.has(month)} onClick={() => onCreate(month, hasPrevious && copy)}>{busy ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}{t("Créer")}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- the page

export default function ContentPlanPage({ workspaceId, clientId, clientName, onNotice, onError, onOpenTask, onRecordsChanged }: {
  workspaceId: string; clientId: string; clientName: string;
  onNotice: (s: string) => void; onError: (s: string) => void; onOpenTask: (id: string) => void;
  /** The plan's nodes are real tasks: lets the tracker refresh its own list after a change here. */
  onRecordsChanged?: () => void;
}) {
  const { t } = useI18n();
  const monthName = useMonthName();
  const { get, post } = useApi(workspaceId);
  const [data, setData] = useState<Overview | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [planId, setPlanId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    try { setData(await get<Overview>({ clientId })); onRecordsChanged?.(); } catch (e) { onError(t((e as Error).message)); }
  }, [get, clientId, onError, t, onRecordsChanged]);
  useEffect(() => {
    let alive = true;
    get<Overview>({ clientId }).then((d) => { if (alive) setData(d); }).catch((e) => onError(t((e as Error).message)));
    return () => { alive = false; };
  }, [get, clientId, onError, t]);

  const create = async (month: string, copyBranches: boolean) => {
    setBusy(true);
    try {
      const r = await post<{ plan: ContentPlan }>({ action: "create", clientId, month, copyBranches });
      await load(); setCreating(false); setPlanId(r.plan.id);
    } catch (e) { onError(t((e as Error).message)); }
    setBusy(false);
  };

  const importNew = async (file: unknown) => {
    setBusy(true);
    try {
      const r = await post<{ plan: ContentPlan; count: number }>({ action: "import", clientId, file });
      await load(); setPlanId(r.plan.id); onNotice(t("Plan importé : {n} contenus.", { n: r.count }));
    } catch (e) { onError(failure(e, t)); }
    setBusy(false);
  };

  const plans = (data?.plans ?? []).filter((p) => showArchived || !p.archived);
  return (
    <div className="cp-page">
      <div className="page-heading cp-heading">
        <span className="page-symbol" aria-hidden="true"><CalendarDays size={22} /></span>
        <div className="heading-line">
          <h1>{t("Plan Éditorial")}</h1>
          {!planId && data?.canEdit && (
            <div className="inline cp-actions">
              <a className="btn ghost" href="/plan-editorial-modele.json" download><Download size={14} />{t("Modèle JSON")}</a>
              <ImportButton busy={busy} label="Importer (JSON)" onError={onError} onFile={(file) => void importNew(file)} />
              <button type="button" className="btn primary" onClick={() => setCreating(true)}><Plus size={15} />{t("Nouveau plan")}</button>
            </div>
          )}
        </div>
        <p>{t("Le plan de contenu de {name}, mois par mois, en carte mentale.", { name: clientName })}</p>
      </div>

      {!data ? <div className="loading"><Loader2 className="spin" /></div>
        : planId ? (
          <PlanDetail workspaceId={workspaceId} planId={planId} onBack={() => { setPlanId(null); void load(); }} onChanged={() => onRecordsChanged?.()} onNotice={onNotice} onError={onError} onOpenTask={onOpenTask} />
        ) : (
          <section className="work-panel cp-plans">
            <div className="section-head">
              <h2>{t("Mois")} <small>{plans.length}</small></h2>
              {data.plans.some((p) => p.archived) && <button type="button" className="btn ghost" onClick={() => setShowArchived(!showArchived)}>{t(showArchived ? "Masquer les archives" : "Afficher les archives")}</button>}
            </div>
            {!plans.length ? <p className="small-note">{t("Aucun plan pour l’instant : « Nouveau plan » pour commencer un mois.")}</p> : (
              <ul className="cp-plan-list">
                {plans.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => setPlanId(p.id)}>
                      <b>{monthName(p.month)}</b>
                      <span>{t("{b} branches · {n} contenus", { b: p.branches, n: p.items })}</span>
                      {p.shared && <span className="cp-tag">{t("Partagé")}</span>}
                      {p.archived && <span className="cp-tag">{t("Archivé")}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      {creating && data && <NewPlanDialog plans={data.plans} busy={busy} onClose={() => setCreating(false)} onCreate={(m, c) => void create(m, c)} />}
    </div>
  );
}

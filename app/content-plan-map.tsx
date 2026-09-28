"use client";
// The Plan Éditorial mind map: the month in the centre, its branches (series) on both sides, and every
// reel, post or story as a node on its branch. Editable in the studio (add a branch or a node, rename,
// drag a node onto another branch, open it), read-only in the client portal. Lines are drawn in one SVG
// measured from the laid-out cards, so the layout itself stays plain CSS (and a single column on phones).
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Circle, Clapperboard, GripVertical, Image as ImageIcon, MessageCircle, Pencil, Plus, Trash2, X } from "lucide-react";
import { useI18n } from "@/app/locale-provider";
import { statusClass, type Status } from "@/lib/model";
import { itemTypeLabels, itemTypes, type Branch, type ItemType } from "@/lib/content-plan";

export type MapItem = { id: string; name: string; due?: string; status?: Status; planBranch: string; planType: ItemType; planContent?: string; archived?: boolean };

export const TypeIcon = ({ type, size = 13 }: { type: ItemType; size?: number }) =>
  type === "reel" ? <Clapperboard size={size} /> : type === "post" ? <ImageIcon size={size} /> : <Circle size={size} />;

type Props = {
  title: string;
  branches: Branch[];
  items: MapItem[];
  editable: boolean;
  comments?: (itemId: string) => number;
  onOpen: (item: MapItem) => void;
  onAddBranch?: (name: string) => void;
  onRenameBranch?: (id: string, name: string) => void;
  onRemoveBranch?: (branch: Branch) => void;
  onAddItem?: (branchId: string, type: ItemType, name: string) => void;
  onMoveItem?: (item: MapItem, branchId: string) => void;
};

/** A short input: Enter saves, leaving the field saves what was typed and closes, Escape gives up.
 *  With `again`, Enter empties the field for the next entry instead of closing it. */
function InlineInput({ initial = "", placeholder, onDone, onCancel, again }: { initial?: string; placeholder: string; onDone: (v: string) => void; onCancel: () => void; again?: boolean }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (close: boolean) => {
    const v = value.trim();
    if (v && !done.current) onDone(v);
    if (again && !close) { setValue(""); return; }
    done.current = true;
    onCancel();
  };
  return (
    <input className="mm-input" autoFocus value={value} placeholder={placeholder} maxLength={160}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => { if (!done.current) finish(true); }}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); finish(false); } if (e.key === "Escape") { done.current = true; onCancel(); } }} />
  );
}

function BranchCard({ branch, items, editable, comments, onOpen, onRename, onRemove, onAdd, onDrop, headRef }: {
  branch: Branch; items: MapItem[]; editable: boolean; comments?: (id: string) => number; onOpen: (i: MapItem) => void;
  onRename?: (name: string) => void; onRemove?: () => void; onAdd?: (type: ItemType, name: string) => void; onDrop?: (itemId: string) => void;
  headRef: (el: HTMLElement | null) => void;
}) {
  const { t, date } = useI18n();
  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState<ItemType | null>(null);
  const [over, setOver] = useState(false);
  return (
    <section className={`mm-branch${over ? " over" : ""}`}
      onDragOver={editable ? (e) => { e.preventDefault(); setOver(true); } : undefined}
      onDragLeave={editable ? () => setOver(false) : undefined}
      onDrop={editable ? (e) => { e.preventDefault(); setOver(false); const id = e.dataTransfer.getData("text/plan-item"); if (id) onDrop?.(id); } : undefined}>
      <header ref={headRef} className="mm-branch-head">
        {renaming
          ? <InlineInput initial={branch.name} placeholder={t("Nom de la branche")} onDone={(v) => { if (v !== branch.name) onRename?.(v); }} onCancel={() => setRenaming(false)} />
          : <h3 dir="auto">{branch.name}</h3>}
        <small>{items.length}</small>
        {editable && !renaming && <>
          <button type="button" className="mm-icon" aria-label={t("Renommer")} title={t("Renommer")} onClick={() => setRenaming(true)}><Pencil size={13} /></button>
          <button type="button" className="mm-icon" aria-label={t("Retirer la branche")} title={t("Retirer la branche")} onClick={onRemove}><Trash2 size={13} /></button>
        </>}
      </header>
      <ul className="mm-nodes">
        {items.map((it) => (
          <li key={it.id}>
            <button type="button" className={`mm-node ${it.planType}`} draggable={editable}
              onDragStart={(e) => { e.dataTransfer.setData("text/plan-item", it.id); e.dataTransfer.effectAllowed = "move"; }}
              onClick={() => onOpen(it)}>
              {editable && <GripVertical size={12} className="mm-grip" aria-hidden="true" />}
              <span className="mm-type" title={t(itemTypeLabels[it.planType])}><TypeIcon type={it.planType} /></span>
              <span className="mm-name" dir="auto">{it.name}</span>
              {!!comments?.(it.id) && <span className="mm-count"><MessageCircle size={11} />{comments(it.id)}</span>}
              {it.due && <small>{date(it.due, { day: "numeric", month: "short" })}</small>}
              <span className={`mm-dot ${statusClass[it.status ?? "À faire"]}`} title={t(it.status ?? "À faire")} />
            </button>
          </li>
        ))}
        {!items.length && !adding && <li className="mm-empty">{t(editable ? "Aucun contenu : ajoutez-en un ci-dessous." : "Aucun contenu.")}</li>}
      </ul>
      {editable && (adding
        ? <div className="mm-add-form">
            <div className="mm-types" role="group">
              {itemTypes.map((ty) => <button key={ty} type="button" className={adding === ty ? "on" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => setAdding(ty)}><TypeIcon type={ty} />{t(itemTypeLabels[ty])}</button>)}
            </div>
            <InlineInput again placeholder={t("Titre du contenu, puis Entrée")} onDone={(v) => onAdd?.(adding, v)} onCancel={() => setAdding(null)} />
            <button type="button" className="mm-icon" aria-label={t("Fermer")} onClick={() => setAdding(null)}><X size={13} /></button>
          </div>
        : <button type="button" className="mm-add" onClick={() => setAdding("reel")}><Plus size={13} />{t("Ajouter un contenu")}</button>)}
    </section>
  );
}

export default function MindMap({ title, branches, items, editable, comments, onOpen, onAddBranch, onRenameBranch, onRemoveBranch, onAddItem, onMoveItem }: Props) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const center = useRef<HTMLDivElement>(null);
  const heads = useRef(new Map<string, HTMLElement>());
  const [lines, setLines] = useState<{ id: string; d: string }[]>([]);
  const [naming, setNaming] = useState(false);

  const live = items.filter((i) => !i.archived);
  // Nodes whose branch is gone (an older plan) still show, on a branch of their own.
  const orphans = live.filter((i) => !branches.some((b) => b.id === i.planBranch));
  const shown: Branch[] = orphans.length ? [...branches, { id: "__other", name: t("Sans branche") }] : branches;
  const itemsOf = (id: string) => (id === "__other" ? orphans : live.filter((i) => i.planBranch === id));
  const right = shown.filter((_, i) => i % 2 === 0), left = shown.filter((_, i) => i % 2 === 1);
  const counts = { reel: live.filter((i) => i.planType === "reel").length, post: live.filter((i) => i.planType === "post").length, story: live.filter((i) => i.planType === "story").length };

  const measure = useCallback(() => {
    const root = box.current, mid = center.current;
    if (!root || !mid) return;
    const r = root.getBoundingClientRect(), c = mid.getBoundingClientRect();
    if (getComputedStyle(root).getPropertyValue("--mm-lines").trim() === "off") { setLines([]); return; }
    const cy = c.top + c.height / 2 - r.top;
    const next: { id: string; d: string }[] = [];
    for (const [id, el] of heads.current) {
      const h = el.getBoundingClientRect();
      if (!h.width) continue;
      const toRight = h.left > c.left;
      const x1 = (toRight ? c.right : c.left) - r.left, x2 = (toRight ? h.left : h.right) - r.left;
      const y2 = h.top + h.height / 2 - r.top;
      const mx = (x1 + x2) / 2;
      next.push({ id, d: `M${x1},${cy} C${mx},${cy} ${mx},${y2} ${x2},${y2}` });
    }
    setLines(next);
  }, []);
  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [measure, branches, items]);

  const card = (b: Branch) => (
    <BranchCard key={b.id} branch={b} items={itemsOf(b.id)} editable={editable && b.id !== "__other"} comments={comments} onOpen={onOpen}
      headRef={(el) => { if (el) heads.current.set(b.id, el); else heads.current.delete(b.id); }}
      onRename={(name) => onRenameBranch?.(b.id, name)} onRemove={() => onRemoveBranch?.(b)}
      onAdd={(type, name) => onAddItem?.(b.id, type, name)}
      onDrop={(itemId) => { const it = live.find((x) => x.id === itemId); if (it && it.planBranch !== b.id) onMoveItem?.(it, b.id); }} />
  );
  const newBranch = editable && (naming
    ? <div className="mm-branch mm-new"><InlineInput placeholder={t("Nom de la branche, puis Entrée")} onDone={(v) => onAddBranch?.(v)} onCancel={() => setNaming(false)} /></div>
    : <button type="button" className="mm-branch mm-new" onClick={() => setNaming(true)}><Plus size={15} />{t("Nouvelle branche")}</button>);

  return (
    <div className="mm" ref={box}>
      <svg className="mm-lines" aria-hidden="true">{lines.map((l) => <path key={l.id} d={l.d} />)}</svg>
      <div className="mm-side left">{left.map(card)}{right.length > left.length && newBranch}</div>
      <div className="mm-center" ref={center}>
        <strong>{title}</strong>
        <span className="mm-totals">
          <span title={t("Reels")}><Clapperboard size={13} />{counts.reel}</span>
          <span title={t("Posts")}><ImageIcon size={13} />{counts.post}</span>
          <span title={t("Stories")}><Circle size={13} />{counts.story}</span>
        </span>
        {!shown.length && <small>{t(editable ? "Commencez par une branche : une série, un thème, une rubrique." : "Aucun contenu pour l’instant.")}</small>}
      </div>
      <div className="mm-side right">{right.map(card)}{right.length <= left.length && newBranch}</div>
    </div>
  );
}

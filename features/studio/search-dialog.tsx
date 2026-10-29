"use client";
// « Rechercher dans l’espace » (⌘K): clients, sub-projects and tasks by name, outside the archive. A cmdk
// palette: arrows move, Enter opens, Escape closes; results are grouped by kind, 15 at most.
import { useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { beat, ease } from "@/lib/motion";
import { ArrowDown, ArrowUp, CornerDownLeft, FileText, Folder, FolderOpen, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/locale-provider";
import type { RecordItem } from "@/lib/model";
import type { WorkspaceRoute } from "@/lib/navigation";

const groups = [
  { kind: "client", label: "Clients", icon: Folder },
  { kind: "project", label: "Sous-projets", icon: FolderOpen },
  { kind: "task", label: "Tâches", icon: FileText },
] as const;

export function SearchDialog({ searchOpen, setSearchOpen, records, archived, navigate }: {
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  records: RecordItem[];
  archived: (record: RecordItem) => boolean;
  navigate: (route: WorkspaceRoute) => void;
}) {
  const { t: tr } = useI18n();
  const [globalQuery, setGlobalQuery] = useState("");
  const found = useMemo(() => {
    const query = globalQuery.trim().toLowerCase();
    return records
      .filter((r) => ["client", "task", "project"].includes(r.kind) && !archived(r) && r.name.toLowerCase().includes(query))
      .slice(0, 15);
  }, [records, archived, globalQuery]);
  const clientName = (id?: string) => (id ? records.find((r) => r.id === id)?.name : undefined);
  // While the field is empty, the hint shows what can be found here: real names from this space, one after
  // the other (a client, then recent tasks). Still with reduced motion.
  const reduce = useReducedMotion();
  const examples = useMemo(() => {
    const live = records.filter((r) => !archived(r));
    const client = live.find((r) => r.kind === "client");
    const tasks = live.filter((r) => r.kind === "task").sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 2);
    return [client, ...tasks].filter((r): r is RecordItem => !!r).map((r) => r.name);
  }, [records, archived]);
  const [shown, setShown] = useState(-1);
  useEffect(() => {
    if (!searchOpen || reduce || globalQuery || !examples.length) return;
    // The plain hint first (-1), then each example, then the plain hint again.
    const tick = setInterval(() => setShown((i) => (i + 1 >= examples.length ? -1 : i + 1)), 2600);
    return () => clearInterval(tick);
  }, [searchOpen, reduce, globalQuery, examples.length]);
  const hint = shown < 0 || !examples[shown] ? tr("Nom d’une tâche, d’un client…") : tr("Essayez « {name} »", { name: examples[shown] });
  const open = (r: RecordItem) => {
    navigate({
      page: r.kind === "task" ? "task" : "client",
      id: r.kind === "project" ? r.clientId : r.id,
      tab: r.kind === "project" ? "projects" : undefined,
    });
    setSearchOpen(false);
  };
  return (
    <Dialog open={searchOpen} onOpenChange={(next) => { setSearchOpen(next); if (!next) { setGlobalQuery(""); setShown(-1); } }}>
      <DialogContent className="command-palette" showCloseButton={false} overlayClassName="command-palette-overlay">
        <DialogTitle className="sr-only">{tr("Rechercher dans l’espace")}</DialogTitle>
        <DialogDescription className="sr-only">{tr("Clients, sous-projets et tâches.")}</DialogDescription>
        <Command shouldFilter={false} loop label={tr("Recherche globale")}>
          <div className="command-palette-field">
            <Search size={17} aria-hidden />
            <span className="command-palette-input">
              <Command.Input
                autoFocus
                value={globalQuery}
                onValueChange={setGlobalQuery}
                placeholder={tr("Nom d’une tâche, d’un client…")}
                aria-label={tr("Recherche globale")}
              />
              {!globalQuery && (
                <span className="command-palette-hint" aria-hidden="true">
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span key={hint} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: beat.move, ease: ease.arrive }}>{hint}</motion.span>
                  </AnimatePresence>
                </span>
              )}
            </span>
            <kbd>{tr("Échap")}</kbd>
          </div>
          <Command.List className="command-palette-list">
            <Command.Empty className="command-palette-empty">{tr("Aucun résultat.")}</Command.Empty>
            {groups.map(({ kind, label, icon: Icon }) => {
              const items = found.filter((r) => r.kind === kind);
              if (!items.length) return null;
              return (
                <Command.Group key={kind} heading={tr(label)}>
                  {items.map((r) => (
                    <Command.Item key={r.id} value={r.id} onSelect={() => open(r)}>
                      <Icon size={16} aria-hidden />
                      <span className="command-palette-name">{r.name}</span>
                      {kind !== "client" && clientName(r.clientId) && <small>{clientName(r.clientId)}</small>}
                      <CornerDownLeft size={14} className="command-palette-enter" aria-hidden />
                    </Command.Item>
                  ))}
                </Command.Group>
              );
            })}
          </Command.List>
          <footer className="command-palette-foot">
            <span><kbd><ArrowUp size={11} aria-hidden /></kbd><kbd><ArrowDown size={11} aria-hidden /></kbd>{tr("Parcourir")}</span>
            <span><kbd><CornerDownLeft size={11} aria-hidden /></kbd>{tr("Ouvrir")}</span>
          </footer>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

/** ⌘K / Ctrl+K opens and closes the search from anywhere in the studio. */
export function useSearchShortcut(setSearchOpen: (update: (open: boolean) => boolean) => void) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [setSearchOpen]);
}

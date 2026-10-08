"use client";
// « Rechercher dans l’espace » (⌘K): clients, sub-projects and tasks by name, outside the archive.
import { useEffect, useState } from "react";
import { ChevronRight, FileText, Folder, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/locale-provider";
import type { RecordItem } from "@/lib/model";
import type { WorkspaceRoute } from "@/lib/navigation";

export function SearchDialog({ searchOpen, setSearchOpen, records, archived, navigate }: {
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  records: RecordItem[];
  archived: (record: RecordItem) => boolean;
  navigate: (route: WorkspaceRoute) => void;
}) {
  const { t: tr } = useI18n();
  const [globalQuery, setGlobalQuery] = useState("");
  return (
    <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
      <DialogContent className="tracker-modal search-modal">
        <DialogHeader>
          <DialogTitle>{tr("Rechercher dans l’espace")}</DialogTitle>
          <DialogDescription>
            {tr("Clients, sous-projets et tâches.")}
          </DialogDescription>
        </DialogHeader>
        <label className="search-input">
          <Search size={18} />
          <input
            autoFocus
            value={globalQuery}
            onChange={(e) => setGlobalQuery(e.target.value)}
            placeholder={tr("Nom d’une tâche, d’un client…")}
            aria-label={tr("Recherche globale")}
          />
        </label>
        <div className="search-results">
          {records
            .filter(
              (r) =>
                ["client", "task", "project"].includes(r.kind) &&
                !archived(r) &&
                r.name.toLowerCase().includes(globalQuery.toLowerCase()),
            )
            .slice(0, 15)
            .map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  navigate({
                    page: r.kind === "task" ? "task" : "client",
                    id: r.kind === "project" ? r.clientId : r.id,
                    tab: r.kind === "project" ? "projects" : undefined,
                  });
                  setSearchOpen(false);
                }}
              >
                {r.kind === "task" ? (
                  <FileText size={16} />
                ) : (
                  <Folder size={16} />
                )}
                <span>
                  {r.name}
                  <small>
                    {tr(
                      r.kind === "task"
                        ? "Tâche"
                        : r.kind === "project"
                          ? "Sous-projet"
                          : "Client",
                    )}
                  </small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
          {!records.some(
            (r) =>
              ["client", "task", "project"].includes(r.kind) &&
              !archived(r) &&
              r.name.toLowerCase().includes(globalQuery.toLowerCase()),
          ) && <p>{tr("Aucun résultat.")}</p>}
        </div>
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

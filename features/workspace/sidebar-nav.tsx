"use client";
// The studio sidebar's building blocks: a page link, a folding group, the per-browser memory of which
// group each page sits in and which groups are folded, and the sidebar's resizable width.
import { Children, useCallback, useEffect, useState } from "react";
import { ChevronRight, Hourglass, type LucideIcon } from "lucide-react";
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";

export function NavItem({
  icon: Icon,
  label,
  onClick,
  active,
  badge,
  badgeTitle,
  badgeTone,
  mark,
  dragId,
  shortcut,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  active?: boolean;
  badge?: number;
  badgeTitle?: string;
  badgeTone?: "client";
  mark?: React.ReactNode;
  dragId?: string;
  shortcut?: string;
}) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenuItem
      draggable={!!dragId}
      onDragStart={dragId ? (e) => { e.dataTransfer.setData("text/plain", dragId); e.currentTarget.style.opacity = "0.5"; } : undefined}
      onDragEnd={dragId ? (e) => { e.currentTarget.style.opacity = "1"; } : undefined}
    >
      <SidebarMenuButton
        isActive={active}
        onClick={() => {
          onClick();
          setOpenMobile(false);
        }}
        className="nav-item"
        aria-keyshortcuts={shortcut ? "Meta+k Control+k" : undefined}
      >
        {mark ?? <Icon strokeWidth={1.5} />}
        <span>{label}</span>
        {shortcut && <kbd className="keyboard-hint" aria-hidden="true"><bdi dir="ltr">{shortcut}</bdi></kbd>}
        {!!badge && (
          <span className={`counter${badgeTone ? ` counter-${badgeTone}` : ""}`} title={badgeTitle} aria-label={badgeTitle}>
            {badgeTone === "client" && <Hourglass size={11} aria-hidden="true" />}
            {badge}
          </span>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
const navGroupsKey = "the-one.nav-groups";
const navLayoutKey = "the-one.nav-layout";
const builtInLayout: Record<string, string> = {
  tasks: "work", internal: "work", shoots: "work", requests: "work",
  social: "content", ig: "content", "ig-search": "content", library: "content",
  crm: "studio", meetings: "studio", team: "studio", settings: "studio", activity: "studio", platform: "studio"
};
/**
 * Which group each page sits in: the studio's arrangement (lib/process.ts pages, set by the owner on
 * « Personnaliser »), with the pages this person dragged elsewhere, remembered in this browser. Only the
 * moves are kept, so a later change by the owner still reaches every page nobody moved.
 */
export function useNavLayout(studioLayout: Record<string, string> = builtInLayout) {
  const [moves, setMoves] = useState<Record<string, string>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(navLayoutKey) || "{}") as Record<string, string>;
      // Layouts saved whole by older versions: an entry equal to the old default was never a move.
      return Object.fromEntries(Object.entries(stored).filter(([page, group]) => builtInLayout[page] !== group));
    } catch { return {}; }
  });
  // A page outside the studio's arrangement (« Paramètres de l'agence ») keeps its built-in group.
  const layout = { ...builtInLayout, ...studioLayout, ...moves };
  const save = (next: Record<string, string>) => {
    const own = Object.fromEntries(Object.entries(next).filter(([page, group]) => studioLayout[page] !== group));
    setMoves(own);
    try { localStorage.setItem(navLayoutKey, JSON.stringify(own)); } catch { /* private mode */ }
  };
  return [layout, save] as const;
}
/** Which sidebar groups are folded, remembered in this browser: group id → the page it was folded on. */

export function useNavGroups() {
  const [closed, setClosed] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem(navGroupsKey) || "{}"); } catch { return {}; }
  });
  const toggle = useCallback((id: string, open: boolean, here: string) => {
    setClosed((current) => {
      const next = { ...current };
      if (open) next[id] = here; else delete next[id];
      try { localStorage.setItem(navGroupsKey, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, []);
  return { closed, toggle };
}
/**
 * A folding group of the sidebar. Open unless folded; a folded group opens again by itself when you
 * reach one of its pages from elsewhere. Folded, it shows the sum of its counters. Empty groups (nothing
 * for this role) aren't drawn.
 */
export function NavGroup({ id, label, badge, badgeTitle, active, here, closedAt, onToggle, action, children, onDropItem }: {
  id: string; label: string; badge: number; badgeTitle?: string; active: boolean; here: string; closedAt?: string;
  onToggle: (id: string, open: boolean, here: string) => void; action?: React.ReactNode; children: React.ReactNode;
  onDropItem?: (itemId: string, groupId: string) => void;
}) {
  const items = Children.toArray(children);
  if (!items.length && !onDropItem) return null;
  const open = closedAt === undefined || (active && closedAt !== here);
  return (
    <SidebarGroup
      className={`nav-group${open ? " open" : ""}`}
      onDragOver={onDropItem ? (e) => { e.preventDefault(); e.currentTarget.classList.add("drop-target"); } : undefined}
      onDragLeave={onDropItem ? (e) => { e.currentTarget.classList.remove("drop-target"); } : undefined}
      onDrop={onDropItem ? (e) => {
        e.preventDefault();
        e.currentTarget.classList.remove("drop-target");
        const itemId = e.dataTransfer.getData("text/plain");
        if (itemId && onDropItem) onDropItem(itemId, id);
      } : undefined}
    >
      <div className="nav-group-head">
        <button type="button" className="nav-group-toggle" aria-expanded={open} onClick={() => onToggle(id, open, here)}>
          <span>{label}</span>
          {!open && badge > 0 && <span className={`counter${id === "clients" ? " counter-client" : ""}`} title={badgeTitle}>{id === "clients" && <Hourglass size={11} aria-hidden="true" />}{badge}</span>}
          <ChevronRight size={15} className="nav-group-chevron" aria-hidden="true" />
        </button>
        {action}
      </div>
      {open && <SidebarMenu>{items}</SidebarMenu>}
    </SidebarGroup>
  );
}

const MIN_SIDEBAR_WIDTH = 190;
const MAX_SIDEBAR_WIDTH = 420;
const sidebarWidthKey = "the-one.sidebarWidth";
/**
 * The sidebar width is a per-browser convenience, remembered locally per person. Starting from the
 * static default (not reading localStorage here) keeps the server and the first client render
 * identical; the stored width is applied client-side just after mount.
 */
export function useSidebarWidth(rtl: boolean) {
  const [sidebarWidth, setSidebarWidth] = useState(260);
  useEffect(() => {
    let saved = NaN;
    try {
      saved = Number(localStorage.getItem(sidebarWidthKey));
    } catch {
      /* private mode */
    }
    if (saved >= MIN_SIDEBAR_WIDTH && saved <= MAX_SIDEBAR_WIDTH) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only localStorage read after mount
      setSidebarWidth(saved);
    }
  }, []);
  const onSidebarResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = sidebarWidth;
      let current = startWidth;
      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        current = Math.min(
          MAX_SIDEBAR_WIDTH,
          Math.max(MIN_SIDEBAR_WIDTH, startWidth + (rtl ? -delta : delta)),
        );
        setSidebarWidth(current);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        try {
          localStorage.setItem(sidebarWidthKey, String(current));
        } catch {
          /* private mode */
        }
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [sidebarWidth, rtl],
  );
  return { sidebarWidth, setSidebarWidth, onSidebarResizeStart };
}

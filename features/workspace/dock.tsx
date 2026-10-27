"use client";
// The floating dock (Nuage d'or), on a computer in place of the full sidebar: the agency's mark on top, the
// pages used every day, search, the full menu and the person's settings. Icons grow as the pointer passes
// along it (after React Bits' Dock, on Motion); with reduced motion they keep their size. The full sidebar
// is still one click away (« Tout le menu », the top bar's menu button, Ctrl/⌘ B). Styles in
// features/workspace/dock.css.
import { useRef, type ReactNode } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform, type MotionValue } from "motion/react";
import { Menu, Search, type LucideIcon } from "lucide-react";
import Avatar from "@/components/profile-avatar";
import { useI18n } from "@/lib/i18n/locale-provider";

/** One of the pages used every day: in the dock on a computer, in the bottom bar on a phone. */
export type FrameTab = { icon: LucideIcon; label: string; active: boolean; badge?: number; onClick: () => void };

const BASE = 48;
const PEAK = 66;
const REACH = 130;

function DockItem({ pointer, label, active, badge, onClick, children }: {
  pointer: MotionValue<number>; label: string; active?: boolean; badge?: number; onClick: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const reduce = useReducedMotion();
  const distance = useTransform(pointer, (y) => {
    const box = ref.current?.getBoundingClientRect();
    return box ? y - (box.top + box.height / 2) : Infinity;
  });
  const target = useTransform(distance, [-REACH, 0, REACH], [BASE, reduce ? BASE : PEAK, BASE], { clamp: true });
  const size = useSpring(target, { mass: 0.1, stiffness: 170, damping: 14 });
  return (
    <motion.button
      ref={ref}
      type="button"
      className={`dock-item${active ? " active" : ""}`}
      style={{ width: size, height: size }}
      aria-label={badge ? `${label} (${badge})` : label}
      aria-current={active ? "page" : undefined}
      data-label={label}
      onClick={onClick}
    >
      {children}
      {!!badge && <span className="dock-badge" aria-hidden="true">{badge > 99 ? "99+" : badge}</span>}
    </motion.button>
  );
}

export function Dock({ tabs, mark, user, onSearch, onMenu, onSettings }: {
  tabs: FrameTab[];
  mark: ReactNode;
  user: { name: string; avatar?: string | null };
  onSearch?: () => void;
  onMenu: () => void;
  onSettings: () => void;
}) {
  const { t } = useI18n();
  const pointer = useMotionValue(Infinity);
  const icon = (Icon: LucideIcon) => <Icon size={20} strokeWidth={1.8} aria-hidden="true" />;
  return (
    <nav
      className="dock"
      aria-label={t("Navigation principale")}
      onMouseMove={(e) => pointer.set(e.clientY)}
      onMouseLeave={() => pointer.set(Infinity)}
    >
      <span className="dock-mark">{mark}</span>
      {tabs.map((tab) => (
        <DockItem key={tab.label} pointer={pointer} label={tab.label} active={tab.active} badge={tab.badge} onClick={tab.onClick}>
          {icon(tab.icon)}
        </DockItem>
      ))}
      <span className="dock-rule" aria-hidden="true" />
      {onSearch && <DockItem pointer={pointer} label={t("Rechercher")} onClick={onSearch}>{icon(Search)}</DockItem>}
      <DockItem pointer={pointer} label={t("Tout le menu")} onClick={onMenu}>{icon(Menu)}</DockItem>
      <DockItem pointer={pointer} label={t("Paramètres")} onClick={onSettings}>
        <Avatar name={user.name} avatar={user.avatar} />
      </DockItem>
    </nav>
  );
}

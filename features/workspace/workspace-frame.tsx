"use client";

import Copyright from "@/components/copyright";
import SkipLink from "@/components/skip-link";
import { brandLogoClass, brandLogoUrl, useBrand } from "@/features/workspace/brand-store";
import {
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import Image from "next/image";
import { MoreHorizontal, Settings2 } from "lucide-react";
import { SidebarDock, type FrameTab } from "./dock";
import { MenuClose } from "./sidebar-nav";
import {
  Sidebar,
  SidebarProvider,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import WorkspaceSwitch from "@/features/workspace/workspace-switch";
import type { ProfileUser } from "@/features/workspace/settings-dialog";
import Avatar from "@/components/profile-avatar";
import { useI18n } from "@/lib/i18n/locale-provider";
import {
  roleLabels,
  type WorkspaceContext,
  type WorkspaceSummary,
} from "@/lib/workspace";

export type WorkspaceFrameOptions = {
  workspace: WorkspaceContext | null;
  workspaces: WorkspaceSummary[];
  user: ProfileUser;
  busy: boolean;
  sidebarWidth: number;
  onResizeStart: (event: MouseEvent) => void;
  onWidthChange: (width: number) => void;
  onSwitch: (id: string) => void;
  onOpenSettings: () => void;
};

/** The pages used every day: the dock on a computer, the bottom bar on a phone (the rest are in the full menu). */
export type { FrameTab };

export default function WorkspaceFrame({
  navigation,
  children,
  tabs,
  onSearch,
  ...options
}: WorkspaceFrameOptions & { navigation: ReactNode; children: ReactNode; tabs?: FrameTab[]; onSearch?: () => void }) {
  const { t, rtl } = useI18n();
  const { workspace, workspaces, user, busy, sidebarWidth } = options;
  const brand = useBrand();
  const brandLogo = brandLogoUrl(brand);
  return (
    <SidebarProvider
      // The full sidebar starts closed on a computer: the dock stands in for it (SidebarDock).
      defaultOpen={false}
      className={`workspace-frame ${tabs?.length ? "has-tabbar" : ""}`}
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <SkipLink />
      <Sidebar className="tracker-sidebar" side={rtl ? "right" : "left"}>
        <SidebarHeader>
          <div className="brand">
            {brandLogo ? (
              // eslint-disable-next-line @next/next/no-img-element -- the workspace's own uploaded logo
              <span className="brand-logo-box"><img className={brandLogoClass(brand)} src={brandLogo} alt={brand?.name ?? ""} /></span>
            ) : brand?.company ? (
              <span className="brand-wordmark">{brand.name}</span>
            ) : (
              <Image
                className="sidebar-logo"
                src="/the-one-core-logo.svg"
                alt="The One Core"
                width={588}
                height={138}
                priority
              />
            )}
          </div>
        </SidebarHeader>
        <SidebarContent>
          <Navigation>{navigation}</Navigation>
        </SidebarContent>
        <SidebarFooter>

          {workspaces.length > 1 ? (
            <WorkspaceSwitch
              value={workspace?.id || ""}
              workspaces={workspaces}
              disabled={busy}
              onChange={options.onSwitch}
            />
          ) : null}
          <MenuClose />
          <ProfileRow user={user} workspace={workspace} onOpen={options.onOpenSettings} />
          <Copyright short />
        </SidebarFooter>
      </Sidebar>
      <ResizeHandle
        width={sidebarWidth}
        onResizeStart={options.onResizeStart}
        onWidthChange={options.onWidthChange}
      />
      {!!tabs?.length && (
        <SidebarDock
          tabs={tabs}
          mark={brandLogo ? (
            // eslint-disable-next-line @next/next/no-img-element -- the workspace's own uploaded logo
            <span className="dock-logo"><img className={brandLogoClass(brand)} src={brandLogo} alt={brand?.name ?? ""} /></span>
          ) : (
            // The agency's initials, not a « 1 » that reads as a count.
            <span className="dock-agency" title={brand?.name || workspace?.name || ""}>{(brand?.name || workspace?.name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "·"}</span>
          )}
          user={user}
          onSearch={onSearch}
          onSettings={options.onOpenSettings}
        />
      )}
      {children}
      {!!tabs?.length && <TabBar tabs={tabs} more={t("Plus")} />}
    </SidebarProvider>
  );
}

/** The person, at the foot of the menu: opens Settings. On a phone the menu closes behind it. */
function ProfileRow({ user, workspace, onOpen }: { user: ProfileUser; workspace: WorkspaceContext | null; onOpen: () => void }) {
  const { t } = useI18n();
  const { setOpenMobile } = useSidebar();
  return (
    <div className="user-row">
      <button
        className="user-profile"
        onClick={() => { setOpenMobile(false); onOpen(); }}
        aria-label={t("Paramètres")}
        title={t("Paramètres")}
      >
        <Avatar name={user.name} avatar={user.avatar} />
        <div>
          <strong>
            {user.name.includes("@")
              ? user.name.split("@")[0]
              : user.name}
          </strong>
          <small>
            {workspace ? `${t(roleLabels[workspace.role])} · ${workspace.name}` : ""}
          </small>
        </div>
        <Settings2 size={15} className="user-settings-icon" />
      </button>
    </div>
  );
}

/**
 * On a phone the sidebar gives way to a bottom bar, as in the client portal: the pages used every day,
 * and « Plus » opening the full menu (every other page, the workspace switch, settings).
 */
function TabBar({ tabs, more }: { tabs: FrameTab[]; more: string }) {
  const { setOpenMobile, openMobile } = useSidebar();
  const visibleTabs = tabs.filter((t) => !t.hideOnMobile).slice(0, 4);
  const button = (tab: FrameTab) => (
    <button key={tab.label} type="button" className={tab.active ? "active" : ""} aria-current={tab.active ? "page" : undefined} onClick={tab.onClick}>
      <span className="portal-tab-icon"><tab.icon size={21} strokeWidth={1.7} />{!!tab.badge && <span className="portal-tab-badge">{tab.badge > 99 ? "99+" : tab.badge}</span>}</span>
      <span className="portal-tab-label">{tab.label}</span>
    </button>
  );
  return (
    <nav className="portal-tabbar workspace-tabbar">
      {visibleTabs.map(button)}
      {button({ icon: MoreHorizontal, label: more, active: openMobile || !visibleTabs.some((x) => x.active), onClick: () => setOpenMobile(true) })}
    </nav>
  );
}

function Navigation({ children }: { children: ReactNode }) {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <div
      className="workspace-navigation"
      onClick={(event) => {
        if (
          isMobile &&
          event.target instanceof Element &&
          // Group headings only expand/collapse; dismiss for page selections or explicit actions.
          event.target.closest('[data-sidebar="menu-button"], [data-sidebar-dismiss]')
        )
          setOpenMobile(false);
      }}
    >
      {children}
    </div>
  );
}

function ResizeHandle({
  width,
  onResizeStart,
  onWidthChange,
}: {
  width: number;
  onResizeStart: (event: MouseEvent) => void;
  onWidthChange: (width: number) => void;
}) {
  const { t, rtl } = useI18n();
  const { isMobile, open } = useSidebar();
  if (isMobile || !open) return null;
  return (
    <div
      className="sidebar-resize-handle"
      style={rtl ? { right: width } : { left: width }}
      onMouseDown={onResizeStart}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={t("Redimensionner la barre latérale")}
      aria-valuemin={190}
      aria-valuemax={420}
      aria-valuenow={width}
      onKeyDown={(event) => {
        const direction =
          event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (!direction && !["Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next =
          event.key === "Home"
            ? 190
            : event.key === "End"
              ? 420
              : Math.max(
                  190,
                  Math.min(420, width + direction * (rtl ? -10 : 10)),
                );
        onWidthChange(next);
        try {
          localStorage.setItem("the-one.sidebarWidth", String(next));
        } catch {
          /* private mode */
        }
      }}
    />
  );
}

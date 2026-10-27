"use client";

import Copyright from "@/components/copyright";
import { brandLogoClass, brandLogoUrl, useBrand } from "@/features/workspace/brand-store";
import {
  useState,
  useEffect,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import Image from "next/image";
import { MoreHorizontal, Settings2 } from "lucide-react";
import { Seal } from "@/components/ui/seal";
import { Dock, type FrameTab } from "./dock";
import {
  Sidebar,
  SidebarProvider,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import WorkspaceSwitch from "@/features/workspace/workspace-switch";
import SettingsDialog, { type ProfileUser } from "@/features/workspace/settings-dialog";
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
  onProfile: (changes: {
    name?: string;
    avatar?: string | null;
  }) => Promise<ProfileUser | undefined>;
  onLogout: () => void;
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [driveResult, setDriveResult] = useState<{ error?: string; connected?: boolean }>();
  // A connection started in Settings returns there; a client callback is handled on its Files tab.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (/^#client\/[^/]+\/files$/.test(url.hash)) return;
    const error = url.searchParams.get('driveError'); const connected = url.searchParams.has('driveConnected');
    if (!error && !connected) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- consume a completed external OAuth navigation
    setDriveResult({ ...(error ? { error } : {}), connected }); setSettingsOpen(true);
    url.searchParams.delete('driveError'); url.searchParams.delete('driveConnected'); window.history.replaceState(null, '', url);
  }, []);
  const { workspace, workspaces, user, busy, sidebarWidth } = options;
  const brand = useBrand();
  const brandLogo = brandLogoUrl(brand);
  return (
    <SidebarProvider
      // The full sidebar starts closed on a computer: the dock stands in for it (FrameDock).
      defaultOpen={false}
      className={`workspace-frame ${tabs?.length ? "has-tabbar" : ""}`}
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
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
          <div className="user-row">
            <button
              className="user-profile"
              onClick={() => setSettingsOpen(true)}
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
          <Copyright short />
        </SidebarFooter>
      </Sidebar>
      <ResizeHandle
        width={sidebarWidth}
        onResizeStart={options.onResizeStart}
        onWidthChange={options.onWidthChange}
      />
      {!!tabs?.length && (
        <FrameDock
          tabs={tabs}
          mark={brandLogo ? (
            // eslint-disable-next-line @next/next/no-img-element -- the workspace's own uploaded logo
            <span className="dock-logo"><img className={brandLogoClass(brand)} src={brandLogo} alt={brand?.name ?? ""} /></span>
          ) : <Seal size={52} />}
          user={user}
          onSearch={onSearch}
          onSettings={() => setSettingsOpen(true)}
        />
      )}
      {children}
      {!!tabs?.length && <TabBar tabs={tabs} more={t("Plus")} />}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={(open) => { setSettingsOpen(open); if (!open) setDriveResult(undefined); }}
        user={user}
        workspaceId={workspace?.id || null}
        workspaceName={workspace?.name}
        driveRole={workspace?.role === "owner" ? "owner" : workspace?.role === "admin" ? "admin" : undefined}
        driveResult={driveResult}
        onSave={options.onProfile}
        onLogout={() => {
          setSettingsOpen(false);
          options.onLogout();
        }}
      />
    </SidebarProvider>
  );
}

/**
 * On a phone the sidebar gives way to a bottom bar, as in the client portal: the pages used every day,
 * and « Plus » opening the full menu (every other page, the workspace switch, settings).
 */
function TabBar({ tabs, more }: { tabs: FrameTab[]; more: string }) {
  const { setOpenMobile, openMobile } = useSidebar();
  const visibleTabs = tabs.slice(0, 4);
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

/** The dock while the full sidebar is closed on a computer; « Tout le menu » opens the sidebar. */
function FrameDock(props: Omit<Parameters<typeof Dock>[0], "onMenu">) {
  const { isMobile, state, setOpen } = useSidebar();
  if (isMobile || state !== "collapsed") return null;
  return <Dock {...props} onMenu={() => setOpen(true)} />;
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

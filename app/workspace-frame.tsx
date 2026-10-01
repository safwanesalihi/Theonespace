"use client";

import Copyright from "@/app/copyright";
import { brandLightLogoClass, brandPdfLogo, useBrand } from "@/app/brand-store";
import {
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import Image from "next/image";
import { MoreHorizontal, Printer, Settings2, type LucideIcon } from "lucide-react";
import {
  Sidebar,
  SidebarProvider,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import WorkspaceSwitch from "@/app/workspace-switch";
import SettingsDialog, { type ProfileUser } from "@/app/settings-dialog";
import NotificationBell from "@/app/notification-bell";
import Avatar from "@/app/profile-avatar";
import { useI18n } from "@/app/locale-provider";
import {
  isPrintWorkspaceId,
  roleLabels,
  type WorkspaceContext,
  type WorkspaceSummary,
} from "@/lib/workspace";
import type { RecordItem } from "@/lib/model";

export type WorkspaceFrameOptions = {
  workspace: WorkspaceContext | null;
  workspaces: WorkspaceSummary[];
  user: ProfileUser;
  busy: boolean;
  sidebarWidth: number;
  onResizeStart: (event: MouseEvent) => void;
  onWidthChange: (width: number) => void;
  onSwitch: (id: string) => void;
  onCreatePrint?: () => Promise<void>;
  onProfile: (changes: {
    name?: string;
    avatar?: string | null;
  }) => Promise<ProfileUser | undefined>;
  onLogout: () => void;
  // Omitted entirely by the print workspace (comments/task-assignment notifications don't exist there).
  notifications?: RecordItem[];
  onMarkNotificationsRead?: (ids: string[]) => void;
  onOpenNotificationTask?: (taskId: string) => void;
  onOpenNotificationMeeting?: () => void;
  onOpenNotificationRequests?: () => void;
};

/** One of the few pages in the phone's bottom bar (the rest are under « Plus », in the sidebar). */
export type FrameTab = { icon: LucideIcon; label: string; active: boolean; badge?: number; onClick: () => void };

export default function WorkspaceFrame({
  navigation,
  children,
  tabs,
  ...options
}: WorkspaceFrameOptions & { navigation: ReactNode; children: ReactNode; tabs?: FrameTab[] }) {
  const { t, rtl } = useI18n();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { workspace, workspaces, user, busy, sidebarWidth } = options;
  const printing = !!workspace && isPrintWorkspaceId(workspace.id);
  const brand = useBrand();
  const brandLogo = brandPdfLogo(brand);
  return (
    <SidebarProvider
      className={`workspace-frame ${printing ? "print-app" : ""} ${tabs?.length ? "has-tabbar" : ""}`}
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <Sidebar className="tracker-sidebar" side={rtl ? "right" : "left"}>
        <SidebarHeader>
          <div className={`brand ${printing ? "workspace-brand-print" : ""}`}>
            {!printing && brandLogo ? (
              // eslint-disable-next-line @next/next/no-img-element -- the workspace's own uploaded logo
              <span className="brand-logo-box"><img className={brandLightLogoClass(brand)} src={brandLogo} alt={brand?.name ?? ""} /></span>
            ) : !printing && brand?.company ? (
              <span className="brand-wordmark">{brand.name}</span>
            ) : (
              <Image
                className="sidebar-logo"
                src={
                  printing ? "/the-one-print-logo-new.png" : "/the-one-core-logo-light.svg"
                }
                alt={
                  printing ? "The One Print — By The One Core" : "The One Core"
                }
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
          ) : options.onCreatePrint &&
            workspace?.role === "owner" &&
            !workspaces.some((w) => isPrintWorkspaceId(w.id)) ? (
            <button
              type="button"
              className="btn subtle workspace-create-print"
              disabled={busy}
              onClick={() => void options.onCreatePrint?.()}
            >
              <Printer size={14} />
              {t("Créer l’espace Impression")}
            </button>
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
      {children}
      {!!tabs?.length && <TabBar tabs={tabs} more={t("Plus")} />}
      {options.notifications && options.onMarkNotificationsRead && options.onOpenNotificationTask && (
        <NotificationBell
          records={options.notifications}
          currentUserId={user.id}
          rtl={rtl}
          onMarkRead={options.onMarkNotificationsRead}
          onOpenTask={options.onOpenNotificationTask}
          onOpenMeeting={options.onOpenNotificationMeeting}
          onOpenRequests={options.onOpenNotificationRequests}
        />
      )}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        user={user}
        workspaceId={workspace?.id || null}
        workspaceName={workspace?.name}
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
  const button = (tab: FrameTab) => (
    <button key={tab.label} type="button" className={tab.active ? "active" : ""} aria-current={tab.active ? "page" : undefined} onClick={tab.onClick}>
      <span className="portal-tab-icon"><tab.icon size={21} strokeWidth={1.7} />{!!tab.badge && <span className="portal-tab-badge">{tab.badge > 99 ? "99+" : tab.badge}</span>}</span>
      <span className="portal-tab-label">{tab.label}</span>
    </button>
  );
  return (
    <nav className="portal-tabbar workspace-tabbar">
      {tabs.slice(0, 4).map(button)}
      {button({ icon: MoreHorizontal, label: more, active: openMobile || !tabs.some((x) => x.active), onClick: () => setOpenMobile(true) })}
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
          event.target.closest("button")
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

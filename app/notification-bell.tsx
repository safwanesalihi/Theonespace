"use client";
import { formatTimestamp } from "@/lib/time";

import { useMemo, useState } from "react";
import { Bell, CheckCheck, Loader2, MessageSquare, UserRound, Video } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/lib/i18n/locale-provider";
import { isEventRecipient, isEventUnreadFor } from "@/lib/flow";
import type { RecordItem } from "@/lib/model";

type Props = {
  records: RecordItem[];
  currentUserId: string;
  rtl: boolean;
  onMarkRead: (ids: string[]) => void;
  onMarkAllRead: () => Promise<unknown>;
  onOpenTask: (taskId: string) => void;
  onOpenMeeting?: () => void;
  onOpenRequests?: () => void;
};

/** A header control for the targeted notifications (comment, task-assigned) that are
 * actually addressed to the signed-in person — separate from the studio-wide alerts panel/feed,
 * which keep showing broadcast events to everyone as before. */
export default function NotificationBell({ records, currentUserId, rtl, onMarkRead, onMarkAllRead, onOpenTask, onOpenMeeting, onOpenRequests }: Props) {
  const { t, tag } = useI18n();
  const [open, setOpen] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [readError, setReadError] = useState("");
  const notifications = useMemo(
    () =>
      records
        .filter((r) => r.kind === "event" && r.recipients && isEventRecipient(r, currentUserId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [records, currentUserId],
  );
  const unread = notifications.filter((n) => isEventUnreadFor(n, currentUserId));
  const when = (iso: string) =>
    formatTimestamp(iso, tag, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  async function markAllRead() {
    if (markingAll || !unread.length) return;
    setMarkingAll(true);
    setReadError("");
    try {
      await onMarkAllRead();
    } catch (error) {
      setReadError(t(error instanceof Error ? error.message : "Enregistrement impossible. Réessayez."));
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <div className="notification-bell">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="notification-bell-trigger" aria-label={t("Notifications")} title={t("Notifications")}>
            <Bell size={18} aria-hidden="true" />
            <span className="notification-bell-label">{t("Notifications")}</span>
            {!!unread.length && (
              <span className="notification-bell-badge">{unread.length > 9 ? "9+" : unread.length}</span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="notification-bell-popover"
          align="end"
          sideOffset={8}
          dir={rtl ? "rtl" : "ltr"}
        >
          <div className="notification-bell-header">
            <strong>{t("Notifications")}</strong>
            <button
              type="button"
              className="notification-bell-read-all"
              disabled={markingAll || !unread.length}
              aria-busy={markingAll}
              onClick={() => void markAllRead()}
            >
              {markingAll ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <CheckCheck size={14} aria-hidden="true" />}
              {t("Tout marquer lu")}
            </button>
          </div>
          {readError && <p className="notification-bell-error" role="alert">{readError}</p>}
          <div className="notification-bell-list">
            {notifications.slice(0, 30).map((n) => {
              const isUnread = isEventUnreadFor(n, currentUserId);
              return (
                <button
                  key={n.id}
                  type="button"
                  className={`notification-bell-item ${isUnread ? "" : "read"}`}
                  onClick={() => {
                    setOpen(false);
                    if (isUnread) onMarkRead([n.id]);
                    if (n.taskId) onOpenTask(n.taskId);
                    else if (n.meetingId) onOpenMeeting?.();
                    else if (n.requestId) onOpenRequests?.();
                  }}
                >
                  <span className="notification-bell-icon">
                    {n.type === "comment" ? <MessageSquare size={14} /> : n.type === "meeting" ? <Video size={14} /> : <UserRound size={14} />}
                  </span>
                  <span>
                    <small>{when(n.createdAt)}</small>
                    <strong>{n.name}</strong>
                  </span>
                </button>
              );
            })}
            {!notifications.length && (
              <p className="notification-bell-empty">{t("Rien pour l’instant.")}</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

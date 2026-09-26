"use client";

import { useMemo, useState } from "react";
import { Bell, MessageSquare, UserRound, Video } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/app/locale-provider";
import { isEventRecipient, isEventUnreadFor } from "@/lib/flow";
import type { RecordItem } from "@/lib/model";

type Props = {
  records: RecordItem[];
  currentUserId: string;
  rtl: boolean;
  onMarkRead: (ids: string[]) => void;
  onOpenTask: (taskId: string) => void;
  onOpenMeeting?: () => void;
};

/** A persistent top-right bell for the targeted notifications (comment, task-assigned) that are
 * actually addressed to the signed-in person — separate from the studio-wide alerts panel/feed,
 * which keep showing broadcast events to everyone as before. */
export default function NotificationBell({ records, currentUserId, rtl, onMarkRead, onOpenTask, onOpenMeeting }: Props) {
  const { t, tag } = useI18n();
  const [open, setOpen] = useState(false);
  const notifications = useMemo(
    () =>
      records
        .filter((r) => r.kind === "event" && r.recipients && isEventRecipient(r, currentUserId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 30),
    [records, currentUserId],
  );
  const unread = notifications.filter((n) => isEventUnreadFor(n, currentUserId));
  const when = (iso: string) =>
    new Date(iso).toLocaleString(tag, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="notification-bell" style={rtl ? { left: 16 } : { right: 16 }}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="notification-bell-trigger" aria-label={t("Notifications")}>
            <Bell size={18} />
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
          </div>
          <div className="notification-bell-list">
            {notifications.map((n) => {
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

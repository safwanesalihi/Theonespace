"use client";
import { formatTimestamp } from "@/lib/time";

import { useMemo, useState } from "react";
import { Bell, CheckCheck, Loader2, MessageSquare, UserRound, Video } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { beat, ease, spring } from "@/lib/motion";
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
  // The badge gives a small knock when something new arrives, never as things are read or as the page loads
  // (the first records to arrive are the page loading, not news).
  const [counted, setCounted] = useState(unread.length);
  const [knocks, setKnocks] = useState(0);
  const [loaded, setLoaded] = useState(records.length > 0);
  if (unread.length !== counted) {
    if (loaded && unread.length > counted) setKnocks((k) => k + 1);
    setCounted(unread.length);
  }
  if (!loaded && records.length) setLoaded(true);
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
              <motion.span key={knocks} className="notification-bell-badge" initial={knocks ? { scale: 1.5 } : false} animate={{ scale: 1 }} transition={spring.strike}>{unread.length > 9 ? "9+" : unread.length}</motion.span>
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
          {/* Opened, the notes come in one after the other; a new one arriving meanwhile slides in on top. */}
          <MotionConfig reducedMotion="user">
          <div className="notification-bell-list">
            <AnimatePresence initial>
            {notifications.slice(0, 30).map((n, i) => {
              const isUnread = isEventUnreadFor(n, currentUserId);
              return (
                <motion.button
                  key={n.id}
                  layout="position"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: beat.move, ease: ease.arrive, delay: Math.min(i, 7) * 0.04, layout: spring.walk }}
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
                </motion.button>
              );
            })}
            </AnimatePresence>
            {!notifications.length && (
              <p className="notification-bell-empty">{t("Rien pour l’instant.")}</p>
            )}
          </div>
          </MotionConfig>
        </PopoverContent>
      </Popover>
    </div>
  );
}

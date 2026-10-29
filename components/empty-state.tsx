"use client";
// The empty state of a list or a page: an icon, a title, a line of help and an optional action. Inside
// a panel it stands bare; `framed` gives it its own dashed card where it stands in for a whole page's
// content (no meetings, no requests, no resources yet).
import { Inbox, type LucideIcon } from "lucide-react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { useI18n } from "@/lib/i18n/locale-provider";

export function Blank({
  icon: Icon = Inbox,
  title = "Aucun élément",
  text = "Les éléments apparaîtront ici.",
  action,
  framed = false,
  heading = false,
}: {
  icon?: LucideIcon;
  title?: string;
  text?: string;
  action?: React.ReactNode;
  framed?: boolean;
  /** The screen has nothing else: its title is the page's heading (« Page introuvable »). */
  heading?: boolean;
}) {
  const { t: tr } = useI18n();
  return (
    <Empty className={`empty-state${framed ? " framed" : ""}`}>
      <EmptyHeader>
        <EmptyMedia>
          <Icon size={24} strokeWidth={1.6} />
        </EmptyMedia>
        <EmptyTitle {...(heading ? { role: "heading", "aria-level": 1 } : {})}>{tr(title)}</EmptyTitle>
        {text && <EmptyDescription>{tr(text)}</EmptyDescription>}
      </EmptyHeader>
      {action && <div className="empty-state-actions">{action}</div>}
    </Empty>
  );
}

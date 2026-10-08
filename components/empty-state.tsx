"use client";
// The empty state of a list or a page: an icon, a title, a line of help and an optional action.
import { CheckSquare } from "lucide-react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { useI18n } from "@/lib/i18n/locale-provider";

export function Blank({
  title = "Aucun élément",
  text = "Les éléments apparaîtront ici.",
  action,
}: {
  title?: string;
  text?: string;
  action?: React.ReactNode;
}) {
  const { t: tr } = useI18n();
  return (
    <Empty className="empty-state">
      <EmptyHeader>
        <EmptyMedia>
          <CheckSquare size={32} />
        </EmptyMedia>
        <EmptyTitle>{tr(title)}</EmptyTitle>
        <EmptyDescription>{tr(text)}</EmptyDescription>
      </EmptyHeader>
      {action}
    </Empty>
  );
}

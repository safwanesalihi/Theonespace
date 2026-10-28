// A deliverable's status in the client portal's own words (lib/portal-i18n.ts).
import { statusClass, type CoreStatus, type RecordItem } from "@/lib/model";
import type { PortalCopy } from "@/lib/portal-i18n";

export function Chip({ status = 'À faire', copy }: { status?: RecordItem['status']; copy: PortalCopy }) {
  return <span className={`status ${statusClass[status as CoreStatus]}`}>{copy.status[status]}</span>;
}

// A page's heading: its symbol (or a mark such as a client's logo), title, action and subtitle.
import { CheckSquare, Folder, Users } from "lucide-react";

export function Heading({
  emoji,
  title,
  subtitle,
  action,
  mark,
}: {
  emoji: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  mark?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      {mark ?? (
        <span className="page-symbol" aria-hidden="true">
          {emoji === "🗂️" ? (
            <Users size={22} />
          ) : emoji === "✅" ? (
            <CheckSquare size={22} />
          ) : (
            <Folder size={22} />
          )}
        </span>
      )}
      <div className="heading-line">
        <h1>{title}</h1>
        {action}
      </div>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}

"use client";
// « © The One Core » — the app's copyright line, on the sign-in page and under every sidebar (studio,
// companies' own workspaces and the client portal): the product stays The One Core's whatever brand
// a workspace shows.
import { useI18n } from "@/app/locale-provider";

export const copyrightHolder = "The One Core";

/** `short`: one line for the sidebar; the full wording shows on hover. */
export default function Copyright({ className = "", short = false }: { className?: string; short?: boolean }) {
  const { t } = useI18n();
  const full = `© ${new Date().getFullYear()} The One Space · ${t("par")} ${copyrightHolder}. ${t("Tous droits réservés.")}`;
  return (
    <small className={`app-copyright ${className}`.trim()} title={short ? full : undefined}>
      {short ? `© ${new Date().getFullYear()} ${copyrightHolder}` : full}
    </small>
  );
}

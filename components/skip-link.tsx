"use client";
// « Aller au contenu »: the first Tab stop on every screen of the studio and the portal, shown only while
// focused. It jumps past the menu and the dock to the page's <main id="contenu">.
import { useI18n } from "@/lib/i18n/locale-provider";

export const contentId = "contenu";

export default function SkipLink() {
  const { t } = useI18n();
  return (
    <a className="skip-link" href={`#${contentId}`} onClick={(event) => {
      // The app routes on the hash: move focus without changing it.
      event.preventDefault();
      document.getElementById(contentId)?.focus();
    }}>
      {t("Aller au contenu")}
    </a>
  );
}

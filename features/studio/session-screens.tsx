"use client";
// The screens shown instead of a workspace: while it opens, while switching to another one, when the
// account has none, and when it could not be loaded.
import { useEffect, useState } from "react";
import { LogOut, RefreshCw } from "lucide-react";
import { BootMark } from "@/components/boot-mark";
import { ProductMark } from "@/components/product-mark";
import { useI18n } from "@/lib/i18n/locale-provider";
import type { BootBrand } from "@/lib/boot-brand";
import { bootBrandOf, brandLightLogoClass, brandLogoClass, lastBrand, rememberedBrand } from "@/features/workspace/brand-store";

/**
 * Whose brand a loading screen shows, gathering in grains of light (components/particle-mark.tsx): the
 * agency this browser last opened (its logo, else its name), or The One Core's own studio; nothing known
 * → a neutral pulse, never another brand's mark. The server already knows it from its cookie
 * (lib/boot-brand.ts, `initial`), so the first frame is right; this browser's memory confirms it after mount.
 * Without `initial` (a screen the server never drew), an empty slot of the same height until then.
 */
function SessionMark({ initial }: { initial?: BootBrand | null }) {
  const [brand, setBrand] = useState<BootBrand | null | undefined>(initial);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only memory, read once after hydration
  useEffect(() => { const last = lastBrand(); setBrand(last ? bootBrandOf(last) : null); }, []);
  if (brand === undefined) return <span className="session-mark-slot" aria-hidden="true" />;
  return <BootMark key={brand?.name ?? "none"} brand={brand} />;
}

/**
 * Before the first /api/records reply comes back, we don't yet know whether the visitor is signed in:
 * this keeps the studio shell from flashing for everyone right before the sign-in screen.
 */
export function BootScreen({ brand }: { brand?: BootBrand | null }) {
  const { t: tr } = useI18n();
  return (
    <div className="boot-screen">
      <div className="boot-container">
        <SessionMark initial={brand} />
        <p className="boot-status">
          {tr("Ouverture de votre espace…")}
          <small>{tr("Un instant, vos projets arrivent.")}</small>
        </p>
      </div>
    </div>
  );
}

/**
 * A workspace switch in flight: the workspace being left stays in state until the target arrives, so
 * rendering it would flash the wrong workspace. The target's own brand shows instead, as this browser
 * remembers it (its logo, else its name); never seen yet → its name; no name → the neutral pulse.
 */
export function SwitchScreen({ name }: { name?: string }) {
  const { t: tr } = useI18n();
  // Shown only after a click, never by the server: the browser's memory and theme can be read at once.
  const [target] = useState(() => {
    const known = rememberedBrand(name);
    const dark = document.documentElement.dataset.theme === "dark";
    return { brand: known ? bootBrandOf(known) : name ? { name } : null, logoClass: known ? (dark ? brandLogoClass(known) : brandLightLogoClass(known)) : undefined };
  });
  return (
    <div className="switch-screen" role="status" aria-live="polite">
      <BootMark brand={target.brand} logoClass={target.logoClass} textColor="currentColor" />
      <p>{name ? tr("Ouverture de {name}…", { name }) : tr("Ouverture de votre espace…")}</p>
    </div>
  );
}

/** The account is signed in but belongs to no workspace. */
export function NoAccessScreen({ email, busy, onLogout, onRetry }: { email: string; busy: boolean; onLogout: () => void; onRetry: () => void }) {
  const { t: tr } = useI18n();
  return (
    <div className="auth-screen">
      <div className="auth-form google-login">
        <ProductMark className="auth-logo" />
        <h1>
          {tr("Accès sur invitation")}
          <span className="wordmark-dot">.</span>
        </h1>
        <p>
          {tr(
            "Votre compte ({email}) n’a pas d’espace attribué. Demandez au studio de vous inviter.",
            { email: email || tr("connecté") },
          )}
        </p>
        <div className="inline">
          <button className="btn primary" disabled={busy} onClick={onLogout}>
            <LogOut size={15} />
            {tr("Se déconnecter")}
          </button>
          <button className="btn" onClick={onRetry}>
            <RefreshCw size={15} />
            {tr("Réessayer")}
          </button>
        </div>
      </div>
      <div className="auth-flow" />
    </div>
  );
}

/**
 * The studio shell needs a workspace. Reaching it without one means the load failed (network, server
 * error, an access that was revoked…): said so, with a way out, instead of an empty shell.
 */
export function UnavailableScreen({ error, loading, busy, onRetry, onLogout }: { error: string; loading: boolean; busy: boolean; onRetry: () => void; onLogout: () => void }) {
  const { t: tr } = useI18n();
  return (
    <div className="auth-screen">
      <div className="auth-form google-login">
        <SessionMark />
        <h1>
          {tr("Espace indisponible")}
          <span className="wordmark-dot">.</span>
        </h1>
        <p>{error || tr("Chargement impossible.")}</p>
        <div className="inline">
          <button className="btn primary" disabled={loading} onClick={onRetry}>
            <RefreshCw size={15} />
            {tr("Réessayer")}
          </button>
          <button className="btn" disabled={busy} onClick={onLogout}>
            <LogOut size={15} />
            {tr("Se déconnecter")}
          </button>
        </div>
      </div>
      <div className="auth-flow" />
    </div>
  );
}

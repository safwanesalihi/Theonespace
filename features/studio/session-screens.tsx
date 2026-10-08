"use client";
// The screens shown instead of a workspace: while it opens, while switching to another one, when the
// account has none, and when it could not be loaded.
import Image from "next/image";
import { Loader2, LogOut, RefreshCw } from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-provider";

/**
 * Before the first /api/records reply comes back, we don't yet know whether the visitor is signed in:
 * this keeps the studio shell from flashing for everyone right before the sign-in screen.
 */
export function BootScreen() {
  const { t: tr } = useI18n();
  return (
    <div className="boot-screen">
      <div className="boot-container">
        <img
          className="auth-logo"
          src="/the-one-core-logo.svg"
          alt="The One Core"
        />
        <div className="boot-progress-bar" />
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
 * rendering it would flash the wrong workspace. The target's branding and a spinner show instead.
 */
export function SwitchScreen({ name, toPrint }: { name?: string; toPrint: boolean }) {
  const { t: tr } = useI18n();
  return (
    <div className="switch-screen" role="status" aria-live="polite">
      <Image
        className="switch-logo"
        src={toPrint ? "/the-one-print-logo-new.png" : "/the-one-core-logo.svg"}
        alt={toPrint ? "The One Print" : "The One Core"}
        width={588}
        height={138}
        priority
      />
      <p>
        <Loader2 size={16} className="spin" />
        {tr("Ouverture de {name}…", { name: name ?? (toPrint ? "The One Print" : "The One Space") })}
      </p>
    </div>
  );
}

/** The account is signed in but belongs to no workspace. */
export function NoAccessScreen({ email, busy, onLogout, onRetry }: { email: string; busy: boolean; onLogout: () => void; onRetry: () => void }) {
  const { t: tr } = useI18n();
  return (
    <div className="auth-screen">
      <div className="auth-form google-login">
        <img
          className="auth-logo"
          src="/the-one-core-logo.svg"
          alt="The One Core"
        />
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
        <Image
          className="auth-logo"
          src="/the-one-core-logo.svg"
          alt="The One Core"
          width={588}
          height={138}
        />
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

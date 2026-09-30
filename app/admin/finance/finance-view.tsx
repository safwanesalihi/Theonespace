"use client";
// The owner's view of the finance dashboard: the export in a sandboxed frame, and a way to replace it.
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileUp, Loader2 } from "lucide-react";
import { useI18n } from "@/app/locale-provider";
import type { DashboardInfo } from "@/lib/finance-dashboard";

export default function FinanceView({ info }: { info: DashboardInfo | null }) {
  const { t, tag } = useI18n();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/admin/finance/data", {
        method: "PUT",
        headers: { "Content-Type": "text/html; charset=utf-8", "X-File-Name": encodeURIComponent(file.name) },
        body: file,
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Envoi impossible. Réessayez.");
      router.refresh();
    } catch (e) {
      setError(t((e as Error).message));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  const picker = (
    <>
      <input ref={input} type="file" hidden accept=".html,.htm,text/html" onChange={(e) => void upload(e.target.files?.[0])} />
      <button type="button" className={`btn ${info ? "" : "primary"}`} disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 size={15} className="spin" /> : <FileUp size={15} />}
        {t(info ? "Remplacer le fichier" : "Importer le tableau de bord")}
      </button>
    </>
  );

  return (
    <div className="finance-page">
      <header className="finance-bar">
        <Link className="btn ghost" href="/">
          <ArrowLeft size={15} />
          {t("Retour à votre espace")}
        </Link>
        <div className="finance-title">
          <strong>{t("Finance")}</strong>
          {info && (
            <small>
              {info.name} ·{" "}
              {t("mis à jour le {date}", {
                date: new Date(info.updatedAt).toLocaleString(tag, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
              })}
            </small>
          )}
        </div>
        {picker}
      </header>
      {error && <p className="form-error finance-error" role="alert">{error}</p>}
      {info ? (
        <iframe
          key={info.updatedAt}
          className="finance-frame"
          src={`/admin/finance/data?v=${encodeURIComponent(info.updatedAt)}`}
          sandbox="allow-scripts"
          title={t("Tableau de bord financier")}
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="finance-empty">
          <FileUp size={28} />
          <h1>{t("Aucun tableau de bord importé")}</h1>
          <p>{t("Choisissez l’export HTML du classeur (TheOneCore_Dashboard_2026.html). Il est gardé dans la base de données, visible par vous seul.")}</p>
          {picker}
        </div>
      )}
    </div>
  );
}

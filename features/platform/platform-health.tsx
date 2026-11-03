"use client";
// Plateforme → Vue d'ensemble: « Santé des services » (lib/platform-health.ts). What is broken comes first, and
// keys that were only found present never look like a service that was tried.
import { useCallback, useEffect, useState } from "react";
import { Activity, Loader2, Mail, RefreshCw } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { useI18n } from "@/lib/i18n/locale-provider";
import type { HealthState, ServiceHealth } from "@/lib/platform-health";

const stateLabel: Record<HealthState, string> = { ok: "Testé, fonctionne", set: "Clés présentes, non testé", off: "Non configuré", fail: "En panne", warn: "À vérifier" };
const order: Record<HealthState, number> = { fail: 0, warn: 1, off: 2, set: 3, ok: 4 };
const byUrgency = (a: ServiceHealth, b: ServiceHealth) => order[a.state] - order[b.state];

export default function PlatformHealth() {
  const { t } = useI18n();
  const [services, setServices] = useState<ServiceHealth[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ good: boolean; text: string } | null>(null);

  const check = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const r = await fetch("/api/platform?health", { cache: "no-store" });
      if (!r.ok) throw new Error();
      setServices(((await r.json()) as { services: ServiceHealth[] }).services);
    } catch { setLoadFailed(true); }
    setLoading(false);
  }, []);
  useEffect(() => { void Promise.resolve().then(check); }, [check]);

  async function testMail() {
    setTesting(true);
    setResult(null);
    try {
      const r = await fetch("/api/platform", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "health-mail-test" }) });
      const data = (await r.json().catch(() => ({}))) as { to?: string; error?: string };
      setResult(r.ok ? { good: true, text: t("E-mail envoyé à {to}. Vérifiez qu’il arrive, spams compris.", { to: data.to ?? "" }) } : { good: false, text: data.error ?? t("L’e-mail n’a pas pu être envoyé.") });
    } catch { setResult({ good: false, text: t("L’e-mail n’a pas pu être envoyé.") }); }
    setTesting(false);
  }

  const toFix = services?.filter((s) => s.required && s.state !== "ok" && s.state !== "set").length ?? 0;
  const row = (s: ServiceHealth) => (
    <li key={s.id} className={`pf-health-row is-${s.state}`}>
      <i aria-hidden />
      <div>
        <b>{t(s.label)}</b>
        <small>{t(s.use)}</small>
        {s.detail && s.state !== "ok" && <em>{t(s.detail)}</em>}
      </div>
      <span>{t(stateLabel[s.state])}{s.state === "ok" && s.detail ? ` · ${t(s.detail)}` : ""}</span>
    </li>
  );
  return (
    <Surface className="pf-card pf-health" aria-busy={loading}>
      <header>
        <h3><Activity size={15} aria-hidden />{t("Santé des services")}{services && <small>{toFix ? t("{n} à corriger", { n: toFix }) : t("essentiels en place")}</small>}</h3>
        <div>
          <button type="button" className="btn" disabled={testing || services?.find((s) => s.id === "mail")?.state === "off"} onClick={() => void testMail()}>
            {testing ? <Loader2 size={14} className="spin" aria-hidden /> : <Mail size={14} aria-hidden />}{t("Envoyer un e-mail de test")}
          </button>
          <button type="button" className="btn" disabled={loading} onClick={() => void check()}>
            {loading ? <Loader2 size={14} className="spin" aria-hidden /> : <RefreshCw size={14} aria-hidden />}{t("Vérifier")}
          </button>
        </div>
      </header>
      {result && <p role="status" className={result.good ? "pf-health-good" : "pf-health-bad"}>{result.text}</p>}
      {loadFailed && <p role="alert" className="pf-health-bad">{t("Vérification impossible. Réessayez.")}</p>}
      {services && (
        <div className="pf-health-groups">
          <div><h4>{t("Essentiels au lancement")}</h4><ul>{services.filter((s) => s.required).sort(byUrgency).map(row)}</ul></div>
          <div><h4>{t("Selon les fonctions proposées")}</h4><ul>{services.filter((s) => !s.required).sort(byUrgency).map(row)}</ul></div>
        </div>
      )}
    </Surface>
  );
}

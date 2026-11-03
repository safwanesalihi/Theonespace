"use client";
// Plateforme → Site → « Coordonnées de paiement »: where an agency sends its transfer (lib/payment-details.ts).
// Not public: an agency's owner sees it only after asking for a plan; here it can be copied to paste in a message.
import { Surface } from "@/components/ui/surface";
import { useEffect, useState } from "react";
import { Check, Copy, Landmark, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-provider";
import { emptyPaymentDetails, paymentLines, type PaymentDetails } from "@/lib/payment-details";

const fields: [keyof PaymentDetails, string, string][] = [
  ["beneficiary", "Bénéficiaire", "THE ONE CORE"],
  ["bank", "Banque", ""],
  ["rib", "RIB (24 chiffres)", "000 000 0000000000000000 00"],
  ["iban", "IBAN (facultatif)", ""],
  ["ice", "ICE", ""],
  ["note", "Note pour l’agence (facultatif)", "Indiquez le nom de votre agence en référence."],
];

export default function PlatformPayment({ onNotice, onError }: { onNotice: (text: string) => void; onError: (text: string) => void }) {
  const { t } = useI18n();
  const [saved, setSaved] = useState<PaymentDetails | null>(null);
  const [draft, setDraft] = useState<PaymentDetails>(emptyPaymentDetails);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetch("/api/platform?payment", { cache: "no-store" }).then((r) => r.json()).then((data: { payment?: PaymentDetails }) => {
      if (alive && data.payment) { setSaved(data.payment); setDraft(data.payment); }
    }).catch(() => onError(t("Chargement impossible.")));
    return () => { alive = false; };
  }, [onError, t]);

  const dirty = !!saved && JSON.stringify(saved) !== JSON.stringify(draft);

  async function save() {
    setBusy(true);
    try {
      const r = await fetch("/api/platform", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "payment-save", payment: draft }) });
      const data = (await r.json().catch(() => ({}))) as { payment?: PaymentDetails; error?: string };
      if (!r.ok || !data.payment) throw new Error(data.error || "Enregistrement impossible.");
      setSaved(data.payment); setDraft(data.payment);
      onNotice(t("Coordonnées enregistrées."));
    } catch (e) { onError(t((e as Error).message)); }
    setBusy(false);
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(paymentLines(draft, t).map(([label, value]) => `${label} : ${value}`).join("\n"));
      onNotice(t("Coordonnées copiées."));
    } catch { onError(t("Copie impossible.")); }
  }

  if (!saved) return <div className="loading"><Loader2 className="spin" /></div>;
  return (
    <Surface className="pf-card pf-payment">
      <h3><Landmark size={15} aria-hidden />{t("Coordonnées de paiement")}</h3>
      <p className="pf-quiet">{t("Où une agence envoie son virement. Jamais sur le site public : une agence les voit seulement après avoir demandé un plan.")}</p>
      <div className="pf-payment-grid">
        {fields.map(([key, label, placeholder]) => (
          <div key={key} className="pf-field">
            <label htmlFor={`pf-pay-${key}`}>{t(label)}</label>
            <input id={`pf-pay-${key}`} value={draft[key]} maxLength={key === "note" ? 200 : 80} placeholder={placeholder ? t(placeholder) : undefined}
              inputMode={key === "rib" || key === "ice" ? "numeric" : undefined} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
          </div>
        ))}
      </div>
      <div className="pf-payment-actions">
        <button type="button" className="btn primary" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? <Loader2 size={14} className="spin" /> : <Check size={14} aria-hidden />}{t("Enregistrer")}
        </button>
        <button type="button" className="btn" disabled={!paymentLines(draft).length} onClick={() => void copy()}><Copy size={14} aria-hidden />{t("Copier pour un message")}</button>
      </div>
    </Surface>
  );
}

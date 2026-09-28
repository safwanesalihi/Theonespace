"use client";
// « Votre marque » (Team page, owner and administrators): the workspace's logo and main colour — and,
// for a company's own workspace, its name. What is chosen here replaces The One Core's in the app,
// the client portal, calls, e-mails and PDFs (lib/branding.ts).
import { useRef, useState } from "react";
import { Check, ImagePlus, Loader2, Palette, RotateCcw, Trash2 } from "lucide-react";
import { useI18n } from "@/app/locale-provider";
import { brandLogoUrl, useBrand } from "@/app/brand-store";
import { brandPresets, brandTokens, defaultBrandColor, isHexColor } from "@/lib/branding";
import { uploadImage } from "@/lib/image";

type Changes = { name?: string; logo?: string | null; color?: string | null };

export default function BrandSettings({ workspaceId, onSave, onNotice, onError }: {
  workspaceId: string;
  onSave: (changes: Changes) => Promise<unknown>;
  onNotice: (text: string) => void;
  onError: (text: string) => void;
}) {
  const { t } = useI18n();
  const brand = useBrand();
  const [name, setName] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "logo" | "save">("");
  const input = useRef<HTMLInputElement>(null);
  if (!brand) return null;
  const shownName = name ?? brand.name;
  const shownColor = color ?? brand.color ?? defaultBrandColor;
  const logo = brandLogoUrl(brand);
  const dirty = (brand.company && name !== null && name.trim() !== brand.name) || (color !== null && color !== (brand.color ?? defaultBrandColor));

  async function run(kind: "logo" | "save", changes: Changes, notice: string) {
    setBusy(kind);
    try {
      await onSave(changes);
      onNotice(t(notice));
      setName(null); setColor(null);
    } catch (e) { onError(t((e as Error).message)); }
    setBusy("");
  }
  async function pickLogo(file: File | undefined) {
    if (!file) return;
    setBusy("logo");
    try {
      const id = await uploadImage(file, "logo", workspaceId);
      await run("logo", { logo: id }, "Logo enregistré.");
    } catch (e) { onError(t((e as Error).message)); setBusy(""); }
  }
  const save = () => void run("save", {
    ...(brand.company && name !== null ? { name: name.trim() } : {}),
    ...(color !== null ? { color: color === defaultBrandColor && !brand.color ? null : color } : {}),
  }, "Marque enregistrée.");

  return (
    <section className="work-panel brand-settings" aria-labelledby="brand-settings-title">
      <header className="brand-settings-head">
        <h2 id="brand-settings-title"><Palette size={16} />{t("Votre marque")}</h2>
        <p>{t("Votre logo et votre couleur remplacent ceux de The One Core dans l’application, le portail de vos clients, les appels, les e-mails et les PDF.")}</p>
      </header>
      <div className="brand-settings-grid">
        <div className="brand-settings-logo">
          <span className="brand-settings-label">{t("Logo")}</span>
          <div className="brand-settings-preview">
            {logo
              // eslint-disable-next-line @next/next/no-img-element -- the workspace's own uploaded logo
              ? <img src={logo} alt={brand.name} />
              : <span className="brand-wordmark">{brand.company ? brand.name : "The One Core"}</span>}
          </div>
          <div className="inline">
            <button type="button" className="btn" disabled={!!busy} onClick={() => input.current?.click()}>
              {busy === "logo" ? <Loader2 size={14} className="spin" /> : <ImagePlus size={14} />}{t(logo ? "Changer le logo" : "Ajouter un logo")}
            </button>
            {logo && <button type="button" className="btn ghost" disabled={!!busy} onClick={() => void run("logo", { logo: null }, "Logo retiré.")}><Trash2 size={14} />{t("Retirer")}</button>}
          </div>
          <small>{t("PNG ou JPEG, de préférence sur fond transparent ; il est réduit automatiquement.")}</small>
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => { void pickLogo(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        <div className="brand-settings-fields">
          {brand.company && (
            <label className="form-field">
              <span>{t("Nom de l’espace")}</span>
              <input value={shownName} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </label>
          )}
          <div className="form-field">
            <span>{t("Couleur principale")}</span>
            <div className="brand-swatches" role="radiogroup" aria-label={t("Couleur principale")}>
              {brandPresets.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={shownColor === c} aria-label={c} className={`brand-swatch${shownColor === c ? " is-picked" : ""}`} style={{ background: c }} onClick={() => setColor(c)}>
                  {shownColor === c && <Check size={13} />}
                </button>
              ))}
              <label className="brand-swatch custom" title={t("Autre couleur")}>
                <input type="color" value={shownColor} onChange={(e) => isHexColor(e.target.value) && setColor(e.target.value.toLowerCase())} aria-label={t("Autre couleur")} />
              </label>
            </div>
            <div className="brand-sample">
              <span className="brand-sample-button" style={{ background: shownColor, color: brandTokens(shownColor)["--t-brand-ink"] }}>{t("Aperçu du bouton")}</span>
              <code>{shownColor}</code>
            </div>
          </div>
          <div className="inline">
            <button type="button" className="btn primary" disabled={!dirty || !!busy} onClick={save}>
              {busy === "save" ? <Loader2 size={14} className="spin" /> : <Check size={14} />}{t("Enregistrer")}
            </button>
            {brand.color && <button type="button" className="btn ghost" disabled={!!busy} onClick={() => void run("save", { color: null }, "Couleur par défaut rétablie.")}><RotateCcw size={14} />{t("Couleur par défaut")}</button>}
          </div>
        </div>
      </div>
    </section>
  );
}

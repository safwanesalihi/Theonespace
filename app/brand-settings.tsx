"use client";
// « Votre marque » (Team page, owner and administrators): the workspace's logo and main colour — and,
// for a company's own workspace, its name. What is chosen here replaces The One Core's in the app,
// the client portal, calls, e-mails and PDFs (lib/branding.ts).
import { Surface } from "@/components/ui/surface";
import { useRef, useState } from "react";
import { Check, ImagePlus, Loader2, Palette, RotateCcw, Trash2 } from "lucide-react";
import { useI18n } from "@/app/locale-provider";
import { brandLogoClass, brandLogoUrl, useBrand } from "@/app/brand-store";
import { brandPresets, brandTokens, defaultBrandColor, isHexColor, logoOnDarkModes, type LogoOnDark } from "@/lib/branding";
import { prepareBrandLogo } from "@/lib/brand-logo";
import { uploadPrepared } from "@/lib/image";

type Changes = { name?: string; logo?: string | null; logoLight?: string; logoTone?: "dark" | "light"; logoOnDark?: LogoOnDark; color?: string | null };
const modeLabels: Record<LogoOnDark, string> = { auto: "Automatique", original: "Couleurs d’origine", white: "Blanc" };

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
  const logoOnLight = brand.logoLight ? `/api/assets/${brand.logoLight}` : logo;
  const mode = brand.logoOnDark ?? "auto";
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
      // Transparent PNG/SVG/WebP only, trimmed, with a dark twin when the logo is light (lib/brand-logo.ts).
      const prepared = await prepareBrandLogo(file);
      const [id, light] = await Promise.all([
        uploadPrepared(prepared.logo, "logo", workspaceId),
        prepared.forLight ? uploadPrepared(prepared.forLight, "logo", workspaceId) : Promise.resolve(undefined),
      ]);
      await run("logo", { logo: id, logoTone: prepared.tone, ...(light ? { logoLight: light } : {}) }, "Logo enregistré.");
    } catch (e) { onError(t((e as Error).message)); setBusy(""); }
  }
  const save = () => void run("save", {
    ...(brand.company && name !== null ? { name: name.trim() } : {}),
    ...(color !== null ? { color: color === defaultBrandColor && !brand.color ? null : color } : {}),
  }, "Marque enregistrée.");

  return (
    <Surface asChild tone="default"><section className="work-panel brand-settings" aria-labelledby="brand-settings-title">
      <header className="brand-settings-head">
        <h2 id="brand-settings-title"><Palette size={16} />{t("Votre marque")}</h2>
        <p>{t("Votre logo et votre couleur remplacent ceux de The One Core dans l’application, le portail de vos clients, les appels, les e-mails et les PDF.")}</p>
      </header>
      <div className="brand-settings-grid">
        <div className="brand-settings-logo">
          <span className="brand-settings-label">{t("Logo")}</span>
          <div className="brand-settings-previews">
            <figure className="brand-settings-preview">
              <div>
                {logo
                  // eslint-disable-next-line @next/next/no-img-element -- the workspace's own uploaded logo
                  ? <img className={brandLogoClass(brand)} src={logo} alt={brand.name} />
                  : <span className="brand-wordmark">{brand.company ? brand.name : "The One Core"}</span>}
              </div>
              <figcaption>{t("Sur fond sombre")}</figcaption>
            </figure>
            <figure className="brand-settings-preview light">
              <div>
                {logoOnLight
                  // eslint-disable-next-line @next/next/no-img-element -- the workspace's own uploaded logo
                  ? <img className="brand-logo" src={logoOnLight} alt={brand.name} />
                  : <span className="brand-wordmark">{brand.company ? brand.name : "The One Core"}</span>}
              </div>
              <figcaption>{t("Sur fond clair (PDF)")}</figcaption>
            </figure>
          </div>
          <div className="inline">
            <button type="button" className="btn" disabled={!!busy} onClick={() => input.current?.click()}>
              {busy === "logo" ? <Loader2 size={14} className="spin" /> : <ImagePlus size={14} />}{t(logo ? "Changer le logo" : "Ajouter un logo")}
            </button>
            {logo && <button type="button" className="btn ghost" disabled={!!busy} onClick={() => void run("logo", { logo: null }, "Logo retiré.")}><Trash2 size={14} />{t("Retirer")}</button>}
          </div>
          <small>{t("PNG, SVG ou WebP sur fond transparent. Toutes les formes conviennent : les marges vides sont retirées et la taille s’adapte.")}</small>
          {logo && (
            <div className="form-field">
              <span>{t("Affichage sur fond sombre")}</span>
              <div className="brand-settings-mode" role="radiogroup" aria-label={t("Affichage sur fond sombre")}>
                {logoOnDarkModes.map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={mode === m} disabled={!!busy} onClick={() => mode !== m && void run("logo", { logoOnDark: m }, "Logo enregistré.")}>{t(modeLabels[m])}</button>
                ))}
              </div>
            </div>
          )}
          <input ref={input} type="file" accept="image/png,image/svg+xml,image/webp" hidden onChange={(e) => { void pickLogo(e.target.files?.[0]); e.target.value = ""; }} />
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
              <span className="brand-sample-button" style={{ background: brandTokens(shownColor)["--t-brand"], color: brandTokens(shownColor)["--t-brand-ink"] }}>{t("Aperçu du bouton")}</span>
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
    </section></Surface>
  );
}

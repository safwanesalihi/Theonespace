"use client";
// The landing's six windows (planets.ts). A click on a topic opens its window over the page and puts
// ?espace=<slug> in the address: the back button or Échap closes it, and a shared link opens the landing
// with that window; /espace/<slug> is the topic's own page (app/espace/[slug]). Each window is silver glass with a black sidebar of the six topics; its head is
// the brushed-silver panel with the topic's picture (topic-art.tsx), then its four points, and the next
// topic one click away. The dock on the screen's edge (bottom on phones) lists the six windows once the
// hero has scrolled away and magnifies the icons near the pointer, like a desktop dock.
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-provider";
import { planets, planetHref, type PlanetSlug } from "./planets";
import { TopicArt, topicTone } from "./topic-art";
import { DeepPanel, useStill } from "./ui";

type Windows = { open: (slug: PlanetSlug) => void; close: () => void; current: PlanetSlug | null };
const WindowsContext = createContext<Windows>({ open: () => {}, close: () => {}, current: null });
export const useWindows = () => useContext(WindowsContext);

// The open window lives in the address as ?espace=<slug> on the landing itself: changing only the query
// keeps Next.js on this page (a pathname change would swap the page underneath for /espace/<slug>), and
// the link can be shared — it opens the landing with that window. /espace/<slug> stays the topic's own
// page for search engines, a modifier click or no JavaScript.
const param = "espace";
const readSlug = () => {
  const value = new URLSearchParams(window.location.search).get(param);
  return planets.some((p) => p.slug === value) ? (value as PlanetSlug) : null;
};
const changed = "ts-windows";
function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(changed, onChange);
  return () => { window.removeEventListener("popstate", onChange); window.removeEventListener(changed, onChange); };
}
function writeSlug(slug: PlanetSlug | null, push: boolean) {
  const url = new URL(window.location.href);
  if (slug) url.searchParams.set(param, slug); else url.searchParams.delete(param);
  window.history[push ? "pushState" : "replaceState"](window.history.state, "", url.pathname + url.search + url.hash);
  window.dispatchEvent(new Event(changed));
}

export function WindowsProvider({ children, cta }: { children: ReactNode; cta: { href: string; label: string; external: boolean } }) {
  const current = useSyncExternalStore(subscribe, readSlug, () => null);
  // Whether this visit added the history entry, so closing can simply go back.
  const pushed = useRef(false);
  const open = useCallback((slug: PlanetSlug) => {
    const wasOpen = readSlug() !== null;
    writeSlug(slug, !wasOpen);
    if (!wasOpen) pushed.current = true;
  }, []);
  const close = useCallback(() => {
    if (pushed.current) { pushed.current = false; window.history.back(); }
    else writeSlug(null, false);
  }, []);
  useEffect(() => {
    const onPop = () => { if (!readSlug()) pushed.current = false; };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return (
    <WindowsContext.Provider value={{ open, close, current }}>
      {children}
      <PlanetWindow cta={cta} />
    </WindowsContext.Provider>
  );
}

/** A link to a topic: opens its window, or the full page with a modifier key or without JavaScript. */
export function PlanetLink({ slug, className, children, onOpen }: { slug: PlanetSlug; className?: string; children: ReactNode; onOpen?: () => void }) {
  const { open } = useWindows();
  return (
    <a href={planetHref(slug)} className={className} onClick={(event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault(); onOpen?.(); open(slug);
    }}>{children}</a>
  );
}

function PlanetWindow({ cta }: { cta: { href: string; label: string; external: boolean } }) {
  const { t } = useI18n();
  const { current, close, open } = useWindows();
  const still = useStill();
  const closeRef = useRef<HTMLButtonElement>(null);
  const index = planets.findIndex((p) => p.slug === current);
  const planet = index >= 0 ? planets[index] : undefined;
  const prev = planets[(index + planets.length - 1) % planets.length];
  const next = planets[(index + 1) % planets.length];
  useEffect(() => {
    if (!current) return;
    const before = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    document.documentElement.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => { document.removeEventListener("keydown", onKey); document.documentElement.style.overflow = ""; before?.focus?.(); };
  }, [current, close]);
  return (
    <AnimatePresence>
      {planet && (
        <motion.div key="backdrop" className="ts-win-back" onClick={close} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: still ? 0 : 0.25 }}>
          <motion.div role="dialog" aria-modal="true" aria-labelledby="ts-win-title" className="ts-win" onClick={(e) => e.stopPropagation()}
            initial={still ? false : { opacity: 0, y: 40, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={still ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.97 }} transition={{ type: "spring", stiffness: 260, damping: 26 }}>
            <div className="ts-win-bar">
              <span className="ts-win-lights"><button ref={closeRef} type="button" className="red" onClick={close} aria-label={t("Fermer")}><X size={9} strokeWidth={3} aria-hidden="true" /></button><i /><i /></span>
              <span className="ts-win-url" dir="ltr">space.the1core.com{planetHref(planet.slug)}</span>
              <button type="button" className="ts-win-close" onClick={close}>{t("Fermer")} <kbd>{t("Échap")}</kbd></button>
            </div>
            <div className="ts-win-body">
              <nav className="ts-win-side" aria-label={t("Explorer l’espace")}>
                <span className="ts-win-brand">
                  {/* eslint-disable-next-line @next/next/no-img-element -- SVG mark */}
                  <img src="/favicon.svg" alt="" />The One Space
                </span>
                {planets.map(({ slug, icon: Icon, title }, i) => (
                  <button key={slug} type="button" className={slug === planet.slug ? "on" : ""} aria-current={slug === planet.slug ? "page" : undefined} onClick={() => open(slug)}>
                    {slug === planet.slug && <motion.span layoutId="ts-win-hl" className="ts-win-hl" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                    <em>{String(i + 1).padStart(2, "0")}</em><Icon size={16} aria-hidden="true" /><span>{t(title)}</span>
                  </button>
                ))}
              </nav>
              <AnimatePresence mode="wait">
                <motion.div key={planet.slug} className="ts-win-main" initial={still ? false : { opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={still ? { opacity: 0 } : { opacity: 0, x: -12 }} transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}>
                  <DeepPanel tone="silver" className="ts-win-head">
                    <div className="ts-win-intro">
                      <span className="ts-win-icon"><planet.icon size={22} aria-hidden="true" /></span>
                      <h2 id="ts-win-title">{t(planet.title)}</h2>
                      <p className="ts-win-tag">{t(planet.tagline)}</p>
                    </div>
                    <div className={`ts-win-art ${topicTone[planet.slug]}`}><TopicArt slug={planet.slug} /></div>
                  </DeepPanel>
                  <ol className="ts-win-points">
                    {planet.points.map(([head, text], i) => (
                      <motion.li key={head} initial={still ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 + i * 0.06 }}>
                        <b>{String(i + 1).padStart(2, "0")}</b><div><h3>{t(head)}</h3><p>{t(text)}</p></div>
                      </motion.li>
                    ))}
                  </ol>
                  <div className="ts-win-foot">
                    <a className="ts-win-cta" href={cta.href} {...(cta.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{cta.label} <ArrowRight size={16} className="os-arrow" aria-hidden="true" /></a>
                    <span className="ts-win-steps">
                      <button type="button" onClick={() => open(prev.slug)} aria-label={t("Précédent : {title}", { title: t(prev.title) })}><ArrowLeft size={16} className="os-arrow" aria-hidden="true" /></button>
                      <button type="button" className="next" onClick={() => open(next.slug)}>{t("Suivant")} · {t(next.title)} <ArrowRight size={16} className="os-arrow" aria-hidden="true" /></button>
                    </span>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DockItem({ slug, pointer, vertical }: { slug: PlanetSlug; pointer: MotionValue<number>; vertical: boolean }) {
  const { t } = useI18n();
  const { current } = useWindows();
  const ref = useRef<HTMLSpanElement>(null);
  const still = useStill();
  const planet = planets.find((p) => p.slug === slug)!;
  const distance = useTransform(pointer, (value) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || value === Infinity) return 999;
    return value - (vertical ? r.top + r.height / 2 : r.left + r.width / 2);
  });
  const size = useSpring(useTransform(distance, [-130, 0, 130], [44, still ? 44 : 62, 44], { clamp: true }), { stiffness: 320, damping: 22 });
  const Icon = planet.icon;
  return (
    <PlanetLink slug={slug} className={`ts-dock-item${current === slug ? " on" : ""}`}>
      <motion.span ref={ref} className="ts-dock-ball" style={{ width: size, height: size }}><Icon size={18} aria-hidden="true" /></motion.span>
      <span className="ts-dock-tip">{t(planet.title)}</span>
    </PlanetLink>
  );
}

/** The dock of the six windows, shown once `hero` has scrolled away. */
export function Dock({ hero }: { hero: RefObject<HTMLElement | null> }) {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  const [vertical, setVertical] = useState(true);
  const pointer = useMotionValue(Infinity);
  useEffect(() => {
    const el = hero.current;
    if (!el) return;
    const watch = new IntersectionObserver(([entry]) => setShown(!entry.isIntersecting), { rootMargin: "-160px 0px 0px 0px" });
    watch.observe(el);
    const media = window.matchMedia("(min-width: 901px)");
    const sync = () => setVertical(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => { watch.disconnect(); media.removeEventListener("change", sync); };
  }, [hero]);
  return (
    <nav className={`ts-dock${shown ? " shown" : ""}`} aria-label={t("Explorer l’espace")} aria-hidden={!shown} inert={!shown}
      onPointerMove={(e) => pointer.set(vertical ? e.clientY : e.clientX)} onPointerLeave={() => pointer.set(Infinity)}>
      {planets.map(({ slug }) => <DockItem key={slug} slug={slug} pointer={pointer} vertical={vertical} />)}
    </nav>
  );
}

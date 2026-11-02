"use client";
// The client's side, to try: a pile of deliverables from a demo agency, as the client sees them in the
// portal. Throw the top card toward the end of the line (right, or left in Arabic) to approve it — the
// stamp strikes on it before it leaves — or toward the start to ask for changes; the two buttons do the
// same for a mouse, a keyboard or a screen reader. The gesture follows React Bits' Stack (drag, lean,
// fling), pared down to motion's drag. When the pile is empty it says what was decided and starts over.
import { AnimatePresence, motion, useMotionValue, useTransform } from "motion/react";
import { useState } from "react";
import { Check, PenLine, RotateCcw } from "lucide-react";
import NetworkIcon from "@/components/network-icon";
import { Stamp } from "@/components/moments/stamp";
import { spring } from "@/lib/motion";
import { useI18n } from "@/lib/i18n/locale-provider";
import { useStill } from "./ui";

type Network = "instagram" | "tiktok" | "facebook" | "youtube";
type Verdict = "yes" | "no";
const FAR = 110;

function Card({ title, kind, network, round, hours, depth, verdict, end, onDecide }: {
  title: string; kind: string; network: Network; round: string; hours: number; depth: number;
  verdict: Verdict | null; end: number; onDecide: (v: Verdict) => void;
}) {
  const { t } = useI18n();
  const still = useStill();
  const x = useMotionValue(0);
  const yes = useTransform(x, (v) => Math.min(1, Math.max(0, (v * end) / FAR)));
  const no = useTransform(x, (v) => Math.min(1, Math.max(0, (-v * end) / FAR)));
  const lean = useTransform(x, [-300, 300], [-9, 9]);
  const top = depth === 0;
  // The two answers show through only while the card is held, so a still page never shows both.
  const [held, setHeld] = useState(false);
  return (
    <motion.article
      className="v6-card"
      style={{ x, rotate: top && !still ? lean : 0, zIndex: 10 - depth, touchAction: "pan-y" }}
      initial={{ y: 30, scale: 0.9, opacity: 0 }}
      animate={{ y: depth * 16, scale: 1 - depth * 0.05, opacity: depth > 2 ? 0 : 1 }}
      variants={{ out: (dir: number) => ({ x: dir * 520, rotate: dir * 18, opacity: 0, transition: still ? { duration: 0 } : { duration: 0.45, ease: [0.4, 0, 1, 1] } }) }}
      exit="out"
      transition={still ? { duration: 0 } : spring.settle}
      drag={top && !verdict ? "x" : false}
      dragSnapToOrigin
      dragElastic={0.9}
      onDragStart={() => setHeld(true)}
      onDragEnd={(_, info) => {
        setHeld(false);
        const along = (info.offset.x + info.velocity.x * 0.2) * end;
        if (along >= FAR) onDecide("yes");
        else if (along <= -FAR) onDecide("no");
      }}
      aria-hidden={!top || undefined}
    >
      <div className={`v6-card-art ${network}`}>
        <NetworkIcon network={network} size={22} />
        <span>{kind}</span>
        <b>{title}</b>
      </div>
      <div className="v6-card-body">
        <p className="v6-card-client">{t("Café Atlas · à valider")}</p>
        <h3>{title}</h3>
        <p className="v6-card-meta"><span>{round}</span><span>{t("Validation tacite dans {h} h", { h: hours })}</span></p>
      </div>
      {top && held && !verdict && (
        <>
          <motion.span className="v6-card-tag yes" style={{ opacity: yes }} aria-hidden="true">{t("Valider")}</motion.span>
          <motion.span className="v6-card-tag no" style={{ opacity: no }} aria-hidden="true">{t("Retouche")}</motion.span>
        </>
      )}
      {verdict === "yes" && <span className="v6-card-stamp"><Stamp play size={96} /></span>}
      {verdict === "no" && <span className="v6-card-tag no shown">{t("Retouche demandée")}</span>}
    </motion.article>
  );
}

export default function ClientDeck() {
  const { t, rtl } = useI18n();
  const still = useStill();
  const end = rtl ? -1 : 1;
  const cards: { id: string; title: string; kind: string; network: Network; round: string; hours: number }[] = [
    { id: "carrousel", title: t("Carrousel 3 spots"), kind: t("Carrousel"), network: "instagram", round: t("Tour 1 sur 2"), hours: 47 },
    { id: "reel", title: t("Reel · ouverture du samedi"), kind: t("Reel"), network: "tiktok", round: t("Tour 2 sur 2"), hours: 31 },
    { id: "story", title: t("Story promo de la semaine"), kind: t("Story"), network: "facebook", round: t("Tour 1 sur 2"), hours: 12 },
    { id: "video", title: t("Vidéo recette du mois"), kind: t("Vidéo"), network: "youtube", round: t("Tour 1 sur 3"), hours: 44 },
  ];
  const [at, setAt] = useState(0);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [tally, setTally] = useState({ yes: 0, no: 0 });
  const [dir, setDir] = useState(end);
  const decide = (v: Verdict) => {
    if (verdict || at >= cards.length) return;
    setVerdict(v);
    setDir(v === "yes" ? end : -end);
    setTally((n) => ({ ...n, [v]: n[v] + 1 }));
    setTimeout(() => { setVerdict(null); setAt((i) => i + 1); }, still ? 250 : v === "yes" ? 900 : 650);
  };
  const left = cards.slice(at);
  const done = left.length === 0;
  return (
    <div className="v6-deck">
      <div className="v6-deck-pile">
        <AnimatePresence custom={dir} initial={false}>
          {left.slice(0, 3).map((c, depth) => <Card key={c.id} {...c} depth={depth} verdict={depth === 0 ? verdict : null} end={end} onDecide={decide} />).reverse()}
        </AnimatePresence>
        {done && (
          <motion.div className="v6-deck-done" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={still ? { duration: 0 } : spring.settle}>
            <Stamp size={64} />
            <b>{t("Tout est traité.")}</b>
            <p>{t("{yes} validé(s), {no} retouche(s). Chaque décision a son reçu daté dans l’historique.", { yes: tally.yes, no: tally.no })}</p>
            <button type="button" className="v6-deck-again" onClick={() => { setAt(0); setTally({ yes: 0, no: 0 }); }}><RotateCcw size={15} aria-hidden="true" />{t("Recommencer")}</button>
          </motion.div>
        )}
      </div>
      <div className="v6-deck-actions">
        <button type="button" className="no" onClick={() => decide("no")} disabled={done || !!verdict}><PenLine size={16} aria-hidden="true" />{t("Retouche")}</button>
        <button type="button" className="yes" onClick={() => decide("yes")} disabled={done || !!verdict}><Check size={16} aria-hidden="true" />{t("Valider")}</button>
      </div>
      <p className="v6-deck-hint" aria-live="polite">
        {done ? t("Démonstration terminée.") : verdict === "yes" ? t("Validé. Le reçu est ajouté à l’historique.") : verdict === "no" ? t("Retouche demandée. L’agence est prévenue.") : t("Glissez la carte, ou utilisez les boutons. {n} sur {total}.", { n: at + 1, total: cards.length })}
      </p>
    </div>
  );
}

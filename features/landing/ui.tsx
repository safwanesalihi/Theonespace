"use client";
// Small animated pieces shared by the landing, below its first screen. Reveal fades a block in as it
// scrolls into view, DepthCard follows the pointer with a spotlight and a slight 3D tilt, CountUp counts a
// figure up once it is seen (all three with motion/react, still for visitors who ask for reduced motion),
// and the 48-hour countdown. The pieces without motion (DeepPanel, the media queries, the scroll readings)
// live in ui-base.tsx, so the first screen doesn't carry motion.
import { m, useInView, useMotionValue } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStill } from "./ui-base";

export { DeepPanel, useRich, useStill } from "./ui-base";

// motion's animation engine (springs, tweens) is not on the first screen: the page's few animations ask
// for it when they start, from the chunk that also carries LazyMotion's features (motion-features.ts).
const engine = () => import("./motion-features").then((motion) => motion.animate);

export function Reveal({ children, delay = 0, className, y = 28 }: { children: ReactNode; delay?: number; className?: string; y?: number }) {
  // With reduced motion the block simply appears (space.css also shows it before the script runs).
  const still = useStill();
  return (
    <m.div className={className} initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={still ? { duration: 0 } : { duration: 0.8, delay, ease: [0.16, 1, 0.3, 1] }}>
      {children}
    </m.div>
  );
}

/** A card with a pointer-following gold spotlight (--mx/--my) and, with `tilt`, a soft 3D lean. */
export function DepthCard({ children, className = "", tilt = false, as = "div", href, onClick }: { children: ReactNode; className?: string; tilt?: boolean; as?: "div" | "a"; href?: string; onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void }) {
  const still = useStill();
  // The lean follows the pointer on a spring (as motion's useSpring would), from the engine fetched on the
  // first move.
  const rx = useMotionValue(0), ry = useMotionValue(0);
  const lean = (x: number, y: number) => engine().then((animate) => {
    const spring = { type: "spring", stiffness: 180, damping: 18 } as const;
    animate(rx, x, spring); animate(ry, y, spring);
  });
  const move = (event: React.PointerEvent<HTMLElement>) => {
    const el = event.currentTarget;
    const r = el.getBoundingClientRect();
    const px = (event.clientX - r.left) / r.width, py = (event.clientY - r.top) / r.height;
    el.style.setProperty("--mx", `${px * 100}%`);
    el.style.setProperty("--my", `${py * 100}%`);
    if (tilt && !still) lean((0.5 - py) * 8, (px - 0.5) * 10);
  };
  const leave = () => { if (tilt && !still) lean(0, 0); };
  const style = tilt && !still ? { rotateX: rx, rotateY: ry, transformPerspective: 900 } : undefined;
  if (as === "a") return <m.a href={href} onClick={onClick} className={`ts-depth ${className}`} style={style} onPointerMove={move} onPointerLeave={leave}>{children}</m.a>;
  return <m.div className={`ts-depth ${className}`} style={style} onPointerMove={move} onPointerLeave={leave}>{children}</m.div>;
}

/** Counts from 0 to `to` the first time it is seen; `format` turns the number into text. The server and
 *  the first render show the final figure, so the page reads right before (or without) the animation. */
export function CountUp({ to, format = (n) => String(Math.round(n)), duration = 1.6 }: { to: number; format?: (n: number) => string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true, margin: "-60px" });
  const still = useStill();
  const [value, setValue] = useState(to);
  useEffect(() => {
    if (!seen || still) return;
    // motion's animation engine comes with the first figure seen, not with the first screen.
    let run: { stop: () => void } | undefined, gone = false;
    engine().then((animate) => { if (!gone) run = animate(0, to, { duration, ease: [0.16, 1, 0.3, 1], onUpdate: setValue }); });
    return () => { gone = true; run?.stop(); };
  }, [seen, still, to, duration]);
  return <span ref={ref}>{format(value)}</span>;
}

/** Seconds left on a 48-hour validation clock that really runs (it starts again when it reaches zero). */
export function useCountdown(start = 48 * 3600 - 1) {
  const [left, setLeft] = useState(start);
  useEffect(() => {
    const tick = setInterval(() => setLeft((s) => (s > 0 ? s - 1 : 48 * 3600 - 1)), 1000);
    return () => clearInterval(tick);
  }, []);
  const two = (n: number) => String(n).padStart(2, "0");
  return { hh: two(Math.floor(left / 3600)), mm: two(Math.floor((left % 3600) / 60)), ss: two(left % 60) };
}

/** The countdown as a large mono clock with blinking separators. */
export function LiveClock({ className = "ts-clock" }: { className?: string }) {
  const { hh, mm, ss } = useCountdown();
  return <b className={className} aria-hidden="true">{hh}<i>:</i>{mm}<i>:</i>{ss}</b>;
}

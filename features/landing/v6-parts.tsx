"use client";
// The pieces both halves of the landing use: the first screen (v6.tsx) and the sections below it
// (v6-sections.tsx). Their own module, so neither half imports the other.
import Image from "next/image";
import dynamic from "next/dynamic";
import { useI18n } from "@/lib/i18n/locale-provider";

// The stamp strikes only once the page has settled (or when the pilot call is seen): its code, motion's
// full component, comes then, not with the first screen.
export const Stamp = dynamic(() => import("@/components/moments/stamp").then((s) => s.Stamp), { ssr: false });

export type Cta = { href: string; label: string; external: boolean };
export const outward = (cta: Cta) => (cta.external ? { target: "_blank", rel: "noopener noreferrer" } : {});
export const away = (href: string) => (href.startsWith("https://") ? { target: "_blank", rel: "noopener noreferrer" } : {});

/** « Demander un accès »: there is no self-serve sign-up; an agency asks, and The One Core opens its space
 *  (app/login, lib/access-requests.ts). Every call to action on the page leads there. */
export function useCta(): Cta {
  const { t } = useI18n();
  return { href: "/login?demande=1", label: t("Demander un accès"), external: false };
}

/** A real screen of the app in a light browser frame. */
export function Screen({ src, alt, priority = false, className = "" }: { src: string; alt: string; priority?: boolean; className?: string }) {
  return (
    <figure className={`v6-screen ${className}`}>
      <div className="v6-screen-bar" aria-hidden="true"><i /><i /><i /><span>space.the1core.com</span></div>
      <Image src={src} alt={alt} width={1920} height={1200} sizes="(max-width: 900px) 100vw, 1200px" {...(priority ? { loading: "eager", fetchPriority: "high" } as const : {})} />
    </figure>
  );
}

/** A real phone screen of the app. */
export function PhoneShot({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  return (
    <figure className={`v6-phone ${className}`}>
      <Image src={src} alt={alt} width={780} height={1688} sizes="(max-width: 900px) 46vw, 300px" />
    </figure>
  );
}

export function Head({ id, title, lead }: { id: string; title: string; lead?: string }) {
  return (
    <div className="v6-head">
      <h2 id={id}>{title}</h2>
      {lead && <p>{lead}</p>}
    </div>
  );
}

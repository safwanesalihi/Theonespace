"use client";
// The home's two sides, each in its own client bundle (next/dynamic in a Client Component splits, and only
// the side that renders is fetched): a visitor downloads the landing alone, a signed-in user the studio
// alone. app/(app)/page.tsx decides which side from the session.
import dynamic from "next/dynamic";
import type { LandingContent } from "@/features/landing/content";
import type { BootBrand } from "@/lib/boot-brand";

const Landing = dynamic(() => import("@/features/landing/landing"));
const StudioApp = dynamic(() => import("./studio"));

type Props = { signedIn: true; content?: undefined; bootBrand?: BootBrand | null } | { signedIn: false; content: LandingContent; bootBrand?: undefined };

export default function Home({ signedIn, content, bootBrand }: Props) {
  return signedIn ? <StudioApp bootBrand={bootBrand} /> : <Landing content={content} />;
}

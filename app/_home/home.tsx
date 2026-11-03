"use client";
// The home's two sides, each in its own client bundle (next/dynamic in a Client Component splits, and only
// the side that renders is fetched): a visitor downloads the landing alone, a signed-in user the studio
// alone. app/page.tsx decides which side from the session.
import dynamic from "next/dynamic";
import type { LandingContent } from "@/features/landing/content";

const Landing = dynamic(() => import("@/features/landing/landing"));
const StudioApp = dynamic(() => import("./studio"));

type Props = { signedIn: true; content?: undefined } | { signedIn: false; content: LandingContent };

export default function Home({ signedIn, content }: Props) {
  return signedIn ? <StudioApp /> : <Landing content={content} />;
}

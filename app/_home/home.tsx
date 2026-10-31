"use client";
// The home's two sides, each in its own client bundle (next/dynamic in a Client Component splits, and only
// the side that renders is fetched): a visitor downloads the landing alone, a signed-in user the studio
// alone. app/page.tsx decides which side from the session.
import dynamic from "next/dynamic";

const Landing = dynamic(() => import("@/features/landing/landing"));
const StudioApp = dynamic(() => import("@/features/studio/studio-app"));

export default function Home({ signedIn, signup }: { signedIn: boolean; signup: boolean }) {
  return signedIn ? <StudioApp /> : <Landing signup={signup} />;
}

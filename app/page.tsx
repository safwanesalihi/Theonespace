import type { Metadata } from "next";
import Home from "./_home/home";
import { homeMetadata } from "./_home/metadata";
import { getAppUser } from "@/lib/auth";
import { signupEnabled } from "@/lib/signup";

export const dynamic = "force-dynamic";

export const metadata: Metadata = homeMetadata;

// A visitor without a session cookie never reaches this page: next.config.ts answers "/" from the
// prebuilt public page (app/accueil). Here, with a cookie: signed out (a stale cookie), the public page
// (features/landing/landing.tsx); signed in — including someone who must still choose their password —
// the studio app (features/studio/studio-app.tsx), which handles that step itself. Each side loads in its
// own bundle (app/_home/home.tsx), so visitors don't download the studio.
export default async function Page() {
  const user = await getAppUser().catch(() => null);
  return <Home signedIn={!!user} signup={!user && signupEnabled()} />;
}

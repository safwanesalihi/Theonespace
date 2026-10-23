import type { Metadata } from "next";
import StudioApp from "@/features/studio/studio-app";
import Landing from "@/features/landing/landing";
import { getAppUser } from "@/lib/auth";
import { signupEnabled } from "@/lib/signup";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: new URL("https://space.the1core.com"),
  title: "The One Space — vos clients valident en 48 h",
  description: "L’espace de travail des agences et de leurs clients : production, validation en 48 h, publication sur Facebook et Instagram, portail client à votre marque et assistant IA.",
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: "The One Space", locale: "fr_MA", title: "The One Space — vos clients valident en 48 h. Sinon, c’est validé.", description: "Production, validation et publication pour les agences et leurs clients, avec des règles que le logiciel fait respecter." },
  twitter: { card: "summary_large_image" },
};

// Signed out: the public landing page (features/landing/landing.tsx). Signed in — including someone who
// must still choose their password — the studio app (features/studio/studio-app.tsx), which handles that
// step itself.
export default async function Page() {
  const user = await getAppUser().catch(() => null);
  if (!user) return <Landing signup={signupEnabled()} />;
  return <StudioApp />;
}

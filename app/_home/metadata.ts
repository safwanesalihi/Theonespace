// The home's title, description and sharing card, for both its pages: the live one (app/page.tsx) and
// the prebuilt public one (app/accueil/page.tsx), which is served at "/" as well.
import type { Metadata } from "next";

export const homeMetadata: Metadata = {
  metadataBase: new URL("https://space.the1core.com"),
  title: "The One Space — vos clients valident en 48 h",
  description: "L’espace de travail des agences et de leurs clients : production, validation en 48 h, publication sur Facebook et Instagram, portail client à votre marque et assistant IA.",
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: "The One Space", locale: "fr_MA", title: "The One Space — vos clients valident en 48 h. Sinon, c’est validé.", description: "Production, validation et publication pour les agences et leurs clients, avec des règles que le logiciel fait respecter." },
  twitter: { card: "summary_large_image" },
};

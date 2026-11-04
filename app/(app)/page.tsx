import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import Home from "../_home/home";
import { BrandBootScreen } from "../boot-screen";
import { homeMetadata } from "../_home/metadata";
import { getAppUser } from "@/lib/auth";
import { landingContent } from "@/features/landing/content";
import { bootBrandCookie, decodeBootBrand, type BootBrand } from "@/lib/boot-brand";

export const dynamic = "force-dynamic";

export const metadata: Metadata = homeMetadata;

// A visitor without a session cookie never reaches this page: next.config.ts answers "/" from the
// prebuilt public page (app/accueil). Here, with a cookie: signed out (a stale cookie), the public page
// (features/landing/landing.tsx); signed in — including someone who must still choose their password —
// the studio app (features/studio/studio-app.tsx), which handles that step itself. Each side loads in its
// own bundle (app/_home/home.tsx), so visitors don't download the studio.
//
// While the session is checked, the loading screen shows the brand this browser last opened (its cookie,
// lib/boot-brand.ts), drawn by the server in the first frame; the studio's own boot screen keeps it.
export default async function Page() {
  const brand = decodeBootBrand((await cookies()).get(bootBrandCookie)?.value);
  return <Suspense fallback={<BrandBootScreen brand={brand} />}><Signed brand={brand} /></Suspense>;
}

async function Signed({ brand }: { brand: BootBrand | null }) {
  const user = await getAppUser().catch(() => null);
  return user ? <Home signedIn bootBrand={brand} /> : <Home signedIn={false} content={await landingContent()} />;
}

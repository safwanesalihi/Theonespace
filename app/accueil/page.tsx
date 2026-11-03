// The public page, prebuilt: next.config.ts serves it at "/" to anyone without a session cookie, so a
// visitor's first byte comes from the cache, not from a server checking a session. Same page as the
// live home shows when signed out (features/landing/landing.tsx). Its editable information (banner, pilot
// offer, prices, contact) is read when the page is built, and the page is built again each time the owner
// saves it (Plateforme → Site, revalidatePath in app/api/platform/route.ts).
import type { Metadata } from "next";
import Landing from "@/features/landing/landing";
import { landingContent } from "@/features/landing/content";
import { homeMetadata } from "../_home/metadata";

export const dynamic = "force-static";
export const metadata: Metadata = homeMetadata;

export default async function PublicHome() {
  return <Landing content={await landingContent()} />;
}

// The public page, prebuilt: next.config.ts serves it at "/" to anyone without a session cookie, so a
// visitor's first byte comes from the cache, not from a server checking a session. Same page as the
// live home shows when signed out (features/landing/landing.tsx). Whether sign-up is open is read when
// the site is built (PUBLIC_SIGNUP): changing it takes a new deployment.
import type { Metadata } from "next";
import Landing from "@/features/landing/landing";
import { signupEnabled } from "@/lib/signup";
import { homeMetadata } from "../_home/metadata";

export const dynamic = "force-static";
export const metadata: Metadata = homeMetadata;

export default function PublicHome() {
  return <Landing signup={signupEnabled()} />;
}

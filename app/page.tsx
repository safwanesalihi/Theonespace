import Tracker from "./tracker";
import Landing from "../features/landing/landing";
import { getAppUser } from "@/lib/auth";
import { signupEnabled } from "@/lib/signup";

export const dynamic = "force-dynamic";

// Signed out: the public landing page (app/landing.tsx). Signed in — including someone who must still
// choose their password — the app, which handles that step itself.
export default async function Page() {
  const user = await getAppUser().catch(() => null);
  if (!user) return <Landing signup={signupEnabled()} />;
  return <Tracker />;
}

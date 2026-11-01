"use client";
// The studio side of the home (app/_home/home.tsx), with the app's stylesheet: a signed-in user gets it
// with the studio's bundle; a visitor of the public page never does. Once the studio is up, the English
// and Arabic dictionaries are fetched in idle time, so a language change in the settings is instant.
import "@/app/styles.css";
import { useEffect } from "react";
import StudioApp from "@/features/studio/studio-app";
import { preloadLocales } from "@/lib/i18n/locale-provider";

export default function Studio() {
  useEffect(() => {
    if (typeof window.requestIdleCallback !== "function") { const id = window.setTimeout(preloadLocales, 3000); return () => window.clearTimeout(id); }
    const id = window.requestIdleCallback(preloadLocales, { timeout: 5000 });
    return () => window.cancelIdleCallback(id);
  }, []);
  return <StudioApp />;
}

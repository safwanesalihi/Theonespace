"use client";
// Sends the activity beat (lib/activity.ts) once a minute while the app is the visible tab. Nothing is
// sent while the tab is hidden, so time spent elsewhere never counts as time on screen.
import { useEffect } from "react";
import { activity } from "@/lib/activity-rules";

export function useActivityBeat(workspaceId: string | null | undefined) {
  useEffect(() => {
    if (!workspaceId) return;
    let lastInput = Date.now();
    const mark = () => { lastInput = Date.now(); };
    const inputs = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;
    for (const type of inputs) window.addEventListener(type, mark, { passive: true, capture: true });
    const beat = () => {
      if (document.visibilityState !== "visible") return;
      const active = Date.now() - lastInput < activity.idleMinutes * 60_000;
      void fetch("/api/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Workspace-Id": workspaceId },
        body: JSON.stringify({ active }),
        keepalive: true,
      }).catch(() => {});
    };
    beat();
    const timer = window.setInterval(beat, activity.beatSeconds * 1000);
    const onVisible = () => { if (document.visibilityState === "visible") { mark(); beat(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      for (const type of inputs) window.removeEventListener(type, mark, { capture: true });
    };
  }, [workspaceId]);
}

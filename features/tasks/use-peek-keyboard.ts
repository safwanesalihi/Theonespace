"use client";
import { useEffect, useRef } from "react";
import type { RecordItem } from "@/lib/model";

/** In the task side panel, ↑/↓ (or k/j) go to the previous/next task of the list; not while typing. */
export function usePeekKeyboard(filtered: RecordItem[], peekId: string | null, setPeekId: (id: string) => void) {
  const peekList = useRef<string[]>([]);
  useEffect(() => { peekList.current = filtered.map((t) => t.id); });
  useEffect(() => {
    if (!peekId) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      const step = e.key === "ArrowDown" || e.key === "j" ? 1 : e.key === "ArrowUp" || e.key === "k" ? -1 : 0;
      if (!step) return;
      const ids = peekList.current, next = ids[ids.indexOf(peekId) + step];
      if (next) { e.preventDefault(); setPeekId(next); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [peekId, setPeekId]);
}

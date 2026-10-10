"use client";
// Work that takes a while — publishing, the AI, Instagram readings — runs here, outside the window that
// started it: the person closes the window or moves to another page, a small panel shows what is still
// running, and a notice says how each one ended. Kept at module level, so closing a dialog or changing
// page never cancels it; only leaving or reloading the app would, and the browser asks first.
import { useEffect, useState, useSyncExternalStore } from "react";
import { Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-provider";

export type BackgroundJob = { id: string; key?: string; label: string; startedAt: number };
type Report = { notice: (text: string) => void; error: (text: string) => void };

let jobs: BackgroundJob[] = [];
const none: BackgroundJob[] = [];
/** What finished jobs brought back, by key, until the screen that started them takes it. */
const results = new Map<string, unknown>();
const listeners = new Set<() => void>();
let report: Report = { notice: () => {}, error: () => {} };
const emit = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Where the outcome is told: the studio's own notice and error banners (studio-app.tsx). */
export function setBackgroundReport(next: Report) { report = next; }

/**
 * Runs `work` in the background. `key` names the work so it can't start twice and so its result can be
 * picked up later (`useBackgroundResult`); `done` and `failed` turn the outcome into the notice shown
 * at the end (nothing is shown when they return nothing).
 */
export function runInBackground<T>({ key, label, work, done, failed }: {
  key?: string; label: string; work: () => Promise<T>;
  done?: (result: T) => string | null | void; failed?: (error: Error) => string | null | void;
}): boolean {
  if (key && jobs.some((j) => j.key === key)) return false;
  const job: BackgroundJob = { id: crypto.randomUUID(), key, label, startedAt: Date.now() };
  jobs = [...jobs, job];
  emit();
  void work().then(
    (result) => {
      if (key) results.set(key, result);
      const text = done?.(result);
      if (text) report.notice(text);
    },
    (error: Error) => {
      const text = failed ? failed(error) : error.message;
      if (text) report.error(text);
    },
  ).finally(() => {
    jobs = jobs.filter((j) => j.id !== job.id);
    emit();
  });
  return true;
}

export const useBackgroundJobs = () => useSyncExternalStore(subscribe, () => jobs, () => none);
/** The same, outside React (tests/background-work.mjs). */
export const runningJobs = () => jobs;
export const resultFor = <T,>(key: string) => results.get(key) as T | undefined;
/** The job running under `key`, if any. */
export const useBackgroundJob = (key: string) => useBackgroundJobs().find((j) => j.key === key);
/** A finished job's result, kept until the screen that wanted it is done with it (`clearResult`). */
export const useBackgroundResult = <T,>(key: string) => useSyncExternalStore(subscribe, () => results.get(key) as T | undefined, () => undefined);
export function clearResult(key: string) {
  if (results.delete(key)) emit();
}

/** Seconds since `startedAt`, ticking while shown. */
export function useElapsed(startedAt?: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);
  return startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
}

function JobRow({ job }: { job: BackgroundJob }) {
  const { t } = useI18n();
  const s = useElapsed(job.startedAt);
  return <li><Loader2 size={14} className="spin" /><span>{job.label}</span><small>{t("{s} s", { s })}</small></li>;
}

/** The panel in the corner: what is still running. The browser asks before the app is left meanwhile. */
export function BackgroundPanel() {
  const { t } = useI18n();
  const running = useBackgroundJobs();
  useEffect(() => {
    if (!running.length) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running.length]);
  if (!running.length) return null;
  return (
    <section className="background-work" role="status" aria-live="polite" aria-label={t("En cours")}>
      <strong>{t("En cours · vous pouvez continuer à travailler")}</strong>
      <ul>{running.map((job) => <JobRow key={job.id} job={job} />)}</ul>
    </section>
  );
}

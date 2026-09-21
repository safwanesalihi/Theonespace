"use client";
// Voice-message player drawn with the app's own controls. The browser's native <audio controls> looks
// foreign next to them and, for clips recorded with MediaRecorder (whose WebM carries no length in its
// header), keeps showing 0:00 with a dead seek bar.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type SyntheticEvent } from "react";
import { Pause, Play } from "lucide-react";

export type PlayerLabels = { play: string; pause: string };

export function formatClock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const known = (audio: HTMLAudioElement) => Number.isFinite(audio.duration) && audio.duration > 0;

export default function AudioPlayer({
  src,
  label,
  labels = { play: "Lire", pause: "Pause" },
  preload = "metadata",
}: {
  src: string | Blob; // a URL, or a clip that has not been uploaded yet
  label: string;
  labels?: PlayerLabels;
  preload?: "none" | "metadata" | "auto";
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  // True while seeking past the end to make the browser work out an unknown length.
  const probingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0); // 0 until the browser knows it

  // A Blob gets an object URL for as long as this player shows it.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || typeof src === "string") return;
    const url = URL.createObjectURL(src);
    audio.src = url;
    return () => URL.revokeObjectURL(url);
  }, [src]);

  function onLoadedMetadata(e: SyntheticEvent<HTMLAudioElement>) {
    const audio = e.currentTarget;
    if (known(audio)) {
      setDuration(audio.duration);
      return;
    }
    probingRef.current = true;
    audio.currentTime = 1e101;
  }
  function onDurationChange(e: SyntheticEvent<HTMLAudioElement>) {
    if (known(e.currentTarget)) setDuration(e.currentTarget.duration);
  }
  function onSeeked(e: SyntheticEvent<HTMLAudioElement>) {
    const audio = e.currentTarget;
    if (!probingRef.current) return;
    probingRef.current = false;
    if (known(audio)) setDuration(audio.duration);
    audio.currentTime = 0;
  }
  function onTimeUpdate(e: SyntheticEvent<HTMLAudioElement>) {
    if (!probingRef.current) setTime(e.currentTarget.currentTime);
  }
  function onEnded(e: SyntheticEvent<HTMLAudioElement>) {
    if (probingRef.current) return;
    setPlaying(false);
    e.currentTarget.currentTime = 0;
    setTime(0);
  }

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setPlaying(false));
    else audio.pause();
  }
  function seekTo(ratio: number) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const next = Math.min(Math.max(ratio, 0), 1) * duration;
    audio.currentTime = next;
    setTime(next);
  }
  function onTrackPointer(e: PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    seekTo((rtl ? rect.right - e.clientX : e.clientX - rect.left) / rect.width);
  }
  function onTrackKey(e: KeyboardEvent<HTMLDivElement>) {
    if (!duration) return;
    const step = 5;
    const jumps: Record<string, number> = { ArrowRight: time + step, ArrowUp: time + step, ArrowLeft: time - step, ArrowDown: time - step, Home: 0, End: duration };
    if (!(e.key in jumps)) return;
    e.preventDefault();
    seekTo(jumps[e.key] / duration);
  }

  const progress = duration ? Math.min(time / duration, 1) * 100 : 0;
  return (
    <div className={`audio-player${playing ? " playing" : ""}`} role="group" aria-label={label}>
      <audio
        ref={audioRef}
        src={typeof src === "string" ? src : undefined}
        preload={preload}
        onLoadedMetadata={onLoadedMetadata}
        onDurationChange={onDurationChange}
        onSeeked={onSeeked}
        onTimeUpdate={onTimeUpdate}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={onEnded}
      />
      <button type="button" className="audio-toggle" aria-label={playing ? labels.pause : labels.play} title={playing ? labels.pause : labels.play} onClick={toggle}>
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <div
        className="audio-track"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(time)}
        aria-valuetext={formatClock(time)}
        onPointerDown={onTrackPointer}
        onKeyDown={onTrackKey}
      >
        <div className="audio-fill" style={{ width: `${progress}%` }} />
      </div>
      <span className="audio-time">
        {formatClock(time)}
        {duration ? ` / ${formatClock(duration)}` : ""}
      </span>
    </div>
  );
}

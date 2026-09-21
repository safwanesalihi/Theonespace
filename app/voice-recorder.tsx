"use client";
// Records a short voice message with the browser's MediaRecorder and hands the finished clip back
// to its parent, which uploads it (uploadVoice) when the comment is actually sent.
import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, Square, Trash2 } from "lucide-react";

export type VoiceLabels = {
  record: string;
  stop: string;
  recording: string;
  remove: string;
  unsupported: string;
  denied: string;
};

export const maxVoiceSeconds = 180;

const mimeCandidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  return mimeCandidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

export async function uploadVoice(clip: Blob, workspaceId: string): Promise<string> {
  const type = clip.type.split(";")[0] || "audio/webm";
  const ext = type === "audio/mp4" ? "m4a" : type === "audio/ogg" ? "ogg" : type === "audio/mpeg" ? "mp3" : "webm";
  const body = new FormData();
  body.append("kind", "audio");
  body.append("file", new File([clip], `voice.${ext}`, { type }));
  const response = await fetch("/api/assets", { method: "POST", body, headers: { "X-Workspace-Id": workspaceId } });
  const data = (await response.json()) as { id?: string; error?: string };
  if (!response.ok || !data.id) throw new Error(data.error || "Envoi impossible.");
  return data.id;
}

export default function VoiceRecorder({
  value,
  onChange,
  disabled,
  labels,
}: {
  value: Blob | null;
  onChange: (clip: Blob | null) => void;
  disabled?: boolean;
  labels: VoiceLabels;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // One object URL per clip, revoked when the clip changes or the recorder unmounts.
  const previewUrl = useMemo(() => (value ? URL.createObjectURL(value) : ""), [value]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  // Leaving the screen mid-recording releases the microphone.
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recorder?.stream.getTracks().forEach((track) => track.stop());
  }, []);

  function stopRecorder() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recorder?.stream.getTracks().forEach((track) => track.stop());
  }

  async function start() {
    setError("");
    const mimeType = pickMimeType();
    if (!mimeType || !navigator.mediaDevices?.getUserMedia) {
      setError(labels.unsupported);
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError(labels.denied);
      return;
    }
    const recorder = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const clip = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];
      setRecording(false);
      if (clip.size) onChange(clip);
    };
    recorderRef.current = recorder;
    recorder.start(250);
    setRecording(true);
    setSeconds(0);
    timerRef.current = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= maxVoiceSeconds) stopRecorder();
        return s + 1;
      });
    }, 1000);
  }

  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div className="voice-recorder">
      {recording ? (
        <button type="button" className="btn voice-stop" onClick={stopRecorder}>
          <Square size={14} />
          {labels.stop}
          <span className="voice-clock" aria-live="polite">
            <i className="voice-dot" /> {labels.recording} {clock}
          </span>
        </button>
      ) : value && previewUrl ? (
        <div className="voice-preview">
          <audio controls src={previewUrl} preload="metadata" />
          <button type="button" className="icon-button" aria-label={labels.remove} title={labels.remove} disabled={disabled} onClick={() => onChange(null)}>
            <Trash2 size={15} />
          </button>
        </div>
      ) : (
        <button type="button" className="btn voice-start" disabled={disabled} onClick={() => void start()}>
          <Mic size={15} />
          {labels.record}
        </button>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

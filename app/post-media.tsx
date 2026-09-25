"use client";
// The photo or video an editorial post publishes. Uploaded from the browser straight to storage
// (app/api/editorial/media hands out the signed URL), so large videos never go through the app.
// Photos are re-encoded as JPEG on the way: Instagram publishes no other image format.
import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useI18n } from "@/app/locale-provider";

export type PostMediaValue = { mediaUrl: string; mediaType: string; mediaPath: string };

const maxImageSide = 1440; // Instagram's own ceiling; anything larger is downscaled by Meta anyway

async function toJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error("Image illisible."); });
  const scale = Math.min(1, maxImageSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#fff"; // transparent PNG areas become white rather than black
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("Impossible de préparer l’image.");
  return blob;
}

function put(url: string, body: Blob, onProgress: (ratio: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", body.type);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("L’envoi du fichier a échoué.")));
    xhr.onerror = () => reject(new Error("L’envoi du fichier a échoué."));
    xhr.send(body);
  });
}

export default function PostMedia({
  value,
  onChange,
  workspaceId,
  disabled,
}: {
  value: PostMediaValue;
  onChange: (next: PostMediaValue) => void;
  workspaceId: string | null;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function pick(file: File | undefined) {
    if (!file || !workspaceId) return;
    setError("");
    setProgress(0);
    try {
      const video = file.type.startsWith("video/");
      const body: Blob = video ? file : await toJpeg(file);
      const response = await fetch("/api/editorial/media", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Workspace-Id": workspaceId },
        body: JSON.stringify({ contentType: body.type, size: body.size }),
      });
      const data = (await response.json()) as { uploadUrl?: string; publicUrl?: string; path?: string; mediaType?: string; error?: string };
      if (!response.ok || !data.uploadUrl) throw new Error(data.error || "L’envoi du fichier a échoué.");
      await put(data.uploadUrl, body, setProgress);
      onChange({ mediaUrl: data.publicUrl!, mediaType: data.mediaType!, mediaPath: data.path! });
    } catch (e) {
      setError(t((e as Error).message));
    } finally {
      setProgress(null);
      if (input.current) input.current.value = "";
    }
  }

  const uploading = progress !== null;
  return (
    <div className="post-media">
      {value.mediaUrl && (
        <div className="post-media-preview">
          {value.mediaType === "video" ? (
            <video src={value.mediaUrl} controls preload="metadata" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- a user upload on another origin, shown as is
            <img src={value.mediaUrl} alt={t("Média du post")} />
          )}
        </div>
      )}
      <div className="inline">
        <input
          ref={input}
          type="file"
          hidden
          accept="image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime"
          onChange={(e) => void pick(e.target.files?.[0])}
        />
        <button type="button" className="btn" disabled={disabled || uploading || !workspaceId} onClick={() => input.current?.click()}>
          {uploading ? <Loader2 size={14} className="spin" /> : <ImagePlus size={14} />}
          {uploading
            ? t("Envoi… {percent} %", { percent: Math.round((progress ?? 0) * 100) })
            : t(value.mediaUrl ? "Remplacer le média" : "Ajouter une photo ou une vidéo")}
        </button>
        {value.mediaUrl && !uploading && (
          <button type="button" className="btn ghost danger" disabled={disabled} onClick={() => onChange({ mediaUrl: "", mediaType: "", mediaPath: "" })}>
            <Trash2 size={14} />
            {t("Retirer")}
          </button>
        )}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}

"use client";
// Uploads a post's photo or video straight from the browser to storage: app/api/editorial/media hands
// out a signed URL, so large videos never go through the app. Photos are re-encoded as JPEG on the
// way — Instagram publishes no other image format.
import type { SocialMedia } from "@/lib/social";

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

export const acceptedMedia = "image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime";

export async function uploadMedia(file: File, workspaceId: string, onProgress: (ratio: number) => void): Promise<SocialMedia> {
  const video = file.type.startsWith("video/");
  const body: Blob = video ? file : await toJpeg(file);
  const response = await fetch("/api/editorial/media", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Workspace-Id": workspaceId },
    body: JSON.stringify({ contentType: body.type, size: body.size }),
  });
  const data = (await response.json().catch(() => ({}))) as { uploadUrl?: string; publicUrl?: string; path?: string; mediaType?: "image" | "video"; error?: string };
  if (!response.ok || !data.uploadUrl) throw new Error(data.error || "L’envoi du fichier a échoué.");
  await put(data.uploadUrl, body, onProgress);
  return { url: data.publicUrl!, type: data.mediaType!, path: data.path };
}

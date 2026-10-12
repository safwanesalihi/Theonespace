"use client";
// The client's Drive folder in a dialog so the studio can browse sub-folders, preview photos/videos,
// and pick up to 35 files for a post without pasting links.
import { useCallback, useEffect, useState } from "react";
import { Check, ChevronRight, FileImage, FileVideo, Folder, FolderOpen, Loader2, Play } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/locale-provider";
import { driveFetch } from "@/features/drive/drive-client";
import { folderMime, type DriveFile as ClientFolderDriveFile } from "@/lib/client-folders";
import type { DriveFile } from "@/lib/drive";
import styles from "./drive-browser-dialog.module.css";

type Listing = {
  files: ClientFolderDriveFile[];
  nextPageToken?: string;
  folder: ClientFolderDriveFile;
  root: { id: string; name: string };
  refreshedAt: string;
};

export type DriveBrowserDialogProps = {
  open: boolean;
  workspaceId: string;
  clientId: string;
  clientName: string;
  maxFiles?: number;
  onClose: () => void;
  onPick: (files: DriveFile[]) => void;
};

export default function DriveBrowserDialog({
  open,
  workspaceId,
  clientId,
  clientName,
  maxFiles = 35,
  onClose,
  onPick,
}: DriveBrowserDialogProps) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [listing, setListing] = useState<Listing | null>(null);
  const [stack, setStack] = useState<{ id: string; name: string }[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const load = useCallback(
    async (folderId?: string) => {
      setLoading(true);
      setError("");
      try {
        const query = new URLSearchParams({ clientId });
        if (folderId) query.set("folderId", folderId);
        const data = await driveFetch<Listing>(workspaceId, `files?${query}`);
        setListing(data);
        setStack((prev) => {
          if (!folderId || folderId === data.root.id) return [{ id: data.root.id, name: data.root.name }];
          const idx = prev.findIndex((f) => f.id === folderId);
          if (idx >= 0) return prev.slice(0, idx + 1);
          return [...prev, { id: data.folder.id, name: data.folder.name }];
        });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [workspaceId, clientId],
  );

  useEffect(() => {
    if (!open || !clientId) return;
    setSelectedIds([]);
    setStack([]);
    setListing(null);
    void load();
  }, [open, clientId, load]);

  function toggle(file: ClientFolderDriveFile) {
    if (file.mimeType === folderMime) return;
    const isImage = file.mimeType.startsWith("image/");
    const isVideo = file.mimeType.startsWith("video/");
    if (!isImage && !isVideo) return;
    setSelectedIds((prev) => {
      if (prev.includes(file.id)) return prev.filter((id) => id !== file.id);
      if (prev.length >= maxFiles) return prev;
      return [...prev, file.id];
    });
  }

  async function submit() {
    if (!selectedIds.length) return;
    setSubmitting(true);
    setError("");
    try {
      const data = await driveFetch<{ files: DriveFile[] }>(workspaceId, "media", { clientId, fileIds: selectedIds });
      onPick(data.files || []);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const items = listing?.files ?? [];
  const folders = items.filter((f) => f.mimeType === folderMime);
  const mediaFiles = items.filter((f) => f.mimeType.startsWith("image/") || f.mimeType.startsWith("video/"));
  const otherFiles = items.filter((f) => f.mimeType !== folderMime && !f.mimeType.startsWith("image/") && !f.mimeType.startsWith("video/"));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !submitting) onClose(); }}>
      <DialogContent className="tracker-modal tracker-modal-large">
        <DialogHeader>
          <DialogTitle>{t("Parcourir le Drive de {client}", { client: clientName })}</DialogTitle>
          <DialogDescription>
            {t("Sélectionnez les photos et vidéos à ajouter à la publication (35 maximum).")}
          </DialogDescription>
        </DialogHeader>

        <nav aria-label={t("Chemin du dossier")} className={styles.breadcrumbs}>
          {stack.map((item, i) => (
            <span key={item.id} className={styles.crumbItem}>
              {i > 0 && <ChevronRight size={13} className={styles.crumbSep} />}
              <button
                type="button"
                className={styles.crumbButton}
                disabled={loading || submitting || i === stack.length - 1}
                onClick={() => void load(item.id)}
              >
                {i === 0 ? <FolderOpen size={14} /> : <Folder size={14} />}
                <span>{item.name}</span>
              </button>
            </span>
          ))}
        </nav>

        {error && <div className={styles.error}>{t(error)}</div>}

        <div className={styles.body}>
          {loading ? (
            <div className={styles.loading}>
              <Loader2 size={24} className="spin" />
              <span>{t("Chargement des fichiers…")}</span>
            </div>
          ) : (
            <div className={styles.grid}>
              {folders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={styles.folderCard}
                  disabled={submitting}
                  onClick={() => void load(f.id)}
                >
                  <Folder size={22} className={styles.folderIcon} />
                  <span className={styles.fileName} title={f.name}>{f.name}</span>
                </button>
              ))}

              {mediaFiles.map((f) => {
                const selected = selectedIds.includes(f.id);
                const order = selectedIds.indexOf(f.id);
                const isVideo = f.mimeType.startsWith("video/");
                return (
                  <button
                    key={f.id}
                    type="button"
                    className={`${styles.mediaCard} ${selected ? styles.selected : ""}`}
                    disabled={submitting}
                    onClick={() => toggle(f)}
                    aria-pressed={selected}
                    title={f.name}
                  >
                    <div className={styles.thumbWrap}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- Google Drive thumbnail */}
                      <img
                        src={`https://drive.google.com/thumbnail?id=${f.id}&sz=w400`}
                        alt=""
                        className={styles.thumb}
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                          const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
                          if (fallback) fallback.style.display = "flex";
                        }}
                      />
                      <div className={styles.thumbFallback} style={{ display: "none" }}>
                        {isVideo ? <FileVideo size={28} /> : <FileImage size={28} />}
                      </div>
                      {isVideo && <Play size={16} className={styles.videoBadge} />}
                      <span className={`${styles.checkBadge} ${selected ? styles.checked : ""}`}>
                        {selected ? order + 1 : <Check size={12} />}
                      </span>
                    </div>
                    <span className={styles.fileName}>{f.name}</span>
                  </button>
                );
              })}

              {!folders.length && !mediaFiles.length && !otherFiles.length && (
                <div className={styles.empty}>
                  <FolderOpen size={36} />
                  <p>{t("Ce dossier est vide.")}</p>
                </div>
              )}

              {!folders.length && !mediaFiles.length && otherFiles.length > 0 && (
                <div className={styles.empty}>
                  <FileImage size={36} />
                  <p>{t("Aucune photo ni vidéo dans ce dossier.")}</p>
                  <small>{t("{n} autres documents non pris en charge.", { n: otherFiles.length })}</small>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="modal-footer">
          <span className={styles.footerInfo}>
            {selectedIds.length > 0
              ? t("{n} sélectionné(s) sur {max}", { n: selectedIds.length, max: maxFiles })
              : t("Sélectionnez jusqu’à {max} médias", { max: maxFiles })}
          </span>
          <button type="button" className="btn" disabled={submitting} onClick={onClose}>
            {t("Annuler")}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={submitting || !selectedIds.length}
            onClick={() => void submit()}
          >
            {submitting && <Loader2 size={14} className="spin" />}
            {t("Ajouter à la publication")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

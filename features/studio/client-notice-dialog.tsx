"use client";
// « Notifier le client »: an e-mail to the client's portal accesses (or their file's address) with what
// waits for their approval and an optional word from the studio.
import { behaviourOf } from "@/lib/process";
import { useProcess } from "@/features/workspace/process-context";
import { useState } from "react";
import { Bell } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/locale-provider";
import type { RecordItem } from "@/lib/model";
import type { WorkspacePayload } from "@/features/workspace/use-workspace-session";

/** The dialog's state; `openClientNotice` starts it fresh for a client. */
export function useClientNotice() {
  const [clientNotice, setClientNotice] = useState<{ id: string; name: string } | null>(null);
  const [clientNoticeNews, setClientNoticeNews] = useState("");
  const [clientNoticeBusy, setClientNoticeBusy] = useState(false);
  const [clientNoticeError, setClientNoticeError] = useState("");
  const [clientNoticeSent, setClientNoticeSent] = useState(0);
  const openClientNotice = (c: RecordItem) => {
    setClientNoticeNews("");
    setClientNoticeError("");
    setClientNoticeSent(0);
    setClientNotice({ id: c.id, name: c.name });
  };
  return {
    clientNotice, setClientNotice, clientNoticeNews, setClientNoticeNews, clientNoticeBusy, setClientNoticeBusy,
    clientNoticeError, setClientNoticeError, clientNoticeSent, setClientNoticeSent, openClientNotice,
  };
}

export function ClientNoticeDialog({ state, mailConfigured, tasks, mutate }: {
  state: ReturnType<typeof useClientNotice>;
  mailConfigured: boolean;
  tasks: RecordItem[];
  mutate: (body: unknown) => Promise<WorkspacePayload>;
}) {
  const { t: tr } = useI18n();
  const process = useProcess();
  const {
    clientNotice, setClientNotice, clientNoticeNews, setClientNoticeNews, clientNoticeBusy, setClientNoticeBusy,
    clientNoticeError, setClientNoticeError, clientNoticeSent, setClientNoticeSent,
  } = state;
  return (
    <Dialog
      open={!!clientNotice}
      onOpenChange={(o) => {
        if (!o && !clientNoticeBusy) setClientNotice(null);
      }}
    >
      <DialogContent className="tracker-modal">
        <DialogHeader>
          <DialogTitle>
            {tr("Notifier {name}", { name: clientNotice?.name ?? "" })}
          </DialogTitle>
          <DialogDescription>
            {tr(
              "Un e-mail part vers les accès portail de ce client (ou sa fiche, à défaut), avec ses éléments en attente de validation et l’actualité ci-dessous.",
            )}
          </DialogDescription>
        </DialogHeader>
        {!mailConfigured ? (
          <p className="form-error" role="alert">
            {tr("L’envoi d’e-mail n’est pas configuré pour cet espace.")}
          </p>
        ) : (
          <div className="form-fields">
            <div className="form-field">
              <span>{tr("À valider")}</span>
              {(() => {
                const pending = tasks.filter(
                  (t) => t.clientId === clientNotice?.id && behaviourOf(t.status, process) === "client",
                );
                return pending.length ? (
                  <ul className="notice-pending-list">
                    {pending.map((t) => (
                      <li key={t.id}>{t.name}</li>
                    ))}
                  </ul>
                ) : (
                  <small>{tr("Rien en attente de validation pour ce client.")}</small>
                );
              })()}
            </div>
            <label className="form-field">
              <span>{tr("Actualités")}</span>
              <textarea
                rows={4}
                maxLength={2000}
                value={clientNoticeNews}
                disabled={clientNoticeBusy}
                onChange={(e) => setClientNoticeNews(e.target.value)}
                placeholder={tr("Un mot pour le client (optionnel)…")}
              />
            </label>
            {clientNoticeError && (
              <p className="form-error" role="alert">
                {clientNoticeError}
              </p>
            )}
            {!!clientNoticeSent && (
              <p className="confirm-copy">
                {tr("Envoyé à {n} adresse(s).", { n: clientNoticeSent })}
              </p>
            )}
          </div>
        )}
        <DialogFooter className="modal-footer">
          <button
            type="button"
            className="btn"
            disabled={clientNoticeBusy}
            onClick={() => setClientNotice(null)}
          >
            {tr("Fermer")}
          </button>
          {mailConfigured && (
            <button
              className="btn primary"
              disabled={clientNoticeBusy}
              onClick={async () => {
                if (!clientNotice) return;
                setClientNoticeBusy(true);
                setClientNoticeError("");
                try {
                  const r = await mutate({
                    action: "notify-client",
                    clientId: clientNotice.id,
                    news: clientNoticeNews,
                  });
                  setClientNoticeSent(r.emailCount || 1);
                } catch (e) {
                  setClientNoticeError(tr((e as Error).message));
                } finally {
                  setClientNoticeBusy(false);
                }
              }}
            >
              <Bell size={15} />
              {clientNoticeBusy ? tr("Envoi…") : tr("Envoyer")}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

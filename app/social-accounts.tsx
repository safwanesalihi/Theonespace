"use client";
// « Comptes »: each client's Facebook Page, Instagram, TikTok and YouTube, connected by logging into
// the platform (like Metricool) — no id, no token. After a Facebook login that brings several Pages,
// the person picks the one that belongs to this client.
import { useState } from "react";
import { Check, Link2, Loader2, Unlink } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import NetworkIcon from "@/app/network-icon";
import { useI18n } from "@/app/locale-provider";
import type { RecordItem } from "@/lib/model";
import { networkLabels, networks, type Network } from "@/lib/social";

export type AccountSummary = { clientId: string; network: Network; name: string; username?: string; picture?: string; connectedAt: string; connectedBy: string; status: "ok" | "expired" };
export type Available = { meta: boolean; tiktok: boolean; google: boolean };
export type PendingPick = { clientId: string; pages: { id: string; name: string; picture?: string; instagram?: { id: string; username?: string; picture?: string } }[] };

export const providerOf = (network: Network) => (network === "facebook" || network === "instagram" ? "meta" : network === "tiktok" ? "tiktok" : "google");

export function connectUrl(network: Network, clientId: string, workspaceId: string) {
  return `/api/social/connect/${providerOf(network)}?${new URLSearchParams({ clientId, workspace: workspaceId })}`;
}

export function AccountsPanel({
  clients, accounts, available, workspaceId, fixedClientId, onDisconnect,
}: {
  clients: RecordItem[];
  accounts: AccountSummary[];
  available: Available | null;
  workspaceId: string;
  fixedClientId?: string;
  onDisconnect: (clientId: string, network: Network) => Promise<void>;
}) {
  const { t, tag } = useI18n();
  const [busy, setBusy] = useState("");
  const rows = fixedClientId ? clients.filter((c) => c.id === fixedClientId) : [{ id: "internal", name: t("Agence") } as RecordItem, ...clients];
  return (
    <div className="accounts-panel">
      <p className="accounts-intro">{t("Connectez les comptes de chaque client en vous connectant à la plateforme, comme sur Metricool. Aucun identifiant à copier. Les publications partent ensuite sur ces comptes.")}</p>
      {rows.map((client) => (
        <section key={client.id} className="accounts-client">
          {!fixedClientId && <h3>{client.name}</h3>}
          <div className="accounts-grid">
            {networks.map((network) => {
              const account = accounts.find((a) => a.clientId === client.id && a.network === network);
              const on = available?.[providerOf(network)] ?? false;
              const key = `${client.id}:${network}`;
              return (
                <div key={network} className={`account-card ${account ? (account.status === "ok" ? "connected" : "expired") : ""}`}>
                  <NetworkIcon network={network} size={16} badge />
                  <div className="account-card-body">
                    <strong>{networkLabels[network]}</strong>
                    {account ? (
                      <span className="account-who">
                        {account.picture && (
                          // eslint-disable-next-line @next/next/no-img-element -- the platform's own profile picture
                          <img src={account.picture} alt="" />
                        )}
                        {account.name}
                      </span>
                    ) : <small>{t("Non connecté")}</small>}
                    {account && (
                      <small>
                        {account.status === "expired" ? t("Connexion expirée : reconnectez.") : t("Connecté le {date} par {name}", { date: new Date(account.connectedAt).toLocaleDateString(tag, { day: "numeric", month: "short" }), name: account.connectedBy })}
                      </small>
                    )}
                  </div>
                  <div className="account-card-actions">
                    {(!account || account.status === "expired") && (
                      network === "instagram" && !account ? (
                        <small className="account-note">{t("Avec la Page Facebook")}</small>
                      ) : (
                        <a className={`btn ${on ? "primary" : ""}`} aria-disabled={!on} href={on ? connectUrl(network, client.id, workspaceId) : undefined} title={on ? undefined : t("À activer une fois pour le studio (voir le guide)")}>
                          <Link2 size={14} />{t(account ? "Reconnecter" : "Connecter")}
                        </a>
                      )
                    )}
                    {account && (
                      <button type="button" className="btn ghost" disabled={busy === key} aria-label={t("Déconnecter {network}", { network: networkLabels[network] })}
                        onClick={async () => { setBusy(key); try { await onDisconnect(client.id, network); } finally { setBusy(""); } }}>
                        {busy === key ? <Loader2 size={14} className="spin" /> : <Unlink size={14} />}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {available && !available.meta && !available.tiktok && !available.google && (
        <p className="accounts-setup">{t("Les boutons « Connecter » s’activent une fois l’application de la plateforme enregistrée par le studio (réglage unique, voir le guide).")}</p>
      )}
    </div>
  );
}

export function PagePicker({ pending, clientName, onPick, onCancel }: { pending: PendingPick | null; clientName: string; onPick: (pageId: string, instagram: boolean) => Promise<void>; onCancel: () => void }) {
  const { t } = useI18n();
  const [chosen, setChosen] = useState<string>("");
  const [withInstagram, setWithInstagram] = useState(true);
  const [busy, setBusy] = useState(false);
  const page = pending?.pages.find((p) => p.id === (chosen || pending.pages[0]?.id));
  return (
    <Dialog open={!!pending} onOpenChange={(o) => { if (!o && !busy) onCancel(); }}>
      <DialogContent className="tracker-modal page-picker">
        <DialogHeader>
          <DialogTitle>{t("Quelle Page est celle de {client} ?", { client: clientName })}</DialogTitle>
          <DialogDescription>{t("Ce compte Facebook gère plusieurs Pages. Choisissez celle du client ; son Instagram professionnel est relié en même temps.")}</DialogDescription>
        </DialogHeader>
        <div className="page-options" role="radiogroup">
          {pending?.pages.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={page?.id === p.id} className={`page-option ${page?.id === p.id ? "selected" : ""}`} onClick={() => setChosen(p.id)}>
              {p.picture ? (
                // eslint-disable-next-line @next/next/no-img-element -- the Page's own picture from Facebook
                <img src={p.picture} alt="" />
              ) : <NetworkIcon network="facebook" size={18} badge />}
              <span>
                <strong>{p.name}</strong>
                <small>{p.instagram?.username ? `Instagram @${p.instagram.username}` : t("Pas d’Instagram professionnel relié")}</small>
              </span>
              {page?.id === p.id && <Check size={16} />}
            </button>
          ))}
        </div>
        {page?.instagram && (
          <label className="check-field">
            <input type="checkbox" checked={withInstagram} onChange={(e) => setWithInstagram(e.target.checked)} />
            <span><strong>{t("Relier aussi Instagram @{name}", { name: page.instagram.username || "" })}</strong></span>
          </label>
        )}
        <DialogFooter className="modal-footer">
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>{t("Annuler")}</button>
          <button type="button" className="btn primary" disabled={busy || !page} onClick={async () => { if (!page) return; setBusy(true); try { await onPick(page.id, withInstagram); } finally { setBusy(false); } }}>
            {busy ? <Loader2 size={14} className="spin" /> : <Link2 size={14} />}{t("Relier à {client}", { client: clientName })}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

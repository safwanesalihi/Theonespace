'use client';
import { useEffect, useState } from 'react';
import { Cloud, FolderOpen, Link2, Loader2, Unplug } from 'lucide-react';
import { useI18n } from '@/app/locale-provider';
import { driveFetch, chooseDriveRoot } from '@/app/drive-client';
import type { DriveConnectionView } from '@/lib/client-folders';
import styles from '@/app/client-drive.module.css';

export default function DriveSettings({ workspaceId, owner, clientId, initial, oauthResult, onChange, onPickerState }: { workspaceId: string; owner: boolean; clientId?: string; initial?: DriveConnectionView; oauthResult?: { error?: string; connected?: boolean }; onChange?: (c: DriveConnectionView) => void; onPickerState?: (open: boolean) => void }) {
  const { t, locale } = useI18n();
  const [data, setData] = useState(initial); const [busy, setBusy] = useState(false); const [error, setError] = useState(oauthResult?.error ?? ''); const [disconnect, setDisconnect] = useState(false);
  useEffect(() => { let alive = true; if (!initial) void driveFetch<DriveConnectionView>(workspaceId, 'connection').then((value) => { if (alive) setData(value); }).catch((e) => { if (alive) setError(e.message); }); return () => { alive = false; }; }, [workspaceId, initial]);
  const accept = (c: DriveConnectionView) => { setData(c); onChange?.(c); };
  async function choose() {
    setBusy(true); setError(''); onPickerState?.(true);
    try { const id = await chooseDriveRoot(workspaceId, locale, t('Choisir le dossier agence')); if (id) accept(await driveFetch<DriveConnectionView>(workspaceId, 'connection', { action: 'root', id })); }
    catch (e) { setError((e as Error).message); }
    finally { onPickerState?.(false); setBusy(false); }
  }
  async function unlink() {
    setBusy(true); setError('');
    try { accept(await driveFetch<DriveConnectionView>(workspaceId, 'connection', { action: 'disconnect' })); setDisconnect(false); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const href = `/api/drive/connect?${new URLSearchParams({ workspaceId, ...(clientId ? { clientId } : {}) })}`;
  return <section className={styles.connection} aria-label="Google Drive">
    <div className={styles.heading}><span className={styles.icon}><Cloud size={20} /></span><div><strong>Google Drive</strong><p>{data?.connected ? data.account?.email : t('Le Drive de l’agence, connecté à vos clients.')}</p></div>{busy && <Loader2 size={18} className="spin" />}</div>
    {!data && !error && <p className="small-note">{t('Chargement…')}</p>}
    {data?.connected && <p className={styles.rootLabel}><FolderOpen size={16} />{data.root?.name || t('Choisissez le dossier principal de l’agence.')}</p>}
    {oauthResult?.connected && <p className="small-note" role="status">{t('Google Drive connecté. Choisissez maintenant le dossier agence.')}</p>}
    {owner && data && <div className={styles.actions}>
      {data.configured && <a className="btn" href={href}><Link2 size={16} />{t(data.connected ? 'Reconnecter' : 'Connecter Google Drive')}</a>}
      {data.connected && <button type="button" className="btn" disabled={busy || !data.pickerConfigured} onClick={() => void choose()}><FolderOpen size={16} />{t('Choisir le dossier agence')}</button>}
      {data.connected && <button type="button" className="btn ghost danger" disabled={busy} onClick={() => setDisconnect((v) => !v)}><Unplug size={16} />{t('Déconnecter')}</button>}
    </div>}
    {data && !data.configured && <p className="small-note">{t('La connexion Google Drive doit être configurée sur le serveur.')}</p>}
    {data?.connected && owner && !data.pickerConfigured && <p className="small-note">{t('Google Picker doit être configuré pour choisir le dossier agence.')}</p>}
    {!owner && <p className="small-note">{t('Le propriétaire connecte le Drive et choisit le dossier agence.')}</p>}
    {data?.connected && <p className="small-note">{t('Le dossier choisi peut appartenir à Mon Drive ou à un Drive partagé. Les fichiers déjà existants doivent être autorisés individuellement avec Google Picker ; choisir leur parent ne suffit pas.')}</p>}
    {disconnect && <div className={styles.confirm}><p>{t('Déconnecter le compte ? Les dossiers et fichiers resteront dans Google Drive.')}</p><div className={styles.actions}><button type="button" className="btn danger" disabled={busy} onClick={() => void unlink()}>{t('Confirmer la déconnexion')}</button><button type="button" className="btn" onClick={() => setDisconnect(false)}>{t('Annuler')}</button></div></div>}
    {error && <p className="form-error" role="alert">{t(error)}</p>}
  </section>;
}

'use client';
// Personal settings, opened from the profile picture in the sidebar: photo, display name, language, sign-out.
import { useRef, useState } from 'react';
import { Camera, Check, KeyRound, Languages, Loader2, LogOut, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import Avatar from '@/app/profile-avatar';
import LanguageSwitch from '@/app/language-switch';
import { useI18n } from '@/app/locale-provider';
import { uploadImage } from '@/lib/image';

export type ProfileUser = { id: string; name: string; email: string; avatar?: string | null };
type Props = {
  open: boolean; onOpenChange: (open: boolean) => void;
  user: ProfileUser; workspaceId: string | null; workspaceName?: string;
  /** Sends `{ action: 'update-profile', ... }` and resolves with the fresh user. */
  onSave: (changes: { name?: string; avatar?: string | null }) => Promise<ProfileUser | undefined>;
  onLogout: () => void;
};

export default function SettingsDialog(props: Props) {
  // Remounted each time it opens so the form starts from the current profile.
  return <SettingsBody key={String(props.open)} {...props} />;
}

function SettingsBody({ open, onOpenChange, user, workspaceId, workspaceName, onSave, onLogout }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState(user.name.includes('@') || user.name === workspaceName ? '' : user.name);
  const [busy, setBusy] = useState<'name' | 'photo' | 'password' | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // Changing the password was previously only possible on the forced first-login screen.
  const [password, setPassword] = useState({ current: '', next: '', confirm: '' });
  const [passwordDone, setPasswordDone] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  async function saveName(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy('name'); setError(''); setSaved(false);
    try { await onSave({ name }); setSaved(true); }
    catch (e) { setError(t((e as Error).message)); }
    finally { setBusy(null); }
  }
  async function pickPhoto(file: File | undefined) {
    if (!file || busy || !workspaceId) return;
    setBusy('photo'); setError('');
    try { const id = await uploadImage(file, 'avatar', workspaceId); await onSave({ avatar: id }); }
    catch (e) { setError(t((e as Error).message)); }
    finally { setBusy(null); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function removePhoto() {
    if (busy) return;
    setBusy('photo'); setError('');
    try { await onSave({ avatar: null }); }
    catch (e) { setError(t((e as Error).message)); }
    finally { setBusy(null); }
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (password.next !== password.confirm) { setPasswordError(t('Les deux mots de passe ne correspondent pas.')); return; }
    setBusy('password'); setPasswordError(''); setPasswordDone(false);
    try {
      const response = await fetch('/api/auth/password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'change-password', currentPassword: password.current, newPassword: password.next }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Modification impossible. Réessayez.');
      setPassword({ current: '', next: '', confirm: '' });
      setPasswordDone(true);
    } catch (e) { setPasswordError(t((e as Error).message)); }
    finally { setBusy(null); }
  }

  return <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
    <DialogContent className="tracker-modal settings-dialog">
      <DialogHeader><DialogTitle>{t('Paramètres')}</DialogTitle><DialogDescription>{t('Votre photo, votre nom et la langue de l’application.')}</DialogDescription></DialogHeader>
      <section className="settings-section settings-photo">
        <Avatar name={user.name} avatar={user.avatar} className="avatar-xl" />
        <div>
          <strong>{t('Photo de profil')}</strong>
          <p>{t('Carrée, 320 px. Visible par l’équipe et vos clients.')}</p>
          <div className="inline">
            <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => void pickPhoto(e.target.files?.[0])} />
            <button type="button" className="btn" disabled={!!busy || !workspaceId} onClick={() => fileInput.current?.click()}>{busy === 'photo' ? <Loader2 size={14} className="spin" /> : <Camera size={14} />}{t(user.avatar ? 'Changer la photo' : 'Ajouter une photo')}</button>
            {user.avatar && <button type="button" className="btn ghost danger" disabled={!!busy} onClick={() => void removePhoto()}><Trash2 size={14} />{t('Retirer')}</button>}
          </div>
        </div>
      </section>
      <form className="settings-section" onSubmit={saveName}>
        <div className="form-fields">
          <label className="form-field"><span>{t('Nom affiché *')}</span><input required minLength={2} maxLength={80} value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} placeholder={t('Prénom Nom')} /></label>
          <label className="form-field"><span>{t('Adresse e-mail')}</span><input value={user.email} disabled readOnly /></label>
        </div>
        <div className="inline settings-actions"><button className="btn primary" disabled={!!busy || !name.trim()}>{busy === 'name' ? <Loader2 size={14} className="spin" /> : <Check size={14} />}{t('Enregistrer')}</button>{saved && <span className="small-note">{t('Profil mis à jour')}</span>}</div>
      </form>
      <form className="settings-section" onSubmit={changePassword} aria-label={t('Changer le mot de passe')}>
        <strong><KeyRound size={14} /> {t('Mot de passe')}</strong>
        <p className="small-note">{t('Vos autres sessions seront déconnectées.')}</p>
        <div className="form-fields">
          <label className="form-field"><span>{t('Mot de passe actuel')}</span><input type="password" required maxLength={200} autoComplete="current-password" value={password.current} onChange={(e) => { setPassword((p) => ({ ...p, current: e.target.value })); setPasswordDone(false); }} /></label>
          <div className="form-pair">
            <label className="form-field"><span>{t('Nouveau mot de passe')}</span><input type="password" required minLength={10} maxLength={200} autoComplete="new-password" value={password.next} onChange={(e) => { setPassword((p) => ({ ...p, next: e.target.value })); setPasswordDone(false); }} placeholder={t('10 caractères minimum')} /></label>
            <label className="form-field"><span>{t('Confirmez le mot de passe')}</span><input type="password" required minLength={10} maxLength={200} autoComplete="new-password" value={password.confirm} onChange={(e) => { setPassword((p) => ({ ...p, confirm: e.target.value })); setPasswordDone(false); }} /></label>
          </div>
        </div>
        <div className="inline settings-actions">
          <button className="btn" disabled={!!busy || !password.current || password.next.length < 10}>{busy === 'password' ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />}{t('Changer le mot de passe')}</button>
          {passwordDone && <span className="small-note">{t('Mot de passe mis à jour')}</span>}
        </div>
        {passwordError && <p className="form-error" role="alert">{passwordError}</p>}
      </form>
      <section className="settings-section settings-language">
        <div><strong><Languages size={14} /> {t('Langue')}</strong><p>{t('S’applique immédiatement, sur cet appareil.')}</p></div>
        <LanguageSwitch compact />
      </section>
      {error && <p className="form-error" role="alert">{error}</p>}
      <section className="settings-section settings-signout">
        <button type="button" className="btn ghost danger" disabled={!!busy} onClick={onLogout}><LogOut size={15} />{t('Se déconnecter')}</button>
      </section>
    </DialogContent>
  </Dialog>;
}

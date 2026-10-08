'use client';
// Personal settings, opened from the profile picture in the sidebar: photo, display name, language, sign-out.
import { useRef, useState } from 'react';
import { Camera, Check, KeyRound, Languages, Loader2, LogOut, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogPortal, DialogTitle } from '@/components/ui/dialog';
import Avatar from '@/components/profile-avatar';
import { ThemeChoices } from '@/components/theme-provider';
import LanguageSwitch from '@/components/language-switch';
import { useI18n } from '@/lib/i18n/locale-provider';
import { uploadImage } from '@/lib/image';
import dynamic from 'next/dynamic';
import WorkflowFields from './workflow-fields';
import { defaultWorkflowSettings, workflowSettingsSchema, type WorkflowSettings } from '@/lib/workflow-settings';
const DriveSettings = dynamic(() => import('@/features/drive/drive-settings'));

export type ProfileUser = { id: string; name: string; email: string; avatar?: string | null };
type Props = {
  open: boolean; onOpenChange: (open: boolean) => void;
  user: ProfileUser; workspaceId: string | null; workspaceName?: string;
  driveRole?: 'owner' | 'admin';
  workflowSettings?: WorkflowSettings; workflowRevision?: number;
  onWorkflowSave?: (data: WorkflowSettings, revision: number) => Promise<number>;
  driveResult?: { error?: string; connected?: boolean };
  /** Sends `{ action: 'update-profile', ... }` and resolves with the fresh user. */
  onSave: (changes: { name?: string; avatar?: string | null }) => Promise<ProfileUser | undefined>;
  onLogout: () => void;
};

export default function SettingsDialog(props: Props) {
  // Remounted each time it opens so the form starts from the current profile.
  return <SettingsBody key={String(props.open)} {...props} />;
}

function SettingsBody({ open, onOpenChange, user, workspaceId, workspaceName, driveRole, driveResult, workflowSettings, workflowRevision = 0, onWorkflowSave, onSave, onLogout }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState(user.name.includes('@') || user.name === workspaceName ? '' : user.name);
  const [busy, setBusy] = useState<'name' | 'photo' | 'password' | 'workflow' | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [workflow, setWorkflow] = useState(workflowSettings ?? defaultWorkflowSettings);
  const [workflowSaved, setWorkflowSaved] = useState(false);
  const [workflowVersion, setWorkflowVersion] = useState(workflowRevision);
  const [pickingDrive, setPickingDrive] = useState(false);
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

  // Switching Radix's modal mode replaces the entire content tree. Keep it stable so
  // Picker callbacks can update this same DriveSettings instance (including errors).
  return <Dialog open={open} modal={false} onOpenChange={(o) => { if (!busy && !pickingDrive) onOpenChange(o); }}>
    {open && <DialogPortal><div aria-hidden="true" data-state="open" className="fixed inset-0 z-50 bg-black/50" /></DialogPortal>}
    <DialogContent className="tracker-modal settings-dialog" onEscapeKeyDown={(e) => { if (pickingDrive) e.preventDefault(); }} onInteractOutside={(e) => { if (pickingDrive) e.preventDefault(); }} onFocusOutside={(e) => e.preventDefault()} onKeyDown={(e) => {
      if (pickingDrive || e.key !== 'Tab') return;
      const controls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]')).filter((el) => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }}>
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
      <section className="settings-section"><strong>{t("Apparence")}</strong><p>{t("S’applique immédiatement, sur cet appareil.")}</p><ThemeChoices /></section>
      {onWorkflowSave && <form className="settings-section" onSubmit={async e => {
        e.preventDefault(); if (busy) return;
        const parsed = workflowSettingsSchema.safeParse(workflow);
        if (!parsed.success) { setError(t('Indiquez un délai entre 1 minute et 365 jours et un nombre entier de tours entre 0 et 10 000.')); return; }
        setBusy('workflow'); setError(''); setWorkflowSaved(false);
        try { setWorkflowVersion(await onWorkflowSave(parsed.data, workflowVersion)); setWorkflowSaved(true); }
        catch (error) { setError(t((error as Error).message)); }
        finally { setBusy(null); }
      }}>
        <strong>{t('Validation et modifications')}</strong>
        <p>{t('Valeurs par défaut de cet espace. Chaque client peut avoir ses propres règles. Les validations en cours et les documents envoyés conservent leurs conditions.')}</p>
        <WorkflowFields value={workflow} disabled={!!busy} onChange={value => { setWorkflow(value); setWorkflowSaved(false); }} />
        <div className="inline settings-actions"><button className="btn primary" disabled={!!busy}>{busy === 'workflow' ? <Loader2 size={14} className="spin" /> : <Check size={14} />}{t('Enregistrer les règles')}</button>{workflowSaved && <span className="small-note" role="status">{t('Règles de validation mises à jour')}</span>}</div>
      </form>}
      {open && workspaceId && driveRole && <section className="settings-section"><DriveSettings workspaceId={workspaceId} owner={driveRole === 'owner'} oauthResult={driveResult} onPickerState={setPickingDrive} /></section>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="small-note settings-activity-note">{t('Vos heures de connexion et votre temps d’utilisation de l’application sont enregistrés et visibles par le responsable du studio.')}</p>
      <section className="settings-section settings-signout">
        <button type="button" className="btn ghost danger" disabled={!!busy} onClick={onLogout}><LogOut size={15} />{t('Se déconnecter')}</button>
      </section>
    </DialogContent>
  </Dialog>;
}

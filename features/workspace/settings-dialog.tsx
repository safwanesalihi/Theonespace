'use client';
// « Mon compte »: everything about the person in one panel, by category, opened from their picture (dock,
// sidebar footer). Profil (photo, name, e-mail, WhatsApp), Apparence (light or dark), Langue, Sécurité
// (password, sign-out). The agency's own settings, Google Drive included, are in « Paramètres de l'agence ».
import { useRef, useState, type ReactNode } from 'react';
import { Camera, Check, KeyRound, Languages, Loader2, LogOut, Palette, ShieldCheck, Trash2, UserRound, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Avatar from '@/components/profile-avatar';
import { ThemeChoices } from '@/components/theme-provider';
import LanguageSwitch from '@/components/language-switch';
import { useI18n } from '@/lib/i18n/locale-provider';
import { uploadImage } from '@/lib/image';
import { whatsappFormatHint, whatsappInputMaxLength } from '@/lib/whatsapp-number';

export type ProfileUser = { id: string; name: string; email: string; avatar?: string | null };
/** The person's WhatsApp number in this workspace (studio members; a client has none). */
export type ProfileWhatsapp = { value: string; onSave: (value: string) => Promise<void> };
type Props = {
  open: boolean; onOpenChange: (open: boolean) => void;
  user: ProfileUser; workspaceId: string | null; workspaceName?: string;
  whatsapp?: ProfileWhatsapp;
  /** Sends `{ action: 'update-profile', ... }` and resolves with the fresh user. */
  onSave: (changes: { name?: string; avatar?: string | null }) => Promise<ProfileUser | undefined>;
  onLogout: () => void;
};
type Category = 'profile' | 'appearance' | 'language' | 'security';
const categories: [Category, string, LucideIcon][] = [
  ['profile', 'Profil', UserRound],
  ['appearance', 'Apparence', Palette],
  ['language', 'Langue', Languages],
  ['security', 'Sécurité', ShieldCheck],
];

export default function SettingsDialog(props: Props) {
  // Remounted each time it opens so the form starts from the current profile.
  return <SettingsBody key={String(props.open)} {...props} />;
}

function SettingsBody({ open, onOpenChange, user, workspaceId, workspaceName, whatsapp, onSave, onLogout }: Props) {
  const { t } = useI18n();
  const [category, setCategory] = useState<Category>('profile');
  const [name, setName] = useState(user.name.includes('@') || user.name === workspaceName ? '' : user.name);
  const [phone, setPhone] = useState(whatsapp?.value ?? '');
  const [busy, setBusy] = useState<'name' | 'photo' | 'password' | 'phone' | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<'name' | 'phone' | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState({ current: '', next: '', confirm: '' });
  const [passwordDone, setPasswordDone] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  async function run(kind: 'name' | 'photo' | 'phone', work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(kind); setError(''); setSaved(null);
    try { await work(); if (kind !== 'photo') setSaved(kind); }
    catch (e) { setError(t((e as Error).message)); }
    finally { setBusy(null); if (fileInput.current) fileInput.current.value = ''; }
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
  const pane = (id: Category, title: string, text: string, children: ReactNode) => (
    <TabsContent value={id} className="settings-pane">
      <div className="settings-pane-head"><h3>{t(title)}</h3><p>{t(text)}</p></div>
      {children}
    </TabsContent>
  );

  return <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
    <DialogContent className="tracker-modal settings-dialog">
      <DialogHeader><DialogTitle>{t('Mon compte')}</DialogTitle><DialogDescription>{t('Tout ce qui vous concerne, au même endroit.')}</DialogDescription></DialogHeader>
      <Tabs value={category} onValueChange={(value) => { setCategory(value as Category); setError(''); }} className="settings-layout">
        <TabsList className="settings-nav" aria-label={t('Catégories')}>
          {categories.map(([id, label, Icon]) => <TabsTrigger key={id} value={id}><Icon size={15} aria-hidden="true" />{t(label)}</TabsTrigger>)}
        </TabsList>
        {pane('profile', 'Profil', 'Ce que l’équipe et vos clients voient de vous.', <>
          <section className="settings-section settings-photo">
            <Avatar name={user.name} avatar={user.avatar} className="avatar-xl" />
            <div>
              <strong>{t('Photo de profil')}</strong>
              <p>{t('Carrée, 320 px. Visible par l’équipe et vos clients.')}</p>
              <div className="inline">
                <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file && workspaceId) void run('photo', async () => onSave({ avatar: await uploadImage(file, 'avatar', workspaceId) })); }} />
                <button type="button" className="btn" disabled={!!busy || !workspaceId} onClick={() => fileInput.current?.click()}>{busy === 'photo' ? <Loader2 size={14} className="spin" /> : <Camera size={14} />}{t(user.avatar ? 'Changer la photo' : 'Ajouter une photo')}</button>
                {user.avatar && <button type="button" className="btn ghost danger" disabled={!!busy} onClick={() => void run('photo', () => onSave({ avatar: null }))}><Trash2 size={14} />{t('Retirer')}</button>}
              </div>
            </div>
          </section>
          <form className="settings-section" onSubmit={(e) => { e.preventDefault(); void run('name', () => onSave({ name })); }}>
            <div className="form-fields">
              <label className="form-field"><span>{t('Nom affiché *')}</span><input required minLength={2} maxLength={80} value={name} onChange={(e) => { setName(e.target.value); setSaved(null); }} placeholder={t('Prénom Nom')} /></label>
              <label className="form-field"><span>{t('Adresse e-mail')}</span><input value={user.email} disabled readOnly /></label>
            </div>
            <div className="inline settings-actions"><button className="btn primary" disabled={!!busy || !name.trim()}>{busy === 'name' ? <Loader2 size={14} className="spin" /> : <Check size={14} />}{t('Enregistrer')}</button>{saved === 'name' && <span className="small-note" role="status">{t('Profil mis à jour')}</span>}</div>
          </form>
          {whatsapp && <form className="settings-section" onSubmit={(e) => { e.preventDefault(); void run('phone', () => whatsapp.onSave(phone.trim())); }}>
            <label className="form-field"><span id="own-whatsapp-label">{t('WhatsApp (facultatif)')}</span><input type="tel" inputMode="tel" autoComplete="tel" dir="ltr" aria-labelledby="own-whatsapp-label" aria-describedby="own-whatsapp-format" maxLength={whatsappInputMaxLength} value={phone} disabled={!!busy} onChange={(e) => { setPhone(e.target.value); setSaved(null); }} placeholder="0612345678" /><small id="own-whatsapp-format">{t(whatsappFormatHint)}</small></label>
            <div className="inline settings-actions"><button className="btn" disabled={!!busy || phone.trim() === whatsapp.value}>{busy === 'phone' ? <Loader2 size={14} className="spin" /> : <Check size={14} />}{t('Enregistrer le numéro')}</button>{saved === 'phone' && <span className="small-note" role="status">{t('Numéro enregistré')}</span>}</div>
          </form>}
        </>)}
        {pane('appearance', 'Apparence', 'Clair ou sombre. S’applique immédiatement, sur cet appareil.', <section className="settings-section"><ThemeChoices /></section>)}
        {pane('language', 'Langue', 'S’applique immédiatement, sur cet appareil.', <section className="settings-section settings-language"><LanguageSwitch compact /></section>)}
        {pane('security', 'Sécurité', 'Votre mot de passe et votre session.', <>
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
              {passwordDone && <span className="small-note" role="status">{t('Mot de passe mis à jour')}</span>}
            </div>
            {passwordError && <p className="form-error" role="alert">{passwordError}</p>}
          </form>
          <p className="small-note settings-activity-note">{t('Vos heures de connexion et votre temps d’utilisation de l’application sont enregistrés et visibles par le responsable du studio.')}</p>
          <section className="settings-section settings-signout">
            <button type="button" className="btn ghost danger" disabled={!!busy} onClick={onLogout}><LogOut size={15} />{t('Se déconnecter')}</button>
          </section>
        </>)}
      </Tabs>
      {error && <p className="form-error" role="alert">{error}</p>}
    </DialogContent>
  </Dialog>;
}

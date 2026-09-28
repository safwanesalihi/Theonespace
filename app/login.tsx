'use client';

import Copyright from '@/app/copyright';
import { useEffect, useState } from 'react';
import { ArrowLeft, Building2, Check, KeyRound, Loader2, Lock, Mail } from 'lucide-react';
import { useI18n } from '@/app/locale-provider';

type Step = 'sign-in' | 'change-password' | 'sign-up' | 'sign-up-code' | 'forgot' | 'forgot-sent' | 'reset';

export default function Login({ initialStep = 'sign-in', email: knownEmail = '', resetToken = '' }: { initialStep?: Step; email?: string; resetToken?: string }) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>(initialStep);
  // Only asked when the temporary password was not typed on this very screen (gate reached after a reload).
  const [askCurrent] = useState(initialStep === 'change-password');
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [signupOpen, setSignupOpen] = useState(false);
  // Local development without e-mail: the server hands the code back so the flow can be tried.
  const [devCode, setDevCode] = useState('');
  const [devLink, setDevLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The server answers in French; the wait before a new try carries its number of minutes.
  const shown = (message: string) => {
    const wait = message.match(/^Trop de tentatives\. Réessayez dans (\d+) min\.$/);
    const left = message.match(/^Code incorrect \((\d+) essais? restants?\)\.$/);
    return wait ? t('Trop de tentatives. Réessayez dans {n} min.', { n: wait[1] })
      : left ? t('Code incorrect ({n} essai(s) restant(s)).', { n: left[1] }) : t(message);
  };
  const [form, setForm] = useState({ email: knownEmail, password: '', newPassword: '', confirm: '', company: '', name: '', code: '' });
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: event.target.value }));

  useEffect(() => {
    let active = true;
    fetch('/api/auth/status', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { passwordConfigured?: unknown; signupEnabled?: unknown }) => {
        if (!active) return;
        setConfigured(data.passwordConfigured === true);
        setSignupOpen(data.signupEnabled === true);
      })
      .catch(() => { if (active) setConfigured(false); });
    return () => { active = false; };
  }, []);

  async function call(body: Record<string, string>, path = '/api/auth/password') {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json() as { error?: string; mustChangePassword?: boolean; devCode?: string; devLink?: string };
    if (!response.ok) throw new Error(t(data.error || 'Connexion impossible. Réessayez.'));
    return data;
  }

  // The form lives both at "/" (inside the tracker) and at "/login": land on the studio home either way.
  function enter() {
    if (window.location.pathname === '/') { window.location.hash = '#home'; window.location.reload(); }
    else window.location.replace('/#home');
  }

  async function submitSignIn(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const data = await call({ action: 'sign-in', email: form.email, password: form.password });
      if (data.mustChangePassword) { setStep('change-password'); setBusy(false); return; }
      enter();
    } catch (error) { setError((error as Error).message); setBusy(false); }
  }

  const go = (next: Step) => { setError(''); setStep(next); };

  async function submitSignUp(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (form.password !== form.confirm) { setError(t('Les deux mots de passe ne correspondent pas.')); return; }
    setBusy(true); setError('');
    try {
      const data = await call({ action: 'start', company: form.company, name: form.name, email: form.email, password: form.password }, '/api/auth/signup');
      setDevCode(data.devCode ?? '');
      setForm((f) => ({ ...f, code: '' }));
      setStep('sign-up-code');
    } catch (error) { setError((error as Error).message); }
    setBusy(false);
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      await call({ action: 'verify', email: form.email, code: form.code.replace(/\s/g, '') }, '/api/auth/signup');
      enter();
    } catch (error) { setError((error as Error).message); setBusy(false); }
  }

  async function submitForgot(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const data = await call({ action: 'forgot', email: form.email });
      setDevLink(data.devLink ?? '');
      setStep('forgot-sent');
    } catch (error) { setError((error as Error).message); }
    setBusy(false);
  }

  async function submitReset(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (form.newPassword !== form.confirm) { setError(t('Les deux mots de passe ne correspondent pas.')); return; }
    setBusy(true); setError('');
    try {
      await call({ action: 'reset', token: resetToken, newPassword: form.newPassword });
      window.location.replace('/#home');
    } catch (error) { setError((error as Error).message); setBusy(false); }
  }

  async function submitChange(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (form.newPassword !== form.confirm) { setError(t('Les deux mots de passe ne correspondent pas.')); return; }
    setBusy(true); setError('');
    try {
      await call({ action: 'change-password', currentPassword: form.password, newPassword: form.newPassword });
      enter();
    } catch (error) { setError((error as Error).message); setBusy(false); }
  }

  return <div className="login-root">
    <div className="login-sidebar google-login">
      <a className="auth-home" href="/">{t('← Découvrir The One Space')}</a>
      <img className="auth-logo" src="/the-one-core-logo.svg" alt="The One Core" />
      {step === 'sign-in' ? <>
        <h1>{t('Bienvenue')}<span className="wordmark-dot">.</span></h1>
        <p>{t('L’espace de suivi et de validation de The One Core — pour l’équipe comme pour ses clients.')}</p>
        <form className="auth-password" onSubmit={submitSignIn} aria-label={t('Se connecter')}>
          <label><span>{t('Adresse e-mail')}</span><input type="email" required maxLength={200} autoComplete="email" value={form.email} onChange={set('email')} placeholder={t('vous@entreprise.com')} /></label>
          <label><span>{t('Mot de passe')}</span><input type="password" required maxLength={200} autoComplete="current-password" value={form.password} onChange={set('password')} placeholder="••••••••••" /></label>
          <button className="btn primary auth-submit" disabled={configured !== true || busy}>
            {busy ? <Loader2 size={18} className="spin" /> : <Lock size={16} />}{t('Se connecter')}</button>
        </form>
        <p className="google-login-note">{t('Accès sur invitation : vos identifiants vous ont été transmis par votre studio ; à la première connexion, vous choisissez votre mot de passe.')}</p>
        <p className="auth-switch"><button type="button" className="text-link" onClick={() => go('forgot')}><KeyRound size={13} />{t('Mot de passe oublié ?')}</button></p>
        {signupOpen && <p className="auth-switch">{t('Nouveau sur The One Space ?')} <button type="button" className="text-link" onClick={() => go('sign-up')}>{t('Créer le compte de votre entreprise')}</button></p>}
      </> : step === 'forgot' ? <>
        <h1>{t('Mot de passe oublié')}<span className="wordmark-dot">.</span></h1>
        <p>{t('Saisissez votre adresse : si elle a un compte, vous recevez un lien pour choisir un nouveau mot de passe (valable 30 minutes).')}</p>
        <form className="auth-password" onSubmit={submitForgot} aria-label={t('Mot de passe oublié')}>
          <label><span>{t('Adresse e-mail')}</span><input type="email" required maxLength={200} autoComplete="email" value={form.email} onChange={set('email')} placeholder={t('vous@entreprise.com')} /></label>
          <button className="btn primary auth-submit" disabled={configured !== true || busy}>
            {busy ? <Loader2 size={18} className="spin" /> : <Mail size={16} />}{t('Recevoir le lien')}</button>
        </form>
        <p className="auth-switch"><button type="button" className="text-link" onClick={() => go('sign-in')}><ArrowLeft size={13} />{t('Retour à la connexion')}</button></p>
      </> : step === 'forgot-sent' ? <>
        <h1>{t('Regardez vos e-mails')}<span className="wordmark-dot">.</span></h1>
        <p>{t('Si {email} a un compte, un lien vient de lui être envoyé. Il est valable 30 minutes et ne sert qu’une fois.', { email: form.email })}</p>
        {devLink && <p className="auth-dev-code" role="status">{t('Mode local (sans e-mail) :')} <a href={devLink}>{t('ouvrir le lien')}</a></p>}
        <p className="google-login-note">{t('Pas d’e-mail ? Regardez dans les indésirables, ou redemandez un lien dans quelques minutes.')}</p>
        <p className="auth-switch"><button type="button" className="text-link" onClick={() => go('sign-in')}><ArrowLeft size={13} />{t('Retour à la connexion')}</button></p>
      </> : step === 'reset' ? <>
        <h1>{t('Nouveau mot de passe')}<span className="wordmark-dot">.</span></h1>
        <p>{t('Choisissez votre nouveau mot de passe (10 caractères minimum). Vous serez déconnecté de vos autres appareils.')}</p>
        <form className="auth-password" onSubmit={submitReset} aria-label={t('Nouveau mot de passe')}>
          <label><span>{t('Nouveau mot de passe')}</span><input type="password" required minLength={10} maxLength={200} autoComplete="new-password" value={form.newPassword} onChange={set('newPassword')} placeholder={t('10 caractères minimum')} /></label>
          <label><span>{t('Confirmez le mot de passe')}</span><input type="password" required minLength={10} maxLength={200} autoComplete="new-password" value={form.confirm} onChange={set('confirm')} /></label>
          <button className="btn primary auth-submit" disabled={busy}>
            {busy ? <Loader2 size={18} className="spin" /> : <Check size={16} />}{t('Enregistrer et entrer')}</button>
        </form>
        <p className="auth-switch"><button type="button" className="text-link" onClick={() => { window.history.replaceState(null, '', '/login'); go('forgot'); }}>{t('Demander un nouveau lien')}</button></p>
      </> : step === 'sign-up' ? <>
        <h1>{t('Créez votre espace')}<span className="wordmark-dot">.</span></h1>
        <p>{t('Un espace de travail pour votre entreprise : clients, tâches, validations et publications. Vous en serez le propriétaire.')}</p>
        <form className="auth-password" onSubmit={submitSignUp} aria-label={t('Créer un compte')}>
          <label><span>{t('Entreprise')}</span><input required minLength={2} maxLength={80} autoComplete="organization" value={form.company} onChange={set('company')} placeholder={t('Nom de votre agence ou entreprise')} /></label>
          <label><span>{t('Votre nom')}</span><input required minLength={2} maxLength={80} autoComplete="name" value={form.name} onChange={set('name')} placeholder={t('Prénom Nom')} /></label>
          <label><span>{t('Adresse e-mail')}</span><input type="email" required maxLength={200} autoComplete="email" value={form.email} onChange={set('email')} placeholder={t('vous@entreprise.com')} /></label>
          <label><span>{t('Mot de passe')}</span><input type="password" required minLength={10} maxLength={200} autoComplete="new-password" value={form.password} onChange={set('password')} placeholder={t('10 caractères minimum')} /></label>
          <label><span>{t('Confirmez le mot de passe')}</span><input type="password" required minLength={10} maxLength={200} autoComplete="new-password" value={form.confirm} onChange={set('confirm')} /></label>
          <button className="btn primary auth-submit" disabled={configured !== true || busy}>
            {busy ? <Loader2 size={18} className="spin" /> : <Building2 size={16} />}{t('Créer mon espace')}</button>
        </form>
        <p className="auth-switch">{t('Déjà un compte ?')} <button type="button" className="text-link" onClick={() => go('sign-in')}>{t('Se connecter')}</button></p>
      </> : step === 'sign-up-code' ? <>
        <h1>{t('Vérifiez votre e-mail')}<span className="wordmark-dot">.</span></h1>
        <p>{t('Nous avons envoyé un code à 6 chiffres à {email}. Il est valable 30 minutes.', { email: form.email })}</p>
        {devCode && <p className="auth-dev-code" role="status">{t('Mode local (sans e-mail) : votre code est {code}', { code: devCode })}</p>}
        <form className="auth-password" onSubmit={submitCode} aria-label={t('Vérifier le code')}>
          <label><span>{t('Code reçu par e-mail')}</span><input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} value={form.code} onChange={set('code')} placeholder="123456" className="auth-code" /></label>
          <button className="btn primary auth-submit" disabled={busy}>
            {busy ? <Loader2 size={18} className="spin" /> : <Check size={16} />}{t('Créer mon espace')}</button>
        </form>
        <p className="auth-switch">
          <button type="button" className="text-link" disabled={busy} onClick={(e) => void submitSignUp(e as unknown as React.FormEvent)}><Mail size={13} />{t('Renvoyer le code')}</button>
          <button type="button" className="text-link" onClick={() => go('sign-up')}><ArrowLeft size={13} />{t('Modifier mes informations')}</button>
        </p>
        <p className="google-login-note">{t('Pas d’e-mail ? Regardez dans les indésirables. Si l’adresse a déjà un compte, l’e-mail vous invite à vous connecter.')}</p>
      </> : <>
        <h1>{t('Choisissez votre mot de passe')}<span className="wordmark-dot">.</span></h1>
        <p>{form.email ? t('Bienvenue, {email}. ', { email: form.email }) : ''}{t('Le mot de passe temporaire ne sert qu’une fois : choisissez maintenant le vôtre (10 caractères minimum).')}</p>
        <form className="auth-password" onSubmit={submitChange} aria-label={t('Choisir un mot de passe')}>
          {askCurrent && <label><span>{t('Mot de passe actuel')}</span><input type="password" required maxLength={200} autoComplete="current-password" value={form.password} onChange={set('password')} /></label>}
          <label><span>{t('Nouveau mot de passe')}</span><input type="password" required minLength={10} maxLength={200} autoComplete="new-password" value={form.newPassword} onChange={set('newPassword')} placeholder={t('10 caractères minimum')} /></label>
          <label><span>{t('Confirmez le mot de passe')}</span><input type="password" required minLength={10} maxLength={200} autoComplete="new-password" value={form.confirm} onChange={set('confirm')} /></label>
          <button className="btn primary auth-submit" disabled={busy}>
            {busy ? <Loader2 size={18} className="spin" /> : <Check size={16} />}{t('Enregistrer et entrer')}</button>
        </form>
        <p className="google-login-note"><KeyRound size={13} />{' '}{t('Ce mot de passe vous servira pour toutes vos prochaines connexions.')}</p>
      </>}
      {configured === false && <div className="auth-setup" role="status"><strong>{t('Connexion non configurée')}</strong><p>{t('L’adresse de l’application (AUTH_URL) doit être définie côté serveur.')}</p></div>}
      {error && <p className="form-error" role="alert">{shown(error)}</p>}
      <small className="auth-privacy"><Lock size={14} />{t('Vos données restent privées. Les mots de passe sont stockés hachés et jamais en clair.')}</small>
      <Copyright className="auth-copyright" />
    </div>
  </div>;
}

// Outgoing e-mail through Gmail SMTP (App Password). When not configured, callers fall back to showing the
// information on screen so the studio can send it by hand.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '@/lib/env';
import { buildInvitePdf } from '@/lib/invite-pdf-core';

/** The studio logo, read once and cached for every PDF the server generates this instance. */
let logoBytesPromise: Promise<Uint8Array | null> | null = null;
const logoBytes = () => {
  logoBytesPromise ??= readFile(join(process.cwd(), 'public', 'the-one-core-logo-pdf.png')).catch(() => null);
  return logoBytesPromise;
};

/** The From header: the studio's name as a display name only (no quotes, brackets or line breaks can break out of it). */
const fromAddress = (studio: string) => ({ name: studio.replace(/[\r\n"<>\\,;@]/g, ' ').replace(/\s+/g, ' ').trim() || 'The One Space', address: env.GMAIL_USER! });

export const mailConfigured = () => !!(env.GMAIL_USER && env.GMAIL_APP_PASSWORD);

export type Invitation = { to: string; name: string; temporaryPassword: string; studio: string; url: string; roleLabel: string; renewal: boolean;
  /** The workspace's own logo (PNG) for the PDF; null: none (a company without a logo); absent: The One Core's. */
  logoPng?: Uint8Array | null };

export function invitationMessage(i: Invitation) {
  const subject = i.renewal ? `Nouveau mot de passe temporaire — ${i.studio}` : `Votre accès à l’espace ${i.studio}`;
  const text = [
    `Bonjour ${i.name || ''},`.replace(' ,', ','),
    '',
    i.renewal
      ? `${i.studio} a renouvelé votre accès à son espace de suivi et de validation.`
      : `${i.studio} vous a ouvert un accès à son espace de suivi et de validation (${i.roleLabel}).`,
    '',
    `Adresse : ${i.url}`,
    `Identifiant : ${i.to}`,
    `Mot de passe temporaire : ${i.temporaryPassword}`,
    '',
    'À votre première connexion, vous choisirez votre propre mot de passe. Ce mot de passe temporaire ne sert qu’une fois.',
    '',
    `— ${i.studio}`,
  ].join('\n');
  const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const html = `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.7;color:#111;max-width:560px">
<p>Bonjour ${esc(i.name || '')},</p>
<p>${esc(i.renewal ? `${i.studio} a renouvelé votre accès à son espace de suivi et de validation.` : `${i.studio} vous a ouvert un accès à son espace de suivi et de validation (${i.roleLabel}).`)}</p>
<table style="border-collapse:collapse;margin:18px 0"><tr><td style="padding:6px 14px 6px 0;color:#666">Adresse</td><td><a href="${esc(i.url)}">${esc(i.url)}</a></td></tr>
<tr><td style="padding:6px 14px 6px 0;color:#666">Identifiant</td><td>${esc(i.to)}</td></tr>
<tr><td style="padding:6px 14px 6px 0;color:#666">Mot de passe temporaire</td><td><code style="font-size:16px;letter-spacing:.06em;background:#f3f3f1;border:1px solid #e5e5e0;border-radius:4px;padding:3px 8px">${esc(i.temporaryPassword)}</code></td></tr></table>
<p>À votre première connexion, vous choisirez votre propre mot de passe. Ce mot de passe temporaire ne sert qu’une fois.</p>
<p style="color:#666">— ${esc(i.studio)}</p></div>`;
  return { subject, text, html };
}

export type ClientNotice = { to: string[]; clientName: string; studio: string; url: string; pendingTasks: string[]; news?: string };

export function clientNoticeMessage(n: ClientNotice) {
  const subject = n.pendingTasks.length
    ? `${n.pendingTasks.length > 1 ? `${n.pendingTasks.length} éléments` : 'Un élément'} à valider — ${n.studio}`
    : `Actualités — ${n.studio}`;
  const lines = ['Bonjour,', ''];
  if (n.pendingTasks.length) {
    lines.push(`${n.studio} a ${n.pendingTasks.length > 1 ? 'des éléments' : 'un élément'} en attente de votre validation :`, '', ...n.pendingTasks.map((t) => `• ${t}`), '');
  }
  if (n.news) lines.push(n.news, '');
  lines.push(`Adresse : ${n.url}`, '', `— ${n.studio}`);
  const text = lines.join('\n');
  const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const html = `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.7;color:#111;max-width:560px">
<p>Bonjour,</p>
${n.pendingTasks.length ? `<p>${esc(n.studio)} a ${n.pendingTasks.length > 1 ? 'des éléments' : 'un élément'} en attente de votre validation :</p><ul>${n.pendingTasks.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
${n.news ? `<p>${esc(n.news).replace(/\n/g, '<br>')}</p>` : ''}
<p><a href="${esc(n.url)}">${esc(n.url)}</a></p>
<p style="color:#666">— ${esc(n.studio)}</p></div>`;
  return { subject, text, html };
}

export async function sendClientNotice(notice: ClientNotice): Promise<{ sent: boolean; error?: string }> {
  if (!mailConfigured()) return { sent: false };
  try {
    const { default: nodemailer } = await import('nodemailer');
    const transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: env.GMAIL_USER!, pass: env.GMAIL_APP_PASSWORD! } });
    const message = clientNoticeMessage(notice);
    await transport.sendMail({ from: fromAddress(notice.studio), to: notice.to, subject: message.subject, text: message.text, html: message.html });
    return { sent: true };
  } catch (error) {
    console.error('client notice mail', (error as Error).message);
    return { sent: false, error: 'L’envoi de l’e-mail a échoué.' };
  }
}

export type ApprovalNotice = { to: string; studio: string; taskName: string; clientName?: string; mode: 'explicit' | 'silence' | 'studio'; by: string; at: string; hours?: number; url: string };

/** What the owner reads when a deliverable gets approved: which one, by whom and how, and a link to it. */
export function approvalNoticeMessage(n: ApprovalNotice) {
  const how = n.mode === 'explicit' ? `validé par ${n.by}${n.clientName ? ` (${n.clientName})` : ''}`
    : n.mode === 'studio' ? `validé depuis le studio par ${n.by}`
    : `validé tacitement${n.hours ? ` après ${n.hours} h sans réponse` : ''}`;
  const when = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Africa/Casablanca' }).format(new Date(n.at));
  const subject = `Livrable validé — ${n.taskName}${n.clientName ? ` · ${n.clientName}` : ''}`.slice(0, 200);
  const text = ['Bonjour,', '', `« ${n.taskName} » a été ${how}.`, ...(n.clientName ? [`Client : ${n.clientName}`] : []), `Le ${when} (heure de Casablanca).`, '', `Ouvrir la tâche : ${n.url}`, '', `— ${n.studio}`].join('\n');
  const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const html = `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.7;color:#111;max-width:560px">
<p>Bonjour,</p>
<p>« <strong>${esc(n.taskName)}</strong> » a été ${esc(how)}.</p>
<table style="border-collapse:collapse;margin:14px 0">${n.clientName ? `<tr><td style="padding:4px 14px 4px 0;color:#666">Client</td><td>${esc(n.clientName)}</td></tr>` : ''}<tr><td style="padding:4px 14px 4px 0;color:#666">Date</td><td>${esc(when)} (Casablanca)</td></tr></table>
<p><a href="${esc(n.url)}">Ouvrir la tâche</a></p>
<p style="color:#666">— ${esc(n.studio)}</p></div>`;
  return { subject, text, html };
}

export async function sendApprovalNotice(notice: ApprovalNotice): Promise<{ sent: boolean; error?: string }> {
  if (!mailConfigured()) return { sent: false };
  try {
    const { default: nodemailer } = await import('nodemailer');
    const transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: env.GMAIL_USER!, pass: env.GMAIL_APP_PASSWORD! } });
    const message = approvalNoticeMessage(notice);
    await transport.sendMail({ from: fromAddress(notice.studio), to: notice.to, subject: message.subject, text: message.text, html: message.html });
    return { sent: true };
  } catch (error) {
    console.error('approval notice mail', (error as Error).message);
    return { sent: false, error: 'L’envoi de l’e-mail a échoué.' };
  }
}

export async function sendInvitation(invitation: Invitation): Promise<{ sent: boolean; error?: string }> {
  if (!mailConfigured()) return { sent: false };
  try {
    const { default: nodemailer } = await import('nodemailer');
    const transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: env.GMAIL_USER!, pass: env.GMAIL_APP_PASSWORD! } });
    const message = invitationMessage(invitation);
    // Same welcome document as the "Download as PDF" button, attached so it arrives with the e-mail too.
    const pdfBytes = await buildInvitePdf({
      name: invitation.name, roleLabel: invitation.roleLabel, email: invitation.to,
      temporaryPassword: invitation.temporaryPassword, url: invitation.url, studioName: invitation.studio,
      logoPngBytes: 'logoPng' in invitation ? invitation.logoPng ?? null : await logoBytes(),
    }).catch((error) => { console.error('invitation pdf', (error as Error).message); return null; });
    await transport.sendMail({
      from: fromAddress(invitation.studio), to: invitation.to, subject: message.subject, text: message.text, html: message.html,
      ...(pdfBytes ? { attachments: [{ filename: `acces-${invitation.studio}.pdf`, content: Buffer.from(pdfBytes), contentType: 'application/pdf' }] } : {}),
    });
    return { sent: true };
  } catch (error) {
    console.error('invitation mail', (error as Error).message);
    return { sent: false, error: 'L’envoi de l’e-mail a échoué. Transmettez le mot de passe temporaire vous-même.' };
  }
}

export type SignupCode = { to: string; name: string; company: string; code: string; url: string; existing: boolean };
const escHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/**
 * The code that confirms a new account's e-mail (lib/signup.ts). When the address already has an
 * account, the same request sends a « you already have an account » note instead of a code — the
 * sign-up form answers identically either way, so it never reveals who is registered.
 */
export async function sendSignupCode(message: SignupCode): Promise<{ sent: boolean; error?: string }> {
  if (!mailConfigured()) return { sent: false };
  const subject = message.existing ? 'Vous avez déjà un compte The One Space' : `${message.code} — votre code The One Space`;
  const text = message.existing
    ? `Bonjour,\n\nQuelqu’un (sans doute vous) a demandé à créer un compte avec cette adresse, mais elle a déjà un compte. Connectez-vous sur ${message.url} — mot de passe oublié ? Demandez à votre studio de renouveler votre accès.\n\nSi ce n’était pas vous, ignorez ce message.`
    : `Bonjour ${message.name},\n\nVotre code pour créer l’espace « ${message.company} » : ${message.code}\n\nIl est valable 30 minutes. Si vous n’avez rien demandé, ignorez ce message : aucun compte n’est créé sans ce code.`;
  const html = message.existing
    ? `<p>Bonjour,</p><p>Quelqu’un (sans doute vous) a demandé à créer un compte avec cette adresse, mais elle a déjà un compte. <a href="${escHtml(message.url)}">Connectez-vous</a>.</p><p>Si ce n’était pas vous, ignorez ce message.</p>`
    : `<p>Bonjour ${escHtml(message.name)},</p><p>Votre code pour créer l’espace « ${escHtml(message.company)} » :</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${message.code}</p><p>Il est valable 30 minutes. Si vous n’avez rien demandé, ignorez ce message : aucun compte n’est créé sans ce code.</p>`;
  try {
    const { default: nodemailer } = await import('nodemailer');
    const transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: env.GMAIL_USER!, pass: env.GMAIL_APP_PASSWORD! } });
    await transport.sendMail({ from: `"The One Space" <${env.GMAIL_USER}>`, to: message.to, subject, text, html });
    return { sent: true };
  } catch (error) {
    console.error('signup mail', (error as Error).message);
    return { sent: false, error: 'L’e-mail n’a pas pu être envoyé. Réessayez dans un instant.' };
  }
}

/** « Mot de passe oublié ? » (lib/password-reset.ts): the one-time link, valid 30 minutes. */
export async function sendPasswordReset(message: { to: string; name: string; link: string }): Promise<{ sent: boolean; error?: string }> {
  if (!mailConfigured()) return { sent: false };
  const hello = message.name ? `Bonjour ${message.name},` : 'Bonjour,';
  const text = `${hello}\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable 30 minutes, une seule fois) :\n${message.link}\n\nSi vous n’avez rien demandé, ignorez ce message : votre mot de passe actuel reste valable.`;
  const html = `<p>${escHtml(hello)}</p><p>Pour choisir un nouveau mot de passe, ouvrez ce lien (valable 30 minutes, une seule fois) :</p><p><a href="${escHtml(message.link)}" style="display:inline-block;padding:12px 18px;background:#efb849;color:#251f12;border-radius:10px;text-decoration:none;font-weight:600">Choisir un nouveau mot de passe</a></p><p>Si vous n’avez rien demandé, ignorez ce message : votre mot de passe actuel reste valable.</p>`;
  try {
    const { default: nodemailer } = await import('nodemailer');
    const transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: env.GMAIL_USER!, pass: env.GMAIL_APP_PASSWORD! } });
    await transport.sendMail({ from: `"The One Space" <${env.GMAIL_USER}>`, to: message.to, subject: 'Choisir un nouveau mot de passe', text, html });
    return { sent: true };
  } catch (error) {
    console.error('reset mail', (error as Error).message);
    return { sent: false, error: 'L’e-mail n’a pas pu être envoyé.' };
  }
}

/** A company asks for a paid plan (lib/plans.ts): The One Core's owner (OWNER_EMAIL) is told, to collect the payment. */
export async function sendPlanRequest(request: { company: string; plan: string; priceMad: number; email: string; name: string }): Promise<{ sent: boolean; error?: string }> {
  const to = (env.OWNER_EMAIL ?? '').trim();
  if (!mailConfigured() || !to) return { sent: false };
  const text = `Nouvelle demande de plan\n\nEntreprise : ${request.company}\nPlan : ${request.plan} (${request.priceMad} MAD / mois)\nDemandé par : ${request.name} <${request.email}>\n\nEncaissez le paiement puis marquez l’espace comme payé sur la page Plateforme.`;
  const html = `<p><strong>Nouvelle demande de plan</strong></p><p>Entreprise : ${escHtml(request.company)}<br>Plan : ${escHtml(request.plan)} (${request.priceMad} MAD / mois)<br>Demandé par : ${escHtml(request.name)} &lt;${escHtml(request.email)}&gt;</p><p>Encaissez le paiement puis marquez l’espace comme payé sur la page Plateforme.</p>`;
  try {
    const { default: nodemailer } = await import('nodemailer');
    const transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: env.GMAIL_USER!, pass: env.GMAIL_APP_PASSWORD! } });
    await transport.sendMail({ from: `"The One Space" <${env.GMAIL_USER}>`, to, replyTo: request.email, subject: `Plan ${request.plan} demandé — ${request.company}`, text, html });
    return { sent: true };
  } catch (error) {
    console.error('plan request mail', (error as Error).message);
    return { sent: false, error: 'L’e-mail n’a pas pu être envoyé.' };
  }
}

/** A production failure (lib/error-report.ts): The One Core's owner hears of it, at most once an hour per area. */
export async function sendErrorAlert(alert: { area: string; message: string; count: number }): Promise<{ sent: boolean }> {
  const to = (env.OWNER_EMAIL ?? '').trim();
  if (!mailConfigured() || !to) return { sent: false };
  const where = env.AUTH_URL ? `${env.AUTH_URL.replace(/\/$/, '')}` : 'l’application';
  const text = `Une erreur s’est produite sur The One Space.\n\nZone : ${alert.area}\nErreur : ${alert.message}\nOccurrences aujourd’hui : ${alert.count}\n\nLe détail et les erreurs suivantes sont sur la page Plateforme de ${where}.`;
  const html = `<p><strong>Une erreur s’est produite sur The One Space.</strong></p><p>Zone : ${escHtml(alert.area)}<br>Erreur : ${escHtml(alert.message)}<br>Occurrences aujourd’hui : ${alert.count}</p><p>Le détail et les erreurs suivantes sont sur la page Plateforme de ${escHtml(where)}.</p>`;
  try {
    const { default: nodemailer } = await import('nodemailer');
    const transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: env.GMAIL_USER!, pass: env.GMAIL_APP_PASSWORD! } });
    await transport.sendMail({ from: `"The One Space" <${env.GMAIL_USER}>`, to, subject: `Erreur — ${alert.area}`, text, html });
    return { sent: true };
  } catch (error) {
    console.error('error alert mail', (error as Error).message);
    return { sent: false };
  }
}

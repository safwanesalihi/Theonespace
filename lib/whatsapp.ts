// WhatsApp Business (Meta Cloud API): tells a client, on their phone, that something is waiting for
// their approval. Server-only — the token never leaves lib/env.
//
// Meta only lets a business open a conversation with a PRE-APPROVED message template, so the text is
// not written here: it lives in WhatsApp Manager, and this module fills its body variables.
//   « Prêt à valider » (WHATSAPP_TEMPLATE): {{1}} client · {{2}} deliverable · {{3}} portal address
//   « Nouveau message » (WHATSAPP_COMMENT_TEMPLATE, optional): {{1}} client · {{2}} who wrote · {{3}} task · {{4}} portal address
// See README → "WhatsApp" for the exact templates to submit.
import { env } from '@/lib/env';
import { metaGraphVersion } from '@/lib/meta-graph';
import { parseWhatsappNumber } from '@/lib/whatsapp-number';

const graphVersion = metaGraphVersion();
const timeoutMs = 5000;

const credentialsConfigured = () => !!(env.WHATSAPP_TOKEN?.trim() && env.WHATSAPP_PHONE_NUMBER_ID?.trim());
export const whatsappConfigured = () => credentialsConfigured() && !!env.WHATSAPP_TEMPLATE?.trim();

export const isWhatsappNumber = (value: string) => {
  const parsed = parseWhatsappNumber(value);
  return parsed.valid && !!parsed.number;
};

// Every client gets the French template, whatever the language on their file: one template to have
// approved and to keep in step, and no client left without a message for want of a translation.
// WhatsApp Manager files a template under the language picked when it was created — often English
// (en_US) by default, or a regional code — and Meta only finds it under that exact code. So when Meta
// says « not in this language » (#132001), the usual codes are tried in turn (a refused try sends
// nothing), and the one that works is remembered for the next messages.
const preferredLanguages = ['fr', 'fr_FR', 'fr_CA', 'en_US', 'en', 'en_GB', 'ar'];
const workingLanguage = new Map<string, string>();
const notInLanguage = 132001;
export const resetWhatsappLanguages = () => workingLanguage.clear();

export type ApprovalNotice = { to: string; clientName: string; taskName: string; url: string };
export type MessageNotice = { to: string; clientName: string; from: string; taskName: string; url: string };
export type AssignmentNotice = { to: string; memberName: string; from: string; taskName: string; url: string };
export type ChangesNotice = { to: string; memberName: string; clientName: string; taskName: string; url: string };
export type ApprovedNotice = { to: string; memberName: string; taskName: string; clientName: string; url: string };
export type WhatsappResult = { sent: boolean; error?: string; messageId?: string };

/** « Un nouveau contenu est prêt à valider ». Never throws. */
export const sendApprovalRequest = (notice: ApprovalNotice) =>
  sendTemplate('WHATSAPP_TEMPLATE', notice.to, [notice.clientName, notice.taskName, notice.url], env.WHATSAPP_TEMPLATE_LANGUAGE);

export const sendAssignmentNotice = (notice: AssignmentNotice) =>
  sendTemplate('WHATSAPP_ASSIGNMENT_TEMPLATE', notice.to, [notice.memberName, notice.taskName, notice.from, notice.url], env.WHATSAPP_ASSIGNMENT_LANGUAGE || env.WHATSAPP_TEMPLATE_LANGUAGE);

export const sendChangesNotice = (notice: ChangesNotice) =>
  sendTemplate('WHATSAPP_CHANGES_TEMPLATE', notice.to, [notice.memberName, notice.taskName, notice.clientName, notice.url], env.WHATSAPP_CHANGES_LANGUAGE || env.WHATSAPP_TEMPLATE_LANGUAGE);

export const sendReminderNotice = (notice: AssignmentNotice) =>
  sendTemplate('WHATSAPP_REMINDER_TEMPLATE', notice.to, [notice.memberName, notice.taskName, notice.from, notice.url], env.WHATSAPP_REMINDER_LANGUAGE || env.WHATSAPP_TEMPLATE_LANGUAGE);

/** « {client} a validé {task} » to the owner and the admins. Never throws. */
export const sendApprovedNotice = (notice: ApprovedNotice) =>
  sendTemplate('WHATSAPP_APPROVED_TEMPLATE', notice.to, [notice.memberName, notice.taskName, notice.clientName, notice.url], env.WHATSAPP_APPROVED_LANGUAGE || env.WHATSAPP_TEMPLATE_LANGUAGE);

/** Is the optional « nouveau message » template set up (on top of the approval one)? */
export const messageNoticeConfigured = () => credentialsConfigured() && !!env.WHATSAPP_COMMENT_TEMPLATE?.trim();
/** « {who} vous a écrit à propos de {task} ». Never throws. */
export const sendMessageNotice = (notice: MessageNotice) =>
  sendTemplate('WHATSAPP_COMMENT_TEMPLATE', notice.to, [notice.clientName, notice.from, notice.taskName, notice.url], env.WHATSAPP_COMMENT_LANGUAGE || env.WHATSAPP_TEMPLATE_LANGUAGE);

/** Never throws: a failed message must never fail the save that triggered it. */
async function sendTemplate(setting: 'WHATSAPP_TEMPLATE' | 'WHATSAPP_COMMENT_TEMPLATE' | 'WHATSAPP_ASSIGNMENT_TEMPLATE' | 'WHATSAPP_CHANGES_TEMPLATE' | 'WHATSAPP_REMINDER_TEMPLATE' | 'WHATSAPP_APPROVED_TEMPLATE', to: string, variables: string[], language?: string): Promise<WhatsappResult> {
  const template = env[setting]?.trim();
  const missing = [!env.WHATSAPP_TOKEN?.trim() && 'WHATSAPP_TOKEN', !env.WHATSAPP_PHONE_NUMBER_ID?.trim() && 'WHATSAPP_PHONE_NUMBER_ID', !template && setting].filter(Boolean);
  if (missing.length) return { sent: false, error: `WhatsApp n’est pas configuré : renseignez ${missing.join(', ')} dans l’environnement du serveur puis redéployez.` };
  if (!/^\d+$/.test(env.WHATSAPP_PHONE_NUMBER_ID!.trim())) return { sent: false, error: 'WHATSAPP_PHONE_NUMBER_ID doit être l’identifiant numérique Meta du numéro d’envoi, pas son numéro de téléphone.' };
  const recipient = parseWhatsappNumber(to);
  if (!recipient.valid) return { sent: false, error: recipient.error };
  if (!recipient.number) return { sent: false, error: 'Numéro WhatsApp invalide.' };
  const cacheKey = `${env.WHATSAPP_PHONE_NUMBER_ID}:${template}`;
  const known = workingLanguage.get(cacheKey);
  const order = language?.trim() ? [language.trim()] : known ? [known, ...preferredLanguages.filter((l) => l !== known)] : preferredLanguages;
  const deadline = Date.now() + 20000;
  let result: Attempt | null = null;
  for (const language of order) {
    result = await attempt(template!, language, recipient.number, variables, Math.min(timeoutMs, Math.max(1, deadline - Date.now())));
    if (result.code !== notInLanguage) break;
    if (Date.now() >= deadline) return { sent: false, error: 'WhatsApp : recherche de la langue expirée. Renseignez le code exact du modèle dans WHATSAPP_TEMPLATE_LANGUAGE.' };
  }
  if (!result!.ok) {
    if (result!.code === notInLanguage) {
      console.error('whatsapp', 'template not found in any language', template);
      return {
        sent: false,
        error: `WhatsApp : Meta ne trouve le modèle « ${template} » ${language ? `dans la langue « ${language} »` : 'dans aucune langue'} pour ce numéro. Vérifiez dans WhatsApp Manager que le modèle est « Actif », que son nom est exactement celui de ${setting}, et qu’il est sur le même compte WhatsApp Business que le numéro d’envoi (WHATSAPP_PHONE_NUMBER_ID).`,
      };
    }
    return { sent: false, error: result!.error };
  }
  workingLanguage.set(cacheKey, result!.language);
  return { sent: true, messageId: result!.messageId };
}

type Attempt = { ok: boolean; language: string; code?: number; error?: string; messageId?: string };

async function attempt(template: string, language: string, to: string, variables: string[], timeout: number): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`https://graph.facebook.com/${graphVersion}/${env.WHATSAPP_PHONE_NUMBER_ID!.trim()}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN!.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to.replace(/^\+/, ''),
        type: 'template',
        template: {
          name: template,
          language: { code: language },
          components: [{
            type: 'body',
            parameters: variables.map((text) => ({ type: 'text', text: text.slice(0, 200) })),
          }],
        },
      }),
      signal: controller.signal,
    });
    const data = (await response.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string; code?: number; error_data?: { details?: string } };
    };
    if (!response.ok) {
      // Meta's own message is the useful one ("recipient not on WhatsApp", a wrong variable count…),
      // and its `details` often name the culprit. A template error also says what was asked for.
      const code = data.error?.code;
      if (code === notInLanguage) return { ok: false, language, code };
      const reason = [data.error?.message, data.error?.error_data?.details].filter(Boolean).join(' — ');
      const templateError = code !== undefined && code >= 132000 && code < 133000;
      const asked = templateError ? ` (modèle « ${template} », langue « ${language} »)` : '';
      console.error('whatsapp', response.status, code, reason, asked);
      return { ok: false, language, code, error: reason ? `WhatsApp : ${reason}${asked}` : 'L’envoi WhatsApp a échoué.' };
    }
    const messageId = data.messages?.[0]?.id;
    if (typeof messageId !== 'string' || !messageId) return { ok: false, language, error: 'WhatsApp : Meta n’a retourné aucun identifiant de message. L’envoi n’est pas confirmé.' };
    return { ok: true, language, messageId };
  } catch (error) {
    const aborted = (error as Error).name === 'AbortError';
    console.error('whatsapp', aborted ? 'timeout' : (error as Error).message);
    return { ok: false, language, error: aborted ? 'WhatsApp n’a pas répondu à temps.' : 'L’envoi WhatsApp a échoué.' };
  } finally {
    clearTimeout(timer);
  }
}

// WhatsApp Business (Meta Cloud API): tells a client, on their phone, that something is waiting for
// their approval. Server-only — the token never leaves lib/env.
//
// Meta only lets a business open a conversation with a PRE-APPROVED message template, so the text is
// not written here: it lives in WhatsApp Manager, and this module fills its three body variables:
//   {{1}} the client's name   {{2}} the deliverable's name   {{3}} the portal address
// See README → "WhatsApp" for the exact template to submit.
import { env } from '@/lib/env';

const graphVersion = 'v21.0';
const timeoutMs = 5000;

export const whatsappConfigured = () =>
  !!(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_TEMPLATE);

/** International format only, as WhatsApp itself requires: "+212 6 12 34 56 78" → "+212612345678". */
export function normalizeWhatsapp(value: string) {
  return value.replace(/[\s.()-]/g, '');
}
export const isWhatsappNumber = (value: string) => /^\+[1-9]\d{7,14}$/.test(value);

// Every client gets the French template, whatever the language on their file: one template to have
// approved and to keep in step, and no client left without a message for want of a translation.
const templateLanguage = 'fr';

export type ApprovalNotice = { to: string; clientName: string; taskName: string; url: string };
export type WhatsappResult = { sent: boolean; error?: string; messageId?: string };

/** Never throws: a failed message must never fail the save that triggered it. */
export async function sendApprovalRequest(notice: ApprovalNotice): Promise<WhatsappResult> {
  if (!whatsappConfigured()) return { sent: false, error: 'WhatsApp n’est pas configuré.' };
  if (!isWhatsappNumber(notice.to)) return { sent: false, error: 'Numéro WhatsApp invalide.' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const language = templateLanguage;
  try {
    const response = await fetch(`https://graph.facebook.com/${graphVersion}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: notice.to.replace(/^\+/, ''),
        type: 'template',
        template: {
          name: env.WHATSAPP_TEMPLATE,
          language: { code: language },
          components: [{
            type: 'body',
            parameters: [notice.clientName, notice.taskName, notice.url].map((text) => ({ type: 'text', text: text.slice(0, 200) })),
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
      // Meta's own message is the useful one ("template not found", "recipient not on WhatsApp"…),
      // and its `details` often name the culprit. A template error also says what was asked for,
      // since a name or language that doesn't match WhatsApp Manager exactly is the usual cause.
      const reason = [data.error?.message, data.error?.error_data?.details].filter(Boolean).join(' — ');
      const templateError = data.error?.code !== undefined && data.error.code >= 132000 && data.error.code < 133000;
      const asked = templateError ? ` (modèle « ${env.WHATSAPP_TEMPLATE} », langue « ${language} »)` : '';
      console.error('whatsapp', response.status, data.error?.code, reason, asked);
      return { sent: false, error: reason ? `WhatsApp : ${reason}${asked}` : 'L’envoi WhatsApp a échoué.' };
    }
    return { sent: true, messageId: data.messages?.[0]?.id };
  } catch (error) {
    const aborted = (error as Error).name === 'AbortError';
    console.error('whatsapp', aborted ? 'timeout' : (error as Error).message);
    return { sent: false, error: aborted ? 'WhatsApp n’a pas répondu à temps.' : 'L’envoi WhatsApp a échoué.' };
  } finally {
    clearTimeout(timer);
  }
}

// What a feature says when the key it needs is not set (Daily for calls, Apify for Instagram). The
// studio's own workspace is where those keys get configured, so it keeps the technical hint; an
// agency's workspace (public sign-up, « ws:org:… ») cannot act on an environment variable, so it is
// told the feature isn't available yet and what to do instead. Translated where shown (t(message)).
import { isCompanyWorkspaceId } from '@/lib/workspace';

const pick = (workspaceId: string | null | undefined, studio: string, agency: string) =>
  workspaceId && isCompanyWorkspaceId(workspaceId) ? agency : studio;

/** The Meetings page's banner when calls inside the app are off. */
export const callsBanner = (workspaceId?: string | null) => pick(workspaceId,
  'Les appels intégrés ne sont pas encore activés : ajoutez DAILY_API_KEY dans Vercel (daily.co, gratuit jusqu’à 10 000 minutes par mois). En attendant, collez un lien Google Meet ou Zoom dans la réunion.',
  'Les appels vidéo dans l’application ne sont pas encore disponibles pour votre espace. En attendant, collez un lien Google Meet ou Zoom dans la réunion : vos invités le retrouvent ici.');

/** Joining a meeting that has no link while calls are off. */
export const callsRefusal = (workspaceId?: string | null) => pick(workspaceId,
  'Les appels ne sont pas encore activés (DAILY_API_KEY). Ajoutez un lien de réunion ou activez Daily.',
  'Les appels vidéo dans l’application ne sont pas encore disponibles pour votre espace. Ajoutez un lien Google Meet ou Zoom à la réunion.');

export const igAnalysisBanner = (workspaceId?: string | null) => pick(workspaceId,
  'L’analyse Instagram n’est pas encore activée : ajoutez APIFY_TOKEN dans Vercel (apify.com → Settings → API & Integrations).',
  'L’analyse Instagram n’est pas encore disponible pour votre espace. Contactez le support de The One Space pour l’activer.');
export const igAnalysisRefusal = (workspaceId?: string | null) => pick(workspaceId,
  'L’analyse Instagram n’est pas encore activée : ajoutez APIFY_TOKEN dans Vercel.',
  'L’analyse Instagram n’est pas encore disponible pour votre espace. Contactez le support de The One Space pour l’activer.');

export const igSearchBanner = (workspaceId?: string | null) => pick(workspaceId,
  'La recherche Instagram n’est pas encore activée : ajoutez APIFY_TOKEN dans Vercel (apify.com → Settings → API & Integrations).',
  'La recherche Instagram n’est pas encore disponible pour votre espace. Contactez le support de The One Space pour l’activer.');
export const igSearchRefusal = (workspaceId?: string | null) => pick(workspaceId,
  'La recherche Instagram n’est pas encore activée : ajoutez APIFY_TOKEN dans Vercel.',
  'La recherche Instagram n’est pas encore disponible pour votre espace. Contactez le support de The One Space pour l’activer.');

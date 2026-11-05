// Plateforme → Santé des services: is everything the SaaS leans on really there? The database and the mail are
// tried for real (a query, the mail key), since keys that are present can still be refused. The rest only says
// its keys are present: « set » must never read as « working ». Nothing secret leaves here, only states.
import { aiConfigured } from '@/lib/ai';
import { geminiConfigured } from '@/lib/agent';
import { dailyConfigured } from '@/lib/daily';
import { database, type Db } from '@/lib/database';
import { driveConfigured } from '@/lib/drive-store';
import { env } from '@/lib/env';
import { apifyConfigured } from '@/lib/ig-analyzer/scraper';
import { checkMail, mailConfigured } from '@/lib/mail';
import { mediaStorageConfigured } from '@/lib/media-storage';
import { signupEnabled } from '@/lib/signup';
import { providerConfigured } from '@/lib/social-oauth';
import { whatsappConfigured } from '@/lib/whatsapp';

/** ok: tried, works. set: keys present, not tried. off: missing. fail: tried, refused. warn: works, but look at it. */
export type HealthState = 'ok' | 'set' | 'off' | 'fail' | 'warn';
export type ServiceHealth = { id: string; label: string; use: string; state: HealthState; required: boolean; detail?: string };

const present = (configured: boolean): HealthState => (configured ? 'set' : 'off');

async function databaseHealth(db: Db): Promise<Pick<ServiceHealth, 'state' | 'detail'>> {
  const started = Date.now();
  try {
    await db.query('SELECT 1');
    return { state: 'ok', detail: `${Date.now() - started} ms` };
  } catch (error) {
    // Never the driver's message, in the answer or the log: it can carry the connection address.
    console.error('health database', (error as Error).name);
    return { state: 'fail', detail: 'Base de données injoignable.' };
  }
}

export async function serviceHealth(db: Db = database()): Promise<ServiceHealth[]> {
  const [base, mail] = await Promise.all([databaseHealth(db), mailConfigured() ? checkMail() : null]);
  return [
    { id: 'database', label: 'Base de données', use: 'Toutes les données des agences', required: true, ...base },
    { id: 'mail', label: 'E-mail', use: 'Liens d’accès, invitations, mots de passe oubliés', required: true,
      state: !mail ? 'off' : mail.ok ? 'ok' : 'fail', detail: mail?.error },
    { id: 'storage', label: 'Stockage des fichiers', use: 'Photos et vidéos des publications', required: true, state: present(mediaStorageConfigured()) },
    { id: 'auth', label: 'Secret de connexion', use: 'Sessions et jetons des comptes connectés', required: true, state: (env.AUTH_SECRET?.length ?? 0) >= 32 ? 'set' : 'off' },
    { id: 'owner', label: 'Compte Plateforme', use: 'Reçoit les demandes d’accès', required: true, state: present(!!env.OWNER_EMAIL?.trim()) },
    { id: 'url', label: 'Adresse de l’application', use: 'Les liens envoyés par e-mail', required: true, state: present(!!env.AUTH_URL?.trim()) },
    { id: 'cron', label: 'Tâches planifiées', use: 'Publications à l’heure, relances', required: true, state: present(!!env.CRON_SECRET?.trim()) },
    signupEnabled()
      ? { id: 'signup', label: 'Inscription publique', use: 'Qui peut créer un espace', required: true, state: 'warn', detail: 'Ouverte : on peut créer un espace sans passer par Demandes. Retirez PUBLIC_SIGNUP.' }
      : { id: 'signup', label: 'Inscription publique', use: 'Qui peut créer un espace', required: true, state: 'ok', detail: 'Fermée : tout passe par Demandes.' },
    { id: 'ai', label: 'Assistant IA', use: 'Rédaction et assistant', required: false, state: present(aiConfigured() || geminiConfigured()) },
    { id: 'whatsapp', label: 'WhatsApp', use: 'Notifications aux clients', required: false, state: present(whatsappConfigured()) },
    { id: 'calls', label: 'Appels vidéo', use: 'Réunions dans l’application', required: false, state: present(dailyConfigured()) },
    { id: 'instagram-data', label: 'Données Instagram', use: 'Analyse et recherche de comptes', required: false, state: present(apifyConfigured()) },
    { id: 'meta', label: 'Facebook et Instagram', use: 'Publication sur les comptes des clients', required: false, state: present(providerConfigured('meta')) },
    { id: 'tiktok', label: 'TikTok', use: 'Publication sur les comptes des clients', required: false, state: present(providerConfigured('tiktok')) },
    { id: 'youtube', label: 'YouTube', use: 'Publication sur les comptes des clients', required: false, state: present(providerConfigured('google')) },
    { id: 'drive', label: 'Google Drive', use: 'Dossiers des clients', required: false, state: present(driveConfigured()) },
  ];
}

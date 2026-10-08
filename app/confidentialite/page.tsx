import type { Metadata } from 'next';
import LegalPage from '@/features/legal/legal-page';

export const metadata: Metadata = { title: 'Politique de confidentialité — The One Core' };

export default function Privacy() {
  return (
    <LegalPage title="Politique de confidentialité">
      <p>
        The One Space (<a href="https://space.the1core.com">space.the1core.com</a>) est l’espace de travail de l’agence The One Core et de ses
        clients : suivi des contenus, validation, calendrier et publication sur les réseaux sociaux. Cette page explique quelles données
        l’application traite, pourquoi, et quels sont vos droits. Responsable du traitement : The One Core — <a href="mailto:contact@the1core.com">contact@the1core.com</a>.
      </p>

      <h2>1. Données traitées</h2>
      <ul>
        <li><strong>Compte</strong> : nom, adresse e-mail, mot de passe (enregistré chiffré, jamais lisible), photo de profil facultative.</li>
        <li><strong>Contenu de travail</strong> : clients, projets, tâches, commentaires et messages vocaux, fichiers et liens (dont Google Drive), publications prévues, décisions de validation.</li>
        <li><strong>Activité dans l’application</strong> : heures de connexion et temps d’utilisation, pour l’organisation interne du studio ; les membres en sont informés dans leurs paramètres.</li>
        <li><strong>Comptes de réseaux sociaux connectés</strong> (Facebook, Instagram, TikTok, YouTube), uniquement lorsqu’un utilisateur choisit de les connecter : identifiant, nom et photo du compte, et les jetons d’accès accordés par la plateforme. Ces jetons sont enregistrés chiffrés et ne sont jamais affichés ni transmis à un tiers.</li>
        <li><strong>Statistiques des publications</strong> fournies par les plateformes (portée, vues, interactions), pour les rapports du client.</li>
      </ul>

      <h2>2. Pourquoi</h2>
      <ul>
        <li>Faire fonctionner l’espace de travail : suivre, faire valider et livrer les contenus.</li>
        <li>Publier, à la demande de l’agence ou du client, les contenus validés sur les comptes connectés, et en mesurer les résultats.</li>
        <li>Envoyer les messages liés au service (invitations, validation attendue par e-mail ou WhatsApp).</li>
      </ul>
      <p>Aucune donnée n’est vendue, louée ni utilisée à des fins publicitaires.</p>

      <h2>3. Plateformes de réseaux sociaux</h2>
      <p>
        La connexion d’un compte se fait sur la page de la plateforme elle-même ; The One Space ne voit jamais le mot de passe. L’application
        n’utilise les autorisations accordées que pour publier les contenus programmés et lire leurs statistiques.
      </p>
      <ul>
        <li><strong>Meta (Facebook, Instagram)</strong> : <a href="https://www.facebook.com/privacy/policy/">politique de confidentialité de Meta</a>. Vous pouvez retirer l’accès dans Facebook → Paramètres → Intégrations professionnelles.</li>
        <li><strong>TikTok</strong> : <a href="https://www.tiktok.com/legal/privacy-policy">politique de confidentialité de TikTok</a>. Vous pouvez retirer l’accès dans TikTok → Paramètres → Sécurité → Applications autorisées.</li>
        <li>
          <strong>YouTube</strong> : l’application utilise les services d’API YouTube. En la connectant, vous acceptez les{' '}
          <a href="https://www.youtube.com/t/terms">Conditions d’utilisation de YouTube</a> ; vos données sont également régies par les{' '}
          <a href="https://policies.google.com/privacy">Règles de confidentialité de Google</a>. Vous pouvez retirer l’accès à tout moment sur{' '}
          <a href="https://myaccount.google.com/permissions">la page des autorisations de votre compte Google</a>.
        </li>
      </ul>
      <p>Dans tous les cas, « Déconnecter » dans The One Space (Social → Comptes) supprime immédiatement les jetons enregistrés.</p>

      <h2>4. Où sont les données et qui y a accès</h2>
      <p>
        Les données sont hébergées par nos prestataires techniques : Vercel (hébergement de l’application) et Supabase (base de données et
        fichiers). Les e-mails sont envoyés par Google (Gmail). Seules les personnes autorisées de l’agence et, pour ce qui le concerne, le
        client lui-même accèdent aux données d’un client ; chaque accès est vérifié par rôle.
      </p>

      <h2>5. Durée de conservation</h2>
      <ul>
        <li>Les données de travail sont conservées tant que la relation avec le client dure, puis supprimées ou archivées à sa demande.</li>
        <li>L’historique d’activité est conservé 180 jours.</li>
        <li>Les jetons d’un compte connecté sont supprimés dès sa déconnexion ou la suppression du client.</li>
      </ul>

      <h2>6. Vos droits</h2>
      <p>
        Conformément à la loi n° 09-08 relative à la protection des personnes physiques à l’égard du traitement des données à caractère
        personnel, vous disposez d’un droit d’accès, de rectification, d’opposition et de suppression. Écrivez à{' '}
        <a href="mailto:contact@the1core.com">contact@the1core.com</a> ; nous répondons dans un délai de 30 jours. Vous pouvez aussi saisir la
        CNDP (<a href="https://www.cndp.ma">cndp.ma</a>). Pour supprimer les données liées à un compte de réseau social, voir{' '}
        <a href="/suppression-des-donnees">Suppression des données</a>.
      </p>

      <h2>7. Sécurité</h2>
      <p>Connexions chiffrées (HTTPS), mots de passe hachés, jetons chiffrés, accès limités par rôle et vérifiés à chaque action.</p>

      <h2>8. Modifications</h2>
      <p>Cette politique peut évoluer ; la date de mise à jour figure en haut de la page.</p>
    </LegalPage>
  );
}

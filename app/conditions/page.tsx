import type { Metadata } from 'next';
import LegalPage from '@/features/legal/legal-page';

export const metadata: Metadata = { title: 'Conditions d’utilisation — The One Core' };

export default function Terms() {
  return (
    <LegalPage title="Conditions d’utilisation">
      <p>
        The One Space (<a href="https://space.the1core.com">space.the1core.com</a>) est édité par l’agence The One Core. Il est réservé à
        l’équipe de l’agence et à ses clients, sur invitation. En l’utilisant, vous acceptez les présentes conditions.
      </p>

      <h2>1. Accès</h2>
      <p>
        L’accès se fait par un compte personnel créé sur invitation. Vous gardez vos identifiants confidentiels et signalez sans délai toute
        utilisation non autorisée à <a href="mailto:contact@the1core.com">contact@the1core.com</a>. Chaque rôle (propriétaire, administrateur,
        membre, social media manager, client) ne voit et ne fait que ce qui lui revient.
      </p>

      <h2>2. Utilisation</h2>
      <ul>
        <li>L’application sert à suivre, faire valider, programmer et publier les contenus des clients de l’agence.</li>
        <li>Vous vous engagez à n’y déposer que des contenus dont vous avez les droits, conformes à la loi et aux règles des plateformes.</li>
        <li>Toute tentative d’accès à des données qui ne vous sont pas destinées est interdite.</li>
      </ul>

      <h2>3. Comptes de réseaux sociaux</h2>
      <p>
        En connectant un compte Facebook, Instagram, TikTok ou YouTube, vous autorisez The One Space à y publier les contenus programmés et
        validés, et à en lire les statistiques. Vous restez soumis aux conditions de chaque plateforme, notamment les{' '}
        <a href="https://www.youtube.com/t/terms">Conditions d’utilisation de YouTube</a>, les{' '}
        <a href="https://www.facebook.com/terms.php">Conditions de Meta</a> et les{' '}
        <a href="https://www.tiktok.com/legal/terms-of-service">Conditions de TikTok</a>. Vous pouvez déconnecter un compte à tout moment.
      </p>

      <h2>4. Contenus</h2>
      <p>
        Les contenus restent la propriété de leurs auteurs ou du client selon le contrat qui le lie à l’agence. La validation d’un contenu
        dans l’application (explicite, ou tacite après le délai prévu au contrat) est enregistrée et fait foi entre l’agence et le client.
      </p>

      <h2>5. Disponibilité et responsabilité</h2>
      <p>
        L’agence s’efforce d’assurer un service continu mais ne garantit pas l’absence d’interruption. Une publication peut être refusée ou
        retardée par une plateforme ; l’application en affiche la raison. L’agence n’est pas responsable des décisions des plateformes.
      </p>

      <h2>6. Données personnelles</h2>
      <p>Voir la <a href="/confidentialite">politique de confidentialité</a>.</p>

      <h2>7. Droit applicable</h2>
      <p>Ces conditions sont régies par le droit marocain. Tout litige relève des tribunaux compétents du Maroc.</p>
    </LegalPage>
  );
}

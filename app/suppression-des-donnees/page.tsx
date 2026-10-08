import type { Metadata } from 'next';
import LegalPage from '@/features/legal/legal-page';

export const metadata: Metadata = { title: 'Suppression des données — The One Core' };

export default function DataDeletion() {
  return (
    <LegalPage title="Suppression des données">
      <p>Vous pouvez à tout moment faire supprimer les données que The One Space détient sur vous ou sur un compte connecté.</p>

      <h2>Un compte de réseau social connecté (Facebook, Instagram, TikTok, YouTube)</h2>
      <ul>
        <li>Dans The One Space : Social → Comptes → « Déconnecter » sur le compte. Les jetons d’accès sont supprimés immédiatement.</li>
        <li>
          Depuis la plateforme : Facebook → Paramètres → Intégrations professionnelles → retirer « The One Space » ; TikTok → Paramètres →
          Sécurité → Applications autorisées ; Google → <a href="https://myaccount.google.com/permissions">autorisations du compte</a>.
          L’accès est alors coupé pour l’application.
        </li>
      </ul>

      <h2>Votre compte et vos données dans l’application</h2>
      <p>
        Écrivez à <a href="mailto:contact@the1core.com">contact@the1core.com</a> depuis l’adresse de votre compte, avec pour objet « Suppression
        de mes données ». Nous supprimons votre compte, les comptes connectés et les données personnelles associées dans un délai de 30 jours,
        et vous le confirmons par e-mail. Les documents que la loi nous oblige à conserver (factures, par exemple) sont conservés pour la durée
        légale uniquement.
      </p>
    </LegalPage>
  );
}

// The public legal pages the platforms ask for before an app can log people in (Meta, TikTok,
// Google): privacy policy, terms of use, data deletion. Plain server-rendered pages, open to anyone.
import Image from 'next/image';
import Link from 'next/link';
import './legal.css';

export const legalUpdated = '26 septembre 2026';

export default function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="legal-page">
      <header className="legal-head">
        <Image src="/the-one-core-logo-white.svg" alt="The One Core" width={180} height={42} priority />
        <nav>
          <Link href="/confidentialite">Confidentialité</Link>
          <Link href="/conditions">Conditions</Link>
          <Link href="/suppression-des-donnees">Suppression des données</Link>
        </nav>
      </header>
      <article className="legal-body">
        <h1>{title}</h1>
        <p className="legal-updated">Dernière mise à jour : {legalUpdated}</p>
        {children}
      </article>
      <footer className="legal-foot">The One Core · <a href="mailto:contact@the1core.com">contact@the1core.com</a> · <Link href="/">The One Space</Link></footer>
    </main>
  );
}

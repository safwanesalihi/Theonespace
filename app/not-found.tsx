// Anything outside "/" and "/login": the studio lives at one address, so the only useful thing to
// offer is the way back. Styled like the boot screen rather than Next's unstyled default.
import Link from 'next/link';
import { ProductMark } from '@/components/product-mark';

export default function NotFound() {
  return (
    <main className="boot-screen">
      <div className="boot-container">
        <ProductMark className="auth-logo" />
        <div className="boot-status">
          <h1>Cette page n’existe pas.</h1>
          <small>Le lien est peut-être incomplet ou l’élément a été supprimé.</small>
        </div>
        <Link className="btn primary" href="/">Retour à votre espace</Link>
      </div>
    </main>
  );
}

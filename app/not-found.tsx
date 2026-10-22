// Anything outside "/" and "/login": the studio lives at one address, so the only useful thing to
// offer is the way back. Styled like the boot screen rather than Next's unstyled default.
import Link from 'next/link';
import { ProductMark } from '@/components/product-mark';

export default function NotFound() {
  return (
    <div className="boot-screen">
      <div className="boot-container">
        <ProductMark className="auth-logo" />
        <p className="boot-status">
          Cette page n’existe pas.
          <small>Le lien est peut-être incomplet ou l’élément a été supprimé.</small>
        </p>
        <Link className="btn primary" href="/">Retour à votre espace</Link>
      </div>
    </div>
  );
}

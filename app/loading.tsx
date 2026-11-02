import { ProductMark } from '@/components/product-mark';
import './boot.css'; // not the app's stylesheet: this screen wraps the public page too
/** Stream a visible screen while authentication and the first server response are pending. */
export default function Loading() {
  return <div className="boot-screen" role="status" aria-live="polite">
    <div className="boot-container">
      {/* No workspace is known before the app loads: the product's own mark, never an agency's. */}
      <ProductMark className="auth-logo" />
      <div className="boot-progress-bar" />
      <p className="boot-status">Ouverture de votre espace…<small>Un instant, vos projets arrivent.</small></p>
    </div>
  </div>;
}

import { BootMark } from '@/components/boot-mark';
import './boot.css'; // not the app's stylesheet: this screen wraps the public page too
/** Stream a visible screen while authentication and the first server response are pending. */
export default function Loading() {
  return <div className="boot-screen" role="status" aria-live="polite">
    <div className="boot-container">
      {/* The agency's own logo when this browser already opened their workspace; The One Space otherwise. */}
      <BootMark className="auth-logo" />
      <div className="boot-progress-bar" />
      <p className="boot-status">Ouverture de votre espace…<small>Un instant, vos projets arrivent.</small></p>
    </div>
  </div>;
}

/** Stream a visible screen while authentication and the first server response are pending. */
export default function Loading() {
  return <div className="boot-screen" role="status" aria-live="polite">
    <div className="boot-container">
      {/* eslint-disable-next-line @next/next/no-img-element -- works before the app hydrates */}
      <img className="auth-logo" src="/the-one-core-logo.svg" alt="The One Core" />
      <div className="boot-progress-bar" />
      <p className="boot-status">Ouverture de votre espace…<small>Un instant, vos projets arrivent.</small></p>
    </div>
  </div>;
}

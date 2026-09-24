'use client';
// Last resort when a render throws: the studio's own screen instead of a blank page, with the two
// actions that actually help — retry the render, or go back to the workspace.
import { useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';

export default function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('render', error); }, [error]);
  return (
    <div className="boot-screen">
      <div className="boot-container">
        <Image className="auth-logo" src="/the-one-core-logo.svg" alt="The One Core" width={588} height={138} priority />
        <p className="boot-status">
          Une erreur est survenue.
          <small>Vos données sont intactes. Réessayez, ou revenez à votre espace.</small>
        </p>
        <div className="inline">
          <button className="btn primary" onClick={reset}>Réessayer</button>
          <Link className="btn" href="/">Retour à votre espace</Link>
        </div>
        {error.digest && <small className="boot-reference">Référence : {error.digest}</small>}
      </div>
    </div>
  );
}

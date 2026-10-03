'use client';

/** Root/provider errors cannot be handled by app/error.tsx. Keep this independent of providers. */
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <html lang="fr"><body style={{ margin: 0, background: '#f4f5f7', color: '#17191e', fontFamily: 'Arial, sans-serif' }}>
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, boxSizing: 'border-box' }}>
      <section style={{ maxWidth: 440, padding: 32, background: '#fff', border: '1px solid #dedfe4', borderRadius: 20 }}>
        <h1 style={{ fontSize: 24 }}>Votre espace n’a pas pu s’ouvrir.</h1>
        <p style={{ lineHeight: 1.6 }}>Réessayez de charger la page. Si le problème persiste, revenez à la connexion.</p>
        <button onClick={retry} style={{ padding: '12px 18px', border: 0, borderRadius: 8, background: '#d4af37', color: '#17191e', fontSize: 16, cursor: 'pointer' }}>Réessayer</button>
        <a href="/login" style={{ display: 'inline-block', marginInlineStart: 16, color: '#17191e' }}>Connexion</a>
      </section>
    </main>
  </body></html>;
}

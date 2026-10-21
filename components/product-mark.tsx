// The product's own mark, « The One Space », for the screens shown before anyone's brand is known:
// sign-in, sign-up, password reset and the first loading screen. Once a workspace has loaded, its
// agency's brand takes over (features/workspace/brand-store.ts). The ring echoes the dashboard's
// progress rings; it takes the brand colour token, so it stays amber until an agency picks its own.
export function ProductMark({ className = "" }: { className?: string }) {
  return (
    <span className={`product-mark ${className}`} role="img" aria-label="The One Space" dir="ltr">
      <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <circle cx="16" cy="16" r="12.5" fill="none" stroke="currentColor" strokeOpacity=".22" strokeWidth="3" />
        <path d="M16 3.5a12.5 12.5 0 1 1-11.2 6.9" fill="none" stroke="var(--t-brand, #d4af37)" strokeWidth="3" strokeLinecap="round" />
        <circle cx="16" cy="16" r="4.5" fill="var(--t-brand, #d4af37)" />
      </svg>
      <span className="product-mark-name">The One Space</span>
    </span>
  );
}

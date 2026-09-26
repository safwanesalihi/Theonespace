// Simple glyphs for the four networks (lucide-react ships no brand icons). Drawn in currentColor on a
// tinted chip, so they follow the surrounding text size and stay legible in any theme.
import type { Network } from "@/lib/social";
import { networkLabels } from "@/lib/social";

const paths: Record<Network, React.ReactNode> = {
  instagram: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="17.2" cy="6.8" r="1.2" fill="currentColor" />
    </>
  ),
  facebook: <path d="M13.5 21v-7.2h2.4l.4-2.9h-2.8V9.1c0-.8.3-1.4 1.4-1.4h1.5V5.1a19 19 0 0 0-2.2-.1c-2.2 0-3.7 1.3-3.7 3.8v2.1H8v2.9h2.5V21z" fill="currentColor" />,
  tiktok: <path d="M15.5 3c.3 2.2 1.6 3.6 3.8 3.8v2.8a7 7 0 0 1-3.7-1.1v6.1a5.4 5.4 0 1 1-5.4-5.4c.3 0 .6 0 .9.1v2.9a2.6 2.6 0 1 0 1.8 2.5V3z" fill="currentColor" />,
  youtube: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="4" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M10.2 9.3v5.4l4.6-2.7z" fill="currentColor" />
    </>
  ),
};

export default function NetworkIcon({ network, size = 14, badge = false }: { network: Network; size?: number; badge?: boolean }) {
  const svg = (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {paths[network]}
    </svg>
  );
  return badge
    ? <span className={`network-badge network-${network}`} title={networkLabels[network]}>{svg}</span>
    : <span className={`network-glyph network-${network}`} title={networkLabels[network]}>{svg}</span>;
}

import { BootMark } from '@/components/boot-mark';
import type { BootBrand } from '@/lib/boot-brand';
import './boot.css'; // not the app's stylesheet: this screen wraps the public page too

/**
 * The server-drawn loading screen: the brand this browser last opened (app/(app)/page.tsx reads its cookie), in
 * the first frame and without any script; nothing known (app/(app)/loading.tsx, a first visit) → neutral.
 */
export function BrandBootScreen({ brand }: { brand: BootBrand | null }) {
  return <div className="boot-screen" role="status" aria-live="polite">
    <div className="boot-container">
      <BootMark key={brand?.name ?? 'none'} brand={brand} />
      <p className="boot-status">Ouverture de votre espace…<small>Un instant, vos projets arrivent.</small></p>
    </div>
  </div>;
}

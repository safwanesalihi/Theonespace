import { BrandBootScreen } from './boot-screen';
/**
 * Stream a visible screen while authentication and the first server response are pending. It wraps every
 * page and stays static (no cookie read here), so it knows no workspace: a neutral screen, never a brand.
 * The home page draws its own, with the remembered brand (app/page.tsx).
 */
export default function Loading() {
  return <BrandBootScreen brand={null} />;
}

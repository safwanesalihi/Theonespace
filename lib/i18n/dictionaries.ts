// The English and Arabic dictionaries, in their own module so the browser fetches them only when one
// of those languages is in use (lib/i18n/index.ts, loadLocale): French, the source, needs none.
// The catalogs (lib/i18n/catalog/, one per area) first, then the pipeline and Drive copy, which win for
// the few keys they share with a catalog — the precedence these dictionaries always had.
import { catalogAr, catalogEn } from './catalog';
import { pipelineEn, pipelineAr } from './pipeline';
import { driveEn, driveAr } from './drive';

export const en: Record<string, string> = { ...catalogEn, ...pipelineEn, ...driveEn };
export const ar: Record<string, string> = { ...catalogAr, ...pipelineAr, ...driveAr };

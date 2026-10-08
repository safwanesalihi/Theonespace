/** French source string → [English, Arabic]. The French text is the key (gettext style). */
export type Catalog = Record<string, readonly [en: string, ar: string]>;

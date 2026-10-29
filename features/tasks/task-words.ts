// The agency's words for what the system counts: « aucun retour utilisé, 2 inclus » rather than « tour 0 sur 2 ».
type Translate = (text: string, values?: Record<string, string | number>) => string;

export function roundsWords({ used, included }: { used: number; included: number }, t: Translate) {
  if (used === 0) return t("aucun retour utilisé, {n} inclus", { n: included });
  return t(used === 1 ? "1 retour utilisé sur {n} inclus" : "{used} retours utilisés sur {n} inclus", { used, n: included });
}

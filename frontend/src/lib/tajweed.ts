/**
 * Tajwid coloré SIMPLIFIÉ, déduit uniquement des signes présents dans le texte
 * uthmani (aucune donnée externe) :
 *  - ghunna : ن / م avec shadda
 *  - madd   : lettre portant le signe de prolongation (U+0653)
 *  - qalqala: ق ط ب ج د avec sukun
 *  - muet   : alef wasla (ٱ) et lettres marquées du petit zéro (U+06DF)
 * C'est volontairement partiel (pas d'ikhfa', idgham, iqlab…).
 */
export type TajweedClass = 'ghunna' | 'madd' | 'qalqala' | 'silent' | null;

const COMBINING = /[ؐ-ًؚ-ٰٟۖ-ۭ]/;
const QALQALA = new Set(['ق', 'ط', 'ب', 'ج', 'د']);

export function splitClusters(word: string): string[] {
  const out: string[] = [];
  for (const ch of word) {
    if ((COMBINING.test(ch) || ch === 'ـ') && out.length) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

export function classify(cluster: string): TajweedClass {
  const base = cluster[0];
  if (cluster.includes('ٓ')) return 'madd';
  if ((base === 'ن' || base === 'م') && cluster.includes('ّ')) return 'ghunna';
  if (QALQALA.has(base) && cluster.includes('ْ')) return 'qalqala';
  if (base === 'ٱ' || cluster.includes('۟')) return 'silent';
  return null;
}

/** Regroupe les grappes consécutives de même classe. */
export function tajweedSpans(word: string): { text: string; cls: TajweedClass }[] {
  const spans: { text: string; cls: TajweedClass }[] = [];
  for (const c of splitClusters(word)) {
    const cls = classify(c);
    const last = spans[spans.length - 1];
    if (last && last.cls === cls) last.text += c;
    else spans.push({ text: c, cls });
  }
  return spans;
}

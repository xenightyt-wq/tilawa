/**
 * Normalisation de l'arabe pour la COMPARAISON uniquement.
 * Le texte affiché reste toujours le texte Tanzil verbatim.
 */

/** Signes de pause / marques coraniques qui forment parfois un "mot" à part. */
const QURAN_MARK_ONLY = /^[ۖ-ۜ۞۩۝]+$/;

/** Diacritiques (harakat, tanwin, shadda, sukun, madda, hamza suscrite/souscrite),
 *  alef suscrit, petites lettres uthmani, marques de pause, tatweel. */
const STRIP = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

const CHAR_MAP: Record<string, string> = {
  'ٱ': 'ا', // ٱ alef wasla → ا
  'آ': 'ا', // آ
  'أ': 'ا', // أ
  'إ': 'ا', // إ
  'ٲ': 'ا',
  'ٳ': 'ا',
  'ؤ': 'و', // ؤ → و
  'ئ': 'ي', // ئ → ي
  'ى': 'ي', // ى → ي
  'ة': 'ه', // ة → ه
  'ۀ': 'ه', // ۀ → ه
  'ک': 'ك', // ک → ك
  'ی': 'ي', // ی → ي
  'ء': '', // ء isolé : orthographe trop variable, on l'ignore
};

const NON_ARABIC_LETTER = /[^ا-غف-ي]/g;

/** Forme stricte : squelette de lettres unifiées. */
export function normalizeWord(word: string): string {
  let out = '';
  for (const ch of word.replace(STRIP, '')) {
    out += CHAR_MAP[ch] ?? ch;
  }
  return out.replace(NON_ARABIC_LETTER, '');
}

/** Forme souple : on retire aussi les alefs non initiaux (alef suscrit vs plein,
 *  ex. ٱلْعَـٰلَمِين / العالمين / العلمين). */
export function looseForm(norm: string): string {
  if (norm.length <= 2) return norm;
  const loose = norm[0] + norm.slice(1).replace(/ا/g, '');
  return loose.length ? loose : norm;
}

export function isMarkOnly(token: string): boolean {
  return QURAN_MARK_ONLY.test(token);
}

/** Découpe une transcription en mots normalisés (mots vides éliminés). */
export function tokenize(text: string): string[] {
  return text
    .split(/[\s،؛؟.,!?;:()«»"'\-]+/)
    .map(normalizeWord)
    .filter((w) => w.length > 0);
}

/** Distance de Levenshtein (itérative, O(n·m) mémoire O(m)). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

/** Similarité d'un mot entendu avec les formes acceptées d'un mot attendu. */
export function wordSimilarity(heard: string, forms: readonly string[]): number {
  let best = 0;
  const heardLoose = looseForm(heard);
  for (const f of forms) {
    const s = similarity(heard, f);
    if (s > best) best = s;
    if (best === 1) return 1;
    const sl = similarity(heardLoose, looseForm(f)) * 0.97;
    if (sl > best) best = sl;
  }
  return best;
}

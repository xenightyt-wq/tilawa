import { isMarkOnly, normalizeWord, looseForm, similarity } from './arabic';

export interface SuraInfo {
  n: number;
  start: number; // index global du verset 1
  ayas: number;
  order: number;
  rukus: number;
  name: string;
  tname: string;
  ename: string;
  type: string;
  basmala: string | null;
}

export interface QuranData {
  meta: {
    source: string;
    textVersion: string;
    license: string;
    basmala: [string, string];
    copyrightUthmani: string;
    copyrightSimple: string;
  };
  suras: SuraInfo[];
  /** [uthmani, simple-clean], indexé par index global (0..6235) */
  verses: [string, string][];
  juz: number[];
  hizbQuarter: number[];
  page: number[];
  sajda: { index: number; type: string }[];
}

export type OptionalKind = 'istiadha' | 'basmala';

export interface ExpectedWord {
  /** position dans le passage */
  idx: number;
  /** index global du verset, -1 pour les formules optionnelles */
  verse: number;
  sura: number;
  aya: number;
  /** position du mot dans le verset */
  wordInAya: number;
  /** texte uthmani affiché (avec marques de pause attachées) */
  display: string;
  /** formes normalisées acceptées */
  forms: string[];
  optional?: OptionalKind;
  /** dernier mot du verset ? */
  ayaEnd: boolean;
}

export interface Passage {
  /** index global du premier et dernier verset (inclus) */
  from: number;
  to: number;
  words: ExpectedWord[];
}

const ISTIADHA = 'أَعُوذُ بِٱللَّهِ مِنَ ٱلشَّيْطَـٰنِ ٱلرَّجِيمِ';

export function verseRef(data: QuranData, index: number): { sura: number; aya: number } {
  let lo = 0;
  let hi = data.suras.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (data.suras[mid].start <= index) lo = mid;
    else hi = mid - 1;
  }
  return { sura: lo + 1, aya: index - data.suras[lo].start + 1 };
}

export function verseIndex(data: QuranData, sura: number, aya: number): number {
  return data.suras[sura - 1].start + aya - 1;
}

/** Regroupe les tokens uthmani : les marques isolées s'attachent au mot voisin. */
export function displayTokens(uthmani: string): string[] {
  const out: string[] = [];
  let pendingPrefix = '';
  for (const tok of uthmani.split(' ').filter(Boolean)) {
    if (isMarkOnly(tok)) {
      if (out.length && tok !== '۞') out[out.length - 1] += ' ' + tok;
      else pendingPrefix += tok + ' ';
    } else {
      out.push(pendingPrefix + tok);
      pendingPrefix = '';
    }
  }
  return out;
}

/**
 * Associe à chaque mot uthmani la forme "simple" correspondante (orthographe
 * imla'i, proche de la sortie des modèles de reconnaissance). Alignement 1:1,
 * 1:2, 1:3 ou 2:1 (ex. يَـٰٓأَيُّهَا ↔ يا أيها).
 */
export function mapSimpleForms(uthNorm: string[], simpleNorm: string[]): string[][] {
  const n = uthNorm.length;
  const m = simpleNorm.length;
  if (n === m) return uthNorm.map((u, i) => uniq([simpleNorm[i], u]));
  const INF = 1e9;
  const D: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(INF));
  const B: [number, number][][] = Array.from({ length: n + 1 }, () => new Array(m + 1));
  D[0][0] = 0;
  const cost = (a: string, b: string) => 1 - similarity(looseForm(a), looseForm(b));
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (D[i][j] >= INF) continue;
      const steps: [number, number][] = [
        [1, 1],
        [1, 2],
        [1, 3],
        [2, 1],
      ];
      for (const [di, dj] of steps) {
        if (i + di > n || j + dj > m) continue;
        const c =
          D[i][j] +
          cost(uthNorm.slice(i, i + di).join(''), simpleNorm.slice(j, j + dj).join('')) +
          (di + dj > 2 ? 0.05 : 0);
        if (c < D[i + di][j + dj]) {
          D[i + di][j + dj] = c;
          B[i + di][j + dj] = [di, dj];
        }
      }
    }
  }
  const forms: string[][] = new Array(n);
  let i = n;
  let j = m;
  if (D[n][m] >= INF) return uthNorm.map((u) => [u]);
  while (i > 0) {
    const [di, dj] = B[i][j];
    const simple = simpleNorm.slice(j - dj, j).join('');
    for (let k = i - di; k < i; k++) {
      forms[k] = di === 1 ? uniq([simple, uthNorm[k]]) : [uthNorm[k]];
    }
    i -= di;
    j -= dj;
  }
  return forms;
}

function uniq(a: string[]): string[] {
  return [...new Set(a.filter(Boolean))];
}

export interface BuildOptions {
  /** autoriser isti'adha / basmala optionnelles en tête (défaut : oui) */
  optionalPrefix?: boolean;
}

export function buildPassage(
  data: QuranData,
  from: number,
  to: number,
  opts: BuildOptions = {},
): Passage {
  const words: ExpectedWord[] = [];
  const push = (w: Omit<ExpectedWord, 'idx'>) => words.push({ ...w, idx: words.length });
  const first = verseRef(data, from);

  if (opts.optionalPrefix !== false) {
    const optional: [OptionalKind, string][] = [['istiadha', ISTIADHA]];
    const sura = data.suras[first.sura - 1];
    // Basmala optionnelle : en début de sourate (si elle n'est pas un verset),
    // ou en milieu de sourate (certains la récitent), jamais pour at-Tawba.
    if (first.sura !== 9 && !(first.sura === 1 && first.aya === 1)) {
      optional.push(['basmala', sura.basmala ?? data.meta.basmala[0]]);
    }
    for (const [kind, text] of optional) {
      const toks = displayTokens(text);
      toks.forEach((t, k) =>
        push({
          verse: -1,
          sura: first.sura,
          aya: 0,
          wordInAya: k,
          display: t,
          forms: [normalizeWord(t)],
          optional: kind,
          ayaEnd: k === toks.length - 1,
        }),
      );
    }
  }

  for (let v = from; v <= to; v++) {
    const { sura, aya } = verseRef(data, v);
    const [uth, simple] = data.verses[v];
    const disp = displayTokens(uth);
    const uthNorm = disp.map(normalizeWord);
    const simpleNorm = simple.split(' ').map(normalizeWord).filter(Boolean);
    const forms = mapSimpleForms(uthNorm, simpleNorm);
    disp.forEach((d, k) =>
      push({
        verse: v,
        sura,
        aya,
        wordInAya: k,
        display: d,
        forms: forms[k],
        ayaEnd: k === disp.length - 1,
      }),
    );
  }
  return { from, to, words };
}

/** Plage de versets (index globaux inclusifs) pour une division. */
export function rangeOf(
  data: QuranData,
  kind: 'page' | 'juz' | 'hizb' | 'quarter',
  n: number,
): [number, number] {
  const arr =
    kind === 'page' ? data.page : kind === 'juz' ? data.juz : data.hizbQuarter;
  const step = kind === 'hizb' ? 4 : 1;
  const i = kind === 'hizb' ? (n - 1) * 4 : n - 1;
  const start = arr[i];
  const next = arr[i + step];
  return [start, next === undefined ? data.verses.length - 1 : next - 1];
}

/** Numéro de page (1..604) contenant le verset. */
export function pageOf(data: QuranData, index: number): number {
  let p = 0;
  while (p + 1 < data.page.length && data.page[p + 1] <= index) p++;
  return p + 1;
}

export function toArabicDigits(n: number): string {
  return String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
}

import { wordSimilarity } from './arabic';
import type { ExpectedWord } from './quran';

export type OpType = 'match' | 'sub' | 'ins' | 'del';

export interface AlignOp {
  type: OpType;
  /** indices des mots attendus (absolus dans le passage) */
  e: number[];
  /** indices des mots entendus */
  h: number[];
  sim: number;
}

export interface AlignResult {
  ops: AlignOp[];
  cost: number;
  /** index (absolu) du mot attendu qui suit la fin de l'alignement */
  end: number;
}

export interface AlignParams {
  /** similarité minimale pour qu'un mot soit accepté */
  threshold: number;
}

export const THRESHOLDS = { strict: 0.86, lenient: 0.7 } as const;

const COST_SUB = 1;
const COST_INS = 1.05;
/** pénalité par mot quand l'alignement commence avant la position courante */
const COST_BACKREF = 0.04;
const COST_DEL = 1.1;
const COST_JOIN = 0.1;

type Back = 'M' | 'MERGE' | 'SPLIT' | 'I' | 'D' | 'S' | 'R';

/** coût d'un retour en arrière (l'utilisateur reprend quelques mots) */
const COST_REWIND = 0.3;

/**
 * Alignement semi-global de la transcription `hyp` sur les mots attendus
 * `words[winStart..winEnd)`.
 *  - début libre entre winStart et freeUntil (reprise en arrière autorisée
 *    sans pénalité : répéter un passage n'est pas une faute) ;
 *  - fin libre (la transcription couvre un préfixe de ce qui reste) ;
 *  - fusion / coupure de mots (ex. "يا أيها" ↔ "يَـٰٓأَيُّهَا").
 */
export function align(
  words: readonly ExpectedWord[],
  winStart: number,
  winEnd: number,
  freeUntil: number,
  hyp: readonly string[],
  params: AlignParams,
): AlignResult {
  const n = Math.max(0, winEnd - winStart);
  const m = hyp.length;
  const freeLen = Math.min(n, Math.max(0, freeUntil - winStart));
  const INF = 1e9;
  const D: Float64Array[] = [];
  const B: Back[][] = [];
  const RW: Int32Array[] = [];
  for (let i = 0; i <= m; i++) {
    D.push(new Float64Array(n + 1).fill(INF));
    B.push(new Array<Back>(n + 1));
    RW.push(new Int32Array(n + 1));
  }
  const E = (j: number) => words[winStart + j];
  const delCost = (j: number) => (E(j).optional ? 0 : COST_DEL);
  const simCache = new Map<string, number>();
  const sim = (j: number, heard: string) => {
    const key = j + '|' + heard;
    let s = simCache.get(key);
    if (s === undefined) {
      s = wordSimilarity(heard, E(j).forms);
      simCache.set(key, s);
    }
    return s;
  };

  for (let j = 0; j <= n; j++) {
    if (j <= freeLen) {
      D[0][j] = (freeLen - j) * COST_BACKREF;
      B[0][j] = 'S';
    } else {
      D[0][j] = D[0][j - 1] + delCost(j - 1);
      B[0][j] = 'D';
    }
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 0; j <= n; j++) {
      let best = D[i - 1][j] + COST_INS;
      let back: Back = 'I';
      if (j > 0) {
        const s = sim(j - 1, hyp[i - 1]);
        const c = D[i - 1][j - 1] + (s >= params.threshold ? (1 - s) * 0.5 : COST_SUB);
        if (c < best) {
          best = c;
          back = 'M';
        }
        const d = D[i][j - 1] + delCost(j - 1);
        if (d < best) {
          best = d;
          back = 'D';
        }
        if (i > 1) {
          const sm = sim(j - 1, hyp[i - 2] + hyp[i - 1]);
          if (sm >= params.threshold) {
            const cm = D[i - 2][j - 1] + (1 - sm) * 0.5 + COST_JOIN;
            if (cm < best) {
              best = cm;
              back = 'MERGE';
            }
          }
        }
        if (j > 1) {
          const joined = E(j - 2).forms[0] + E(j - 1).forms[0];
          const ss = wordSimilarity(hyp[i - 1], [joined]);
          if (ss >= params.threshold) {
            const cs = D[i - 1][j - 2] + (1 - ss) * 0.5 + COST_JOIN;
            if (cs < best) {
              best = cs;
              back = 'SPLIT';
            }
          }
        }
      }
      D[i][j] = best;
      B[i][j] = back;
    }
    // Retour en arrière : après avoir récité jusqu'à k, reprendre en j < k.
    let runMin = Infinity;
    let runArg = -1;
    for (let j = n; j >= 0; j--) {
      if (runMin + COST_REWIND < D[i][j] - 1e-9) {
        D[i][j] = runMin + COST_REWIND;
        B[i][j] = 'R';
        RW[i][j] = runArg;
      }
      if (D[i][j] < runMin && B[i][j] !== 'R') {
        runMin = D[i][j];
        runArg = j;
      }
    }
    for (let j = 1; j <= n; j++) {
      const d = D[i][j - 1] + delCost(j - 1);
      if (d < D[i][j] - 1e-9) {
        D[i][j] = d;
        B[i][j] = 'D';
      }
    }
  }

  // Fin libre : meilleur coût ; à égalité, on consomme le moins de mots attendus.
  let bestJ = 0;
  for (let j = 1; j <= n; j++) if (D[m][j] < D[m][bestJ] - 1e-9) bestJ = j;

  const ops: AlignOp[] = [];
  let i = m;
  let j = bestJ;
  while (i > 0 || (j > 0 && B[0][j] !== 'S')) {
    const b = B[i][j];
    if (b === 'S') break;
    if (b === 'M') {
      const s = sim(j - 1, hyp[i - 1]);
      ops.push({
        type: s >= params.threshold ? 'match' : 'sub',
        e: [winStart + j - 1],
        h: [i - 1],
        sim: s,
      });
      i--;
      j--;
    } else if (b === 'MERGE') {
      ops.push({
        type: 'match',
        e: [winStart + j - 1],
        h: [i - 2, i - 1],
        sim: sim(j - 1, hyp[i - 2] + hyp[i - 1]),
      });
      i -= 2;
      j--;
    } else if (b === 'SPLIT') {
      ops.push({ type: 'match', e: [winStart + j - 2, winStart + j - 1], h: [i - 1], sim: 1 });
      i--;
      j -= 2;
    } else if (b === 'R') {
      j = RW[i][j];
    } else if (b === 'I') {
      ops.push({ type: 'ins', e: [], h: [i - 1], sim: 0 });
      i--;
    } else {
      ops.push({ type: 'del', e: [winStart + j - 1], h: [], sim: 0 });
      j--;
    }
  }
  ops.reverse();
  return { ops, cost: D[m][bestJ], end: winStart + bestJ };
}

import { align, THRESHOLDS, type AlignOp } from './align';
import { tokenize, wordSimilarity } from './arabic';
import type { ExpectedWord } from './quran';

export type WordState =
  | 'pending'
  | 'tentative'
  | 'correct'
  | 'error'
  | 'corrected'
  | 'skipped'
  | 'hinted'
  | 'optional';

export type ErrorType = 'wrong' | 'missing' | 'extra' | 'ayah_skipped';

export interface RecitationError {
  type: ErrorType;
  /** mot attendu concerné (premier mot pour un groupe) */
  wordIdx: number;
  /** mots attendus concernés */
  words: number[];
  /** ce qui a été entendu (normalisé, sans voyelles) */
  heard?: string;
  /** pour ayah_skipped : premier mot où l'utilisateur a repris */
  jumpTo?: number;
  verse: number;
  at: number;
}

export type CorrectionMode = 'stop' | 'end';
export type Strictness = 'strict' | 'lenient';

export interface TrackerOptions {
  mode: CorrectionMode;
  strictness: Strictness;
  /** logprob moyen en dessous duquel un "final" ne suffit pas à confirmer une faute */
  minConfidence?: number;
}

export interface AsrEvent {
  segment: number;
  text: string;
  final: boolean;
  /** logprob moyen du segment (Whisper), optionnel */
  confidence?: number;
  /** durée du décodage (diagnostic) */
  latencyMs?: number;
}

export interface TrackerUpdate {
  newErrors: RecitationError[];
  /** mode "stop" : une faute vient d'arrêter la récitation */
  stopped: boolean;
  finished: boolean;
}

type Item =
  | { kind: 'ok'; e: number[]; h: number[]; sim: number }
  | { kind: 'opt'; e: number[] }
  | { kind: 'err'; type: ErrorType; e: number[]; h: number[] };

const MAX_BACKREF = 25;

function sigOf(it: Item): string {
  return it.e[0] + '|' + (it.kind === 'err' ? it.type : it.kind);
}
const SKIP_LOOKAHEAD_AYAHS = 5;

export class RecitationTracker {
  readonly words: readonly ExpectedWord[];
  readonly states: WordState[];
  readonly errors: RecitationError[] = [];
  pos = 0;
  stopped = false;
  hints = 0;

  private opts: Required<TrackerOptions>;
  private segment: number | null = null;
  private segAnchor = 0;
  private segBack = 0;
  private prevSig = new Set<string>();
  private tentative = new Set<number>();

  constructor(words: readonly ExpectedWord[], opts: TrackerOptions) {
    this.words = words;
    this.states = words.map(() => 'pending');
    this.opts = { minConfidence: -1.0, ...opts };
  }

  get threshold(): number {
    return THRESHOLDS[this.opts.strictness];
  }

  get finished(): boolean {
    return this.pos >= this.words.length;
  }

  setOptions(opts: Partial<TrackerOptions>) {
    this.opts = { ...this.opts, ...opts };
  }

  /** Début du verset contenant le mot p (ou le dernier mot si p = fin). */
  ayahStart(p: number): number {
    let i = Math.min(p, this.words.length - 1);
    if (i < 0) return 0;
    const v = this.words[i].verse;
    const opt = this.words[i].optional;
    while (i > 0 && this.words[i - 1].verse === v && this.words[i - 1].optional === opt) i--;
    return i;
  }

  private backRefStart(p: number): number {
    if (p <= 0) return 0;
    let s = this.ayahStart(p);
    if (p - s <= 1 && s > 0) s = this.ayahStart(s - 1);
    return Math.max(s, p - MAX_BACKREF);
  }

  /** Reprendre au mot donné (après une faute en mode "stop"). */
  resumeAt(wordIdx: number) {
    const target = Math.max(0, Math.min(wordIdx, this.words.length));
    for (let i = target; i < this.pos; i++) {
      if (this.states[i] === 'correct' || this.states[i] === 'corrected') this.states[i] = 'pending';
    }
    this.pos = target;
    this.stopped = false;
    this.segment = null;
    this.prevSig.clear();
    this.clearTentative();
  }

  /** Révèle le mot attendu (indice). */
  hint(): number | null {
    // Les formules optionnelles (isti'adha, basmala) ne sont pas des indices.
    while (!this.finished && this.words[this.pos].optional) this.states[this.pos++] = 'optional';
    if (this.finished) return null;
    const i = this.pos;
    this.states[i] = 'hinted';
    this.hints++;
    this.pos++;
    this.segment = null;
    this.clearTentative();
    return i;
  }

  private clearTentative() {
    for (const i of this.tentative) if (this.states[i] === 'tentative') this.states[i] = 'pending';
    this.tentative.clear();
  }

  update(evt: AsrEvent, depth = 0): TrackerUpdate {
    const out: TrackerUpdate = { newErrors: [], stopped: false, finished: this.finished };
    if (evt.segment !== this.segment) {
      this.segment = evt.segment;
      this.segAnchor = this.pos;
      this.segBack = this.backRefStart(this.pos);
      this.prevSig.clear();
      this.stopped = false;
    }
    if (this.stopped || this.finished) return out;

    const hypAll = tokenize(evt.text);
    // Le dernier mot d'une transcription partielle est souvent incomplet.
    const hyp = evt.final ? hypAll : hypAll.slice(0, -1);
    this.clearTentative();
    if (!hyp.length) return out;

    const winEnd = Math.min(this.words.length, this.pos + hyp.length * 2 + 12);
    const r = align(this.words, this.segBack, winEnd, this.segAnchor, hyp, {
      threshold: this.threshold,
    });
    const items = this.toItems(r.ops, hyp);
    const sig = new Set<string>(items.map(sigOf));

    const finalTrusted =
      evt.final && (evt.confidence === undefined || evt.confidence >= this.opts.minConfidence);

    for (let k = 0; k < items.length; k++) {
      const it = items[k];
      if (it.e[0] < this.pos) continue;
      if (it.kind === 'opt') {
        // Formule optionnelle non récitée : validée dès qu'un mot suivant l'est.
        if (k === items.length - 1) break;
        for (const e of it.e) this.states[e] = 'optional';
        this.pos = Math.max(this.pos, ...it.e) + 1;
        continue;
      }
      if (it.kind === 'ok') {
        const confirmed =
          evt.final || it.sim >= 0.999 || this.prevSig.has(sigOf(it));
        if (!confirmed) {
          // Affichage provisoire de ce qui suit, sans avancer.
          for (let q = k; q < items.length; q++) {
            const nx = items[q];
            if (nx.kind !== 'ok') break;
            for (const e of nx.e) {
              if (this.states[e] === 'pending') {
                this.states[e] = 'tentative';
                this.tentative.add(e);
              }
            }
          }
          break;
        }
        for (const e of it.e) {
          this.states[e] =
            this.states[e] === 'error' || this.states[e] === 'skipped' ? 'corrected' : 'correct';
        }
        this.pos = Math.max(...it.e) + 1;
        continue;
      }
      // Faute : il faut qu'elle soit confirmée (2 transcriptions successives,
      // ou une transcription finale suffisamment sûre).
      const confirmed = finalTrusted || this.prevSig.has(sigOf(it));
      if (!confirmed) break;
      // En début de verset, un seul mot entendu qui ressemble au début d'un
      // verset suivant : on attend un mot de plus pour distinguer "verset
      // sauté" de "mot erroné" (≈ 0,5 s de plus, uniquement dans ce cas).
      if (
        !evt.final &&
        it.type === 'wrong' &&
        this.words[it.e[0]].wordInAya === 0 &&
        hyp.length - it.h[0] < 2 &&
        this.detectJump(it.e[0], hyp.slice(it.h[0]), 1) !== null
      ) {
        break;
      }
      const err = this.classify(it, hyp);
      this.errors.push(err);
      out.newErrors.push(err);
      if (this.opts.mode === 'stop') {
        if (err.wordIdx < this.words.length) this.states[err.wordIdx] = 'error';
        this.stopped = true;
        out.stopped = true;
        break;
      }
      // Mode "correction à la fin" : on note et on continue.
      if (err.type === 'ayah_skipped' && err.jumpTo !== undefined) {
        for (let e = err.wordIdx; e < err.jumpTo; e++) this.states[e] = 'skipped';
        this.pos = err.jumpTo;
        // Le reste de la transcription est réaligné à partir de là.
        this.segment = null;
        if (depth < 3) {
          const next = this.update(evt, depth + 1);
          out.newErrors.push(...next.newErrors);
          out.finished = next.finished;
          return out;
        }
        break;
      }
      if (err.type === 'extra') {
        if (it.e[0] < this.words.length) this.states[it.e[0]] = 'error';
        continue;
      }
      for (const e of it.e) this.states[e] = 'error';
      this.pos = Math.max(...it.e) + 1;
    }

    this.prevSig = sig;
    out.finished = this.finished;
    return out;
  }

  /** Convertit les opérations d'alignement en éléments (fautes regroupées). */
  private toItems(ops: AlignOp[], hyp: string[]): Item[] {
    const items: Item[] = [];
    let nextE = this.segBack;
    for (const op of ops) {
      if (op.type === 'match') {
        items.push({ kind: 'ok', e: op.e, h: op.h, sim: op.sim });
        nextE = Math.max(...op.e) + 1;
      } else if (op.type === 'sub') {
        items.push({ kind: 'err', type: 'wrong', e: op.e, h: op.h });
        nextE = op.e[0] + 1;
      } else if (op.type === 'del') {
        const w = this.words[op.e[0]];
        const last = items[items.length - 1];
        if (w.optional) {
          if (last?.kind === 'opt') last.e.push(op.e[0]);
          else items.push({ kind: 'opt', e: [op.e[0]] });
        } else if (last?.kind === 'err' && last.type === 'missing') {
          last.e.push(op.e[0]);
        } else {
          items.push({ kind: 'err', type: 'missing', e: [op.e[0]], h: [] });
        }
        nextE = op.e[0] + 1;
      } else {
        // Mot en trop : répétition volontaire si identique à un mot récent.
        const heard = hyp[op.h[0]];
        const lo = Math.max(this.segBack, nextE - 10);
        let repeat = false;
        for (let e = lo; e < Math.min(this.words.length, nextE + 1) && !repeat; e++) {
          repeat = wordSimilarity(heard, this.words[e].forms) >= this.threshold;
        }
        if (!repeat && nextE >= this.pos) {
          items.push({ kind: 'err', type: 'extra', e: [nextE], h: op.h });
        }
      }
    }
    return items;
  }

  private classify(it: Extract<Item, { kind: 'err' }>, hyp: string[]): RecitationError {
    const first = it.e[0];
    const w = this.words[Math.min(first, this.words.length - 1)];
    const base: RecitationError = {
      type: it.type,
      wordIdx: first,
      words: it.e,
      heard: it.h.length ? it.h.map((h) => hyp[h]).join(' ') : undefined,
      verse: w.verse,
      at: Date.now(),
    };
    if (it.type === 'missing') {
      // Un verset entier manquant = verset sauté.
      const lastE = it.e[it.e.length - 1];
      const coversAyah = it.e.some(
        (e) => this.words[e].wordInAya === 0 && this.ayahEnd(e) <= lastE,
      );
      if (coversAyah) return { ...base, type: 'ayah_skipped', jumpTo: lastE + 1 };
      return base;
    }
    if (it.type === 'wrong' && it.h.length) {
      const jump = this.detectJump(first, hyp.slice(it.h[0]));
      if (jump !== null) return { ...base, type: 'ayah_skipped', jumpTo: jump };
    }
    return base;
  }

  private ayahEnd(e: number): number {
    let i = e;
    while (i + 1 < this.words.length && !this.words[i].ayaEnd) i++;
    return i;
  }

  /** La suite entendue correspond-elle au début d'un verset suivant ? */
  private detectJump(from: number, heard: string[], minWords = 2): number | null {
    if (heard.length < minWords) return null;
    let s = this.ayahEnd(from) + 1;
    for (let a = 0; a < SKIP_LOOKAHEAD_AYAHS && s < this.words.length; a++) {
      let ok = 0;
      for (let k = 0; k < Math.min(heard.length, 4) && s + k < this.words.length; k++) {
        if (wordSimilarity(heard[k], this.words[s + k].forms) >= this.threshold) ok++;
        else break;
      }
      if (ok >= Math.min(minWords, heard.length)) return s;
      s = this.ayahEnd(s) + 1;
    }
    return null;
  }

  /** Résumé chiffré de la séance. */
  summary() {
    const scored = this.words.filter((w) => !w.optional);
    const correct = scored.filter((w) => this.states[w.idx] === 'correct').length;
    const perVerse = new Map<number, { errors: number; hints: number; words: number }>();
    for (const w of scored) {
      const v = perVerse.get(w.verse) ?? { errors: 0, hints: 0, words: 0 };
      v.words++;
      const st = this.states[w.idx];
      if (st === 'hinted') v.hints++;
      if (st === 'error' || st === 'corrected' || st === 'skipped') v.errors++;
      perVerse.set(w.verse, v);
    }
    for (const e of this.errors) {
      if (e.type === 'extra' && e.verse >= 0) {
        const v = perVerse.get(e.verse);
        if (v) v.errors++;
      }
    }
    return {
      totalWords: scored.length,
      correctWords: correct,
      accuracy: scored.length ? correct / scored.length : 0,
      errors: this.errors.length,
      hints: this.hints,
      perVerse,
    };
  }
}

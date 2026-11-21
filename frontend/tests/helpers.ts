import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { QuranData } from '../src/core/quran';
import { buildPassage, verseIndex } from '../src/core/quran';
import { RecitationTracker, type TrackerOptions, type TrackerUpdate } from '../src/core/tracker';

let cache: QuranData | null = null;
export function loadQuran(): QuranData {
  cache ??= JSON.parse(
    readFileSync(join(__dirname, '..', 'public', 'data', 'quran.json'), 'utf8'),
  ) as QuranData;
  return cache;
}

export function suraPassage(sura: number, fromAya = 1, toAya?: number) {
  const q = loadQuran();
  const to = toAya ?? q.suras[sura - 1].ayas;
  return buildPassage(q, verseIndex(q, sura, fromAya), verseIndex(q, sura, to));
}

export function makeTracker(sura: number, opts: Partial<TrackerOptions> = {}, from = 1, to?: number) {
  const p = suraPassage(sura, from, to);
  return new RecitationTracker(p.words, { mode: 'stop', strictness: 'strict', ...opts });
}

/**
 * Simule un moteur de streaming : pour chaque segment, envoie des partiels
 * croissants (mot par mot) puis un final.
 */
export function feed(
  t: RecitationTracker,
  segments: string[],
  { firstSegment = 1, partials = true }: { firstSegment?: number; partials?: boolean } = {},
): TrackerUpdate[] {
  const out: TrackerUpdate[] = [];
  segments.forEach((text, k) => {
    const seg = firstSegment + k;
    const words = text.split(' ');
    if (partials) {
      for (let i = 1; i < words.length; i++) {
        out.push(t.update({ segment: seg, text: words.slice(0, i).join(' '), final: false }));
        if (t.stopped) return;
      }
    }
    out.push(t.update({ segment: seg, text, final: true }));
  });
  return out;
}

export const states = (t: RecitationTracker) =>
  t.words.filter((w) => !w.optional).map((w) => t.states[w.idx]);

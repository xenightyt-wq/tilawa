import { newCard, qualityFrom, review, today } from '../core/srs';
import type { RecitationTracker } from '../core/tracker';
import { addSession, getCard, kvSet, putCards, type SessionKind, type SessionRecord } from './db';

/**
 * Enregistre une séance et met à jour la révision espacée des versets
 * effectivement récités (au moins un mot traité).
 */
export async function saveSession(
  tracker: RecitationTracker,
  kind: SessionKind,
  range: { from: number; to: number },
  startedAt: number,
): Promise<SessionRecord | null> {
  const sum = tracker.summary();
  const touched = [...sum.perVerse.entries()].filter(([verse]) =>
    tracker.words.some((w) => w.verse === verse && tracker.states[w.idx] !== 'pending' && tracker.states[w.idx] !== 'tentative'),
  );
  if (!touched.length) return null;
  const attempted = touched.reduce((n, [, v]) => n + v.words, 0);
  const rec: SessionRecord = {
    kind,
    startedAt,
    endedAt: Date.now(),
    from: range.from,
    to: range.to,
    totalWords: sum.totalWords,
    correctWords: sum.correctWords,
    accuracy: attempted ? sum.correctWords / attempted : 0,
    hints: sum.hints,
    completed: tracker.finished,
    errors: tracker.errors
      .filter((e) => e.verse >= 0)
      .map((e) => ({
        type: e.type,
        verse: e.verse,
        word: tracker.words[Math.min(e.wordIdx, tracker.words.length - 1)].wordInAya,
        heard: e.heard,
      })),
  };
  rec.id = await addSession(rec);

  const date = today();
  const cards = [];
  for (const [verse, r] of touched) {
    // Verset entamé mais non terminé : on ne le note que s'il contient une faute.
    const done = tracker.words
      .filter((w) => w.verse === verse)
      .every((w) => !['pending', 'tentative'].includes(tracker.states[w.idx]));
    if (!done && r.errors === 0) continue;
    const card = (await getCard(verse)) ?? newCard(verse, date);
    cards.push(review(card, qualityFrom(r), date));
  }
  await putCards(cards);
  return rec;
}

export async function saveLast(from: number, to: number, kind: SessionKind, mask: string) {
  await kvSet('last', { from, to, kind, mask, at: Date.now() });
}

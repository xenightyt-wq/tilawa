import { describe, expect, it } from 'vitest';
import { addDays, isDue, newCard, qualityFrom, review, suraStatus } from '../src/core/srs';

describe('SM-2 simplifié', () => {
  it('intervalles 1, 6, puis ×EF en cas de succès', () => {
    let c = newCard(0, '2026-01-01');
    c = review(c, 5, '2026-01-01');
    expect(c.interval).toBe(1);
    expect(c.due).toBe('2026-01-02');
    c = review(c, 5, '2026-01-02');
    expect(c.interval).toBe(6);
    c = review(c, 5, '2026-01-08');
    expect(c.interval).toBe(Math.round(6 * 2.7));
  });
  it('une faute fait revenir le verset le lendemain et baisse l\'EF', () => {
    let c = newCard(0, '2026-01-01');
    c = review(review(c, 5, '2026-01-01'), 5, '2026-01-02');
    const ef = c.ef;
    c = review(c, 1, '2026-01-08');
    expect(c.interval).toBe(1);
    expect(c.reps).toBe(0);
    expect(c.lapses).toBe(1);
    expect(c.ef).toBeLessThan(ef);
    expect(isDue(c, '2026-01-09')).toBe(true);
    expect(isDue(c, '2026-01-08')).toBe(false);
  });
  it('EF ne descend pas sous 1.3', () => {
    let c = newCard(0);
    for (let i = 0; i < 20; i++) c = review(c, 0);
    expect(c.ef).toBe(1.3);
  });
  it('qualité selon fautes et indices', () => {
    expect(qualityFrom({ errors: 0, hints: 0, words: 5 })).toBe(5);
    expect(qualityFrom({ errors: 0, hints: 1, words: 5 })).toBe(4);
    expect(qualityFrom({ errors: 1, hints: 0, words: 10 })).toBe(3);
    expect(qualityFrom({ errors: 4, hints: 0, words: 10 })).toBe(1);
  });
  it('addDays gère les fins de mois', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('statut de sourate', () => {
    const good = { ...newCard(0), reps: 2, lastQuality: 5 };
    expect(suraStatus([undefined, undefined])).toBe('unseen');
    expect(suraStatus([good, undefined])).toBe('learning');
    expect(suraStatus([good, { ...good, verse: 1 }])).toBe('acquired');
  });
});

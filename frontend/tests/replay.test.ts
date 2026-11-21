/**
 * Rejoue des flux RÉELS enregistrés depuis le backend (whisper-small-ar-quran,
 * audio EveryAyah diffusé en temps réel) : partiels bruités compris.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeWord as N } from '../src/core/arabic';
import type { AsrEvent } from '../src/core/tracker';
import { makeTracker, states } from './helpers';

const load = (name: string): AsrEvent[] =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', `${name}.json`), 'utf8'));

describe('rejeu de flux réels', () => {
  for (const mode of ['stop', 'end'] as const) {
    it(`Al-Ikhlas (Husary) sans faute — mode ${mode}`, () => {
      const t = makeTracker(112, { mode });
      for (const e of load('ikhlas-husary')) t.update(e);
      expect(t.errors).toEqual([]);
      expect(t.finished).toBe(true);
    });
    it(`Al-Fatiha (Minshawy) sans faute — mode ${mode}`, () => {
      const t = makeTracker(1, { mode });
      for (const e of load('fatiha-minshawy')) t.update(e);
      expect(t.errors).toEqual([]);
      expect(states(t).every((s) => s === 'correct')).toBe(true);
    });
  }
  it('Al-Ikhlas avec le verset 2 sauté : arrêt sur ٱللَّهُ ٱلصَّمَدُ', () => {
    const t = makeTracker(112, { mode: 'stop' });
    for (const e of load('ikhlas-skip-husary')) {
      t.update(e);
      if (t.stopped) break;
    }
    expect(t.errors).toHaveLength(1);
    expect(t.errors[0].type).toBe('ayah_skipped');
    expect(N(t.words[t.errors[0].wordIdx].display)).toBe('الله');
    expect(t.words[t.errors[0].wordIdx].aya).toBe(2);
  });
  it('Al-Ikhlas avec verset sauté — mode fin : 1 faute, fin atteinte', () => {
    const t = makeTracker(112, { mode: 'end' });
    for (const e of load('ikhlas-skip-husary')) t.update(e);
    expect(t.errors.map((e) => e.type)).toEqual(['ayah_skipped']);
    expect(t.finished).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { pcm16ToFloat, SAMPLE_RATE, Segmenter, type Job } from '../src/engine/segmenter';

const SR = SAMPLE_RATE;

function tone(seconds: number, amp = 0.2): Float32Array {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const s = (Math.sin(2 * Math.PI * 180 * t) + Math.sin(2 * Math.PI * 360 * t) + Math.sin(2 * Math.PI * 540 * t)) / 3;
    out[i] = amp * s * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t));
  }
  return out;
}

function silence(seconds: number, amp = 0.001): Float32Array {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  let seed = 7;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    out[i] = amp * ((seed / 2 ** 31) * 2 - 1);
  }
  return out;
}

function cat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function feed(seg: Segmenter, audio: Float32Array, chunkMs = 100): Job[] {
  const step = (SR * chunkMs) / 1000;
  const jobs: Job[] = [];
  for (let k = 0; k < audio.length; k += step) jobs.push(...seg.add(audio.subarray(k, k + step)));
  return jobs;
}

describe('Segmenter (moteur sur l’appareil)', () => {
  it('partiels pendant la parole puis un final après le silence', () => {
    const seg = new Segmenter({ partialMs: 500 });
    const jobs = feed(seg, cat(silence(0.5), tone(2), silence(1)));
    const kinds = jobs.map((j) => j.kind);
    expect(kinds.filter((k) => k === 'final')).toHaveLength(1);
    expect(kinds[kinds.length - 1]).toBe('final');
    expect(kinds.filter((k) => k === 'partial').length).toBeGreaterThanOrEqual(2);
    const secs = jobs[jobs.length - 1].audio.length / SR;
    expect(secs).toBeGreaterThan(2);
    expect(secs).toBeLessThan(3.2);
  });
  it('le silence seul ne produit rien ; deux segments successifs', () => {
    const seg = new Segmenter();
    expect(feed(seg, silence(2))).toEqual([]);
    const finals = feed(seg, cat(tone(1), silence(1), tone(1), silence(1))).filter((j) => j.kind === 'final');
    expect(finals.map((j) => j.segment)).toEqual([0, 1]);
  });
  it('un segment trop long est coupé', () => {
    const seg = new Segmenter({ maxSegmentMs: 3000 });
    expect(feed(seg, tone(7)).filter((j) => j.kind === 'final')).toHaveLength(2);
  });
  it('reset abandonne le segment en cours', () => {
    const seg = new Segmenter();
    feed(seg, tone(1));
    seg.reset();
    expect(seg.segmentMs).toBe(0);
    expect(feed(seg, silence(1))).toEqual([]);
  });
  it('conversion PCM 16 bits', () => {
    const f = pcm16ToFloat(new Int16Array([0, 16384, -32768]).buffer);
    expect(Array.from(f)).toEqual([0, 0.5, -1]);
  });
});

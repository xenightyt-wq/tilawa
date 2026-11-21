/**
 * Découpage du flux micro en segments de parole (portage de
 * backend/app/streaming.py pour l'inférence sur l'appareil).
 *  - VAD par énergie avec plancher de bruit adaptatif
 *  - partiel toutes les `partialMs` pendant la parole, final après `endSilenceMs`
 */
export const SAMPLE_RATE = 16000;
const FRAME_MS = 30;
const FRAME = (SAMPLE_RATE * FRAME_MS) / 1000;

export interface SegmenterOptions {
  partialMs: number;
  endSilenceMs: number;
  maxSegmentMs: number;
  prerollMs: number;
  minPartialMs: number;
}

export const DEFAULT_SEGMENTER: SegmenterOptions = {
  partialMs: 700,
  endSilenceMs: 650,
  maxSegmentMs: 20000,
  prerollMs: 300,
  minPartialMs: 450,
};

export interface Job {
  kind: 'partial' | 'final';
  segment: number;
  audio: Float32Array;
}

export class EnergyVad {
  noiseDb = -60;
  private init = false;
  constructor(
    private marginDb = 9,
    private minSpeechDb = -48,
  ) {}

  static levelDb(f: Float32Array): number {
    let e = 0;
    for (let i = 0; i < f.length; i++) e += f[i] * f[i];
    return 20 * Math.log10(Math.sqrt(e / f.length + 1e-12) + 1e-9);
  }

  isSpeech(f: Float32Array): boolean {
    const db = EnergyVad.levelDb(f);
    if (!this.init) {
      this.noiseDb = Math.min(db, -35);
      this.init = true;
    }
    const speech = db > Math.max(this.noiseDb + this.marginDb, this.minSpeechDb);
    if (db < this.noiseDb) this.noiseDb = 0.7 * this.noiseDb + 0.3 * db;
    else if (!speech) this.noiseDb = 0.98 * this.noiseDb + 0.02 * db;
    return speech;
  }
}

function concat(frames: Float32Array[]): Float32Array {
  const out = new Float32Array(frames.length * FRAME);
  frames.forEach((f, i) => out.set(f, i * FRAME));
  return out;
}

export class Segmenter {
  segment = 0;
  speaking = false;
  opts: SegmenterOptions;
  private vad = new EnergyVad();
  private carry = new Float32Array(0);
  private preroll: Float32Array[] = [];
  private frames: Float32Array[] = [];
  private inSpeech = false;
  private run = 0;
  private silenceMs = 0;
  private sinceDecodeMs = 0;

  constructor(opts: Partial<SegmenterOptions> = {}) {
    this.opts = { ...DEFAULT_SEGMENTER, ...opts };
  }

  get segmentMs(): number {
    return this.frames.length * FRAME_MS;
  }

  reset(): void {
    this.segment++;
    this.frames = [];
    this.inSpeech = false;
    this.run = 0;
    this.silenceMs = 0;
    this.sinceDecodeMs = 0;
    this.speaking = false;
    this.preroll = [];
  }

  flush(): Job[] {
    if (this.inSpeech && this.frames.length) {
      const job: Job = { kind: 'final', segment: this.segment, audio: concat(this.frames) };
      this.reset();
      return [job];
    }
    this.reset();
    return [];
  }

  add(samples: Float32Array): Job[] {
    const data = new Float32Array(this.carry.length + samples.length);
    data.set(this.carry);
    data.set(samples, this.carry.length);
    const n = Math.floor(data.length / FRAME) * FRAME;
    this.carry = data.slice(n);
    const jobs: Job[] = [];
    for (let k = 0; k < n; k += FRAME) {
      const frame = data.slice(k, k + FRAME);
      const job = this.step(frame, this.vad.isSpeech(frame));
      if (job) jobs.push(job);
    }
    return jobs;
  }

  private step(frame: Float32Array, speech: boolean): Job | null {
    const o = this.opts;
    if (!this.inSpeech) {
      this.preroll.push(frame);
      if (this.preroll.length > o.prerollMs / FRAME_MS) this.preroll.shift();
      this.run = speech ? this.run + 1 : 0;
      if (this.run >= 3) {
        this.inSpeech = true;
        this.speaking = true;
        this.frames = this.preroll;
        this.preroll = [];
        this.silenceMs = 0;
        this.sinceDecodeMs = 0;
      }
      return null;
    }
    this.frames.push(frame);
    this.sinceDecodeMs += FRAME_MS;
    if (speech) {
      this.silenceMs = 0;
      this.speaking = true;
    } else {
      this.silenceMs += FRAME_MS;
      if (this.silenceMs >= 200) this.speaking = false;
    }
    if (this.silenceMs >= o.endSilenceMs || this.segmentMs >= o.maxSegmentMs) {
      const job: Job = { kind: 'final', segment: this.segment, audio: concat(this.frames) };
      this.reset();
      return job;
    }
    if (this.sinceDecodeMs >= o.partialMs && this.segmentMs >= o.minPartialMs && this.silenceMs < 300) {
      this.sinceDecodeMs = 0;
      return { kind: 'partial', segment: this.segment, audio: concat(this.frames) };
    }
    return null;
  }
}

export function pcm16ToFloat(buf: ArrayBuffer): Float32Array {
  const i16 = new Int16Array(buf);
  const out = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) out[i] = i16[i] / 32768;
  return out;
}

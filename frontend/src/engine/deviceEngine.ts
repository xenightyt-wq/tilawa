import { MicError, openMic, type MicCapture } from './mic';
import type { EngineHandlers, RecognitionEngine } from './types';
import type { WorkerIn, WorkerOut } from './asr.worker';

export const DEVICE_MODELS = [
  { id: 'whisper-base-ar-quran', sizeMb: 95, label: 'Tarteel base (recommandé)' },
  { id: 'whisper-tiny-ar-quran', sizeMb: 47, label: 'Tarteel tiny (rapide, moins fiable)' },
] as const;

/** Un seul worker pour toute l'app : le modèle reste chargé entre les écrans. */
let shared: { worker: Worker; model: string; ready: Promise<{ device: string }> } | null = null;
let listener: ((m: WorkerOut) => void) | null = null;
let progressListener: ((loaded: number, total: number) => void) | null = null;

function getWorker(model: string) {
  if (shared && shared.model === model) return shared;
  shared?.worker.terminate();
  const worker = new Worker(new URL('./asr.worker.ts', import.meta.url), { type: 'module' });
  const files = new Map<string, { loaded: number; total: number }>();
  const ready = new Promise<{ device: string }>((resolve, reject) => {
    worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
      const m = ev.data;
      if (m.type === 'progress') {
        files.set(m.file, { loaded: m.loaded, total: m.total });
        let l = 0;
        let t = 0;
        for (const f of files.values()) {
          l += f.loaded;
          t += f.total;
        }
        progressListener?.(l, t);
      } else if (m.type === 'ready') resolve({ device: m.device });
      else if (m.type === 'error' && !readyDone) reject(new MicError('server-error', m.message));
      listener?.(m);
    };
  });
  let readyDone = false;
  void ready.then(
    () => (readyDone = true),
    () => {
      readyDone = true;
      shared = null;
    },
  );
  worker.postMessage({ type: 'init', model, device: 'auto' } satisfies WorkerIn);
  shared = { worker, model, ready };
  return shared;
}

/** Précharge le modèle (téléchargement unique, puis cache hors ligne). */
export function preloadModel(model: string, onProgress?: (loaded: number, total: number) => void) {
  progressListener = onProgress ?? null;
  return getWorker(model).ready;
}

/**
 * Reconnaissance entièrement sur l'appareil : micro → Worker (VAD + Whisper
 * ONNX). Aucune donnée audio ne sort du téléphone.
 */
export class DeviceEngine implements RecognitionEngine {
  readonly kind = 'device' as const;
  private mic: MicCapture | null = null;
  private h: EngineHandlers | null = null;
  private segBase = 0;
  private lastSeg = 0;

  constructor(private model: string = DEVICE_MODELS[0].id) {}

  async start(h: EngineHandlers): Promise<void> {
    this.h = h;
    h.onStatus('connecting');
    const w = getWorker(this.model);
    progressListener = (l, t) => h.onProgress?.(l, t);
    const { device } = await w.ready;
    progressListener = null;
    h.onStatus('connecting', { model: this.model, device });
    this.segBase = this.lastSeg + 1;
    listener = (m) => this.onMessage(m);
    w.worker.postMessage({ type: 'reset' } satisfies WorkerIn);
    this.mic = await openMic((pcm, peak) => {
      h.onLevel?.(peak);
      w.worker.postMessage({ type: 'audio', pcm } satisfies WorkerIn, [pcm]);
    });
    h.onStatus('listening', { model: this.model, device });
  }

  private onMessage(m: WorkerOut) {
    const h = this.h;
    if (!h) return;
    if (m.type === 'partial' || m.type === 'final') {
      // Les numéros de segment du worker continuent entre deux écoutes.
      const segment = this.segBase + m.segment;
      this.lastSeg = Math.max(this.lastSeg, segment);
      h.onTranscript({ segment, text: m.text, final: m.type === 'final' });
    } else if (m.type === 'vad') h.onSpeaking?.(m.speaking);
    else if (m.type === 'error') h.onError('server-error', m.message);
  }

  resetSegment(): void {
    shared?.worker.postMessage({ type: 'reset' } satisfies WorkerIn);
  }

  async stop(): Promise<void> {
    if (this.mic) {
      this.mic.stop();
      this.mic = null;
      shared?.worker.postMessage({ type: 'flush' } satisfies WorkerIn);
      await new Promise((r) => setTimeout(r, 1200));
    }
    listener = null;
    this.h?.onStatus('idle');
  }
}

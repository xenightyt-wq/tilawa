/// <reference lib="webworker" />
/**
 * Reconnaissance vocale SUR L'APPAREIL (Web Worker) : Whisper affiné Coran
 * au format ONNX, exécuté par transformers.js (WebGPU si disponible, sinon
 * WebAssembly). L'audio ne quitte jamais le téléphone.
 *
 * Messages entrants : init | audio | reset | flush
 * Messages sortants : progress | ready | error | vad | partial | final
 */
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import { pcm16ToFloat, Segmenter, type Job } from './segmenter';

declare const self: DedicatedWorkerGlobalScope;

export type WorkerIn =
  | { type: 'init'; model: string; device: 'auto' | 'hybrid' | 'webgpu' | 'wasm' }
  | { type: 'audio'; pcm: ArrayBuffer }
  | { type: 'reset' }
  | { type: 'flush' };

export type WorkerOut =
  | { type: 'progress'; file: string; loaded: number; total: number }
  | { type: 'ready'; model: string; device: string; loadMs: number }
  | { type: 'error'; message: string }
  | { type: 'vad'; speaking: boolean }
  | { type: 'partial' | 'final'; segment: number; text: string; latencyMs: number; audioMs: number };

env.allowRemoteModels = false;
env.allowLocalModels = true;
// Chemin relatif (pas d'URL complète) : sinon transformers.js ne détecte pas
// les fichiers locaux optionnels comme preprocessor_config.json.
env.localModelPath = '/models/';
env.useBrowserCache = true;
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = new URL('/ort/', self.location.origin).href;
}

let asr: AutomaticSpeechRecognitionPipeline | null = null;
let loading: Promise<void> | null = null;
const seg = new Segmenter();
let finals: Job[] = [];
let partial: Job | null = null;
let busy = false;
let speaking = false;
let lastLatency = 0;

const post = (m: WorkerOut) => self.postMessage(m);

async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

type Mod = 'encoder_model' | 'decoder_model_merged';
type Profile = { name: string; device: Record<Mod, 'webgpu' | 'wasm'>; dtype: Record<Mod, string> };

/** Profils d'exécution, du plus rapide au plus compatible. */
const PROFILES: Record<string, Profile> = {
  // Encodeur (calcul lourd, constant) sur la puce graphique, décodeur sur le CPU.
  hybrid: {
    name: 'webgpu+wasm',
    device: { encoder_model: 'webgpu', decoder_model_merged: 'wasm' },
    dtype: { encoder_model: 'fp16', decoder_model_merged: 'q8' },
  },
  webgpu: {
    name: 'webgpu',
    device: { encoder_model: 'webgpu', decoder_model_merged: 'webgpu' },
    dtype: { encoder_model: 'fp16', decoder_model_merged: 'fp16' },
  },
  wasm: {
    name: 'wasm',
    device: { encoder_model: 'wasm', decoder_model_merged: 'wasm' },
    dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
  },
};

async function load(model: string, want: string) {
  const t0 = performance.now();
  const gpu = await hasWebGpu();
  const order = want === 'auto' ? (gpu ? ['hybrid', 'wasm'] : ['wasm']) : [want];
  const progress = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status === 'progress' && p.file) post({ type: 'progress', file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0 });
  };
  let lastErr: unknown;
  for (const key of order) {
    const prof = PROFILES[key];
    try {
      asr = (await pipeline('automatic-speech-recognition', model, {
        device: prof.device,
        dtype: prof.dtype,
        progress_callback: progress,
      } as never)) as AutomaticSpeechRecognitionPipeline;
      return finishLoad(model, prof.name, t0);
    } catch (e) {
      // Certains appareils annoncent WebGPU mais échouent : profil suivant.
      lastErr = e;
    }
  }
  throw lastErr;
}

async function finishLoad(model: string, device: string, t0: number) {
  await asr!(new Float32Array(16000), { language: 'arabic', task: 'transcribe' }); // préchauffage
  // Intervalle des partiels adapté à la vitesse de l'appareil
  post({ type: 'ready', model, device, loadMs: Math.round(performance.now() - t0) });
}

function enqueue(jobs: Job[]) {
  for (const j of jobs) {
    if (j.kind === 'final') {
      finals.push(j);
      if (partial?.segment === j.segment) partial = null;
    } else partial = j;
  }
  void pump();
}

async function pump() {
  if (busy || !asr) return;
  busy = true;
  try {
    while (finals.length || partial) {
      const job = finals.length ? finals.shift()! : partial!;
      if (job === partial) partial = null;
      if (job.kind === 'partial' && job.segment !== seg.segment) continue;
      const t0 = performance.now();
      const out = (await asr(job.audio, { language: 'arabic', task: 'transcribe' })) as { text: string };
      lastLatency = performance.now() - t0;
      // Appareil lent : on espace les partiels pour garder le rythme.
      seg.opts.partialMs = Math.max(600, Math.min(2000, lastLatency * 1.3));
      post({
        type: job.kind,
        segment: job.segment,
        text: out.text.trim(),
        latencyMs: Math.round(lastLatency),
        audioMs: Math.round((job.audio.length / 16000) * 1000),
      });
    }
  } catch (e) {
    post({ type: 'error', message: String(e) });
  } finally {
    busy = false;
  }
}

self.onmessage = async (ev: MessageEvent<WorkerIn>) => {
  const m = ev.data;
  try {
    if (m.type === 'init') {
      loading ??= load(m.model, m.device);
      await loading;
    } else if (m.type === 'audio') {
      enqueue(seg.add(pcm16ToFloat(m.pcm)));
      if (seg.speaking !== speaking) {
        speaking = seg.speaking;
        post({ type: 'vad', speaking });
      }
    } else if (m.type === 'reset') {
      seg.reset();
      finals = [];
      partial = null;
    } else if (m.type === 'flush') {
      enqueue(seg.flush());
    }
  } catch (e) {
    loading = null;
    post({ type: 'error', message: String(e) + ((e as Error).stack ? '\n' + (e as Error).stack : '') });
  }
};

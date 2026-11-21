#!/usr/bin/env node
/**
 * Banc d'essai des modèles au format navigateur (transformers.js / ONNX),
 * mêmes mesures que backend/scripts/benchmark.py.
 *
 *   node scripts/bench-onnx.mjs whisper-base-ar-quran q8
 *
 * Prérequis : backend/.bench-cache/raw (généré depuis le cache du banc Python).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, pipeline } from '@huggingface/transformers';
import { tokenize } from '../src/core/arabic.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, '..', '..', 'backend', '.bench-cache', 'raw');
const quran = JSON.parse(readFileSync(join(HERE, '..', 'public', 'data', 'quran.json'), 'utf8'));
const [model = 'whisper-base-ar-quran', dtype = 'q8'] = process.argv.slice(2);

env.localModelPath = join(HERE, '..', 'public', 'models');
env.allowRemoteModels = false;

const asr = await pipeline('automatic-speech-recognition', model, { dtype, device: 'cpu' });
const idx = JSON.parse(readFileSync(join(RAW, 'index.json'), 'utf8'));
const audio = (r, s, a) => {
  const b = readFileSync(join(RAW, `${r}_${String(s).padStart(3, '0')}${String(a).padStart(3, '0')}.f32`));
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
};
const ref = (s, a) => tokenize(quran.verses[quran.suras[s - 1].start + a - 1][1]);

function wer(r, h) {
  let prev = Array.from({ length: h.length + 1 }, (_, j) => j);
  for (let i = 1; i <= r.length; i++) {
    const cur = [i];
    for (let j = 1; j <= h.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r[i - 1] !== h[j - 1] ? 1 : 0));
    prev = cur;
  }
  return prev[h.length];
}

let seed = 1;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
function noisy(x) {
  const n = Math.floor((x.length - 1) / 1.08);
  const y = new Float32Array(n);
  let e = 0;
  for (let i = 0; i < x.length; i++) e += x[i] * x[i];
  const sd = Math.sqrt(e / x.length) / 3.16;
  for (let i = 0; i < n; i++) {
    const p = i * 1.08;
    const k = Math.floor(p);
    y[i] = x[k] + (x[k + 1] - x[k]) * (p - k) + sd * gauss();
  }
  return y;
}

async function run(x) {
  const t0 = performance.now();
  const out = await asr(x, { language: 'arabic', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
  return { hyp: tokenize(out.text), ms: performance.now() - t0 };
}

await run(new Float32Array(16000)); // préchauffage
let errs = 0, nerrs = 0, n = 0;
const lat = [];
for (const r of idx.reciters)
  for (const [s, a] of idx.verses) {
    const x = audio(r, s, a);
    const { hyp, ms } = await run(x);
    errs += wer(ref(s, a), hyp);
    n += ref(s, a).length;
    lat.push(ms / (x.length / 16000));
    nerrs += wer(ref(s, a), (await run(noisy(x))).hyp);
  }
const x3 = audio(idx.reciters[0], 2, 255).slice(0, 3 * 16000);
const l3 = [];
for (let i = 0; i < 3; i++) l3.push((await run(x3)).ms);

let inv = 0, trials = 0;
for (const r of idx.reciters)
  for (const [s, a] of idx.verses) {
    const full = ref(s, a);
    if (full.length < 4) continue;
    const x = audio(r, s, a);
    const { hyp } = await run(x.slice(0, Math.floor(x.length * 0.55)));
    trials++;
    if (hyp.slice(-2).join() === full.slice(-2).join()) inv++;
  }

console.log(
  JSON.stringify({
    model,
    dtype,
    wer: +((100 * errs) / n).toFixed(2),
    wer_noisy: +((100 * nerrs) / n).toFixed(2),
    latency_3s_ms_cpu_node: Math.round(l3.sort((a, b) => a - b)[1]),
    ms_per_audio_s: Math.round(lat.reduce((a, b) => a + b) / lat.length),
    invented_endings: `${inv}/${trials}`,
  }),
);

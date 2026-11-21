#!/usr/bin/env node
/** Copie les fichiers d'exécution ONNX Runtime Web (WebAssembly/WebGPU) dans
 *  frontend/public/ort/ : l'app ne dépend d'aucun CDN et marche hors ligne. */
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONT = join(dirname(fileURLToPath(import.meta.url)), '..', 'frontend');
const SRC = join(FRONT, 'node_modules', 'onnxruntime-web', 'dist');
const OUT = join(FRONT, 'public', 'ort');
await mkdir(OUT, { recursive: true });
const files = (await readdir(SRC)).filter((f) => /^ort-wasm-simd-threaded\.(jsep|asyncify)?\.?(mjs|wasm)$/.test(f));
for (const f of files) await copyFile(join(SRC, f), join(OUT, f));
console.log(`ONNX Runtime : ${files.length} fichiers copiés dans public/ort`);

#!/usr/bin/env node
/**
 * Génère les icônes de la PWA (SVG + PNG 192/512/maskable/apple-touch)
 * sans dépendance : rasterisation simple avec suréchantillonnage.
 * Motif : étoile à 8 branches (deux carrés superposés) sur fond vert.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'public', 'icons');
const BG = [15, 92, 77];
const FG = [246, 243, 234];

function star(cx, cy, r) {
  const pts = (rot) =>
    [0, 1, 2, 3].map((k) => {
      const a = rot + (k * Math.PI) / 2;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    });
  return [pts(Math.PI / 4), pts(0)];
}

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 0 = fond, 1 = étoile, 2 = cercle central (couleur du fond) */
function shape(x, y, size, { rounded, scale }) {
  const c = size / 2;
  const R = (size / 2) * 0.62 * scale;
  if (rounded) {
    const rr = size * 0.22;
    const dx = Math.max(rr - x, 0, x - (size - rr));
    const dy = Math.max(rr - y, 0, y - (size - rr));
    if (dx * dx + dy * dy > rr * rr) return -1; // transparent
  }
  const d = Math.hypot(x - c, y - c);
  if (d < R * 0.36) return d < R * 0.26 ? 1 : 2;
  const [a, b] = star(c, c, R);
  return inPoly(x, y, a) || inPoly(x, y, b) ? 1 : 0;
}

function png(size, opts) {
  const SS = 4;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const s = shape(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS, size, opts);
          if (s < 0) continue;
          const col = s === 1 ? FG : BG;
          r += col[0];
          g += col[1];
          b += col[2];
          a += 255;
        }
      const n = SS * SS;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const cov = a / 255;
      raw[o] = cov ? r / cov : 0;
      raw[o + 1] = cov ? g / cov : 0;
      raw[o + 2] = cov ? b / cov : 0;
      raw[o + 3] = a / n;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return ~c;
}

function svg() {
  const [a, b] = star(50, 50, 31);
  const p = (pts) => pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="22" fill="#0f5c4d"/>
<polygon points="${p(a)}" fill="#f6f3ea"/><polygon points="${p(b)}" fill="#f6f3ea"/>
<circle cx="50" cy="50" r="11.2" fill="#0f5c4d"/><circle cx="50" cy="50" r="8" fill="#f6f3ea"/>
</svg>
`;
}

await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'icon.svg'), svg());
await writeFile(join(OUT, 'icon-192.png'), png(192, { rounded: true, scale: 1 }));
await writeFile(join(OUT, 'icon-512.png'), png(512, { rounded: true, scale: 1 }));
await writeFile(join(OUT, 'icon-maskable-512.png'), png(512, { rounded: false, scale: 0.75 }));
await writeFile(join(OUT, 'apple-touch-icon.png'), png(180, { rounded: false, scale: 0.85 }));
console.log('Icônes générées dans', OUT);

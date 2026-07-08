//? F4 — generate the PWA app icons (192/512 + a padded maskable 512 + an iOS apple-touch 180) from an inline
//? SVG brand mark, so the installed app has a real home-screen icon (the manifest previously shipped only a
//? 48x48 favicon → poor installability). Run: `node scripts/genPwaIcons.mjs`. Deterministic; safe to re-run.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const BG0 = '#14141b';
const BG1 = '#0b0b0f';
const FG = '#f4f4f4';
const ACCENT = '#6366f1';

//? The brand mark: a rounded-square with a subtle vertical gradient + an accent underline + a bold "W".
//? `inset` shrinks the art into the maskable safe zone (central ~80%) so nothing is cropped by the OS mask.
function markSvg(size, { maskable = false } = {}) {
  const s = size;
  const inset = maskable ? Math.round(s * 0.12) : 0; // extra padding for the maskable safe zone
  const box = s - inset * 2;
  const r = Math.round(box * (maskable ? 0.5 : 0.22)); // full-bleed circle-ish for maskable, rounded-square otherwise
  const fontSize = Math.round(box * 0.56);
  const cx = s / 2;
  const cy = s / 2;
  const bar = Math.round(box * 0.09);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${BG0}"/>
      <stop offset="1" stop-color="${BG1}"/>
    </linearGradient>
  </defs>
  ${maskable ? `<rect width="${s}" height="${s}" fill="${BG1}"/>` : ''}
  <rect x="${inset}" y="${inset}" width="${box}" height="${box}" rx="${r}" ry="${r}" fill="url(#g)"/>
  <text x="${cx}" y="${cy}" font-family="Segoe UI, Arial, sans-serif" font-size="${fontSize}" font-weight="800" fill="${FG}" text-anchor="middle" dominant-baseline="central">W</text>
  <rect x="${cx - box * 0.18}" y="${cy + fontSize * 0.42}" width="${box * 0.36}" height="${bar}" rx="${bar / 2}" fill="${ACCENT}"/>
</svg>`;
}

async function emit(name, size, opts) {
  const out = path.join(PUBLIC, name);
  await sharp(Buffer.from(markSvg(size, opts))).png().toFile(out);
  console.log(`[pwa-icons] wrote public/${name} (${String(size)}x${String(size)})`);
}

await emit('pwa-192.png', 192, {});
await emit('pwa-512.png', 512, {});
await emit('pwa-maskable-512.png', 512, { maskable: true });
await emit('apple-touch-icon.png', 180, {});
console.log('[pwa-icons] done');

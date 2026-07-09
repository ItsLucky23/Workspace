//? F4 — PWA installability: the web manifest is valid JSON with the install-critical fields + real 192/512 PNG
//? icons (+ a maskable variant) that actually exist on disk at the declared sizes, the apple-touch-icon is
//? present, and index.html links both. Headless (no browser) — asserts the artifacts Chrome's install
//? criteria check. Uses `sharp` (already a dep) to confirm the real pixel dimensions of each icon.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

import { assert, eq, report } from '../_helpers.mts';

const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, 'public');

const manifest = JSON.parse(readFileSync(path.join(PUBLIC, 'manifest.webmanifest'), 'utf8')) as {
  name?: string; short_name?: string; start_url?: string; display?: string; icons?: { src: string; sizes: string; type: string; purpose?: string }[];
};

// 1) install-critical manifest fields
assert(typeof manifest.name === 'string' && manifest.name.length > 0, 'manifest has a name');
assert(manifest.display === 'standalone', 'display is standalone (installable)');
assert(typeof manifest.start_url === 'string', 'manifest has a start_url');

const icons = manifest.icons ?? [];
const png = icons.filter((i) => i.type === 'image/png');
assert(png.some((i) => i.sizes === '192x192'), 'manifest declares a 192x192 PNG icon');
assert(png.some((i) => i.sizes === '512x512'), 'manifest declares a 512x512 PNG icon');
assert(png.some((i) => (i.purpose ?? '').includes('maskable')), 'manifest declares a maskable icon');

// 2) every declared icon file exists + matches its declared pixel size
for (const icon of png) {
  const file = path.join(PUBLIC, icon.src.replace(/^\//, ''));
  assert(existsSync(file), `icon file exists: ${icon.src}`);
  const meta = await sharp(file).metadata();
  const [w] = icon.sizes.split('x').map(Number);
  eq(meta.width, w, `${icon.src} is really ${icon.sizes}`);
  eq(meta.height, w, `${icon.src} is square`);
}

// 3) apple-touch-icon exists (180) + index.html links the manifest + apple-touch-icon
assert(existsSync(path.join(PUBLIC, 'apple-touch-icon.png')), 'apple-touch-icon.png exists');
const appleMeta = await sharp(path.join(PUBLIC, 'apple-touch-icon.png')).metadata();
eq(appleMeta.width, 180, 'apple-touch-icon is 180x180');

const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
assert(html.includes('rel="manifest"'), 'index.html links the manifest');
assert(html.includes('rel="apple-touch-icon"'), 'index.html links the apple-touch-icon');

report('tests/unit/pwaManifest.test.mts');

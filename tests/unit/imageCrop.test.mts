//? B1 — pure crop/resize geometry. No canvas, no providers: verifies clampCropRegion (clamp + invert +
//? degenerate rejection) and resizeDimensions (shrink-only, aspect-preserving).

import { clampCropRegion, resizeDimensions, RESIZE_PRESETS } from '../../src/workspaces/_functions/imageCrop.ts';
import { assert, eq, report } from '../_helpers.mts';

//? A rect fully inside the canvas passes through (rounded).
eq(clampCropRegion({ left: 10, top: 20, width: 100, height: 60 }, 640, 480), { left: 10, top: 20, width: 100, height: 60 }, 'in-bounds rect kept');

//? An inverted selection (dragged up-left, negative width/height) is normalised.
eq(clampCropRegion({ left: 110, top: 80, width: -100, height: -60 }, 640, 480), { left: 10, top: 20, width: 100, height: 60 }, 'inverted rect normalised');

//? A rect spilling past the edges is clamped to the canvas.
eq(clampCropRegion({ left: -50, top: -50, width: 200, height: 200 }, 640, 480), { left: 0, top: 0, width: 150, height: 150 }, 'out-of-bounds rect clamped');

//? A rect starting inside and spilling off the far edge is clamped to the canvas size.
eq(clampCropRegion({ left: 600, top: 460, width: 200, height: 200 }, 640, 480), { left: 600, top: 460, width: 40, height: 20 }, 'far-edge spill clamped');

//? A degenerate (<2px) region returns null so the editor falls back to no-crop.
assert(clampCropRegion({ left: 10, top: 10, width: 1, height: 50 }, 640, 480) === null, 'sub-2px width → null');
assert(clampCropRegion({ left: 700, top: 10, width: 50, height: 50 }, 640, 480) === null, 'fully off-canvas → null');

//? Resize shrinks proportionally; never upscales; null/original leaves size intact.
eq(resizeDimensions(1920, 1080, 1080), { width: 1080, height: 608 }, 'shrink keeps aspect');
eq(resizeDimensions(800, 600, 1080), { width: 800, height: 600 }, 'target > source → unchanged (no upscale)');
eq(resizeDimensions(800, 600, null), { width: 800, height: 600 }, 'null target → unchanged');
eq(resizeDimensions(1000, 500, 512), { width: 512, height: 256 }, '2:1 shrink preserved');

//? The presets are the four the UI offers, original first.
assert(RESIZE_PRESETS.length === 4 && RESIZE_PRESETS[0].width === null, 'four presets, original first');

report('tests/unit/imageCrop.test.mts');

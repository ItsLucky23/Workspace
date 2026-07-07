//? Unit test for V4 (IDEA_TO_OUTCOME) — scenesInRange. Pure. Verifies a selected time range maps to the right
//? scene(s) on a cumulative timeline (the "select seconds 13–18 → refine" mapping).

import { assert, eq, report } from '../_helpers.mts';
import { scenesInRange } from '../../server/content/sceneRefine';

//? Three 15s scenes → timeline [0-15), [15-30), [30-45) seconds.
const scenes = [
  { id: 'a', order: 0, durationMs: 15_000 },
  { id: 'b', order: 1, durationMs: 15_000 },
  { id: 'c', order: 2, durationMs: 15_000 },
];

try {
  //? 13–18s straddles scene a (0-15) and scene b (15-30).
  const straddle = scenesInRange(scenes, 13_000, 18_000);
  eq(straddle.length, 2, '13–18s covers two scenes');
  eq(straddle.map((s) => s.id).join(','), 'a,b', 'it is scenes a + b');
  eq(straddle[0]?.startMs, 0, 'scene a starts at 0');
  eq(straddle[1]?.startMs, 15_000, 'scene b starts at 15s');

  //? 16–17s is fully inside scene b.
  const inside = scenesInRange(scenes, 16_000, 17_000);
  eq(inside.length, 1, '16–17s covers one scene');
  eq(inside[0]?.id, 'b', 'it is scene b');

  //? 40–50s overlaps scene c (30-45) only.
  const tail = scenesInRange(scenes, 40_000, 50_000);
  eq(tail.length, 1, '40–50s covers the last scene');
  eq(tail[0]?.id, 'c', 'it is scene c');

  //? A boundary-touching range [15,15) is empty (half-open); a range past the end is empty.
  eq(scenesInRange(scenes, 100_000, 120_000).length, 0, 'a range past the timeline is empty');
  //? Unordered input is handled (sorted by order first).
  const rev = scenesInRange([scenes[2], scenes[0], scenes[1]], 0, 1000);
  eq(rev[0]?.id, 'a', 'unordered input is mapped by order (first scene = a)');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
}

report('tests/unit/sceneRange.test.mts');

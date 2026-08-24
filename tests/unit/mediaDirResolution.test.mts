//? Regression test for server/media/store.ts MEDIA_DIR — an ABSOLUTE WS_MEDIA_DIR must be used as-is.
//? The old `path.join(cwd, env)` glued the two together, so `/var/lib/workspaces/media` silently became
//? `<app-dir>/var/lib/workspaces/media` in production (all pi5 media landed inside the app tree,
//? found 2026-08-24). `path.resolve` roots the absolute value correctly; a relative value stays
//? cwd-relative. Env is set BEFORE the dynamic import because MEDIA_DIR is computed at module load.

import path from 'node:path';

import { assert, eq, report } from '../_helpers.mts';

process.env.WS_MEDIA_DIR = '/var/lib/workspaces/media-test';
const { MEDIA_DIR, MEDIA_QUARANTINE_DIR } = await import('../../server/media/store.ts');

// 1) the absolute env value is respected, not appended to cwd
{
  eq(MEDIA_DIR, path.resolve('/var/lib/workspaces/media-test'), 'absolute WS_MEDIA_DIR is used as-is');
  assert(!MEDIA_DIR.startsWith(process.cwd() + path.sep), 'MEDIA_DIR is not nested inside the app dir');
  assert(path.isAbsolute(MEDIA_DIR), 'MEDIA_DIR is absolute');
}

// 2) derived dirs live under the resolved root
{
  eq(MEDIA_QUARANTINE_DIR, path.join(MEDIA_DIR, '.quarantine'), 'quarantine dir hangs under the resolved root');
}

report('tests/unit/mediaDirResolution.test.mts');

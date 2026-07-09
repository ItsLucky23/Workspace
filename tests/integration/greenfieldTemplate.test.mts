//? S2 — greenfield from a template yields a real, RUNNABLE, committed repo (not a shell). Runs the actual
//? `initGreenfieldRepo` (real git) on the Go template into a throwaway workspace dir, then verifies the bare repo
//? holds the seeded source + the S2 `.workspaces/Dockerfile` + `.workspaces/ci.yml`, all on a single `main`
//? commit. No Docker/Mongo. Cleans up its own data dir.

import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

import { assert, eq, report } from '../_helpers.mts';
import { initGreenfieldRepo, workspaceDataDir } from '../../server/git/repoStore.ts';
import { getTemplate } from '../../server/scaffold/templates.ts';

const wsId = `gf-${String(Date.now())}`;
const dataDir = workspaceDataDir(wsId);
const bare = path.join(dataDir, 'repo.git');

try {
  const tpl = getTemplate('go-api');
  assert(tpl !== null, 'the go template resolves');

  const status = await initGreenfieldRepo(wsId, tpl?.files ?? []);
  assert(status.linked === true, 'greenfield init produced a linked repo');

  //? The bare repo's HEAD tree = the committed seed.
  const tree = execFileSync('git', ['--git-dir', bare, 'ls-tree', '-r', 'HEAD', '--name-only'], { encoding: 'utf8' });
  const files = tree.split('\n').map((l) => l.trim()).filter(Boolean);
  assert(files.includes('main.go') && files.includes('go.mod'), 'the runnable Go source was committed');
  assert(files.includes('.workspaces/Dockerfile'), 'the buildable Dockerfile was committed');
  assert(files.includes('.workspaces/ci.yml'), 'the CI gate was committed');
  assert(files.includes('README.md'), 'the README was committed');

  //? Exactly one commit (the scaffold), and the Dockerfile FROMs the go base.
  const count = execFileSync('git', ['--git-dir', bare, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim();
  eq(count, '1', 'a single scaffold commit on main');
  const dockerfile = execFileSync('git', ['--git-dir', bare, 'show', 'HEAD:.workspaces/Dockerfile'], { encoding: 'utf8' });
  assert(dockerfile.includes('workspaces/base-go'), 'the committed Dockerfile builds on the go stack base');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}

report('tests/integration/greenfieldTemplate.test.mts');

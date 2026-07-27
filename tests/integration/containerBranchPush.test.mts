//? Push-on-approval regression: commits live in the container-owned named volume, not
//? the stale host activation worktree. A credential-free bundle crosses that boundary;
//? only a fresh host-controlled bare repo receives the forge token.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { tryCatch } from '@luckystack/core';

import { assert, eq, report } from '../_helpers.mts';
import { pushBundleBranch } from '../../server/git/repoStore';
import { pushContainerBranch } from '../../server/git/containerPush';

const git = (args: string[]): string => execFileSync('git', args, { encoding: 'utf8' }).trim();
const root = mkdtempSync(path.join(tmpdir(), 'workspaces-container-push-test-'));

try {
  const source = path.join(root, 'source');
  const remote = path.join(root, 'remote.git');
  const bundle = path.join(root, 'DEV-99.bundle');
  git(['init', source]);
  git(['-C', source, 'config', 'user.name', 'Workspaces Test']);
  git(['-C', source, 'config', 'user.email', 'workspaces@example.test']);
  writeFileSync(path.join(source, 'README.md'), 'base\n');
  git(['-C', source, 'add', 'README.md']);
  git(['-C', source, 'commit', '-m', 'base']);
  git(['-C', source, 'checkout', '-b', 'DEV-99']);
  writeFileSync(path.join(source, 'proof.txt'), 'container-owned commit\n');
  git(['-C', source, 'add', 'proof.txt']);
  git(['-C', source, 'commit', '-m', 'container proof']);
  const expectedHead = git(['-C', source, 'rev-parse', 'HEAD']);
  git(['-C', source, 'bundle', 'create', bundle, 'DEV-99']);
  git(['init', '--bare', remote]);

  await pushBundleBranch({ bundlePath: bundle, gitUrl: remote, token: 'not-used-for-local-path', branch: 'DEV-99', expectedHead });
  eq(git(['--git-dir', remote, 'rev-parse', 'refs/heads/DEV-99']), expectedHead, 'the remote receives the exact container bundle head');

  const [mismatch] = await tryCatch(() => pushBundleBranch({ bundlePath: bundle, gitUrl: remote, token: 'unused', branch: 'DEV-99', expectedHead: 'a'.repeat(40) }));
  assert(mismatch !== null && mismatch.message.includes('bundle-head-mismatch'), 'a branch race fails closed before remote push');

  const dockerCalls: string[][] = [];
  const pushed: { token?: string; expectedHead?: string } = {};
  let ownedScope = '';
  const fakeHead = 'b'.repeat(40);
  await pushContainerBranch({ container: 'ws-owned', workspaceId: 'workspace-a', ticketKey: 'DEV-99', gitUrl: 'https://github.com/acme/repo.git', token: 'secret-forge-token', branch: 'DEV-99' }, {
    isOwned: async (container, workspaceId, ticketKey) => { ownedScope = `${container}:${workspaceId}:${ticketKey}`; return true; },
    runDocker: async (args) => {
      dockerCalls.push(args);
      return { code: 0, out: args.includes('rev-parse') ? fakeHead : '', err: '', timedOut: false, outputLimitExceeded: false };
    },
    pushBundle: async (input) => { pushed.token = input.token; pushed.expectedHead = input.expectedHead; },
  });
  eq(ownedScope, 'ws-owned:workspace-a:DEV-99', 'ownership is verified against the exact workspace and ticket');
  eq(pushed.expectedHead, fakeHead, 'the host push binds to the exact container branch head');
  eq(pushed.token, 'secret-forge-token', 'the host-only push receives the forge credential');
  assert(dockerCalls.every((args) => !args.join(' ').includes('secret-forge-token')), 'the forge token never enters Docker argv or the container');
  assert(dockerCalls.some((args) => args[0] === 'cp'), 'the credential-free bundle crosses via docker cp');
  assert(dockerCalls.some((args) => args.includes('rm')), 'the container bundle is removed after the push attempt');

  let rejectedDockerCalls = 0;
  const [ownershipError] = await tryCatch(() => pushContainerBranch({ container: 'foreign', workspaceId: 'workspace-a', ticketKey: 'DEV-99', gitUrl: 'https://example.test/repo.git', token: 'secret', branch: 'DEV-99' }, {
    isOwned: async () => false,
    runDocker: async () => { rejectedDockerCalls += 1; return { code: 0, out: '', err: '', timedOut: false, outputLimitExceeded: false }; },
  }));
  assert(ownershipError !== null && ownershipError.message === 'container.notOurs', 'a foreign container is rejected before export');
  eq(rejectedDockerCalls, 0, 'a rejected container causes no Docker operation');
} finally {
  rmSync(root, { recursive: true, force: true });
}

report('tests/integration/containerBranchPush.test.mts');

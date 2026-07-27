//? Export a ticket branch from its container-owned named volume without ever placing
//? forge credentials in the container. The container emits a credential-free Git bundle;
//? only a fresh host-controlled bare repo receives the token and performs the remote push.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { tryCatch } from '@luckystack/core';

import { docker, isWorkspaceTicketContainer, type DockerResult } from '../container/runtime';
import { pushBundleBranch } from './repoStore';

export interface PushContainerBranchInput {
  container: string;
  workspaceId: string;
  ticketKey: string;
  gitUrl: string;
  token: string;
  branch: string;
}

export interface PushContainerBranchDependencies {
  runDocker?: (args: string[]) => Promise<DockerResult>;
  pushBundle?: typeof pushBundleBranch;
  isOwned?: (container: string, workspaceId: string, ticketKey: string) => Promise<boolean>;
}

export async function pushContainerBranch(
  input: PushContainerBranchInput,
  dependencies: PushContainerBranchDependencies = {},
): Promise<void> {
  const runDocker = dependencies.runDocker ?? docker;
  const pushBundle = dependencies.pushBundle ?? pushBundleBranch;
  const isOwned = dependencies.isOwned ?? isWorkspaceTicketContainer;
  if (!(await isOwned(input.container, input.workspaceId, input.ticketKey))) throw new Error('container.notOurs');

  const scratch = mkdtempSync(path.join(tmpdir(), 'workspaces-stage-push-'));
  const bundleName = `stage-${randomUUID()}.bundle`;
  const containerBundle = `/tmp/${bundleName}`;
  const hostBundle = path.join(scratch, bundleName);
  try {
    const head = await runDocker(['exec', '--user', 'agent', input.container, 'git', '-C', '/work', 'rev-parse', '--verify', `refs/heads/${input.branch}`]);
    const expectedHead = head.out.trim();
    if (head.code !== 0 || !/^[0-9a-f]{40,64}$/i.test(expectedHead)) throw new Error('container.branchMissing');

    const bundled = await runDocker(['exec', '--user', 'agent', input.container, 'git', '-C', '/work', 'bundle', 'create', containerBundle, input.branch]);
    if (bundled.code !== 0) throw new Error(bundled.err.trim() || 'container.bundleFailed');
    const copied = await runDocker(['cp', `${input.container}:${containerBundle}`, hostBundle]);
    if (copied.code !== 0) throw new Error(copied.err.trim() || 'container.bundleCopyFailed');

    await pushBundle({ bundlePath: hostBundle, gitUrl: input.gitUrl, token: input.token, branch: input.branch, expectedHead });
  } finally {
    await tryCatch(() => runDocker(['exec', '--user', 'agent', input.container, 'rm', '-f', containerBundle]));
    rmSync(scratch, { recursive: true, force: true });
  }
}

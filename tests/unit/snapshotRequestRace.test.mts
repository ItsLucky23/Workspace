//? Client snapshot race regression: delayed project-A responses must never replace the
//? latest desired project B. Pure test over the provider's request-token guard; no React/server.

import { assert, eq, report } from '../_helpers.mts';
import { shouldApplySnapshotResponse, snapshotTargetsMatch, type SnapshotRequestToken, type SnapshotTarget } from '../../src/workspaces/_shell/snapshotRequest';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let latestSequence = 0;
let desired: SnapshotTarget = { workspaceId: 'workspace-1', projectId: 'project-a' };
let applied = '';

const request = async (target: SnapshotTarget, waitMs: number, value: string): Promise<void> => {
  const token: SnapshotRequestToken = { ...target, sequence: latestSequence + 1 };
  latestSequence = token.sequence;
  await delay(waitMs);
  if (shouldApplySnapshotResponse(token, latestSequence, desired)) applied = value;
};

// A starts first, then B becomes desired and resolves first. A's late completion is ignored.
const a = request({ workspaceId: 'workspace-1', projectId: 'project-a' }, 25, 'A');
desired = { workspaceId: 'workspace-1', projectId: 'project-b' };
const b = request({ workspaceId: 'workspace-1', projectId: 'project-b' }, 1, 'B');
await Promise.all([a, b]);
eq(applied, 'B', 'a late project-A response cannot replace project B');

// A callback holding an old refetch closure is rejected before it can supersede B's sequence.
assert(!snapshotTargetsMatch({ workspaceId: 'workspace-1', projectId: 'project-a' }, desired), 'an old refetch closure cannot issue a request for project A after B is desired');

// The desired-target check closes the pre-render window even before a B request exists.
const oldTarget: SnapshotRequestToken = { workspaceId: 'workspace-1', projectId: 'project-a', sequence: 3 };
assert(!shouldApplySnapshotResponse(oldTarget, 3, { workspaceId: 'workspace-1', projectId: 'project-b' }), 'a response for the previous desired project is stale even at the latest sequence');

// Two refetches for the same target are monotonic too: only the newest sequence applies.
const sameTarget = { workspaceId: 'workspace-1', projectId: 'project-b' };
assert(!shouldApplySnapshotResponse({ ...sameTarget, sequence: 4 }, 5, sameTarget), 'an older same-target refetch is ignored');
assert(shouldApplySnapshotResponse({ ...sameTarget, sequence: 5 }, 5, sameTarget), 'the latest response for the desired target applies');

report('tests/unit/snapshotRequestRace.test.mts');

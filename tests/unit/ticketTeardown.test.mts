//? Feature-24 destructive kill regression: only the canonical container carrying the
//? exact workspace/project/ticket labels and its deterministic volume may be removed.

import { assert, eq, report } from '../_helpers.mts';
import { teardownExactTicketContainer, type DockerResult } from '../../server/container/runtime';

const ok = (out = ''): DockerResult => ({ code: 0, out, err: '', timedOut: false, outputLimitExceeded: false });
const missing = (): DockerResult => ({ code: 1, out: '', err: 'not found', timedOut: false, outputLimitExceeded: false });

const workspaceId = 'workspace-a';
const projectId = 'project-a';
const ticketKey = 'DEV-42';
const identity = {
  containerId: 'immutable-container-id',
  name: 'ws-workspace-a-dev-42',
  workspaceId,
  projectId,
  ticketKey,
};

let dockerCalls = 0;
const unavailable = await teardownExactTicketContainer(workspaceId, projectId, ticketKey, {
  available: async () => false,
  inspect: async () => { throw new Error('inspect must not run'); },
  runDocker: async () => { dockerCalls += 1; return ok(); },
});
eq(unavailable, false, 'Docker unavailability fails closed');
eq(dockerCalls, 0, 'an unavailable runtime receives no destructive command');

let mismatchRemovals = 0;
const mismatch = await teardownExactTicketContainer(workspaceId, projectId, ticketKey, {
  available: async () => true,
  inspect: async () => ({ ...identity, projectId: 'foreign-project' }),
  runDocker: async (args) => { if (args.includes('rm')) mismatchRemovals += 1; return ok(); },
});
eq(mismatch, false, 'a project-label mismatch is rejected');
eq(mismatchRemovals, 0, 'a mismatched identity removes no container or volume');

const calls: string[][] = [];
let containerPresent = true;
let volumePresent = true;
const removed = await teardownExactTicketContainer(workspaceId, projectId, ticketKey, {
  available: async () => true,
  inspect: async () => identity,
  runDocker: async (args) => {
    calls.push(args);
    if (args[0] === 'rm') { containerPresent = false; return ok(); }
    if (args[0] === 'inspect') return containerPresent ? ok(identity.containerId) : missing();
    if (args[0] === 'volume' && args[1] === 'inspect') return volumePresent ? ok('volume') : missing();
    if (args[0] === 'volume' && args[1] === 'rm') { volumePresent = false; return ok(); }
    return missing();
  },
});
eq(removed, true, 'the exact container and deterministic volume are removed and proven absent');
assert(calls.some((args) => args.join(' ') === 'rm -f immutable-container-id'), 'container removal uses the immutable ID, not browser input');
assert(calls.some((args) => args.join(' ') === 'volume rm -f wsvol-workspace-a-dev-42'), 'only the deterministic ticket volume is removed');

let absentRmCalls = 0;
const replay = await teardownExactTicketContainer(workspaceId, projectId, ticketKey, {
  available: async () => true,
  inspect: async () => null,
  runDocker: async (args) => { if (args.includes('rm')) absentRmCalls += 1; return missing(); },
});
eq(replay, true, 'an already-absent container and volume are an idempotent replay');
eq(absentRmCalls, 0, 'idempotent replay repeats no destructive remove');

report('tests/unit/ticketTeardown.test.mts');

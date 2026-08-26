//? Assistant execution receipts: “Done” means every real route ACKed success. An empty dispatch, any RBAC/
//? validation failure, or malformed receipt must stay failed/retryable instead of becoming false success.

import { assert, eq, report } from '../_helpers.mts';
import { chatExecutionReceiptsSucceeded, describeChatDispatchResults } from '../../src/workspaces/_functions/chatDispatch.ts';

assert(chatExecutionReceiptsSucceeded([{ status: 'success' }]), 'one successful execution receipt completes a proposal');
assert(chatExecutionReceiptsSucceeded([{ status: 'success', result: {} }, { status: 'success' }]), 'all steps must succeed for a plan');
assert(!chatExecutionReceiptsSucceeded([]), 'a dispatcher that emitted no request is not successful');
assert(!chatExecutionReceiptsSucceeded([{ status: 'error', errorCode: 'auth.forbidden' }]), 'an RBAC rejection is not successful');
assert(!chatExecutionReceiptsSucceeded([{ status: 'success' }, { status: 'error' }]), 'one failed plan step keeps the whole plan failed');
assert(!chatExecutionReceiptsSucceeded([null, { status: 'success' }]), 'a malformed receipt fails closed');

//? ADR 0328 — an op's RESULT is what makes the chat not fire-and-forget: db-introspect's table list has to
//? reach the next turn instead of being dropped on the floor. These guard the two ways that silently breaks:
//? handing back nothing when there IS a payload, or handing back a wall of text that blows the next prompt.
eq(describeChatDispatchResults([]), '', 'no receipts describe to nothing (there is no turn to add)');
eq(describeChatDispatchResults([{ status: 'success' }]), '', 'a receipt with no result adds no turn — an ack is not context');
eq(describeChatDispatchResults([{ status: 'success', result: {} }]), '', 'an EMPTY result object is not context either');
eq(
  describeChatDispatchResults([{ status: 'success', result: { tables: ['user', 'ticket'] } }]),
  '{"tables":["user","ticket"]}',
  'a single op result is described verbatim as JSON (the db-introspect case that prompted this)',
);
eq(
  describeChatDispatchResults([{ status: 'success', result: { a: 1 } }, { status: 'success', result: { b: 2 } }]),
  '[{"a":1},{"b":2}]',
  'a multi-step plan describes as an array, so the AI can tell the steps apart',
);
eq(
  describeChatDispatchResults([{ status: 'success', result: { a: 1 } }, { status: 'success' }]),
  '{"a":1}',
  'result-less steps drop out, so one payload among many still describes as a single object');
{
  const huge = describeChatDispatchResults([{ status: 'success', result: { blob: 'x'.repeat(10_000) } }]);
  assert(huge.length <= 2001, 'an enormous result is capped (2000 chars + the ellipsis) instead of eating the next context window');
  assert(huge.endsWith('…'), 'the cap is marked with an ellipsis so the AI knows the payload was truncated');
}
{
  //? A cyclic result cannot be JSON-stringified. It must degrade to "no extra turn", never throw: the op
  //? itself already SUCCEEDED, and losing its description must not turn that into a failed chat turn.
  const cyclic: Record<string, unknown> = { name: 'loop' };
  cyclic.self = cyclic;
  eq(describeChatDispatchResults([{ status: 'success', result: cyclic }]), '', 'an unserialisable result degrades to no turn instead of throwing');
}

report('tests/unit/chatExecutionReceipts.test.mts');

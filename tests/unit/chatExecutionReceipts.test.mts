//? Assistant execution receipts: “Done” means every real route ACKed success. An empty dispatch, any RBAC/
//? validation failure, or malformed receipt must stay failed/retryable instead of becoming false success.

import { assert, report } from '../_helpers.mts';
import { chatExecutionReceiptsSucceeded } from '../../src/workspaces/_functions/chatDispatch.ts';

assert(chatExecutionReceiptsSucceeded([{ status: 'success' }]), 'one successful execution receipt completes a proposal');
assert(chatExecutionReceiptsSucceeded([{ status: 'success', result: {} }, { status: 'success' }]), 'all steps must succeed for a plan');
assert(!chatExecutionReceiptsSucceeded([]), 'a dispatcher that emitted no request is not successful');
assert(!chatExecutionReceiptsSucceeded([{ status: 'error', errorCode: 'auth.forbidden' }]), 'an RBAC rejection is not successful');
assert(!chatExecutionReceiptsSucceeded([{ status: 'success' }, { status: 'error' }]), 'one failed plan step keeps the whole plan failed');
assert(!chatExecutionReceiptsSucceeded([null, { status: 'success' }]), 'a malformed receipt fails closed');

report('tests/unit/chatExecutionReceipts.test.mts');

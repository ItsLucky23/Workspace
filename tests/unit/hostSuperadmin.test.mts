//? Global host-superadmin identity stays completely separate from tenant owner/admin roles.

import { assert, report } from '../_helpers.mts';

const { assertHostSuperadmin, isHostSuperadmin } = await import('../../server/security/hostSuperadmin.ts');

assert(isHostSuperadmin({ admin: true, email: 'user@example.com' }, ''), 'the persisted global admin flag is a host superadmin');
assert(isHostSuperadmin({ admin: false, email: ' ROOT@Example.com ' }, 'other@example.com,root@example.com'), 'the operator env allowlist bootstraps a host superadmin case-insensitively');
assert(!isHostSuperadmin({ admin: false, email: 'owner@example.com' }, ''), 'an ordinary account is not a host superadmin');
const workspaceOwnerSession = { admin: false, email: 'owner@example.com', role: 'owner' };
const workspaceAdminSession = { admin: false, email: 'admin@example.com', role: 'admin' };
assert(!isHostSuperadmin(workspaceOwnerSession, ''), 'a workspace owner-shaped session gets no host authority');
assert(!isHostSuperadmin(workspaceAdminSession, ''), 'a workspace admin-shaped session gets no host authority');
assert(!isHostSuperadmin(null, 'root@example.com'), 'an unauthenticated caller is never a host superadmin');

let rejected = false;
try { assertHostSuperadmin({ admin: false, email: 'owner@example.com' }, 'root@example.com'); } catch { rejected = true; }
assert(rejected, 'the assertion fails closed for a workspace-only identity');

report('tests/unit/hostSuperadmin.test.mts');

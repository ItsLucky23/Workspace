//? A03 — fail-closed edge-auth policy + route-ownership Redis outcomes. The policy is pure;
//? Redis reads use an injected dependency so found/missing/outage stay distinct without a live store.

import { assert, eq, report } from '../_helpers.mts';
import { decideEditorAuth } from '../../server/http/editorAuthCheck.ts';
import { getRouteWorkspace, type RouteWorkspaceDeps } from '../../server/proxy/routeOwnership.ts';

// Route ownership: one production lookup contract, three security-relevant Redis outcomes.
let requestedKey = '';
const foundDeps: RouteWorkspaceDeps = {
  get: async (routeKey) => {
    requestedKey = routeKey;
    return 'ws-1';
  },
};
eq(await getRouteWorkspace('VSCODE-DEV-1.EXAMPLE.COM', foundDeps), { status: 'found', workspaceId: 'ws-1' }, 'Redis value resolves to found ownership');
assert(requestedKey.includes('routeowner') && requestedKey.includes('vscode-dev-1.example.com'), 'ownership keys normalize the host and keep the routeowner namespace');

const missingDeps: RouteWorkspaceDeps = { get: async () => null };
eq(await getRouteWorkspace('vscode-dev-2.example.com', missingDeps), { status: 'missing' }, 'absent Redis key stays distinguishable as missing');

const unavailableDeps: RouteWorkspaceDeps = { get: () => Promise.reject(new Error('redis unavailable')) };
eq(await getRouteWorkspace('vscode-dev-3.example.com', unavailableDeps), { status: 'unavailable' }, 'Redis failure stays distinguishable as unavailable');

// Pure authorization decision table. A valid login never bypasses ownership or workspace RBAC.
eq(decideEditorAuth({ sessionValid: false }), { statusCode: 401, body: 'unauthorized' }, 'invalid session returns 401');
eq(decideEditorAuth({ sessionValid: true, routeStatus: 'missing' }), { statusCode: 403, body: 'forbidden' }, 'missing host mapping fails closed with 403');
eq(decideEditorAuth({ sessionValid: true, routeStatus: 'unavailable' }), { statusCode: 503, body: 'service unavailable' }, 'Redis ownership outage fails closed with 503');
eq(decideEditorAuth({ sessionValid: true, routeStatus: 'found', hasCapability: true }), { statusCode: 204 }, 'found ownership plus capability proceeds with 204');
eq(decideEditorAuth({ sessionValid: true, routeStatus: 'found', hasCapability: false }), { statusCode: 403, body: 'forbidden' }, 'found ownership without capability returns 403');

report('tests/unit/edgeAuth.test.mts');

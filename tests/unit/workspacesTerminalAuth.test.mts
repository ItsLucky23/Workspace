//? Browser-terminal authorization policy. No Docker/socket/DB: dependencies are injected. Proves the
//? browser can never choose a Docker object, a foreign workspace is denied before inspection, and only
//? the canonical workspace+ticket-labelled container is returned.

import { assert, eq, report } from '../_helpers.mts';

const { authorizeTerminalTarget } = await import('../../server/hooks/workspacesTerminal.ts');

const workspaceId = '507f1f77bcf86cd799439011';

// Malformed tenant/ticket input never reaches RBAC or Docker.
{
  let calls = 0;
  const target = await authorizeTerminalTarget(
    { workspaceId: 'not-an-object-id', ticketKey: 'DEV-1', userId: 'u1' },
    {
      hasWorkTickets: async () => { calls += 1; return true; },
      matchesContainer: async () => { calls += 1; return true; },
    },
  );
  eq(target, null, 'malformed workspace identity is refused');
  eq(calls, 0, 'malformed identity never reaches RBAC or Docker');
}

// Workspace membership/capability is checked before any container inspection.
{
  let inspected = false;
  const target = await authorizeTerminalTarget(
    { workspaceId, ticketKey: 'DEV-1', userId: 'viewer' },
    {
      hasWorkTickets: async () => false,
      matchesContainer: async () => { inspected = true; return true; },
    },
  );
  eq(target, null, 'a user without workTickets is refused');
  assert(!inspected, 'a forbidden user cannot probe container existence');
}

// A labelled container mismatch (wrong workspace/ticket) fails closed.
{
  let derivedName = '';
  const target = await authorizeTerminalTarget(
    { workspaceId, ticketKey: 'DEV-1', userId: 'member' },
    {
      hasWorkTickets: async () => true,
      matchesContainer: async (name) => { derivedName = name; return false; },
    },
  );
  eq(target, null, 'a container label mismatch is refused');
  eq(derivedName, 'ws-507f1f77bcf86cd799439011-dev-1', 'the server derives the canonical name itself');
}

// Exact capability + immutable label match returns only the server-derived target.
{
  const target = await authorizeTerminalTarget(
    { workspaceId, ticketKey: 'DEV-42', userId: 'member' },
    {
      hasWorkTickets: async (candidateWorkspace, userId) => candidateWorkspace === workspaceId && userId === 'member',
      matchesContainer: async (name, candidateWorkspace, ticketKey) => name === 'ws-507f1f77bcf86cd799439011-dev-42' && candidateWorkspace === workspaceId && ticketKey === 'DEV-42',
    },
  );
  eq(target, 'ws-507f1f77bcf86cd799439011-dev-42', 'the exact authorized workspace ticket container is returned');
}

report('tests/unit/workspacesTerminalAuth.test.mts');

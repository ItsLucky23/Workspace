import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const terminalPage = readFileSync('src/workspaces/develop/terminals/page.tsx', 'utf8');
const terminalHook = readFileSync('server/hooks/workspacesTerminal.ts', 'utf8');
const settingsPage = readFileSync('src/workspaces/settings/page.tsx', 'utf8');
const architecture = readFileSync('src/workspaces/_docs/01_ARCHITECTURE.md', 'utf8');

assert.ok(!terminalPage.includes('SshLocked') && !terminalPage.includes('sshUserId'), 'terminal UI has no fictional SSH unlock gate');
assert.ok(!settingsPage.includes('terminalSshUser') && !settingsPage.includes('<AddKeyForm'), 'settings no longer presents SSH keys as terminal authorization');
assert.ok(terminalHook.includes('CAP.workTickets'), 'terminal attach requires the workspace capability');
assert.ok(terminalHook.includes('isWorkspaceTicketContainer'), 'terminal attach verifies exact workspace/ticket container labels');
assert.ok(terminalHook.includes('containerName(workspaceId, ticketKey)'), 'the server derives the canonical container name');
assert.ok(architecture.includes('Session + RBAC + exact-container authorization'), 'the architecture documents the real terminal boundary');
assert.ok(!architecture.includes('SSH-key challenge'), 'the stale nonce/signature promise is absent from the architecture');

console.log('terminal access contract unit tests passed');

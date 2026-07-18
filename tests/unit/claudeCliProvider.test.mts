//? Claude one-shot provider security contract: a fake PTY captures launch env/settings/input framing.
//? No Claude login, network, subscription usage, or real terminal is required.

import path from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

import { assert, eq, report } from '../_helpers.mts';
import { driveClaudeCliTurn, type OneShotPty, type OneShotPtyOptions } from '../../server/ai/providers/claudeCli';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const prompt = 'Return only the requested JSON.';
const fakeEnv: NodeJS.ProcessEnv = {
  PATH: '/safe/bin',
  HOME: '/safe/home',
  TMP: '/safe/tmp',
  CLAUDE_CONFIG_DIR: '/safe/claude-login',
  LANG: 'en_US.UTF-8',
  TERM: 'xterm-256color',
  DATABASE_URL: 'mongodb://secret',
  GEMINI_API_KEY: 'provider-secret',
  GOOGLE_CLIENT_SECRET: 'oauth-secret',
  WORKSPACES_ENC_KEY: 'encryption-secret',
  ANTHROPIC_AUTH_TOKEN: 'metered-secret',
  TEST_RESET_TOKEN: 'test-secret',
  WS_VAPID_PRIVATE: 'push-secret',
};

let capturedSettings = '';
let capturedMcp = '';
let capturedArgs: string[] = [];
let capturedOptions: OneShotPtyOptions | null = null;
let killed = false;
let promptWritten = false;
const writes: string[] = [];

const result = await driveClaudeCliTurn({ prompt, system: 'Reason over inline data only.', timeoutMs: 100 }, {
  claudeBin: 'fake-claude',
  env: fakeEnv,
  wait: () => Promise.resolve(),
  spawnPty: (_file, args, options): OneShotPty => {
    capturedArgs = [...args];
    capturedOptions = options;
    const settingsIndex = args.indexOf('--settings');
    const settingsPath = settingsIndex >= 0 ? args[settingsIndex + 1] ?? '' : '';
    capturedSettings = readFileSync(settingsPath, 'utf8');
    const mcpIndex = args.indexOf('--mcp-config');
    capturedMcp = readFileSync(mcpIndex >= 0 ? args[mcpIndex + 1] ?? '' : '', 'utf8');
    const capturePath = path.join(path.dirname(settingsPath), 'stop.json');
    return {
      onData: () => undefined,
      write: (data) => {
        writes.push(data);
        if (data === prompt) promptWritten = true;
        else if (data === '\r' && promptWritten) writeFileSync(capturePath, JSON.stringify({ last_assistant_message: 'fake final answer' }), 'utf8');
      },
      kill: () => { killed = true; },
    };
  },
});

assert(result.ok && result.text === 'fake final answer', 'fake Stop capture completes the one-shot turn');
assert(killed, 'the fake PTY is cleaned up after capture');
eq(writes, ['\r', prompt, '\r', String.fromCodePoint(3)], 'PTY framing confirms trust, submits once, then sends Ctrl+C (no blind second Enter)');
assert(!capturedArgs.includes('-p') && !capturedArgs.includes('--print'), 'one-shot Claude stays interactive and never uses metered print mode');
assert(capturedArgs.includes('--strict-mcp-config'), 'one-shot Claude ignores project/user MCP configs');
eq(capturedMcp, '{"mcpServers":{}}', 'strict MCP config contains no servers');

const childEnv = capturedOptions?.env ?? {};
eq(Object.keys(childEnv).sort(), ['CLAUDE_CONFIG_DIR', 'HOME', 'LANG', 'PATH', 'TERM', 'TMP'].sort(), 'child env contains only the minimal runtime/login/temp allowlist values present in the source');
eq(childEnv.CLAUDE_CONFIG_DIR, '/safe/claude-login', 'the projected Claude login/config path survives the env allowlist');
for (const secretName of ['DATABASE_URL', 'GEMINI_API_KEY', 'GOOGLE_CLIENT_SECRET', 'WORKSPACES_ENC_KEY', 'ANTHROPIC_AUTH_TOKEN', 'TEST_RESET_TOKEN', 'WS_VAPID_PRIVATE']) {
  assert(!(secretName in childEnv), `${secretName} is absent from the Claude child env`);
}

const parsedSettings: unknown = JSON.parse(capturedSettings);
const permissions = isRecord(parsedSettings) && isRecord(parsedSettings.permissions) ? parsedSettings.permissions : {};
const deny = Array.isArray(permissions.deny) ? permissions.deny.filter((value): value is string => typeof value === 'string') : [];
const allow = Array.isArray(permissions.allow) ? permissions.allow : null;
const ask = Array.isArray(permissions.ask) ? permissions.ask : null;
eq(allow, [], 'one-shot settings allow no tools');
eq(ask, [], 'one-shot settings ask for no tools');
eq(deny, [
  '*',
  'Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'WebFetch', 'WebSearch',
  'Task', 'TaskOutput', 'TaskStop', 'NotebookEdit', 'TodoWrite', 'Skill', 'LSP',
  'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', 'KillShell', 'mcp__*',
], 'one-shot settings explicitly deny all current/future tools plus named built-ins, subagents and MCP');
assert(!capturedSettings.includes('mongodb://secret') && !capturedSettings.includes('provider-secret'), 'settings never serialize parent-process secrets');

report('tests/unit/claudeCliProvider.test.mts');

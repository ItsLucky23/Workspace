//? `claude-code` harness adapter — the interactive Claude Code CLI in the container PTY (the P0.5-proven
//? subscription path). The behaviour here is what `stageRunner.ts` did inline before the seam existed:
//? `buildTurnArgs`, the projected-credential copy, the `claude auth status` probe and the TUI ready markers.
//? @adr 0322

import { copyFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { tryCatchSync } from '@luckystack/core';

import { buildTurnArgs } from '../modelSelect';
import { matchesReady, matchesTrustOrReady } from '../ptyReady';
import type { CodingAgentAdapter, RunDocker } from './types';

//? The pinned CLI version baked into docker/base.Dockerfile (ARG CLAUDE_CLI_VERSION) — recorded per session.
export const CLAUDE_CLI_VERSION = '2.1.198';
export const CAPTURE = '/work/.claude/turn-stop.json';

export function authProjectionDir(): string {
  return process.env.WS_AUTH_DIR ?? path.join(process.cwd(), 'data', '_auth');
}

//? The managed-token refresh loop, on-demand (07b §2.2): the projected token is short-lived and the HOST's
//? `claude` keeps its own copy fresh, so re-copy the live host creds into the RO-mounted projection dir
//? before each turn. Without this, container-claude hits "Not logged in" once the initial copy expires
//? (~hours). Best-effort, host-side.
export function refreshProjectedClaudeAuth(): void {
  const authDir = authProjectionDir();
  const hostCreds = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), '.claude'), '.credentials.json');
  if (existsSync(hostCreds) && existsSync(authDir)) {
    tryCatchSync(() => { copyFileSync(hostCreds, path.join(authDir, '.credentials.json')); });
  }
}

//? Copy the RO-projected subscription creds into a writable, agent-owned ~/.claude (0600) so the CLI's
//? permission check passes (the RO Windows mount is 0777) and no container ever writes the shared source.
//? FIXED path (matches the container's CLAUDE_CONFIG_DIR env) — never `~` (docker exec sets no HOME). Also
//? gives the worktree a git identity so a code stage's `git commit` succeeds. Clears any stale turn-capture.
export async function projectClaudeAuth(container: string, runDocker: RunDocker): Promise<void> {
  await runDocker(['exec', container, 'sh', '-c',
    'mkdir -p /home/agent/.claude && cp /auth-ro/.credentials.json /auth-ro/.claude.json /home/agent/.claude/ 2>/dev/null; chmod 700 /home/agent/.claude 2>/dev/null; chmod 600 /home/agent/.claude/.credentials.json 2>/dev/null; '
    + 'git -C /work config user.name "Workspaces AI" 2>/dev/null; git -C /work config user.email "ai@workspaces.local" 2>/dev/null; '
    + 'rm -f ' + CAPTURE + '; true']);
}

//? Presence-only host probe for readiness: does the host (or the projection) hold Claude credentials?
//? Mirrors refreshProjectedClaudeAuth's source resolution; never reads the file's contents.
export function hostClaudeAuthPresent(env: NodeJS.ProcessEnv = process.env): boolean {
  const hostCreds = path.join(env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), '.claude'), '.credentials.json');
  return existsSync(hostCreds) || existsSync(path.join(authProjectionDir(), '.credentials.json'));
}

export function claudeAuthStatusLoggedIn(raw: string): boolean {
  const [error, parsed] = tryCatchSync(() => JSON.parse(raw) as unknown);
  return !error && parsed !== null && typeof parsed === 'object' && 'loggedIn' in parsed
    && (parsed as { loggedIn?: unknown }).loggedIn === true;
}

export async function containerClaudeAuthenticated(container: string, runDocker: RunDocker): Promise<boolean> {
  const result = await runDocker(['exec', container, 'claude', 'auth', 'status']);
  return result.code === 0 && claudeAuthStatusLoggedIn(result.out);
}

export const claudeCodeAdapter: CodingAgentAdapter = {
  id: 'claude-code',
  binary: 'claude',
  processMatch: 'claude',
  cliVersion: CLAUDE_CLI_VERSION,
  //? `--model` = the resolved tier alias/literal; effort rides in settings.json (MAX_THINKING_TOKENS), not argv.
  turnArgs: ({ resumeSessionId, model }) => buildTurnArgs({ ...(resumeSessionId ? { resumeSessionId } : {}), ...(model ? { model } : {}) }),
  projectAuth: async (container, runDocker) => {
    refreshProjectedClaudeAuth();
    await projectClaudeAuth(container, runDocker);
  },
  authenticated: containerClaudeAuthenticated,
  readyMatches: matchesReady,
  confirmsTrust: true,
  trustOrReadyMatches: matchesTrustOrReady,
};

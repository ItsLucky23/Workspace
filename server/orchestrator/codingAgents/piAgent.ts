//? `pi-agent` harness adapter — the interactive pi coding agent (@earendil-works/pi-coding-agent) in the
//? container PTY, on the Codex (ChatGPT) seat or — warned, off by default — the Claude seat. Host spike
//? 2026-08-23 proved: PTY turn bills the subscription (`(sub)` in the footer), `--session-id` resumes an exact
//? session, and the baked extension writes the same capture files the runner reads for Claude.
//?
//? Credentials: pi keeps ONE `auth.json` (OAuth access+refresh+expires per provider). The host's file is
//? projected to `data/_auth/pi-auth.json` before each turn (newest `expires` wins between host and projection),
//? copied into the agent-owned `/home/agent/.pi/agent/` in the container, and copied BACK after the turn — pi
//? refreshes the token in place, and a rotated refresh-token that stayed in the container would strand the host.
//? @adr 0322

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { tryCatchSync } from '@luckystack/core';

import type { CodingSubscription } from '../../../src/workspaces/_data/types';
import { authProjectionDir, CAPTURE } from './claudeCode';
import { PI_PROVIDER } from './config';
import type { CodingAgentAdapter, RunDocker, TurnArgsInput } from './types';

//? Pinned in docker/base.Dockerfile (ARG PI_AGENT_VERSION).
export const PI_AGENT_VERSION = '0.84.2';
export const PI_EXTENSION = '/opt/workspaces/pi/workspaces.ts';
export const PI_CONFIG_DIR = '/home/agent/.pi/agent';
//? Sessions on the /work VOLUME (not the container overlay) so a `--session-id` resume survives a recreate.
export const PI_SESSION_DIR = '/work/.pi/sessions';
export const PI_AUTH_PROJECTION = 'pi-auth.json';

export function hostPiConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.PI_CODING_AGENT_DIR ?? path.join(homedir(), '.pi', 'agent');
}

//? Pure: the per-turn argv. `--no-extensions -e <ours>` loads exactly the Workspaces extension; `--approve`
//? skips the project-trust prompt (there is no permission prompt to skip — pi has none); `--thinking` takes
//? the same five levels as StageEffort; the stage instructions ride `--append-system-prompt <file>` and
//? /work/CLAUDE.md is auto-loaded as project context, exactly like Claude Code.
export function buildPiTurnArgs(subscription: CodingSubscription, input: TurnArgsInput): string[] {
  return [
    '--provider', PI_PROVIDER[subscription],
    ...(input.model ? ['--model', input.model] : []),
    ...(input.effort ? ['--thinking', input.effort] : []),
    ...(input.resumeSessionId ? ['--session-id', input.resumeSessionId] : []),
    '--session-dir', PI_SESSION_DIR,
    '--no-extensions', '-e', PI_EXTENSION,
    '--no-skills', '--no-prompt-templates', '--approve',
    '--append-system-prompt', '/work/.claude/stage-instructions.txt',
  ];
}

interface PiAuthEntry { type?: unknown; expires?: unknown }
type PiAuthFile = Record<string, PiAuthEntry>;

function parseAuth(raw: string | null): PiAuthFile | null {
  if (raw === null) return null;
  const [error, parsed] = tryCatchSync(() => JSON.parse(raw) as unknown);
  return !error && parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as PiAuthFile : null;
}

function providerExpires(file: PiAuthFile | null, provider: string): number {
  const e = file?.[provider]?.expires;
  return typeof e === 'number' ? e : 0;
}

//? Pure: which of two auth files carries the fresher token for `provider` (ties → the first).
export function newerPiAuth(a: string | null, b: string | null, provider: string): string | null {
  const pa = parseAuth(a);
  const pb = parseAuth(b);
  if (!pa) return pb ? b : null;
  if (!pb) return a;
  return providerExpires(pb, provider) > providerExpires(pa, provider) ? b : a;
}

//? Does the host's pi auth file hold an OAuth entry for the provider? (presence only)
export function hostPiAuthHas(provider: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const file = path.join(hostPiConfigDir(env), 'auth.json');
  if (!existsSync(file)) return false;
  const [, raw] = tryCatchSync(() => readFileSync(file, 'utf8'));
  const parsed = parseAuth(raw ?? null);
  return parsed?.[provider]?.type === 'oauth' || parsed?.[provider]?.type === 'api_key';
}

//? Host-side: refresh the projection from the host file, keeping whichever token is fresher.
export function refreshProjectedPiAuth(provider: string): void {
  const authDir = authProjectionDir();
  const hostFile = path.join(hostPiConfigDir(), 'auth.json');
  const projected = path.join(authDir, PI_AUTH_PROJECTION);
  if (!existsSync(hostFile)) return;
  if (!existsSync(authDir)) tryCatchSync(() => { mkdirSync(authDir, { recursive: true }); });
  if (!existsSync(authDir)) return;
  const [, host] = tryCatchSync(() => readFileSync(hostFile, 'utf8'));
  const [, proj] = tryCatchSync(() => (existsSync(projected) ? readFileSync(projected, 'utf8') : null));
  const pick = newerPiAuth(host ?? null, proj ?? null, provider);
  if (pick !== null && pick !== proj) tryCatchSync(() => { writeFileSync(projected, pick, { mode: 0o600 }); });
}

export async function projectPiAuth(container: string, runDocker: RunDocker): Promise<void> {
  await runDocker(['exec', container, 'sh', '-c',
    `mkdir -p ${PI_CONFIG_DIR} ${PI_SESSION_DIR} && cp /auth-ro/${PI_AUTH_PROJECTION} ${PI_CONFIG_DIR}/auth.json 2>/dev/null; chmod 700 ${PI_CONFIG_DIR} 2>/dev/null; chmod 600 ${PI_CONFIG_DIR}/auth.json 2>/dev/null; `
    + 'git -C /work config user.name "Workspaces AI" 2>/dev/null; git -C /work config user.email "ai@workspaces.local" 2>/dev/null; '
    + 'rm -f ' + CAPTURE + '; true']);
}

//? `pi auth check --provider <p> --json` (0.84+) prints `{ status: 'ready'|'not_ready'|'invalid', provider,
//? reason?, authType? }` (dist/cli/auth-check.d.ts). Only an explicit `ready` counts; a non-zero exit or an
//? unparseable answer is "not signed in" — the runner must fail fast, never open a PTY on a guess.
export function piAuthCheckOk(code: number, raw: string): boolean {
  if (code !== 0) return false;
  const [error, parsed] = tryCatchSync(() => JSON.parse(raw) as unknown);
  if (error || parsed === null || typeof parsed !== 'object') return false;
  return (parsed as { status?: unknown }).status === 'ready';
}

export async function containerPiAuthenticated(container: string, provider: string, runDocker: RunDocker): Promise<boolean> {
  const result = await runDocker(['exec', '-e', `PI_CODING_AGENT_DIR=${PI_CONFIG_DIR}`, container, 'pi', 'auth', 'check', '--provider', provider, '--json']);
  return piAuthCheckOk(result.code, result.out);
}

//? After a turn: pull the (possibly refreshed) auth file back to the host projection when it is fresher.
export async function persistRefreshedPiAuth(container: string, provider: string, runDocker: RunDocker): Promise<void> {
  const result = await runDocker(['exec', container, 'sh', '-c', `cat ${PI_CONFIG_DIR}/auth.json 2>/dev/null || true`]);
  if (result.code !== 0 || result.out.trim().length === 0) return;
  const projected = path.join(authProjectionDir(), PI_AUTH_PROJECTION);
  const [, current] = tryCatchSync(() => (existsSync(projected) ? readFileSync(projected, 'utf8') : null));
  const pick = newerPiAuth(current ?? null, result.out, provider);
  if (pick === result.out && pick !== current) tryCatchSync(() => { writeFileSync(projected, pick, { mode: 0o600 }); });
}

//? pi's TUI is ready once its footer/status strip is painted: the horizontal rule plus the usage cell
//? (`… 0.9%/272k (auto)`, `$0.002 (sub)`) or the model cell (`gpt-… • low`). Broad on purpose.
const PI_READY_PATTERNS: RegExp[] = [
  /─{24,}/,
  /\d+(?:\.\d+)?%\/\d+k/i,
  /\(sub\)/,
  /\s•\s(?:off|minimal|low|medium|high|xhigh|max)\b/,
];
export const matchesPiReady = (buffer: string): boolean => PI_READY_PATTERNS.some((re) => re.test(buffer));

export function piAgentAdapter(subscription: CodingSubscription): CodingAgentAdapter {
  const provider = PI_PROVIDER[subscription];
  return {
    id: 'pi-agent',
    binary: 'pi',
    //? pi's process is `node …/pi-coding-agent/dist/cli.js` — match the package path, not the bare `pi`
    //? (which would also hit `pip`/`pty-agent`-like cmdlines).
    processMatch: 'pi-coding-agent',
    cliVersion: PI_AGENT_VERSION,
    turnArgs: (input) => buildPiTurnArgs(subscription, input),
    prepareHost: () => { refreshProjectedPiAuth(provider); },
    projectAuth: async (container, runDocker) => {
      refreshProjectedPiAuth(provider);
      await projectPiAuth(container, runDocker);
    },
    authenticated: (container, runDocker) => containerPiAuthenticated(container, provider, runDocker),
    afterTurn: (container, runDocker) => persistRefreshedPiAuth(container, provider, runDocker),
    readyMatches: matchesPiReady,
    confirmsTrust: false,
  };
}

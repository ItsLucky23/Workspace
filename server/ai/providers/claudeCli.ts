//? `claude-cli` provider — drives the interactive Claude Code CLI in a node-pty. This is
//? the SUBSCRIPTION-billed path the P0.5 spike proved (clean env → Max subscription, not
//? metered): we NEVER use `-p/--print` (headless = metered). One `complete()` call spawns
//? a PTY, confirms the folder-trust prompt, sends the prompt, and reads the final message
//? off the Stop hook (row B4: `last_assistant_message`) captured to a temp file via
//? `--settings` (so the caller's worktree is never polluted). Latency is a real turn
//? (~10-40s); this shape suits one-shot features (chat/docs-gen/dockerfile-gen). The
//? long-running in-container pipeline agent is a separate session shape, layered later.

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as pty from 'node-pty';
import { tryCatch } from '@luckystack/core';
import type { AiCompletionRequest, AiCompletionResult, AiProvider } from '../types';

const CAPTURE_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'claudeStopCapture.mjs');
//? conpty on Windows cannot resolve a bare `claude`; use the known install path there.
//? In the Linux base image the CLI is on PATH → `claude`. Override with WS_CLAUDE_BIN.
const CLAUDE_BIN = process.env.WS_CLAUDE_BIN ?? (process.platform === 'win32' ? 'C:/Users/mathi/.local/bin/claude.exe' : 'claude');

//? One-shot completions receive all context inline and must never inspect or mutate the host. `*`
//? fails closed for future tools; the named rules keep Bash/Read/Task/MCP denial explicit and auditable.
export const ONE_SHOT_TOOL_DENY = [
  '*',
  'Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'WebFetch', 'WebSearch',
  'Task', 'TaskOutput', 'TaskStop', 'NotebookEdit', 'TodoWrite', 'Skill', 'LSP',
  'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', 'KillShell', 'mcp__*',
] as const;

//? Child env is allowlist-only. It carries process discovery, the user's login/config roots and temp/
//? terminal basics, but no app/database/provider/OAuth/encryption env can cross into the model process.
const CLI_ENV_KEYS = new Set([
  'path', 'pathext', 'home', 'userprofile', 'user', 'username', 'logname', 'shell',
  'appdata', 'localappdata', 'xdg_config_home', 'xdg_cache_home', 'xdg_data_home',
  'xdg_state_home', 'xdg_runtime_dir', 'tmpdir', 'tmp', 'temp', 'systemroot',
  'windir', 'comspec', 'lang', 'lc_all', 'lc_ctype', 'term', 'colorterm',
  'claude_config_dir',
]);

export function buildClaudeCliEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && CLI_ENV_KEYS.has(key.toLowerCase())) out[key] = value;
  }
  const home = source.HOME ?? source.USERPROFILE;
  if (home && out.HOME === undefined) out.HOME = home;
  if (out.TMPDIR === undefined && out.TMP === undefined && out.TEMP === undefined) out.TMPDIR = tmpdir();
  return out;
}

export interface OneShotPty {
  onData: (listener: (data: string) => void) => void;
  write: (data: string) => void;
  kill: () => void;
}

export interface OneShotPtyOptions {
  name: string;
  cols: number;
  rows: number;
  cwd: string;
  env: Record<string, string>;
}

export interface ClaudeCliTurnDependencies {
  spawnPty?: (file: string, args: string[], options: OneShotPtyOptions) => OneShotPty;
  wait?: (ms: number) => Promise<void>;
  env?: NodeJS.ProcessEnv;
  claudeBin?: string;
}

//? Honesty (audit fix): really verify the CLI is present + runnable. The old check returned `true` whenever the
//? bin was the bare name 'claude' — so a host without the CLI installed reported "available" and then failed at
//? turn time. A path → existsSync; a bare name → an actual `--version` probe (PATH-resolved). Cached per process.
let claudeAvail: boolean | null = null;
function claudeCliAvailable(): boolean {
  if (claudeAvail !== null) return claudeAvail;
  if (/[\\/]/.test(CLAUDE_BIN)) { claudeAvail = existsSync(CLAUDE_BIN); return claudeAvail; }
  const res = spawnSync(CLAUDE_BIN, ['--version'], { timeout: 5000, stdio: 'ignore', env: buildClaudeCliEnv() });
  claudeAvail = res.error == null && res.status === 0;
  return claudeAvail;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

export async function driveClaudeCliTurn(req: AiCompletionRequest, dependencies: ClaudeCliTurnDependencies = {}): Promise<AiCompletionResult> {
  const runDir = path.join(tmpdir(), `ws-ai-${String(process.pid)}-${String(process.hrtime.bigint())}`);
  mkdirSync(runDir, { recursive: true });
  const capturePath = path.join(runDir, 'stop.json');
  const settingsPath = path.join(runDir, 'settings.json');
  const mcpPath = path.join(runDir, 'mcp.json');
  //? A type:command Stop hook → the capture script (spike: SessionStart/Stop are
  //? command-transport reliable). This one-shot path is deny-all: it only reasons over
  //? inline prompt data and cannot inspect files, run commands, spawn tasks, or call MCP.
  writeFileSync(settingsPath, JSON.stringify({
    permissions: { allow: [], ask: [], deny: [...ONE_SHOT_TOOL_DENY] },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: `node "${CAPTURE_SCRIPT}" "${capturePath}"` }] }] },
  }, null, 2), 'utf8');
  //? Strict + empty prevents project/user MCP configs from even starting a server for this turn.
  writeFileSync(mcpPath, JSON.stringify({ mcpServers: {} }), 'utf8');

  const args = ['--settings', settingsPath, '--mcp-config', mcpPath, '--strict-mcp-config', ...(req.system ? ['--append-system-prompt', req.system] : [])];
  const spawnPty = dependencies.spawnPty ?? ((file, spawnArgs, options) => pty.spawn(file, spawnArgs, options));
  const waitFor = dependencies.wait ?? wait;
  const term = spawnPty(dependencies.claudeBin ?? CLAUDE_BIN, args, {
    name: 'xterm-color', cols: 120, rows: 34, cwd: req.cwd ?? runDir,
    env: buildClaudeCliEnv(dependencies.env ?? process.env),
  });
  term.onData(() => { /* drain the PTY buffer; output is captured via the Stop hook */ });

  const timeoutMs = req.timeoutMs ?? 90_000;
  await waitFor(6000);         //? boot the REPL / surface the trust prompt
  term.write('\r');            //? confirm folder-trust (default = "Yes, I trust")
  await waitFor(2500);
  term.write(req.prompt);
  await waitFor(1200);
  term.write('\r');            //? submit exactly once; a blind second Enter can start an empty turn

  //? Poll for the Stop-hook capture (turn end) up to the timeout.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !existsSync(capturePath)) await waitFor(1000);
  const captured = existsSync(capturePath);

  term.write(String.fromCodePoint(3)); //? Ctrl+C — end the session cleanly
  await waitFor(600);
  await tryCatch(() => { term.kill(); return Promise.resolve(); });

  let text = '';
  if (captured) {
    const [, payload] = await tryCatch(() => Promise.resolve(JSON.parse(readFileSync(capturePath, 'utf8')) as { last_assistant_message?: unknown }));
    if (payload && typeof payload.last_assistant_message === 'string') text = payload.last_assistant_message;
  }
  //? Best-effort cleanup — on Windows the exiting CLI can briefly hold the dir (EBUSY);
  //? a leftover temp dir must never fail the completion.
  await tryCatch(() => { rmSync(runDir, { recursive: true, force: true }); return Promise.resolve(); });

  if (!captured) return { ok: false, text: '', providerId: 'claude-cli', error: 'ai.turnTimeout' };
  return { ok: true, text, providerId: 'claude-cli' };
}

export const claudeCliProvider: AiProvider = {
  id: 'claude-cli',
  label: 'Claude Code (CLI)',
  //? Available iff the CLI binary actually resolves + runs (`--version`). Login state is still a runtime concern
  //? the turn surfaces, but a not-installed CLI is now reported as unavailable (not falsely available).
  //? The coding agent is subscription-billed (PTY) — no per-workspace key concept (the workspaceId arg the
  //? provider contract now passes is simply not consumed here).
  available: () => Promise.resolve(claudeCliAvailable()),
  complete: (req: AiCompletionRequest) => driveClaudeCliTurn(req),
};

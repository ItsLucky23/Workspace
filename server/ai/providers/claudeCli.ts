//? `claude-cli` provider — drives the interactive Claude Code CLI in a node-pty. This is
//? the SUBSCRIPTION-billed path the P0.5 spike proved (clean env → Max subscription, not
//? metered): we NEVER use `-p/--print` (headless = metered). One `complete()` call spawns
//? a PTY, confirms the folder-trust prompt, sends the prompt, and reads the final message
//? off the Stop hook (row B4: `last_assistant_message`) captured to a temp file via
//? `--settings` (so the caller's worktree is never polluted). Latency is a real turn
//? (~10-40s); this shape suits one-shot features (chat/docs-gen/dockerfile-gen). The
//? long-running in-container pipeline agent is a separate session shape, layered later.

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

const wait = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

//? Strip metered-billing env so the PTY draws on the /login subscription (spike row A1).
function scrubbedEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k.startsWith('ANTHROPIC_') || k === 'CLAUDE_CODE_USE_BEDROCK' || k === 'CLAUDE_CODE_USE_VERTEX') continue;
    out[k] = v;
  }
  return out;
}

async function driveTurn(req: AiCompletionRequest): Promise<AiCompletionResult> {
  const runDir = path.join(tmpdir(), `ws-ai-${String(process.pid)}-${String(process.hrtime.bigint())}`);
  mkdirSync(runDir, { recursive: true });
  const capturePath = path.join(runDir, 'stop.json');
  const settingsPath = path.join(runDir, 'settings.json');
  //? A type:command Stop hook → the capture script (spike: SessionStart/Stop are
  //? command-transport reliable). Permissions locked to read-only tools by default; a
  //? feature that needs writes runs with cwd set + relies on acceptEdits (future arg).
  writeFileSync(settingsPath, JSON.stringify({
    hooks: { Stop: [{ hooks: [{ type: 'command', command: `node "${CAPTURE_SCRIPT}" "${capturePath}"` }] }] },
  }, null, 2), 'utf8');

  const args = ['--settings', settingsPath, ...(req.system ? ['--append-system-prompt', req.system] : [])];
  const term = pty.spawn(CLAUDE_BIN, args, {
    name: 'xterm-color', cols: 120, rows: 34, cwd: req.cwd ?? runDir, env: scrubbedEnv(),
  });
  term.onData(() => { /* drain the PTY buffer; output is captured via the Stop hook */ });

  const timeoutMs = req.timeoutMs ?? 90_000;
  await wait(6000);           //? boot the REPL / surface the trust prompt
  term.write('\r');           //? confirm folder-trust (default = "Yes, I trust")
  await wait(2500);
  term.write(req.prompt);
  await wait(1200);
  term.write('\r');           //? submit
  await wait(2000);
  term.write('\r');           //? re-submit guard (first CR can be eaten by input framing)

  //? Poll for the Stop-hook capture (turn end) up to the timeout.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !existsSync(capturePath)) await wait(1000);
  const captured = existsSync(capturePath);

  term.write(String.fromCodePoint(3)); //? Ctrl+C — end the session cleanly
  await wait(600);
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
  //? Available iff the CLI binary resolves. (Login state is a runtime concern the turn
  //? surfaces; a bare presence check keeps `available` cheap + non-interactive.)
  //? The coding agent is subscription-billed (PTY) — no per-workspace key concept (the workspaceId arg the
  //? provider contract now passes is simply not consumed here).
  available: () => Promise.resolve(existsSync(CLAUDE_BIN) || CLAUDE_BIN === 'claude'),
  complete: (req: AiCompletionRequest) => driveTurn(req),
};

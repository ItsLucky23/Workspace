//? `codex-cli` provider — ONE-SHOT completions on the Codex (ChatGPT Plus/Pro) subscription through pi
//? (`pi --mode json -p`). This is the NON-coding twin of the Claude CLI backend: the same seat the pipeline
//? agent uses, so a workspace with only a Codex subscription can still run script/docs/interviewer features.
//? Headless `-p` is allowed HERE because it is not the coding agent and pi bills the subscription in every
//? mode (one auth store, verified 2026-08-23: `(sub)` + `usage.cost` per turn); ADR 0322 keeps the PTY rule
//? for the code-writing agent only. Deny-all tools: the model only reasons over the inline prompt.
//? @adr 0322

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { tryCatch, tryCatchSync } from '@luckystack/core';

import { hostPiAuthHas, hostPiConfigDir } from '../../orchestrator/codingAgents/piAgent';
import type { AiCompletionRequest, AiCompletionResult, AiProvider } from '../types';

//? conpty/spawn on Windows cannot resolve a bare `pi` (npm shim) — call the `.cmd` shim via a shell there.
const PI_BIN = process.env.WS_PI_BIN ?? 'pi';
//? The resolved bin, for the seat-login PTY (workspacesTerminal.ts) — same resolution, one source of truth.
export function piCliBin(): string { return PI_BIN; }
const PI_PROVIDER = 'openai-codex';
export const CODEX_DEFAULT_MODEL = 'gpt-5.4-mini';

//? Child env is allowlist-only (mirrors claudeCli): process discovery + the user's config roots, never app
//? secrets or provider API keys — pi must resolve the Codex OAuth from its auth file, nothing else.
const CLI_ENV_KEYS = new Set([
  'path', 'pathext', 'home', 'userprofile', 'user', 'username', 'logname', 'shell',
  'appdata', 'localappdata', 'xdg_config_home', 'xdg_cache_home', 'xdg_data_home',
  'xdg_state_home', 'xdg_runtime_dir', 'tmpdir', 'tmp', 'temp', 'systemroot',
  'windir', 'comspec', 'lang', 'lc_all', 'lc_ctype', 'term', 'colorterm',
  'pi_coding_agent_dir',
]);
export function buildPiCliEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && CLI_ENV_KEYS.has(key.toLowerCase())) out[key] = value;
  }
  const home = source.HOME ?? source.USERPROFILE;
  if (home && out.HOME === undefined) out.HOME = home;
  out.PI_SKIP_VERSION_CHECK = '1';
  out.PI_TELEMETRY = '0';
  return out;
}

let piAvail: boolean | null = null;
export function piCliAvailable(): boolean {
  if (piAvail !== null) return piAvail;
  if (/[\\/]/.test(PI_BIN)) { piAvail = existsSync(PI_BIN); return piAvail; }
  const res = spawnSync(PI_BIN, ['--version'], { timeout: 8000, stdio: 'ignore', env: buildPiCliEnv(), shell: process.platform === 'win32' });
  piAvail = res.error == null && res.status === 0;
  return piAvail;
}

//? Pure: the argv for one headless JSON turn. The prompt travels over STDIN (pi merges piped stdin with the
//? message argument), so no prompt text ever hits the argv length cap or shell quoting.
export function buildPiOneShotArgs(model: string, systemFile: string | null): string[] {
  return [
    '--mode', 'json', '-p',
    '--provider', PI_PROVIDER, '--model', model, '--thinking', 'low',
    '--no-tools', '--no-extensions', '--no-skills', '--no-prompt-templates', '-nc', '--no-session',
    ...(systemFile ? ['--append-system-prompt', systemFile] : []),
    'Follow the instructions and answer the request above.',
  ];
}

//? Pure: pick the final assistant text (+ usage) out of pi's JSONL event stream.
export function parsePiJsonOutput(raw: string): { text: string; model?: string; tokensIn?: number; tokensOut?: number } | null {
  let last: { text: string; model?: string; tokensIn?: number; tokensOut?: number } | null = null;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    const [error, evt] = tryCatchSync(() => JSON.parse(trimmed) as { type?: string; messages?: unknown[] });
    if (error || evt?.type !== 'agent_end' || !Array.isArray(evt.messages)) continue;
    for (const m of evt.messages) {
      const msg = m as { role?: string; content?: unknown; model?: string; usage?: { input?: number; output?: number } };
      if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
      const text = msg.content.filter((b): b is { type: string; text: string } => typeof (b as { type?: unknown }).type === 'string' && (b as { type: string }).type === 'text' && typeof (b as { text?: unknown }).text === 'string').map((b) => b.text).join('\n');
      last = { text, ...(msg.model ? { model: msg.model } : {}), ...(typeof msg.usage?.input === 'number' ? { tokensIn: msg.usage.input } : {}), ...(typeof msg.usage?.output === 'number' ? { tokensOut: msg.usage.output } : {}) };
    }
  }
  return last;
}

export async function runPiOneShot(req: AiCompletionRequest, model: string): Promise<AiCompletionResult> {
  const runDir = path.join(tmpdir(), `ws-pi-${String(process.pid)}-${String(process.hrtime.bigint())}`);
  mkdirSync(runDir, { recursive: true });
  let systemFile: string | null = null;
  if (req.system) { systemFile = path.join(runDir, 'system.md'); writeFileSync(systemFile, req.system, 'utf8'); }
  const args = buildPiOneShotArgs(model, systemFile);
  const timeoutMs = req.timeoutMs ?? 120_000;

  const [spawnError, output] = await tryCatch(() => new Promise<{ code: number | null; out: string; err: string }>((resolve, reject) => {
    const child = spawn(PI_BIN, args, { cwd: req.cwd ?? runDir, env: buildPiCliEnv(), windowsHide: true, shell: process.platform === 'win32' });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d: Buffer) => { err += d.toString('utf8'); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    child.stdin.end(`${req.prompt}\n`);
  }));
  await tryCatch(() => { rmSync(runDir, { recursive: true, force: true }); return Promise.resolve(); });

  if (spawnError || !output) return { ok: false, text: '', providerId: 'codex-cli', error: 'ai.cliNotInstalled' };
  const parsed = parsePiJsonOutput(output.out);
  if (!parsed) {
    const notAuth = /not_ready|credentials|login|unauthorized|401/i.test(output.err + output.out);
    return { ok: false, text: '', providerId: 'codex-cli', error: notAuth ? 'ai.notAuthenticated' : (output.code === null ? 'ai.turnTimeout' : 'ai.providerError') };
  }
  return { ok: true, text: parsed.text, providerId: 'codex-cli', ...(parsed.model ? { model: parsed.model } : {}), ...(parsed.tokensIn === undefined ? {} : { tokensIn: parsed.tokensIn }), ...(parsed.tokensOut === undefined ? {} : { tokensOut: parsed.tokensOut }) };
}

export function codexSignedIn(): boolean {
  return hostPiAuthHas('openai-codex');
}

export const codexCliProvider: AiProvider = {
  id: 'codex-cli',
  label: 'Codex (ChatGPT subscription via pi)',
  //? Available iff pi resolves AND the host's pi auth file holds the Codex OAuth entry (presence only; the
  //? token itself is refreshed by pi on use). `hostPiConfigDir` honours PI_CODING_AGENT_DIR.
  available: () => Promise.resolve(piCliAvailable() && existsSync(path.join(hostPiConfigDir(), 'auth.json')) && codexSignedIn()),
  ping: () => Promise.resolve(piCliAvailable() ? (codexSignedIn() ? { ok: true } : { ok: false, error: 'ai.notAuthenticated' }) : { ok: false, error: 'ai.cliNotInstalled' }),
  complete: (req, opts) => runPiOneShot(req, opts?.model ?? CODEX_DEFAULT_MODEL),
};

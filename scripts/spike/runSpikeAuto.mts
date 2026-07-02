//? P0.5 spike — AUTONOMOUS driver (Spike A billing + Spike B hooks). Unlike
//? runSpike.mts (interactive, operator-driven), this drives ONE real `claude` turn
//? programmatically: spawns an interactive PTY with a SCRUBBED env, renders type:http
//? lifecycle hooks → the capture endpoint, sends a tool-using prompt, waits, and exits.
//? Meant to be run once against a logged-in host to fill SPIKE_RESULTS.md rows A1/B*.
//? Run: `npx tsx scripts/spike/runSpikeAuto.mts` (hook capture must be running first).

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as pty from 'node-pty';

const HOOK_PORT = Number(process.env.WS_SPIKE_HOOK_PORT ?? '8790');
const HOOK_TOKEN = process.env.WS_SPIKE_HOOK_TOKEN ?? 'spike-dev-token';
const HOOK_BASE = `http://127.0.0.1:${String(HOOK_PORT)}/hook`;
const CLAUDE_BIN = process.env.WS_SPIKE_CLAUDE_BIN ?? 'claude';

//? type:http hook → the capture endpoint (the architecture's target transport).
function httpHook(event: string, matcher?: string): unknown {
  const entry = { hooks: [{ type: 'http', url: `${HOOK_BASE}/${event}`, headers: { 'X-WS-Hook-Token': HOOK_TOKEN } }] };
  return matcher === undefined ? entry : { matcher, ...entry };
}
//? type:command hook → curl the capture endpoint. Proven-supported transport; the
//? control fallback if type:http turns out unsupported interactively. Distinct path
//? suffix (`-cmd`) so the capture summary shows which transport actually fired.
function cmdHook(event: string, matcher?: string): unknown {
  const cmd = `curl -s -m 3 -X POST -H "X-WS-Hook-Token: ${HOOK_TOKEN}" ${HOOK_BASE}/${event}-cmd -d @-`;
  const entry = { hooks: [{ type: 'command', command: cmd }] };
  return matcher === undefined ? entry : { matcher, ...entry };
}

const settings = {
  //? Scope the auto-run to ONLY `echo` (no permission bypass) so the turn runs without
  //? an interactive prompt yet cannot execute anything else.
  permissions: { allow: ['Bash(echo:*)'] },
  //? Register BOTH transports per event so one run tells us which one fires.
  hooks: {
    SessionStart: [httpHook('SessionStart'), cmdHook('SessionStart')],
    UserPromptSubmit: [httpHook('UserPromptSubmit'), cmdHook('UserPromptSubmit')],
    PreToolUse: [httpHook('PreToolUse', 'Bash'), cmdHook('PreToolUse', 'Bash')],
    PostToolUse: [httpHook('PostToolUse', 'Bash'), cmdHook('PostToolUse', 'Bash')],
    Stop: [httpHook('Stop'), cmdHook('Stop')],
    Notification: [httpHook('Notification'), cmdHook('Notification')],
  },
};

function scrubbedEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (/^ANTHROPIC_/.test(k)) continue;
    if (k === 'CLAUDE_CODE_USE_BEDROCK' || k === 'CLAUDE_CODE_USE_VERTEX') continue;
    out[k] = v;
  }
  return out;
}

const projDir = join(tmpdir(), `ws-spike-auto-${String(process.pid)}`);
mkdirSync(join(projDir, '.claude'), { recursive: true });
writeFileSync(join(projDir, '.claude', 'settings.json'), JSON.stringify(settings, null, 2), 'utf8');

console.log('[spike-auto] project:', projDir);
console.log('[spike-auto] hooks → ', HOOK_BASE, '(type:http)');
console.log('[spike-auto] env: ANTHROPIC_* stripped (Spike A clean-env → subscription)');

const term = pty.spawn(CLAUDE_BIN, [], {
  name: 'xterm-color', cols: 120, rows: 34, cwd: projDir, env: scrubbedEnv(),
});
let out = '';
term.onData((d) => { out += d; process.stdout.write(d); });

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function drive(): Promise<void> {
  await wait(6000);                     // let the REPL boot / clear any first-run prompt
  term.write('\r');                     // confirm the trust prompt (default = "Yes, I trust")
  await wait(3000);
  //? A tool-using prompt → should fire SessionStart, UserPromptSubmit, PreToolUse,
  //? PostToolUse(Bash), Stop. Kept trivial + safe.
  term.write('Use the Bash tool to run exactly this command: echo spike-ok-marker. Then reply with the single word done.');
  await wait(1500);
  term.write('\r');                     // submit
  await wait(2500);
  term.write('\r');                     // ensure submit (in case the first was consumed by input framing)
  await wait(62000);                    // let the turn complete + turn-lifecycle hooks flush
  console.log('\n[spike-auto] turn window elapsed — exiting claude.');
  term.write(String.fromCharCode(3));  // Ctrl+C to end the session cleanly
  await wait(1000);
  term.kill();
  await wait(500);
  //? Persist the transcript so we can inspect trust prompts / hook errors post-run.
  const transcript = join(tmpdir(), 'ws-spike-transcript.txt');
  writeFileSync(transcript, out, 'utf8');
  console.log('[spike-auto] transcript →', transcript);
  rmSync(projDir, { recursive: true, force: true });
  //? Quick heuristic on the captured PTY for the billing/turn signal.
  const ran = /spike-ok-marker/.test(out);
  console.log(`[spike-auto] PTY saw the echo output: ${ran ? 'YES (a real turn ran on the clean-env subscription)' : 'NO — inspect the PTY log above'}`);
  process.exit(0);
}

void drive();
